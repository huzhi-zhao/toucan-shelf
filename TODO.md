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

- [ ] **RAG 库内搜索（F2）** —— Notebook 二级侧栏内的库内检索。
      见 [rag-search.md](docs/dev/rag-search.md)。
      **前置改造**：`SearchRequest` 的 workspace scope 目前是 `workspace_id int32`，
      而前端 Workspace 只带 `workspaces/{UID}` 资源名，没有数字 id。应先把 proto
      改成字符串资源名 + 后端解析 UID→id，再动 F2。另与 `Notebook.tsx` 的预览区
      耦合较深。

- [ ] **知识库级授权收紧到文档/文件夹粒度** —— 现在"分配到库 = 库内文档最大读写"
      是第一期的粗粒度方案。见
      [workspace-member-access.md §5](docs/dev/requirements/collaboration/workspace-member-access.md)。
      同一批要处理的还有 §7 的 **secret block 与库级授权脱节**：可见性按
      `creator_id` 判断、且密钥是用户级的，两层问题叠在一起，需要重新设计密钥分发，
      不是放开查询过滤就行。

- [ ] **secret block 遗留兼容代码清理** —— 全仓 grep
      `LEGACY-COMPAT(secret-block/per-block-passphrase)`。删除判据是
      `SELECT COUNT(*) FROM secret_block WHERE kdf = 'pbkdf2-sha256'` 归零；
      归零前删除那些行的密文永久无法解开。**不要**连带删
      `secret-crypto.ts` 的 `encryptSecret`/`decryptSecret`——`master-v1` 用它们
      包/解包主密钥。见 [secret-block.md](docs/dev/requirements/editor/secret-block.md)。

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

- [ ] **孤儿密文手动管理页** —— 加密块永不自动 GC，需要一个手动清理入口。
      见 [secret-block.md](docs/dev/requirements/editor/secret-block.md)。

- [ ] **文档评论的 LLM 语义兜底（RelocateAnchor）** —— 锚点四级降级之外的最后一档，
      评估过，未实现。

- [ ] **sheets 快照写入失败重试** —— 当前是静默覆盖。留待多人协作编辑时一并处理。
      见 [sheets-block.md](docs/dev/requirements/editor/sheets-block.md)。

- [ ] **SQLite 驱动泄漏点清理** —— 已排查出五处显式判断，可直接作为清理清单。
      见 [sqlite-as-sole-datasource.md](docs/dev/requirements/storage/sqlite-as-sole-datasource.md)。

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

- [ ] **memogit 附件上传** —— 本地新增附件 push 回服务端，代码里没找到对应实现。
      见 [memogit-sync.md](docs/dev/requirements/collaboration/memogit-sync.md)。
- [ ] **附件 10M 大小限制** —— 定义文档写了，`uploadService.ts` /
      `mediaInsertService.ts` 里没找到对应校验常量。
      见 [upload-and-inline-media.md](docs/dev/requirements/attachments/upload-and-inline-media.md)。
- [ ] **`rehype-sanitize` 的 SANITIZE_SCHEMA 当前实际配置** —— 出处同上。
- [ ] **附件搬迁脚本是否已执行** —— 出处同上。
- [ ] **standalone 部署的三条** —— 自动备份的两个已知 bug 是否仍在、无 S3 时的
      警告条是否实现、S3 凭证的环境变量读取路径是否落地。
      见 [standalone-local-deploy.md](docs/dev/standalone-local-deploy.md)。
- [ ] **全站备份的若干项** —— 见
      [backup.md §TODO(确认)](docs/dev/requirements/storage/backup.md)。
- [ ] **calendar 块的写回能力**是哪次迭代加的、有无独立需求记录。
      见 [calendar-block.md](docs/dev/requirements/editor/calendar-block.md)。
- [ ] **sheets 的 `commitFromInstance`** 当前实现是否仍是原设计描述的样子。
      见 [sheets-block.md](docs/dev/requirements/editor/sheets-block.md)。
