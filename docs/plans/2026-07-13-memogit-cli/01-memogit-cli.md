# memogit：本地知识库检出/同步 CLI 工具 — 需求与技术方案

状态：login/clone/pull/push/status 已实现并本地实测跑通（含附件单向下载、pull 删除对账）；待做见 [[03-implementation-notes]]。
实现细节与联调记录见 [[03-implementation-notes]]，操作手册见 `docs/manual/05-memogit-cli.md`。
**2026-07-16 重大修订**：对照 `docs/manual/` 的真实产品模型，把文件布局与元数据设计
从"上游 Memos 的扁平 + tags 模型"改为本 fork 的
**workspace / folder_path / title / doc_type** 层级模型（见 §5、§6 的修订说明）。
关联：融合 AI 编写知识库的探索方向，参考 [[hierarchical-notes]] 的知识库定位。

> **为什么修订**：本文档最初的 §5 文件格式（按主 tag 分目录、uid+首行 slug 命名、
> 给每个文件套一层 memogit frontmatter）是照上游 Memos 的心智写的。但本 fork（见
> `docs/manual/01-knowledge-base.md`、`02-rich-documents.md`）的真实模型是：
> - 每个文档属于一个 **workspace（知识库）**，本地一个 checkout 目录对应一个 workspace；
> - 层级由 **folder_path**（斜杠分隔的路径前缀）+ **title** 决定，唯一键是
>   `(workspace_id, folder_path, title)`——这正好天然映射成文件系统路径；
> - **tags 是从正文 `#hashtag` 派生的只读字段**，不能用来定位/建目录；
> - 文档有 **doc_type**（MARKDOWN / HTML / PDF / VIEW），不能一律当 `.md`；
> - memo 的 `content` **本身可能已带一段 Obsidian 风格的 `---` frontmatter**
>   （喂给 gallery view 的 properties），再套一层 memogit frontmatter 会产生两个
>   堆叠的 `---` 块，污染用户自己的 properties 命名空间。
>
> 修订后的模型见下文。

## 1. 背景与动机

当前 memos 的所有笔记只存在于服务端 DB，AI（如 Claude Code）要参考、批量重写、
关联分析笔记内容，只能一条条走 API 读，效率低、上下文组织困难。

参考 GitHub 的"检出（checkout）"体验：把整个知识库导出成本地文件，AI/用户在本地
用文件系统工具（grep、批量编辑、跨文件关联）高效工作，改完再同步回服务端。

**核心设计原则：不重新实现 git，只做"DB ↔ 本地文件"的双向同步桥接层，版本追踪
完全复用真实的本地 git 仓库。**

## 2. 需求范围（本期讨论 / 后续实现基线）

1. **clone**：首次从服务端拉取全部（或指定范围）memo，写成本地文件，并在本地
   初始化一个 git 仓库，做初始 commit 作为基线快照。
2. **pull**：增量拉取服务端自上次同步以来的变更，更新本地文件，本地 git commit
   记录这次同步点。
3. **commit**：不新增 git 概念，直接复用系统 git 的 `commit`——用户/AI 编辑完
   本地文件后正常 `git add && git commit`，只用于本地历史留存和 diff，不推送到
   任何远程 git 仓库。
4. **push**：将本地相对于"上次同步基线"的改动（新增/修改/删除的文件）同步回
   服务端 DB，通过 memos 的 API 完成。
5. **status**：类似 `git status`，展示本地哪些文件相对服务端有未同步的改动，
   以及服务端是否有本地尚未拉取的新变更。

**明确不做的事**：
- 不实现真正的 git 协议（不做 clone/push/pull 到远程 git 仓库），"clone/pull/push"
  只是借用 git 的命名习惯，实际是本工具自己实现的 DB↔文件同步逻辑。
- 不做服务端代码改造（不侵入 memos Go 后端），所有逻辑作为独立的外挂客户端程序。
- 不做自动定时同步，本期只支持用户手动触发命令。
- 不做多人协作的实时合并（冲突处理只做"检测并拒绝，交给人工"，不做自动 merge）。
- 不做 tags/relations 之外的复杂图谱可视化，本期只保证关联信息在导出文件里可读。

## 3. 整体架构

```
┌─────────────┐   memos REST/Connect API (PAT 鉴权)   ┌──────────────┐
│  memogit CLI │ ───────────────────────────────────▶ │  memos 服务端  │
│ (本地 mac 程序)│ ◀─────────────────────────────────── │   (DB 不变)    │
└──────┬──────┘                                        └──────────────┘
       │ 读写
       ▼
┌───────────────────────────────┐
│ 本地知识库目录（= 一个 workspace）│
│ ├── .memogit/                   │  ← 本工具的元数据
│ │   ├── config.yaml             │  ← server url / token / 绑定的 workspace
│ │   └── sync-state.json         │  ← 每条 memo 的 uid↔路径映射、doc_type、
│ │                               │    visibility、上次同步的 hash / update_time
│ ├── .git/                       │  ← 真实本地 git 仓库，只做本地快照，不设 remote
│ └── <folder_path>/<title>.<ext> │  ← 导出的文档，路径 = 服务端 folder_path + title
│     ├── garden/notes/todo.md    │    ext 由 doc_type 决定（见 §5）
│     ├── papers/attention.pdf.md │
│     └── dashboards/all.view.json│
└───────────────────────────────┘
```

数据流向始终是 **DB ↔ 本地文件**，git 只负责"本地文件在时间线上的快照与 diff"，
不参与任何网络同步——这是本方案与"真的把知识库当 git 仓库托管"的关键区别。

## 4. 服务端接口依赖（复用现有 API，不改服务端代码）

调研确认 memos 已有的能力足够支撑本方案（`proto/api/v1/memo_service.proto`）：

- **鉴权**：Personal Access Token（PAT），长期有效，适合 CLI 场景。
  服务端已支持 PAT 校验：`server/auth/authenticator.go` 的 `AuthenticateByPAT`
  （对比短期 JWT access token，PAT 更适合脚本化调用，不用处理 15 分钟过期刷新）。
  用户在 memos 设置页生成 PAT，配置进 `memogit login`（写入 `.memogit/config.yaml`
  或环境变量 `MEMOGIT_TOKEN`）。

- **列表/拉取**：`ListMemos` rpc，支持 `page_size`/`page_token` 分页，以及
  CEL `filter` 表达式（`memo_service.proto:398-416`），可按 `tags`、
  `updated_ts`/`created_ts`、`visibility` 过滤。增量 pull 就靠
  `filter: updated_ts > <上次同步时间戳>` 实现，不需要服务端新增接口。

- **创建/更新**：`CreateMemo`（`memo_id` 可选，用于指定 uid）、`UpdateMemo`
  （带 `update_mask`，可只更新 `content` 字段，不影响其他属性）。push 时：
  - 本地新文件（无对应 memo uid）→ 调 `CreateMemo`，拿到返回的 `name`/uid
    写回文件头。
  - 本地已修改文件（有 uid 且 hash 变化）→ 调 `UpdateMemo`，`update_mask=[content]`。

- **字段映射**：memo 的 `content`/`folder_path`/`title`/`doc_type`/`visibility`/
  `create_time`/`update_time`/`pinned`/`workspace`/`attachments` 均可从 `ListMemos`
  响应里拿到（已核对 `server/router/api/v1/memo_service_converter.go`，全部填充）。
  注意 `tags` 是 `OUTPUT_ONLY`、从正文 `#hashtag` 派生的**只读**字段，不能用来定位
  文档，也不能通过 API 单独设置。

结论：**本期完全不需要改动 memos 服务端代码**，客户端脚本用现有 API 即可实现
checkout / pull / push 全流程。

## 5. 本地文件格式（2026-07-16 修订：对齐真实层级模型）

### 5.1 路径 = folder_path + title

一个 checkout 目录对应一个 **workspace**。每个文档导出到：

```
<folder_path>/<title>.<ext>
```

- `folder_path` 直接作为相对目录（斜杠分隔，`garden/notes` → `garden/notes/`），
  workspace 根文档的 folder_path 为空 → 落在仓库根。
- `title` 作为文件名主体。服务端唯一键是 `(workspace_id, folder_path, title)`，
  所以这个路径**天生唯一**，不需要再拼 uid。
- **不再按 tag 分目录**，也不再用"首行 slug"命名——那是旧模型的遗留。

**扩展名由 doc_type 决定**：

| doc_type | 扩展名 | 本地内容 | 说明 |
|---|---|---|---|
| MARKDOWN | `.md` | 原始 markdown 正文（verbatim） | 默认类型 |
| HTML | `.html` | 原始 HTML 源码（存在 memo.content 里） | 手册 02 §2.2 |
| PDF | `.pdf.md` | 一个引用占位文件（记录 attachment 名/文件信息） | PDF 无可编辑正文，真实字节是 attachment，v1 read-only 阶段先落占位，实际下载在阶段 5 |
| VIEW | `.view.json` | gallery 配置 JSON（存在 memo.content 里） | 手册 03 §3.1；VIEW 是组织节点 |

> **doc_type 冲突与文件名安全**：`title` 若含 `/` 等路径分隔符需转义（服务端 title
> 是单个路径段，通常不含 `/`，但实现时要做防御性处理）。同一 folder 下不会有同名
> 冲突（服务端唯一键保证），但不同 doc_type 若恰好同 folder+title 也不会——因为
> 唯一键不含 doc_type，服务端本身就不允许。

### 5.2 frontmatter 和解：文件存原始 content，元数据进 sidecar

**关键修订**：memo 的 `content` 本身可能已经以一段 `---` YAML frontmatter 开头
（Obsidian 风格 properties，见 `web/src/utils/frontmatter.ts`，喂给 gallery view 的
`prop:` 过滤/排序/封面）。因此 **memogit 不再往文件里塞自己的 frontmatter**——否则
会出现两个堆叠的 `---` 块，污染用户的 properties 命名空间。

改为：
- **本地文件 = 服务端 content 逐字节还原**（MARKDOWN/HTML/VIEW），用户/AI 看到的
  就是真实文档，包含它自己的 Obsidian frontmatter，不多不少。
- **所有 memogit 元数据**（uid、doc_type、visibility、pinned、timestamps、
  content_hash、relations）**只存在 `.memogit/sync-state.json`**，以 uid 为 key，
  并保存 uid↔本地路径的双向映射。

这样：文件干净可读；push 时靠 sync-state 的路径映射反查 uid（见 §6）；`content_hash`
的比对逻辑不变，只是基线存在 sync-state 而非文件头。

> **relations 的 AI 可读性权衡**：旧设计想把关联 uid 写进文件 frontmatter 供 AI 阅读。
> 但改为 sidecar 后文件里不再有 frontmatter。v1 先把 relations 存进 sync-state（机器
> 可读），AI 上下文可读性作为开放问题保留在 §10——若确有需要，后续生成一个独立的
> 人类可读关联索引文件，而不是回退到污染每个文档的方案。

## 6. 同步状态与冲突检测

`.memogit/sync-state.json` 是**唯一**的元数据源（不再有文件 frontmatter 作为副本）。
每条 memo 一个 entry，key 为 uid，记录：本地相对路径、doc_type、visibility、pinned、
上次同步的服务端 `update_time` 和 `content_hash`。同时维护一个反向的
「路径 → uid」索引，供 push 时判断某个本地文件是已跟踪文档还是新建。

**push 流程（对应此前讨论的"push 前先做一次类似 git pull 的检查"）**：

1. 遍历工作区文件，用「路径 → uid」索引区分：
   - 路径**已在索引** → 已跟踪文档，读当前文件内容算 hash，与基线比对是否本地改动。
   - 路径**不在索引** → 新建文档，`folder_path`/`title`/`doc_type` 从文件路径与扩展名
     推导，走 `CreateMemo`，拿回 uid 写入 sync-state。
   - 索引里有、但文件已被删 → 视为删除意图，按约定转 `ARCHIVED`（软删，见 §10）。
2. 对已跟踪且本地有改动的 uid，重新调 `ListMemos`（或按 uid 精确查询）拿服务端
   **当前** `update_time`/`content_hash`。
3. 与 sync-state 基线比较：
   - 服务端未变 + 本地变了 → 正常 push（`UpdateMemo`，`update_mask=[content]`）。
   - 服务端变了 + 本地也变了 → **冲突**，跳过该文件并提示，交人工处理。
   - 服务端变了 + 本地没变 → 提示用户先 `memogit pull`。
4. 全部检查通过后才真正发起 push；成功后更新 sync-state 基线。

这一步本质就是把"git push 前先 fetch 检查 fast-forward"的思路，用本工具自己的
API 调用实现，而不是真的调用 git 的网络协议。

> **pull 的删除感知缺口（新增说明）**：增量 pull 用 `updated_ts > 上次同步` 过滤，
> **不会**返回服务端已删除或已转 ARCHIVED 的 memo，因此这些项会在本地残留陈旧文件。
> v1 的 pull 只保证"新增 + 修改"收敛；服务端删除的对账留到后续（可选：pull 时对
> sync-state 里的 uid 做一次轻量全量 state 检查来收敛）。命令输出里要注明这一点。

## 7. CLI 设计

```
memogit login    --server <url> --token <PAT>     # 写入 .memogit/config.yaml
memogit clone    [workspace-title] [--filter ...]  # 检出指定知识库；账号仅一个 workspace 时可省略
memogit pull                                        # 增量拉取（复用 clone 绑定的 workspace）
memogit push     [--dry-run]                        # 同步本地变更回服务端，dry-run 只打印计划
memogit status                                      # 展示本地 diff + 待 pull 的远端变更
memogit commit   -m "<msg>"                         # 透传给本地 git commit（不做特殊逻辑）
```

- **workspace 是仓库的绑定单位**：一个 checkout 目录对应一个知识库。`clone Life`
  按 title 精确匹配（服务端无 title 查询接口，客户端 `ListWorkspaces` 后匹配），
  解析出的 `workspaces/{uid}` 写入 config，`pull`/`push` 复用，不跨库串。账号有多个
  workspace 且未指定 title 时 clone 报错并列出候选，绝不猜测。
- `clone`/`pull`/`push` 是本工具自定义命令，`commit` 只是对系统 `git commit` 的
  一层轻量封装（方便统一入口），`status` 需要同时展示"本地 git 未 commit 的改动"
  和"本地/远端未同步的改动"两层信息，避免用户混淆两套"status"概念。

## 8. 技术选型：Go

| 维度 | Go | Python |
|---|---|---|
| 分发 | 编译单一二进制，`brew install` 即用，无需运行时 | 需要用户装 python 或打包（pyinstaller），体验更重 |
| 与 memos 复用 | memos 后端本身是 Go，proto 生成的 client 结构体可直接复用 | 需要额外维护一份 API 数据结构定义 |
| CLI 框架 | `cobra`（成熟，子命令/help 体验好） | `typer`/`click` 同样成熟 |
| git 交互 | shell out 调系统 `git` 二进制即可，无需自己实现 diff | 同样 shell out |

**结论：选 Go。** 主要理由是分发体验（单二进制 + Homebrew）和与 memos 现有
proto/client 代码的复用便利，不是性能考量。

## 9. Mac 安装与分发

1. **原型阶段**：`go build -o memogit .`，产物丢进 `/usr/local/bin` 或 `~/bin`，
   手动 `chmod +x`，配置 PATH。
2. **正式分发**：发布到自建 Homebrew tap（如 `brew tap <user>/memogit`），
   `brew install memogit`，由 Homebrew 管理版本更新与卸载。
3. **配置管理**：`memogit login` 生成的配置落在 `~/.memogit/config.yaml`
   （支持多 profile，对应多个 memos 实例/server url），不用环境变量作为
   唯一配置来源（环境变量可选支持，用于 CI 场景覆盖配置文件）。

## 10. 风险与开放问题（留待实现前进一步确认）

- **删除语义（已定）**：本地文件删除后 push → 服务端 memo 转 `ARCHIVED`（软删，可恢复），
  不做 `DeleteMemo` 真删。`common.proto` 确认 `State` 仅 NORMAL/ARCHIVED 两态。
- **知识关联的上下文完整性**：改为 sidecar 模型后文件里不再有 frontmatter，relations
  存在 sync-state（机器可读）。AI 阅读单个文件时看不到关联——若确有需要，后续生成一个
  独立的人类可读关联索引文件（如 `.memogit/relations.md`），而不是回退到给每篇文档套
  frontmatter 的旧方案。v1 先只做 sync-state 存储。
- **PDF / 附件导出**：PDF 文档无可编辑正文，真实字节是 attachment。v1 read-only 阶段
  先落一个占位/引用文件（`.pdf.md`，记录 attachment 名与文件信息）；实际下载 PDF 字节、
  以及图片等内联媒体的导出与路径重写，放到阶段 5（附件同步）。附件读取走
  `/file/{attachment}/{filename}` 路由，其 PAT 鉴权可行性需先做 spike（见 02 号文档）。
- **pull 的服务端删除对账**：增量 `updated_ts >` 过滤感知不到服务端删除/归档，v1 pull
  只收敛"新增+修改"，残留项留待后续全量对账。
- **冲突处理的用户体验**：本期只做"检测+拒绝"，后续是否需要类似 `git status` 的冲突
  文件标记（如生成 `.conflict` 后缀文件辅助手动比对），待实际使用中验证是否必要。
- **title 文件名安全**：title 理论上是单个路径段，但实现要对 `/`、空串、超长、
  保留字符（如 Windows 的 `:`）做防御性转义，避免落盘失败或路径穿越。
