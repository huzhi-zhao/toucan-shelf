# 存储层收敛：以 SQLite 为唯一数据源

分阶段实施计划见
[design/20260807-storage-consolidation.md](../../design/20260807-storage-consolidation.md)。

## 背景

本项目 fork 自 memos，继承了 sqlite / mysql / postgres 三套数据库驱动。线上部署为
单实例（4 核 24G），使用 sqlite，生产库 `memos_prod.db` 当前约 5.1MB。

起因是评估「线上 sqlite 升级 postgres 的成本」。评估结论是**不升级**，并进一步发现
真正的技术债不在 sqlite，而在同时维护三套从未被部署、也从未被 CI 覆盖的驱动。

本计划的目标因此从「迁移到 postgres」反转为「删除 mysql / postgres 驱动，收敛到 sqlite」。

## 为什么不升级 postgres

### 收益为负

Postgres 的优势集中在多实例、高并发写、连接池等场景，单机知识库一个都用不上。而切换
后会**立刻失去两个已有功能**：

- **RAG 混合搜索**。`store/db/postgres/memo_chunk.go` 仅 54 行，全部返回
  `errRAGUnsupported`；对照 sqlite 的 374 行完整实现。`store/migration/postgres/` 下
  不存在 `rag_search.sql`，`memo_chunk` / `memo_index_job` 两张表在 postgres 根本没有。
  且 [server/server.go:223](../../../../server/server.go) 写死了
  `if s.Profile.Driver == "sqlite"` 才启动索引 worker。
- **自动备份**。[server/runner/backup/runner.go:31](../../../../server/runner/backup/runner.go)
  `if r.Profile.Driver != "sqlite" { return }`。

此外 [store/db/postgres/user.go:92](../../../../store/db/postgres/user.go) 的 `ListUsers`
直接返回 `user filters are not supported`。

### 迁移成本并不随时间增长

数据量 5.1MB，且迁移的主要成本是 schema 类型映射（`INTEGER PRIMARY KEY AUTOINCREMENT`
→ `SERIAL` 及序列 `setval` 修复、`0/1` → `boolean`、`BLOB` → `bytea`）与一次性搬运脚本，
属于固定成本。1GB 与 5MB 的迁移工作量基本一致。这不是滚雪球型技术债。

## 真正的债：三份税

每个 schema 变更需要写三份迁移 + 三份 Go 实现。以本项目自研的 `0.30` 系列为例：

| 目录 | .sql 文件数 |
|---|---|
| `store/migration/sqlite/` | 69 |
| `store/migration/mysql/` | 40 |
| `store/migration/postgres/` | 33 |

| 驱动实现 | 行数 | 文件数 |
|---|---|---|
| `store/db/sqlite/` | 3353 | 20 |
| `store/db/postgres/` | 3186 | 19 |
| `store/db/mysql/` | 2944 | 19 |

而 [.github/workflows/backend-tests.yml:83](../../../../.github/workflows/backend-tests.yml)
中 `DRIVER: ${{ matrix.test-group == 'store' && '' || 'sqlite' }}`，空值在
[store/test/store.go:108](../../../../store/test/store.go) 回落为 sqlite。**这 6130 行
mysql/postgres 代码从未被 CI 执行过一次。**

腐烂痕迹已经可见：

- RAG 仅 sqlite 实现，另两者是桩
- postgres `ListUsers` 不支持 filter
- 迁移编号已错位且不可逆：sqlite 为 `08__rag_search` + `09__secret_block`，
  postgres 为 `08__secret_block`。两条时间线无法再对齐

## 决策依据：两个前置问题的回答

在确定方案前，明确回答了两个问题。

### Q1 将来重新支持 pgsql + pgvector，成本是否低于长期维护？

**是，且差距显著。** 三条理由：

1. **抽象边界干净。** `store/driver.go` 是 69 方法的接口，SQL 完全封装在
   `store/db/{driver}/` 内，上层调用领域方法而非 SQL。新增驱动是机械填空，不触碰业务逻辑。
   驱动泄漏点经排查为五处，且均为显式判断，可直接作为将来的 TODO 清单：
   - `server/server.go:223` — RAG worker 启动条件
   - `server/runner/backup/runner.go:31,49` — 备份 runner
   - `server/backup/backup.go:59` — 备份执行入口
   - `store/migrator.go:271` — demo 模式 seed
   - `internal/filter/` — CEL 方言分支（`DialectMySQL` / `DialectPostgres` 合计 65 处引用：
     `render.go` 34、`schema.go` 12、`engine_test.go` 8、`functions_test.go` 11）

2. **删除后重新支持比现在维护更便宜。** 不存在任何 postgres 存量用户，因此将来永远
   不需要 postgres 的增量迁移链，只需一份 `LATEST.sql` 快照建库。当前正在维护的恰恰
   是那条无人走的增量链。

3. **现存 postgres 代码对 pgvector 场景零帮助。** 向量相关实现为空。将来做 pgvector
   要写的内容与今天是否保留这些文件无关。

代价是将来重写 69 个方法约 3–5 人日，与当前已经分摊付出的维护成本处于同一量级。

### Q2 sqlite 在可预见的数据增长下是否稳定够用？

**够用。** 目标场景为 100 人以下团队与个人，纯 md 文档现实上限估计 500MB–2GB，
sqlite 在该区间为舒适区。写并发方面 WAL 为「单写多读」，文档编辑属人类打字速度，
实际写 QPS 为个位数，`sqlite.go:53` 的 `busy_timeout(10000)` 足够覆盖。

但需记录三个**先于 sqlite 容量到顶的真实瓶颈**：

**① FTS5 trigram 索引体积。** `memo_chunk_fts` 使用 `tokenize='trigram'`（CJK 无分词器
时的正确选择），索引体积通常为原文的 3–5 倍，而 unicode61 仅 0.3–0.5 倍。**监控库体积
需按此系数换算真实文档量。**

**② 向量检索是应用层重排，非全库召回。**
[internal/rag/search.go:174](../../../../internal/rag/search.go) 中
`ListMemoChunks(FindMemoChunk{MemoIDs: memoIDs})` 的 `memoIDs` 来自 FTS 候选集
（`candidateLimit = 50`），再由 [internal/rag/vector.go](../../../../internal/rag/vector.go)
的纯 Go `cosine()` 逐个打分。

- 性能上**有界且安全**：最多计算 50 个文档的 chunk，与总量无关。
- 能力上有边界：当前语义搜索实为「关键词召回 + 语义重排」，FTS 未命中的文档无法被捞回。

这正是将来引入 pgvector 的**真正理由——能力而非性能**，属独立的功能决策，与数据量无关。

**③ `SearchMemosLike` 为全表扫描。** `memo_chunk.go:265` 的 LIKE 兜底路径无索引可用，
文档增多后线性变慢。此问题与数据库选型无关，postgres 上同样慢。

## 需求

1. 删除 mysql、postgres 驱动实现与迁移文件，`store/db/db.go` 仅保留 sqlite 分支
2. `internal/filter` 收敛为单方言，移除 `DialectMySQL` / `DialectPostgres` 分支
3. 清理五处 `if driver == "sqlite"` 泄漏点（判断恒真，直接展开）
4. 测试脚手架移除 mysql/postgres testcontainers 路径
5. 文档与部署配置中移除多驱动说明

## 非目标

- **不做**数据迁移。线上库不动，不涉及任何生产数据变更
- **不改**任何业务逻辑、API 契约、proto 定义
- **不改**表结构。sqlite 的 schema 与迁移链保持原样
- **不实现** pgvector 或任何向量数据库能力
- **不优化** `SearchMemosLike` 全表扫描（独立议题，见观察指标）
- **不调整** sqlite pragma。原计划中的「收敛后开启 mmap」已查明不可行：
  `mmap_size(0)` 是 commit `05f31e45`（*prevent OOM errors*）显式加入的防御性设置，
  代码注释亦有说明。改动需独立的 OOM 复现与压测支撑，不搭本次收敛的车

## 复评触发条件

删除后并非永久决定。以下任一指标触发时重新评估存储选型：

| 指标 | 阈值 | 说明 |
|---|---|---|
| `memos_prod.db` 体积 | > 20GB | 需除以 4–6 换算真实文档量（trigram 系数） |
| `database is locked` | 开始出现 | 10s busy_timeout 已排不下 |
| 搜索 P95 延迟 | > 500ms | 大概率为 `SearchMemosLike` 兜底路径 |

需要全库语义召回（而非当前的 FTS 召回 + 向量重排）时，按 Q1 的结论重新引入 postgres +
pgvector，预算 3–5 人日。
