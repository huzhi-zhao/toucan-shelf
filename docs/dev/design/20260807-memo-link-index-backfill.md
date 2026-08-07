# memo_link 反向索引线上回填方案

## 背景

[cross-reference-repair-on-move-rename.md](../requirements/cross-reference-repair-on-move-rename.md)
的 P0/P1/P2 都依赖 `memo_link` 表（`store/migration/sqlite/0.30/12__memo_link.sql`）。
但该表只在两处写入：`CreateMemo`（[memo_service.go:186](../../../server/router/api/v1/memo_service.go:186)）
和 `UpdateMemo` 里 content 变化时（[memo_service.go:731](../../../server/router/api/v1/memo_service.go:731)）。
建表迁移本身没有做一次性回填，导致功能上线前就存在、且上线后没再被编辑过正文的文档，
`memo_link` 里完全没有它们的行——实测本地 `memos_prod.db`：64 篇正常文档，`memo_link` 0 行。

后果：
- P2（重命名自动修复引用锚文本/href）对这些文档静默失效——`ListMemoLinks` 查不到任何反向引用，
  直接提前返回（[link_repair.go:25](../../../server/router/api/v1/link_repair.go:25)）。
- P1（被引用则拒绝归档/删除）同样失效——走的是同一张表（[memo_service.go:157](../../../server/router/api/v1/memo_service.go:157)）。

## 方案：应用启动时自动全量回填

新增 `APIV1Service.BackfillMemoLinkIndex`（[link_index.go](../../../server/router/api/v1/link_index.go)），
在 `server.Start` 里作为后台 goroutine 启动，与既有的 `memopayload` runner
（[server.go:180](../../../server/server.go:180)）完全同构：

- 分批（100 条/批）拉取所有 `RowStatus=NORMAL` 的文档；
- 对每篇调用已有的 `syncMemoLinkIndex`，即重新解析正文 + `ReplaceMemoLinks` 整表覆盖写。

**不需要迁移脚本、不需要一次性标记位、不需要人工介入。** 理由：

1. `ReplaceMemoLinks` 是全量覆盖（先 `DELETE WHERE memo_id=?` 再插入），天然幂等——
   重复跑对已经有正确索引的文档是纯粹的空操作（相同数据覆盖相同数据）。
2. 现有的 `memoPayloadRunner.RunOnce` 就是同样的模式：每次启动无条件跑一遍全量重建，
   代码里的注释原话是"so payloads stay in sync when the extraction rules change between
   versions"——同样的逻辑适用于 memo_link 的 schema/解析规则以后再变的情况，不用每次都手写新的
   一次性回填。
3. 数据量级：单实例知识库场景下文档数是几十到几千量级，不是 SaaS 多租户体量；分批扫描 + 单机
   parse 的开销可忽略，不需要限流或后台任务队列。

## 部署步骤

1. 合并本次改动（backfill 方法 + server.go 接线 + `RestoreMemoHistory`/`repairOneInboundLinkAnchor`
   两处遗漏的索引同步）。
2. 正常发布/重启服务即可，无需额外操作。启动日志会打一行：
   `memo link index backfill finished processed=<N>`，可用它确认回填跑完、覆盖了多少篇文档。
3. 回填与 HTTP 服务启动并行（不阻塞端口监听），和 memopayload rebuild 一样是尽力而为：
   单篇解析失败会被 `slog.Warn` 记录并跳过，不影响其余文档、不影响服务可用性。

## 验证

- 回填后确认索引不再是空表：
  ```bash
  sqlite3 memos_prod.db "select count(*) from memo_link;"
  ```
  应该跟正文里实际包含站内链接的文档数量级一致，不再是 0。
- 挑一篇有正文站内链接、且上线前就存在的文档，重命名它的引用目标，确认引用方文档的锚文本/href
  被自动改写（P2）；对它发起删除，确认被引用方文档档名出现在拒绝错误里（P1）。
- 单测覆盖：新增 `TestMemoLinkIndexBackfill`
  （[memo_link_index_test.go](../../../server/router/api/v1/test/memo_link_index_test.go)），
  模拟"预先存在、索引行被清空"的文档，跑 `BackfillMemoLinkIndex` 后确认索引恢复。

## 本次一并修的两处遗漏

回填能补上历史数据，但如果链路里还有别的地方"改了正文却不同步索引"，索引会再次腐化。审查后发现两处：

- `RestoreMemoHistory` 直接改 `content` 而不经过 `UpdateMemo` 的 `contentUpdated` 分支
  （[memo_history_service.go:202](../../../server/router/api/v1/memo_history_service.go:202)），
  回滚版本后索引跟正文不一致。已加 `syncMemoLinkIndex` 调用。
- `repairOneInboundLinkAnchor` 自己改写了引用方文档的正文（P2 的一部分），但没有重建那篇文档
  自己的索引（[link_repair.go](../../../server/router/api/v1/link_repair.go)）。已补上。
