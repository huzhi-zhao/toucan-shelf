# Roadmap —— 能力阶段与未竟事项

常青文档，原地改写。

本篇是 `docs/dev/` 里**唯一**允许出现"还没做"的地方（见
[README §三](README.md) 的进度不进文档规则）。它只做**索引**：一行一条，
指回定论所在的需求/设计文档，不在这里复述方案，也不记录排期、负责人、
当前状态这类天天变的东西——那些属于 Issue。

条目分三类：

- **已定未做**：方案已经在某篇文档里定下来了，只是没时间做。
- **明确不做**：已经决策为不做，列在这里是防止被反复重提。见各篇的"明确不做"节，
  本篇不重复。
- **待确认**：文档里写了但没核对过代码，不确定是"没做"还是"做了没记"。
  这类先去核实，不要直接当需求排期。

---

## 一、能力阶段

### Now —— 当前在做

- **对外发布（Publish）** —— 单篇文档发布到对外站点。需求见
  [20260823-public-blog-publishing.md](requirements/20260823-public-blog-publishing.md)，
  技术方案与分阶段切分见
  [design/20260823-public-publishing/](design/20260823-public-publishing/tech-design.md)，
  上线与验收清单见 [launch/20260823-public-publishing.md](launch/20260823-public-publishing.md)。
  门面（外壳、首页编排、主题、皮肤）单独一套文档：需求
  [public-site-front-end.md](requirements/public-site-front-end.md)、方案
  [design/20260823-public-publishing/front-end.md](design/20260823-public-publishing/front-end.md)、
  上线 [launch/20260824-public-site-front-end.md](launch/20260824-public-site-front-end.md)。
  P0 的后端与前端已落地（四张新表、发布管线、按 Host 的对外只读接口、站点管理、
  编辑器发布入口、对外 `/<slug>` 页面）。P1 一致性也已完成：撤下、归档等同撤下、
  站点首页文档不许归档/删除、编辑器里的"线上落后于当前版本"提示与死链页面清单。
  P2a 外壳换皮已完成：对外三个页面换成 `BlogSite/` 皮肤、站点配置里的顶部菜单
  （新表字段 `site.menu`）、主题白名单**在服务端校验**后才落库。
  P2b 首页编排也已完成：封面在发布时定进快照（`PublicPage.cover_url`，取值顺序
  frontmatter `cover` → 正文首图 → 空，同时管线开始剥掉整块 frontmatter）、
  首页读 dashboard `.blogview` 的快照并解析成块（markdown / 对外卡片墙 /
  对外列表三种，解析全程兜底，未配则回落成平铺 feed）、布局编辑器多了两种
  **对外块**及其自己的表单。
  首页后来改成**不是站点的一个页面**：布局文档不能当普通文章发（服务端拒、前端
  不给入口），快照存在 site 行上（`site.dashboard_snapshot`）、随站点 profile
  内联下发，在设置里选中/重新保存这篇文档时生成——它没有 slug，也就不会像早期
  实现那样以 `index` 为标题带着一坨块 JSON 混进文章列表。生成快照时**在服务端
  按字段白名单剪块**：库内 gallery / calendar 的 scope 里写着文件夹路径和
  frontmatter 属性规则，读者端不渲染它们，但不渲染不等于没发出去。走 fixture 的预览原型（`/blog-preview`）已删。
  首页文档后来又从 `.view` 里**分了出来**：新增文档类型 `BLOGVIEW`（本地
  `.blogview.json`），因为对外块与库内块的集合不相交、两端渲染器互相拒绝，该用哪一套
  在建文档那一刻就定了。编辑器共用同一个组件、按类型分叉插入菜单；站点设置的首页下拉
  只列 `.blogview`，`.view` 被服务端明确拒绝当首页。
  P2c 导航树也已完成：站点配置里手写的树（新表字段 `site.nav`，服务端校验层级、
  条数与"只能指向本站点 slug"）、对外的 `/contents` 目录页，以及**服务端按已发布
  集合裁剪**——指向未发布文章的项不下发（不是前端不渲染），底下什么都没有的分组
  整项消失，因此既不会出现死链，也不会靠一个标签泄露某篇文档存在。
  P3 站内搜索也已完成，但落的是**最小实现**：`SearchPublicPages` 在
  `site_publication` 上做 `LIKE` 子串匹配（标题 / 摘要 / 快照正文，多词全中，
  转义 `%` `_`），没有索引表、没有分词、没有向量，文章多了会线性扫。隔离要求
  由"只查快照表"这一条满足——匿名读者搜不到未发布文档，也搜不到发布之后新加的
  正文。原方案的 `site_chunk` 索引换来的是相关性和速度，推迟到 P4 前复评。
  P4 拆成两半，**SEO 那半已完成**：站点自己的 sitemap / robots（只列本站点已发布
  slug）、按 `site.canonical` 下发 `Link: rel="canonical"`、非规范入口 `Disallow`、
  撤下页 410 + 从未存在的 slug 404 + 两者 `X-Robots-Tag: noindex`。这条治的是
  "SPA 对任何 URL 都回 200，撤下一篇文章之后爬虫看到的还是 200，文章一直留在
  搜索结果里"。**自定义域名那半（归属校验、证书、301）未开工**，主要是部署侧。
  CSR 导致爬虫拿不到正文的欠账仍在（方案 §8）。

### Next —— 定了、下一步做

- **RAG 库内搜索（F2）** —— Notebook 二级侧栏内的库内检索。
  见 [rag-search.md](rag-search.md)。
  **前置改造**：`SearchRequest` 的 workspace scope 目前是 `workspace_id int32`，
  而前端 Workspace 只带 `workspaces/{UID}` 资源名，没有数字 id。应先把 proto
  改成字符串资源名 + 后端解析 UID→id，再动 F2。另与 `Notebook.tsx` 的预览区
  耦合较深。

- **知识库级授权收紧到文档/文件夹粒度** —— 现在"分配到库 = 库内文档最大读写"
  是第一期的粗粒度方案。见
  [workspace-member-access.md §5](requirements/collaboration/workspace-member-access.md)。
  同一批要处理的还有 §7 的 **secret block 与库级授权脱节**：可见性按
  `creator_id` 判断、且密钥是用户级的，两层问题叠在一起，需要重新设计密钥分发，
  不是放开查询过滤就行。

- **secret block 遗留兼容代码清理** —— 全仓 grep
  `LEGACY-COMPAT(secret-block/per-block-passphrase)`。删除判据是
  `SELECT COUNT(*) FROM secret_block WHERE kdf = 'pbkdf2-sha256'` 归零；
  归零前删除那些行的密文永久无法解开。**不要**连带删
  `secret-crypto.ts` 的 `encryptSecret`/`decryptSecret`——`master-v1` 用它们
  包/解包主密钥。见 [secret-block.md](requirements/editor/secret-block.md)。

### Later —— 定了方向、暂不排期

- **公开附件的实例级 kill switch** —— 管理员一键停掉全实例的公开附件。
  落点不在 `attachmentacl` 内部（public 分支的价值就是不查任何东西就早退），
  应照 `AllowAnonymous` 加一个 `Request` 字段由 fileserver 在入口带进来。
  见 [access-control-and-private-files.md §尚未实现](requirements/attachments/access-control-and-private-files.md)。

- **公开附件的审计** —— 谁在何时把哪个附件设成公开，目前无记录。写侧已收敛成
  `authorizeAttachmentAccessUpdate` 单点，难点不在埋点而在没有通用审计表。
  出处同上。

- **引用修复的批量写入事务与索引重建合并** —— 文件夹改名/移动引发的引用修复
  逐篇改写正文，当前每篇各触发一次 RAG 索引任务。
  见 [cross-reference-repair-on-move-rename.md](requirements/cross-reference-repair-on-move-rename.md)。

- **`folder_path` 进 CEL filter schema** —— 让 `memo_list_memos` 能按文件夹路径
  批量捞文档。`workspace_get_workspace_tree` 已覆盖主要场景，故推迟。
  见 [mcp-authoring.md §7](requirements/collaboration/mcp-authoring.md)。

- **编辑器软提示 agent 未确认编辑** —— 人类打开 `agent_session_open == true`
  的文档时提示"此文档有 AI 编辑且尚未确认"。flag 已建好，补 UI 成本低。
  出处同上。

- **孤儿密文手动管理页** —— 加密块永不自动 GC，需要一个手动清理入口。
  见 [secret-block.md](requirements/editor/secret-block.md)。

- **文档评论的 LLM 语义兜底（RelocateAnchor）** —— 锚点四级降级之外的最后一档，
  评估过，未实现。

- **sheets 快照写入失败重试** —— 当前是静默覆盖。留待多人协作编辑时一并处理。
  见 [sheets-block.md](requirements/editor/sheets-block.md)。

- **SQLite 驱动泄漏点清理** —— 已排查出五处显式判断，可直接作为清理清单。
  见 [sqlite-as-sole-datasource.md](requirements/storage/sqlite-as-sole-datasource.md)。

- **知识库物理删除** —— `DeleteWorkspace` RPC 保留（要求库为空）但前端不给入口。
  见 [workspace-detail-and-shelf.md](requirements/knowledge-base/workspace-detail-and-shelf.md)。

- **RAG 索引范围按知识库可配置** —— `internal/rag/index.go` 的 `IsIndexable`
  已预留扩展点，是否做成知识库详情页的可配置项未定。见 [rag-search.md](rag-search.md)。

- **正文 `#tag` 暂停，待清除** —— 上游 memos 的标签是打在正文里的 `#tag`，由
  `server/runner/memopayload` 抽进 `memo.payload.tags`。本项目是知识库不是
  memo 流：文档的分类走 frontmatter 的 `tags:` 属性（属性面板里看得见、改得动，
  一处声明而不是散落正文），`#tag` 因此**暂停**——现有解析和统计代码保留，但
  不再作为任何新功能的输入。对外发布已经先落地了这条：`site_publication` 的
  tags 只读 frontmatter，`#tag` 一个都不进快照（见
  [public-publishing/tech-design.md](design/20260823-public-publishing/tech-design.md) 第 5 步）。
  清除的范围是 memopayload 的抽取、`user_service_stats` 的标签统计、以及编辑器里
  的 `#` 高亮与补全；**没排期，因为老文档正文里还留着 `#tag` 文本**，删解析之前
  要先决定这些文本怎么办（原样留着当普通文字，还是迁移进 frontmatter）。

- **RAG 的生成环节（真正的 RAG）** —— 检索已完备，缺"检索 top-K → 交给 LLM →
  带来源生成回答"。**有明确触发条件，条件未满足前不排期**，见
  [rag-search.md](rag-search.md) 的触发条件一节。

---

## 二、待确认（先核实，别当需求排期）

这些是文档里写着"未落地"、但成文时没有逐一核对代码的条目。处理方式是**先去
读代码确认**，确认已实现就把对应文档改掉，确认未实现再挪进上面的阶段列表。

- **memogit 附件上传** —— 本地新增附件 push 回服务端，代码里没找到对应实现。
  见 [memogit-sync.md](requirements/collaboration/memogit-sync.md)。
- **附件 10M 大小限制** —— 定义文档写了，`uploadService.ts` /
  `mediaInsertService.ts` 里没找到对应校验常量。
  见 [upload-and-inline-media.md](requirements/attachments/upload-and-inline-media.md)。
- **`rehype-sanitize` 的 SANITIZE_SCHEMA 当前实际配置**，出处同上。
- **附件搬迁脚本是否已执行**，出处同上。
- **standalone 部署的三条**：自动备份的两个已知 bug 是否仍在、无 S3 时的
  警告条是否实现、S3 凭证的环境变量读取路径是否落地。
  见 [standalone-local-deploy.md](standalone-local-deploy.md)。
- **全站备份**的若干项，见 [backup.md §TODO(确认)](requirements/storage/backup.md)。
- **calendar 块的写回能力**是哪次迭代加的、有无独立需求记录。
  见 [calendar-block.md](requirements/editor/calendar-block.md)。
- **sheets 的 `commitFromInstance`** 当前实现是否仍是原设计描述的样子。
  见 [sheets-block.md](requirements/editor/sheets-block.md)。
