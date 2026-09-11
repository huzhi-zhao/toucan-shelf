# TODO

本仓库**唯一**允许写"还没做"的地方。原 `docs/dev/roadmap.md` 的未竟事项列表迁移至此。

规则沿用原 roadmap：**只做索引**，一行一条，指回定论所在的需求/设计文档。
不复述方案，不记排期、负责人、当前状态——那些属于 Issue。

条目分三类：

- **已定未做** —— 方案已在某篇文档里定下来，只是没时间做。
- **待确认** —— 文档里写了但没核对过代码，不确定是"没做"还是"做了没记"。
  **先去读代码确认**，确认已实现就改掉对应文档，确认未实现再挪进上面的列表。
- **明确不做** —— 见各需求文档自己的"明确不做"节，本篇不重复。

能力阶段与已交付内容的叙述见 [docs/dev/roadmap.md](docs/dev/roadmap.md)。

---

## 一、进行中的收尾

### 对外发布（Publish）

主体已交付，剩两笔欠账。见
[design/20260823-public-publishing/tech-design.md](docs/dev/design/20260823-public-publishing/tech-design.md)。

- [ ] **自定义域名** —— 归属校验、证书、301。主要是部署侧工作，未开工。
- [ ] **CSR 导致爬虫拿不到正文** —— 见方案 §8。SEO 的另一半（sitemap/robots/
      canonical/410/404）已完成，这条仍在。
- [ ] **`site_chunk` 索引复评** —— 站内搜索目前是 `site_publication` 上的 `LIKE`
      子串匹配，没有索引表、分词与向量，文章多了会线性扫。原方案的 `site_chunk`
      换来相关性与速度，推迟至此复评。

---

## 二、已定未做

### 下一步做

- [ ] **知识库级授权收紧到文档/文件夹粒度** —— 现在"分配到库 = 库内文档最大读写"
      是第一期的粗粒度方案。见
      [workspace-member-access.md §5](docs/dev/requirements/collaboration/workspace-member-access.md)。
      同一批要处理的还有 §7 的 **secret block 与库级授权脱节**：可见性按
      `creator_id` 判断、且密钥是用户级的，两层问题叠在一起，需要重新设计密钥分发，
      不是放开查询过滤就行。

### 定了方向、暂不排期

- [ ] **外部资源根（NAS 资源接入）** —— 索引 NAS 上已存在的文件而不要求重新上传，
      产品边界为"引用而非接管"。需求见
      [external-resource-roots.md](docs/dev/requirements/storage/external-resource-roots.md)，
      方案与分阶段见
      [design/20260827-external-resource-roots.md](docs/dev/design/20260827-external-resource-roots.md)。
      **权限模型未定，定不下来之前不应开工**；P0 的容量判断点若不成立，整个方案中止。

- [ ] **公开附件的实例级 kill switch** —— 管理员一键停掉全实例的公开附件。
      落点不在 `attachmentacl` 内部（public 分支的价值就是不查任何东西就早退），
      应照 `AllowAnonymous` 加一个 `Request` 字段由 fileserver 在入口带进来。
      见 [access-control-and-private-files.md §尚未实现](docs/dev/requirements/attachments/access-control-and-private-files.md)。

- [ ] **公开附件的审计** —— 谁在何时把哪个附件设成公开，目前无记录。写侧已收敛成
      `authorizeAttachmentAccessUpdate` 单点，难点不在埋点而在没有通用审计表。
      出处同上。

- [ ] **引用修复的批量写入事务与索引重建合并** —— 文件夹改名/移动引发的引用修复
      逐篇改写正文，当前每篇各触发一次 RAG 索引任务。
      见 [cross-reference-repair-on-move-rename.md](docs/dev/requirements/cross-reference-repair-on-move-rename.md)。

- [ ] **`folder_path` 进 CEL filter schema** —— 让 `memo_list_memos` 能按文件夹路径
      批量捞文档。`workspace_get_workspace_tree` 已覆盖主要场景，故推迟。
      见 [mcp-authoring.md §7](docs/dev/requirements/collaboration/mcp-authoring.md)。

- [ ] **编辑器软提示 agent 未确认编辑** —— 人类打开 `agent_session_open == true`
      的文档时提示"此文档有 AI 编辑且尚未确认"。flag 已建好，补 UI 成本低。
      出处同上。

- [ ] **memogit 附件上传（单向 → 双向）** —— 已确认未实现，且"只下载不上传"是写进
      `push.go` / `attachments.go` 注释与 agent 须知的当前契约，不是没来得及做。要开
      就得连带重定义 `_attachments/` 的可写性、`status` 脏检测与冲突处理。**做不做未定。**
      见 [memogit-sync.md §7](docs/dev/requirements/collaboration/memogit-sync.md)。

- [ ] **孤儿密文手动管理页** —— 加密块永不自动 GC，需要一个手动清理入口。
      见 [secret-block.md](docs/dev/requirements/editor/secret-block.md)。

- [ ] **文档评论的 LLM 语义兜底（RelocateAnchor）** —— 锚点四级降级之外的最后一档，
      评估过，未实现。

- [ ] **sheets 快照写入失败重试** —— 当前是静默覆盖。留待多人协作编辑时一并处理。
      见 [sheets-block.md](docs/dev/requirements/editor/sheets-block.md)。

- [ ] **无远程备份时的警告条** —— 允许无 S3 启动是既定决策，配套的"未配置远程备份"警告条
      与降级提示仍未实现，已核实前端无任何相关逻辑。
      见 [standalone-local-deploy.md](docs/dev/standalone-local-deploy.md)。

- [ ] **S3 凭证的环境变量读取路径** —— standalone 恢复场景下本地 DB 还不存在，凭证只能来自
      `TOUCAN_S3_*` 环境变量。已核实这批变量在代码里零命中，凭证仍只从 DB 读；这条是
      "从 S3 恢复"的前置。出处同上。

- [ ] **备份专用桶** —— 备份现在只能复用 Attachment storage 的同一个桶换 prefix。
      是否允许 admin 单独指定一个备份桶是未决的产品问题，不是实现遗漏。
      见 [backup.md §未决](docs/dev/requirements/storage/backup.md)。

- [ ] **存量附件按 workspace 前缀搬迁** —— 搬迁脚本不存在、从未执行。新旧混存不影响访问，
      要不要搬是产品判断。
      见 [upload-and-inline-media.md](docs/dev/requirements/attachments/upload-and-inline-media.md)。

- [ ] **自动备份间隔做成配置项** —— 周期判定已改为读 `last_backup_time` 并在启动时补跑，
      但间隔本身仍是常量 `backupInterval`，接到 `InstanceSetting` 或环境变量未做。
      出处同上。

- [ ] **知识库物理删除** —— `DeleteWorkspace` RPC 保留（要求库为空）但前端不给入口。
      见 [workspace-detail-and-shelf.md](docs/dev/requirements/knowledge-base/workspace-detail-and-shelf.md)。

- [ ] **RAG 索引范围按知识库可配置** —— `internal/rag/index.go` 的 `IsIndexable`
      已预留扩展点，是否做成知识库详情页的可配置项未定。
      见 [rag-search.md](docs/dev/rag-search.md)。

- [ ] **正文 `#tag` 的解析与统计清除** —— `#tag` 已暂停使用（决策与理由见
      [roadmap.md](docs/dev/roadmap.md)）。清除范围是 `memopayload` 的抽取、
      `user_service_stats` 的标签统计、以及编辑器里的 `#` 高亮与补全。
      **没排期，因为老文档正文里还留着 `#tag` 文本**——删解析之前要先决定这些文本
      怎么办（原样留着当普通文字，还是迁移进 frontmatter）。

- [ ] **RAG 的生成环节（真正的 RAG）** —— 检索已完备，缺"检索 top-K → 交给 LLM →
      带来源生成回答"。**有明确触发条件，条件未满足前不排期**，
      见 [rag-search.md](docs/dev/rag-search.md) 的触发条件一节。

---

## 三、待确认（先核实，别当需求排期）

暂无。上一批三条已核实完毕，结论已回写各自文档，未实现的部分见上面的「已定未做」。
