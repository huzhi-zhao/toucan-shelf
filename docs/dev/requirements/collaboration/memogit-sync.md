# memogit：知识库检出与双向同步

`memogit` 是一个独立的本地 CLI（`cmd/memogit/`，实现在 `internal/memogit/`），把
ToucanShelf 知识库检出成本地文件、并把本地改动同步回服务端，版本追踪复用真实的
本地 git 仓库。它不实现 git 协议，也不改动服务端代码，只调用现有的 memos
REST/Connect API。

文档身份（`memogit-id` 标记）与移动语义是独立的一块，见
[memogit-doc-identity.md](memogit-doc-identity.md)；这里只讲检出、拉取、推送、
多知识库、附件与 agent 入口这些"日常怎么用"的部分。

## 1. 核心原则

**只做 DB ↔ 本地文件的双向同步桥接层，不重新实现 git。** 数据流向始终是
DB ↔ 本地文件，本地 git 仓库只负责给本地文件的时间线提供快照与 diff，不设
remote，不参与任何网络同步。

## 2. 一个 checkout root 可以挂多个知识库

早期设计假设"一个 checkout 目录 = 一个 workspace"，现状已经不是这样：**一个
checkout root 只保存一次账号凭证（`.memogit/config.yaml`），可以同时跟踪账号下
多个知识库**，每个知识库落在自己的子目录里：

```
my-kb/
├── .memogit/
│   ├── config.yaml          # server + token（唯一一份）
│   ├── state/                # 每个知识库一个同步基线文件
│   │   ├── Default.json
│   │   └── Life.json
│   └── toucanshelf-guide.md  # 编译进二进制的、给 AI agent 看的手册全文
├── Default/                  # 第一个知识库的文档树
└── Life/                     # 第二个知识库的文档树
```

`config.yaml` 里的 `workspaces:` 列表记录每个已检出知识库的
`workspace`（`workspaces/{uid}`）、`workspace_title`、`dir`（子目录名，检出时
固定，之后服务端改标题也不会让本地文件失联）、可选的 `name`（sparse checkout
才需要，见下）、可选的 `filter`（CEL 过滤子句）。

`pull` / `push` / `status` 默认对所有已检出的知识库依次执行；也可以在命令行传
一个知识库标题只对那一个执行。旧的单知识库配置格式（`workspace` /
`workspace_title` / `filter` 三个顶层字段）会被 `Migrate` 自动升级成
`workspaces` 列表的第一项，`.memogit/sync-state.json` 迁到
`.memogit/state/<dir>.json`，这个迁移是幂等的，每条命令启动时都会跑一次。

## 3. sparse checkout

`memogit clone <workspace-title> --sparse-checkout <folder-path>` 只检出服务端
指定文件夹（及其子树）下的文档，本地路径去掉这段前缀，push 时再补回去
（`ServerFolderPath` / `LocalRelPath` / `stripSparse`）。因为内容落在 checkout
root 本身（`Dir` 记为 `"."`），无法再用目录名当唯一标识，所以 sparse checkout
必须显式指定 `--dir`（见下）并在 config 里带一个 `name` 字段作为该条目的身份键
（同步状态文件名、命令行选择名）。

## 4. `--dir`：把某个知识库检出到独立目录

`memogit clone --dir <path> <workspace-title>` 会在 `<path>` 新建一个**独立的**
checkout root——凭证与元数据都落在这个目录内部，不加入当前目录已有的 root。
不带 `--dir` 时，再 clone 第二个知识库会加入从当前目录向上找到的既有 root
（`FindRoot`）。`--dir` 主要给 sparse checkout 用：把某个知识库的一个子文件夹
单独检出到一个跟其他知识库无关的位置。

## 5. 本地文件格式

一个文档导出到 `<folder_path>/<title><ext>`，扩展名由 `doc_type` 决定：

| doc_type | 扩展名 | 本地内容 |
|---|---|---|
| MARKDOWN | `.md` | 原始 markdown 正文（逐字节还原，含用户自己的 Obsidian frontmatter） |
| HTML | `.html` | 原始 HTML 源码 |
| PDF | `.pdf.md` | 引用占位文件；真实字节下载到 `_attachments/`，见 §7 |
| VIEW | `.view.json` | gallery 配置 JSON |

服务端唯一键是 `(workspace_id, folder_path, title)`，所以这个路径天生唯一，不
需要再拼 uid 到文件名里。`title` 与 `folder_path` 的每一段都经过
`sanitizeSegment` / `sanitizeFolderPath` 清洗（去掉路径分隔符与
`<>:"/\|?*` 等保留字符、拒绝纯 `.`/`..` 段），防止落盘失败或路径穿越；标题为空
时退回 `untitled`。

memo 的 `content` **不再被 memogit 包一层自己的 frontmatter**——那会与用户自己
的 Obsidian properties 堆叠在一起。所有 memogit 自己的元数据（doc_type、
visibility、pinned、时间戳、content_hash、附件引用）只存在
`.memogit/state/<name>.json`。唯一的例外是文档身份标记（见
[memogit-doc-identity.md](memogit-doc-identity.md)），它必须随文件走，不能只存
sidecar。

## 6. CLI 命令

现状（`cmd/memogit/main.go`）：

```
memogit login       --server <url> --token <PAT>          # 写 .memogit/config.yaml
memogit clone       [workspace-title] [--filter ...] [--sparse-checkout <path>] [--dir <path>]
memogit workspaces  (别名 ws)                               # 列出账号下的知识库，标出哪些已检出
memogit pull        [workspace-title]                       # 增量拉取
memogit push        [workspace-title] [--dry-run]           # 推送本地改动
memogit status      [workspace-title]                       # 本地/远端 diff + 本地 git 工作区状态
memogit agents                                               # （重新）写 AGENTS.md/CLAUDE.md/.cursor
```

`login` 不带子命令参数时会走交互式提示（`ensureConfig` → `promptLogin`），在
终端下 token 输入不回显；因此 `memogit clone --dir <path>` 在全新目录里可以直接
提示登录，不必先手动 `login`。

**没有 `commit` 子命令**——早期方案设想过把系统 `git commit` 包一层，现状是
"直接用系统 `git`"，`memogit` 完全不管本地 git 提交这一步（`status` 里的
`GitDirty` 只是报告"有没有未 commit 的改动"这一个数字，不代为处理）。

`push` 的落地范围明确写在帮助文本里：create / update / archive，**附件是单向
下载，不会被 push 上去**（见 §7）。

## 7. 附件：只读下载，不上传

`downloadMemoAttachments`（`internal/memogit/attachments.go`）把一个文档的全部
附件下载到 `_attachments/<uid>/<filename>`，按 uid 分目录避免同名文件冲突。这是
**单向**的：字节只为本地/AI 上下文而拉取，从不反向上传。已存在且大小相同的本地
文件会被跳过，不重新下载。PDF 文档的 `.pdf.md` 占位文件会指向下载后的第一个
附件路径（`pdfLocalPath`，优先选 `.pdf` 后缀的那个）。

TODO(确认)：附件上传（本地新增附件 push 回服务端）目前代码里没有对应实现，
plan 原文档 §10 提到"附件同步"是"阶段 5"的开放项；现状确认是下载已落地、上传未
落地，但这是否是后续明确排期的方向，还是已经搁置，没有找到更晚近的规划文档，
标记待确认。

## 8. 给 AI agent 的入口：AGENTS.md / CLAUDE.md / .cursor

`memogit clone` 和 `memogit pull` 会自动在 checkout root 及每个知识库子目录里
写入/刷新三类 agent 入口文件：`AGENTS.md`（Codex 等）、`CLAUDE.md`（Claude
Code）、`.cursor/rules/`（Cursor），内容是 `.memogit/toucanshelf-guide.md`
（编译进二进制的手册全文）的摘要或引用。这些文件只重写
`<!-- BEGIN memogit -->` … 标记之间的内容，标记外的用户自己写的笔记不受影响；
已经是用户自己文档的路径永远不会被覆盖。`memogit agents` 命令可以单独重跑这一步
（老版本检出升级，或找回被删掉的入口文件）。

## 9. 技术选型

Go + `cobra` 命令框架，产物是单一二进制；本地 git 交互通过 shell out 调系统
`git`，不自己实现 diff/快照逻辑。选型理由是分发体验（单二进制）和与 memos
现有 proto/client 代码复用的便利，不是性能考量——这一点与原方案保持一致，代码
现状也确实没有走 Python 或其他运行时依赖。

## 10. 明确不做的事

- 不实现真正的 git 协议，"clone/pull/push" 只是借用命名习惯。
- 不改服务端代码。
- 不做自动定时同步，只支持手动触发。
- 不做多人协作的实时合并，冲突只检测并拒绝，交人工处理（见 §11）。

## 11. 同步状态与冲突检测

`.memogit/state/<name>.json` 是唯一的元数据源，记录每条 memo 的本地路径、
doc_type、visibility、pinned、上次同步的服务端 `update_time` 与
`content_hash`，并维护路径 ↔ uid 的双向索引。

`push` 的判定：

- 本地改动 + 服务端未变 → 正常推送（`UpdateMemo`，只带 `content` 之类改动过的
  字段）。
- 本地改动 + 服务端也变了 → 冲突，跳过该文件并提示，交人工处理。
- 本地未变 + 服务端变了 → 提示先 `pull`。
- 本地文件消失但仍被跟踪 → 归档意图，转 `ARCHIVED`（软删）。

`status` 用与 `push` 相同的身份解析逻辑（见
[memogit-doc-identity.md](memogit-doc-identity.md) §"push 的身份解析"），保证
两个命令的口径一致：`status` 报告"待移动"的文件，`push` 一定是真的做移动而不是
误判成删除。

`push` 在本地哈希与基线哈希一致时不会联网确认服务端是否仍然存活，这是有意的
优化；但为避免"服务端已归档/删除、push 却一直报 unchanged"的假阴性，push 开头
会额外拉一次全量存活列表，把不在列表里的已跟踪文档明确报出来并跳过，而不是
静默略过或自动重新创建。

`pull` 的对账（`reconcileDrifted`）同时处理路径漂移与内容漂移：增量过滤器只看
`updated_ts > 上次同步`，对早于水位线的改动永久不可见，所以全量对账会把这类
"卡住"的文档拉平；本地有改动的文档不会被覆盖，会走冲突提示。

## 12. 已知边界

- 两个文件互换路径（A→B 的位置、B→A 的位置）会撞上服务端
  `(workspace, folder_path, title)` 唯一约束，第一次 push 就报错；分两次 push
  可绕开。
- 归档不腾出名字：归档文档仍占用 `(folder_path, title)`，删掉某文档后不能立刻
  用同名新建。
- 移动会把标题规范化：本地文件名是清洗过的，移动时按文件名回写 `title`，带
  保留字符的标题会在移动后被改成清洗后的形式。
