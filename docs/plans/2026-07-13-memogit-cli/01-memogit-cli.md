# memogit：本地知识库检出/同步 CLI 工具 — 需求与技术方案

状态：讨论定稿，暂不排期开发（先留档，等资源到位再实现）
关联：融合 AI 编写知识库的探索方向，参考 [[hierarchical-notes]] 的知识库定位。

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
┌─────────────────────┐
│ 本地知识库目录         │
│ ├── .memogit/         │  ← 本工具的元数据（同步基线、token、server url）
│ │   ├── config.yaml   │
│ │   └── sync-state.json│ ← 记录每条 memo 上次同步时的 hash / update_time
│ ├── .git/             │  ← 真实本地 git 仓库，只做本地版本快照，不设 remote
│ └── work/<tag>/*.md   │  ← 导出的笔记文件，按 tag/日期分目录
└─────────────────────┘
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

- **字段映射**：memo 的 `content`/`tags`/`visibility`/`create_time`/`update_time`/
  `pinned` 均可从 `ListMemos` 响应里拿到，写入本地文件的 frontmatter。

结论：**本期完全不需要改动 memos 服务端代码**，客户端脚本用现有 API 即可实现
checkout / pull / push 全流程。

## 5. 本地文件格式

每条 memo 导出为一个 `.md` 文件，文件名用 uid 短码 + 内容摘要（便于人类浏览），
目录按主 tag 分类（多 tag 的 memo 放主 tag 目录，其余 tag 记录在 frontmatter 里，
避免同一篇内容重复落盘）：

```markdown
---
uid: abcd1234
tags: [work, idea]
visibility: PRIVATE
pinned: false
create_time: 2026-07-01T10:00:00Z
update_time: 2026-07-10T08:30:00Z
content_hash: sha256:...          # 上次同步时服务端内容的 hash，push 前用于判断本地/远端谁变了
---
正文内容（原始 markdown，不做转换）...
```

`content_hash` 是关键字段：
- **pull 时**：服务端返回内容的 hash 与本地记录的 `content_hash` 比较，
  不一致才覆盖本地文件（避免无意义的 git diff 噪音）。
- **push 时**：本地文件当前内容的 hash 与 frontmatter 里 `content_hash` 比较，
  一致说明本地没改，跳过；不一致才需要 push。

## 6. 同步状态与冲突检测

`.memogit/sync-state.json` 额外维护一份"每条 memo 上次同步时的服务端
`update_time`"索引（不依赖 frontmatter，防止用户手改文件头出错）。

**push 流程（对应此前讨论的"push 前先做一次类似 git pull 的检查"）**：

1. 遍历待 push 的本地文件，收集其 uid 列表。
2. 对这些 uid 重新调一次 `ListMemos`（或按 uid 精确查询），拿到服务端**当前**
   的 `update_time`/`content_hash`。
3. 与 `sync-state.json` 记录的"本地基线"比较：
   - 服务端未变 + 本地变了 → 正常 push（`UpdateMemo`）。
   - 服务端变了（说明其他客户端/网页端改过）+ 本地也变了 → **冲突**，
     该文件跳过 push，命令行输出提示，交由用户手动处理（比如手动 pull 覆盖，
     或者手动比对后决定保留哪份）。
   - 服务端变了 + 本地没变 → 视为需要 pull 的项，提示用户先 `memogit pull`。
4. 全部检查通过后才真正发起 push 请求；push 成功后更新 `sync-state.json`
   和文件的 `content_hash`。

这一步本质就是把"git push 前先 fetch 检查 fast-forward"的思路，用本工具自己的
API 调用实现，而不是真的调用 git 的网络协议。

## 7. CLI 设计

```
memogit login    --server <url> --token <PAT>     # 写入 .memogit/config.yaml
memogit clone    [--filter tags=work]              # 首次全量导出 + git init + 初始 commit
memogit pull                                        # 增量拉取服务端变更
memogit push     [--dry-run]                        # 同步本地变更回服务端，dry-run 只打印计划
memogit status                                      # 展示本地 diff + 待 pull 的远端变更
memogit commit   -m "<msg>"                         # 透传给本地 git commit（不做特殊逻辑）
```

`clone`/`pull`/`push` 是本工具自定义命令，`commit` 只是对系统 `git commit` 的
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

- **知识关联的上下文完整性**：AI 批量理解知识库时，如果 memo 间有引用/relation，
  导出文件要不要在 frontmatter 里显式列出关联 uid，避免 AI 只看到孤立文件。
  本文档倾向于"要"，但具体格式（`relations: [uid1, uid2]`）留到实现时再定。
- **附件/资源文件**（图片、PDF 等）如何随笔记一起导出，是否需要额外的
  `assets/` 目录和路径重写规则，本期未展开设计。
- **冲突处理的用户体验**：本期只做"检测+拒绝"，后续是否需要类似 `git status`
  的冲突文件标记（如生成 `.conflict` 后缀文件辅助手动比对），待实际使用中
  验证是否必要。
- **删除语义**：本地文件被删除后 push，是否应该真的调用服务端删除 memo，
  还是只做"归档"（依赖 memos 是否有 archive 状态可复用），需要在实现前确认
  `memo_service.proto` 里 `state` 字段的语义（ACTIVE/ARCHIVED）。
