# 开发文档

面向开发者的需求、设计与决策记录。中文书写，文件名用 English kebab-case。
面向使用者的操作手册在 [../manual/](../manual/)，两者不混放。

```text
docs/dev/
├── README.md                    # 索引（需重写，现在还是原项目内容）
├── roadmap.md
├── platform-architecture.md
├── requirements/
│   ├── README.md                # 域清单 + 建域规则
│   ├── product-overview.md      # 定位、边界（不属于任何单一域）
│   ├── attachments/             # md 附件大域
│   │   ├── pdf-preview.md
│   │   ├── pdf-private-doc.md
│   │   └── pdf-permission.md
│   ├── collaboration/            # agent 协作 + 团队成员协作
│   │   ├── mcp.md
│   │   ├── mcp-oauth.md
│   │   ├── memogit-identity.md
│   │   └── memogit-sync.md
│   ├── editor/                  # 自定义语法、加密块、sheets、outline…
│   ├── knowledge-base/          # workspace / 目录树 / 排序 / 软删除
│   └── search/                  # RAG、FTS
├── adr/                         # 平铺，编号
├── design/                      # 平铺，日期前缀
├── launch/
└── postmortem/
```

## 当前状态

各层的真实实现进度、已知技术债、容易记错的架构事实，统一维护在仓库根目录
`AGENTS.md` / `CLAUDE.md`。本目录只讲设计意图与决策依据，不重复进度。

---

## 一、两个性质，一条建目录的规则

文档不按主题分，按**两个性质**分。写之前先定位性质，落点唯一，
不需要判断"这算不算笔记"。

| **常青** —— 描述现状，原地反复改写 | **事件** —— 描述一次性事件，写完冻结、只追加不修订 |
|---|---|
| `roadmap.md` 交付路线与能力阶段 | `adr/` 一个**选型**的取舍 |
| `platform-architecture.md` 系统长什么样 | [design/](design/) 一次变更**打算**怎么做 |
| [requirements/](requirements/README.md) 要做什么 + 事实依据 | `launch/` 一次变更**实际**怎么上的线 |
| | `postmortem/` 已造成影响的故障复盘 |

> 表中未加链接的是**尚未落地的目录/文件**——按"目录只给会增长的东西"，
> 第一篇文档出现时才创建，不预建空壳。

**建目录的规则只有一条：目录给会增长的东西。**
事件类单调累积，每类都必须有目录；常青类里只有 `requirements/` 会增长
（每做一块能力多一篇），其余直接放顶层——系统只有一个形态、只有一条路线。

### 判定顺序

自上而下问，第一个"是"就是落点：

1. 这篇会不会因为系统变了而**被改写**？会 → 常青类（`requirements/` 或顶层单篇）；
   不会（它记录的是某个时刻发生的事）→ 继续。
2. 它记录的是一个**技术选型的取舍**，且这个取舍以后可能被推翻？→ `adr/`
3. 它记录的是**一次变更打算怎么做**？→ `design/`
4. 它记录的是**一次变更实际上线的过程与验收**？→ `launch/`
5. 它记录的是**出了事之后的复盘**？→ `postmortem/`
6. 都不是 → **它多半不该进本仓库**，见第三节的路由表。

> 失效的旧文档不再有仓库内的去处：有追溯价值就迁到外部知识平台，
> 没有就直接删（git history 保留原文）。不设 `archive/`。

---

## 二、requirements/ 按业务域切块

`requirements/` 是唯一会持续增长、且内容天然异质的目录（pdf 权限和 memogit
放在同一层，读者无从预期里面有什么）。因此**只有它按业务域再分一层**，
域清单与建域规则见 [requirements/README.md](requirements/README.md)。

两条约束，否则半年后又会退化成一个杂物间：

- **域目录的准入是"已经有 ≥3 篇"。** 只有一两篇就平铺在 `requirements/` 根下，
  够 3 篇再收进域目录。不预建空壳。
- **域按用户能感知的能力切，不按技术模块切。** `attachments/` 可以，
  `storage/` 这种实现向的域是例外——它的"用户可感知面"是数据可靠性与可迁移性，
  收在这里是因为它决定了产品能承诺什么，不是因为它是一个代码包。

**事件类目录（adr / design / launch / postmortem）不切域。** 它们按日期排，
一次变更经常横跨多个域（memogit 同时动 agent 协作与存储），切域只会制造
"这篇该放哪"的判断成本。靠日期前缀 + 本索引定位就够。

---

## 三、不要写进 design doc 的东西

design doc 被污染的方式从来不是"写错了"，而是"写多了"——把本该在别处、
且别处天生更合适的内容塞进来。它们的共同特征是**寿命比 design doc 短**：
design doc 是给三个月后的人读的，下面这四类内容三个月后全是噪音。

| 内容 | 写到哪 | 为什么不写进 design doc |
|---|---|---|
| 这次改了哪些文件、怎么验证的、review 时要重点看哪 | **PR 描述** | 与 diff 同生命周期。PR 合并后 diff 是权威，文档里的文件清单只会过期 |
| 这一行为什么这么写、这个命名要不要换、这里少了个 null 检查 | **Code Review** | 讨论的对象是具体代码行，脱离行号就不可理解；结论若是通用规则，升格进 `AGENTS.md` / `CLAUDE.md` |
| 这个 commit 改了什么、为什么 | **Commit message** | `git log` / `git blame` 是它的索引。写进文档等于建了一份不会更新的 git 副本 |
| 进度、排期、"这块谁来做"、临时阻塞、状态更新 | **Issue / Ticket comment** | 天天变。放进仓库会让每次状态变化都产生一次 commit，且文档很快与真实进度不符 |

反过来说，**design doc 只写"三个月后重读仍然有用"的内容**：
问题是什么、方案的取舍、被否决的选项及原因、约束与假设、验收判据。

三条推论：

- **进度不进文档。** 本目录任何文档都不写"✅ 已完成 / ⏸️ 待办"。
  例外只有 `roadmap.md` 的阶段标记，它的对象是**能力阶段**不是任务。
- **文件级清单不进 design doc。** 逐文件的改动清单属于 PR 描述。
  分阶段实施计划是例外——它描述的是"怎么切分风险"，不是"改了哪些文件"。
- **"我踩了个坑"不进文档。** 先判断：是**一次性的**（环境、手滑）→ 丢进
  Issue 评论；是**下次还会踩的**→ 升格为 `AGENTS.md` / `CLAUDE.md` 的一条规则，
  或 ADR 的一段 Consequences。

---

## 四、文档清单

### 顶层单篇 —— 系统现在是什么样（常青）

- [rag-search.md](rag-search.md) —— 检索式搜索（hybrid FTS + 向量），`search/` 域唯一一篇，
  未满 3 篇准入线暂平铺于此
- [standalone-local-deploy.md](standalone-local-deploy.md) —— 单机本地部署：打包、S3 备份
  现状与已知问题、首启引导

规划中：

- `roadmap.md` —— 能力阶段与优先级
- `platform-architecture.md` —— 分层设计意图、部署拓扑与关键设计考虑

**顶层的准入判据**：只收**当前系统的可证伪属性**——能通过读代码、跑一次、
或重新测量来推翻的陈述。"分层边界是什么""部署拓扑什么样"都可证伪；
"我认为应该这样设计"不可证伪，那属于 `design/` 或 `adr/`。

> **失效信号**：顶层常青文档若涨到五篇以上，说明判据没起作用——
> 那时才该建目录，而不是现在预建一个空壳。

### requirements/ —— 要做什么（常青）

- [requirements/README.md](requirements/README.md) —— 域清单与建域规则、各域文档清单

域一览（详细文档清单见 [requirements/README.md](requirements/README.md)）：
`knowledge-base/`、`views/`、`editor/`、`attachments/`、`collaboration/`、`storage/`，
外加根下平铺的 [cross-reference-repair-on-move-rename.md](requirements/cross-reference-repair-on-move-rename.md)。

### adr/ —— 为什么这么选（事件，不改名不删除）

编号从 `0001` 起，一经分配不回收，当前已到 `0018`：

- [0001](adr/0001-attachment-proxy-not-presigned-url.md) 附件走服务端代理，不用 S3 预签名直连
- [0002](adr/0002-private-attachments-reuse-master-passphrase.md) 私密附件复用账号主口令
- [0003](adr/0003-private-attachment-unlock-via-cookie.md) 解锁态是短时 cookie
- [0004](adr/0004-interactive-blocks-via-codeblock-dispatch.md) 交互块走 CodeBlock 语言分发
- [0005](adr/0005-block-style-in-node-overlays.md) 块样式落 node_overlays
- [0006](adr/0006-no-cgo-drop-sqlite-vec-for-fts5-and-in-memory-vector.md) 无 CGO ⇒ FTS5 + 内存向量
- [0007](adr/0007-memogit-doc-identity-marker-in-file.md) memogit 文档身份用文件内标记
- [0008](adr/0008-secret-block-client-side-crypto.md) 加密块浏览器端加解密
- [0009](adr/0009-mcp-online-readwrite-complements-memogit.md) MCP 与 memogit 互补而非替代
- [0010](adr/0010-mcp-tool-whitelist-eight-tools.md) MCP 工具白名单
- [0011](adr/0011-agent-write-snapshots-human-baseline.md) agent 写入前留存人类基线快照
- [0012](adr/0012-actor-kind-from-channel-not-identity.md) actor kind 取决于通道而非身份
- [0013](adr/0013-no-optimistic-concurrency-control.md) 本期不做乐观并发控制
- [0014](adr/0014-agent-session-open-not-a-lock.md) `agent_session_open` 不得复用为锁
- [0015](adr/0015-no-litestream.md) 不引入 Litestream
- [0016](adr/0016-no-multi-instance-lease.md) 不支持多端写入，靠文档约束
- [0017](adr/0017-drawio-svg-with-embedded-xml.md) draw.io 图存成带内嵌 XML 的 SVG 附件
- [0018](adr/0018-html-to-markdown-via-turndown.md) 粘贴的 HTML 用 turndown 转 Markdown

### design/ —— 一次变更打算怎么做（事件）

- [20260704-s3-proxy-and-backup.md](design/20260704-s3-proxy-and-backup.md)
  —— S3 存储代理 + Storage 设置页重构 + 全站 SQLite 备份
- [20260712-calendar-callout.md](design/20260712-calendar-callout.md)
  —— calendar 交互块技术方案
- [20260712-memo-version-history.md](design/20260712-memo-version-history.md)
  —— 文档版本历史技术方案
- [20260713-memogit-cli/](design/20260713-memogit-cli/)
  —— memogit CLI 的 API 调研与实现笔记
- [20260716-rag-search/](design/20260716-rag-search/)
  —— 检索式搜索技术方案（含已取代的问答方向前身文档）
- [20260730-secret-block.md](design/20260730-secret-block.md)
  —— 加密块技术方案
- [20260731-mcp-agent-authoring.md](design/20260731-mcp-agent-authoring.md)
  —— MCP 协作写作技术方案
- [20260803-obsidian-kb-migration/](design/20260803-obsidian-kb-migration/)
  —— Obsidian 知识库迁移方案
- [20260804-standalone-local-deploy.md](design/20260804-standalone-local-deploy.md)
  —— 单机本地部署方案评估与开发计划
- [20260804-workspace-detail-and-shelf.md](design/20260804-workspace-detail-and-shelf.md)
  —— 知识库详情页与书架优化方案
- [20260807-storage-consolidation.md](design/20260807-storage-consolidation.md)
  —— 存储层收敛的分阶段实施计划
- [20260807-cross-reference-repair-plan.md](design/20260807-cross-reference-repair-plan.md)
  —— 跨文档引用完整性维护的分阶段实施计划
- [20260807-memo-link-index-backfill.md](design/20260807-memo-link-index-backfill.md)
  —— 文档引用索引回填方案
- [20260808-plans-to-dev-migration.md](design/20260808-plans-to-dev-migration.md)
  —— `docs/plans/` 历史方案文档拆入本目录的分阶段实施计划（多会话并行执行）
- [20260808-attachment-access-control-and-private-files.md](design/20260808-attachment-access-control-and-private-files.md)
  —— 附件判定收敛（含两处越权修复）与私密附件的分阶段实施计划、风险登记
- [20260814-drawio-svg-round-trip.md](design/20260814-drawio-svg-round-trip.md)
  —— draw.io SVG 图的渲染与回写的分阶段实施计划

> `docs/plans/` 下 2026-07-03 及之后的方案文档已按上述计划拆入本目录并从 `docs/plans/`
> 删除（原文保留在 git history）。2026-03～2026-04 的 6 个方案目录判定与本 fork 增量
> 无关，原地归档、不迁移、不建议阅读；`docs/plans/`、`docs/superpowers/` 整体归档见
> [../README.md](../README.md)。

### launch/ —— 一次变更实际怎么上的线（事件）

- [20260803-obsidian-kb-migration.md](launch/20260803-obsidian-kb-migration.md)
  —— Obsidian 知识库迁移上线记录：空跑实测数据、执行中改掉的方案内容

### postmortem/ —— 事件

尚无。

---

## 五、写作规则

- 目录名用语义，不用数字前缀；数字只用于 ADR 编号与事件文档的日期前缀。
- 文件名一律 English kebab-case，**语言差异只体现在正文**。
- 每篇文档必须被本索引（或 `requirements/README.md`）恰好链接一次；
  没被链接的应当删除。
- 宁可合并不要拆分。**目录只给会增长的东西**——两三篇文档不配一个目录。
- **事件类文档（adr / design / launch / postmortem）写完即冻结**，
  发现结论错了写新的一篇并在旧篇标注被取代，不原地改写。
- **常青类文档（requirements/ 与顶层单篇）原地改写**，不留"v1/v2"痕迹，
  历史交给 git。
