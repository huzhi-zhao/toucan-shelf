# memogit：实现说明与联调记录

状态：login / clone / pull / push / status 均已实现并本地实测跑通，含附件单向下载、
pull 服务端删除对账、以及**冲突落地成 `.remote` sidecar 供 IDE 合并**；待做：附件上传、
`commit` 透传。
关联：[[01-memogit-cli]]（需求与方案，已按真实模型修订）、[[02-api-survey-and-estimate]]（API 调研）。

本文档记录**实际写出来的东西**——代码结构、落地时做的关键决策、以及联调过程中踩到
的真实问题，供后续接手 push/附件同步时参考。面向使用者的操作手册见
`docs/manual/05-memogit-cli.md`（英文）。

## 1. 实现状态总览

| 命令 | 状态 | 说明 |
|---|---|---|
| `memogit login` | ✅ 已实现 | 写 server / token 到 `.memogit/config.yaml`（0600） |
| `memogit clone [workspace-title]` | ✅ 已实现 | 全量导出 + git init + baseline commit |
| `memogit pull` | ✅ 已实现 | 增量拉取 + 冲突检测 + commit |
| `memogit push [--dry-run]` | ✅ 已实现 | 新建→CreateMemo、修改→UpdateMemo(content)、删除→ARCHIVED、push 前冲突检查 |
| `memogit status` | ✅ 已实现 | 本地/远端待同步双层展示 + git 工作区脏文件数 |
| `memogit commit` | ⛔ 未实现 | 阶段 6，仅透传 `git commit` |
| pull 服务端删除对账 | ✅ 已实现 | 全量对账，删除/归档的文档本地移除（有本地改动则保留并提示） |
| 附件下载（单向） | ✅ 已实现 | clone/pull 时下载附件字节到 `_attachments/`，PDF 字节落地；`/file/` 路由 PAT 鉴权已实测可行 |
| 附件上传（本地→服务端） | ⛔ 未实现 | 后续；当前附件是只读下载 |

## 2. 代码结构

独立 Go 二进制，作为 memos 仓库的一个子命令包，直接复用 `proto/gen` 里 buf 生成好的
Connect-Go client，不重新生成 API 类型。

```
cmd/memogit/main.go        cobra 根命令 + login/clone/pull 子命令装配
internal/memogit/
  config.go                .memogit/config.yaml 读写 + 环境变量覆盖（MEMOGIT_SERVER/TOKEN）
  client.go                Connect client + PAT Bearer 拦截器；ListMemos 分页、
                           ListWorkspaces、GetCurrentUser、workspace 解析
  doc.go                   HashContent / CanonicalHash、doc_type 归一、PDF 占位、
                           relations 提取、FileContent（决定文件写什么）
  naming.go                RelPath = folder_path/title.<ext>；路径/文件名清洗与防穿越
  state.go                 sync-state.json 读写；MemoState；PathIndex（路径→uid 反查）
  sync.go                  scopedFilter、writeFile、memoState、exportMemo、
                           relocateAndWrite、pruneEmptyDirs、checkPathCollisions
  repo.go                  FindRoot（向上找 .memogit）、git init/commit、.gitignore
  clone.go                 Clone：解析 workspace → 拉取 → 落盘 → git baseline
  pull.go                  Pull：增量拉取 → 冲突三态 → relocate → commit
  *_test.go                单元测试（13 个用例，无需服务端）
```

## 3. 关键实现决策（落地时定的）

### 3.1 sidecar 元数据模型（重要，区别于需求初稿）
本地文件**只存 memo 的原始 content**，不再套 memogit 自己的 frontmatter。所有元数据
（uid、doc_type、visibility、pinned、timestamps、content_hash、relations）只存
`.memogit/sync-state.json`，以 uid 为 key。

原因：memo 的 content 本身可能已带一段 Obsidian 风格 `---` frontmatter（喂给 gallery
view 的 properties），再套一层会产生两个堆叠的 `---` 块、污染用户的 properties 命名
空间。详见 [[01-memogit-cli]] §5.2。

### 3.2 路径 = folder_path + title + doc_type 扩展名
`RelPath(folderPath, title, docType)` → `<folder_path>/<title><ext>`。扩展名：
MARKDOWN→`.md`、HTML→`.html`、PDF→`.pdf.md`（占位引用，无可编辑正文）、VIEW→`.view.json`。
服务端 `(workspace_id, folder_path, title)` 唯一，所以路径天然唯一，不拼 uid。

### 3.3 CanonicalHash（联调前就预埋，避免假冲突）
`writeFile` 会把内容规整为"去尾换行 + 单个 `\n`"，直接 hash 文件字节会和服务端 content
hash 不相等，导致 pull 误判"本地已改"。因此统一用
`CanonicalHash(s) = HashContent(TrimRight(s, "\n"))`，clone/pull 两端一致，保证未改动
的文件 hash 与基线相等。

### 3.4 只拉自己的 memo（creator scoping）
memos 的 `PROTECTED`/`PUBLIC` 可见性设计使得任意登录用户都能读到别人分享的 memo
（PAT 鉴权不改变这一点）。所以 clone/pull 显式加 `creator == "<username>"`（先
`GetCurrentUser` 拿 username），否则会把别人公开的 memo 混进本地知识库。这是产品语义
需要，不是权限绕过。

### 3.5 workspace 绑定
一个 checkout 目录对应一个 workspace。`clone Life` 按 title 精确匹配（服务端无 title
查询，客户端 `ListWorkspaces` 后匹配），解析出的 `workspaces/{uid}` 写入 config，
pull 复用。多 workspace 且未指定 title 时报错列出候选，绝不猜测。

### 3.6 冲突三态（pull 侧）
- 服务端变 + 本地未变 → 覆盖本地（relocate 若路径变）。
- 两边都变 → `⚠` 跳过，留人工。
- 本地文件被删 → `!` 跳过，留给 push 处理。
- PDF 特判：文件是生成的占位 stub 不是 content，不参与冲突检测，直接采纳服务端。

### 3.7 防御性文件名处理
`sanitizeSegment` 去掉 `<>:"/\|?*` 和控制字符、拒绝纯点名（`.`/`..`）；
`sanitizeFolderPath` 逐段清洗 + `path.Clean` 兜底防 `../` 穿越；CJK（中文）title
通过 `unicode.IsLetter` 保留。两个不同 title 清洗后若撞同名，`checkPathCollisions`
在 clone 时报错而非静默覆盖。

## 4. 联调中发现的真实问题（2026-07-16 本地实测）

### 4.1 端口不是默认 5230
该实例用 `go run ./cmd/memos --port 8081` 启动，后端在 **8081**，前端 Vite 在 3001。
memogit 要连的是**后端端口**（8081），不是前端。定位办法：
`lsof -nP -iTCP -sTCP:LISTEN | grep -i memos` 或 `ps aux | grep memos`。

### 4.2 localhost 解析到 IPv6，端口错时报 connection refused
后端 socket 是 IPv6 `*:8081`。macOS 上 `localhost` 优先解析到 `::1`。若 server 地址
端口填错（如默认 5230），会报 `dial tcp [::1]:5230: connect: connection refused`——
这是端口不对，不是 IPv6 问题。确认真实端口后用 `http://localhost:8081` 即可连上
（IPv6 socket，`localhost`→`::1` 正常工作）。

### 4.3 clone 返回 0 条 memo —— 真因是 creator filter 格式错（已修复）
`clone Default` 鉴权/解析都成功，但导出 0 条。**当初"旧数据未关联 workspace"的猜测
是错的**。用 curl 逐项二分定位：
- 只带 `workspace` 过滤 → 有数据（17 条）。
- 带 `creator == "James"`（memogit 拼的）→ **0 条**。
- 带 `creator == "users/James"` → 有数据。

根因：服务端 CEL 的 `creator` 字段比对的是**资源名** `users/<username>`（见
`internal/filter/schema.go` 的 `creator` → `memo_creator.username` 映射，值形态是
`users/xxx`），不是裸用户名。`scopedFilter` 原来拼 `creator == "James"`，把用户自己
的 memo 全过滤掉了。

**修复**：`sync.go` 的 `scopedFilter` 改为 `creator == "users/"+username`，
同步更新 `memogit_test.go` 断言。

### 4.4 pull 的 updated_ts 比较类型错（已修复）
`pull` 报 `found no matching overload for '_>_' applied to '(timestamp, int)'`。
`updated_ts` 在 CEL schema 里是 **timestamp** 类型（`schema.go:153`），不能和裸 epoch
int 比。**修复**：`pull.go` 的增量 filter 改为 `updated_ts > timestamp(<epoch>)`
（服务端 `internal/filter/time_test.go` 确认 `timestamp(<int>)` 合法）。

### 4.5 文档落进 workspace 子目录（行为变更）
按用户要求，文档不再平铺在 checkout 根，而是落在**以 workspace title 命名的子目录**下
（如 `Default/`），根目录只留 `.memogit`/`.git`/`.gitignore`。实现：新增
`ContentRoot(root, cfg)`（`sync.go`）= `root/<sanitized workspace title>`（title 清洗后
为空则回退 `WorkDir="work"`），clone/pull 把这个 contentRoot 传给
`exportMemo`/`relocateAndWrite`/`filepath.Join`。sync-state 里的 Path 仍是相对 contentRoot
的路径，逻辑不变。**注意**：此前用旧版 clone 出来、文件在根目录的 checkout 与新版不兼容，
需重新 clone。

### 4.6 push（阶段 4，已实现）
`push.go`：`listDocFiles` 扫 contentRoot（跳过 `_attachments/` 与 dotfiles），用
`state.PathIndex()`（路径→uid）区分已跟踪/新建：
- 新文件 → `deriveMemoFromPath`（从路径+扩展名推 folder_path/title/doc_type）→ `CreateMemo`
  （visibility 默认 PRIVATE，workspace 取 config），回写 uid 到 sync-state。
- 已跟踪且本地 hash != 基线 → 先 `GetMemo` 拿服务端当前 content 算 hash：服务端==基线
  → `UpdateMemo(update_mask=[content])`；服务端也变了 → **冲突**（`⚠`）跳过，提示先 pull。
- 已跟踪但本地文件已删 → `ArchiveMemo`（`UpdateMemo state=ARCHIVED`，软删，不 DeleteMemo）。
- PDF stub 与 `_attachments/` 一律不参与 push（生成物/只读）。
- `--dry-run` 只打印计划，不发请求、不改 sync-state、不 commit。成功后更新基线并 git commit。

本地实测（8081 实例）全流程验证通过：新建、修改、删除→归档、幂等（全 unchanged）、
两边都改→冲突跳过、dry-run。

### 4.7 附件单向下载（阶段 5 的下载部分，已实现）
`attachments.go`：`/file/{attachmentName}/{filename}` 路由**已实测认可 PAT `Bearer`**
（spike 通过，200 + 正确 Content-Type/Length），所以下载走裸 HTTP（`Client.DownloadAttachment`），
非 Connect API（Attachment.content 是 INPUT_ONLY，读不到）。
- clone/pull 对每个（变更）memo 下载其全部 attachments 到
  `<contentRoot>/_attachments/<attachment-uid>/<filename>`；按 size 跳过已存在的相同文件。
- sync-state 的 MemoState 新增 `Attachments []AttachmentRef{Name,Filename,Size,Path}`。
- PDF stub 增加指向本地下载文件的链接（`pdfLocalPath`）。
- **不改写正文里的内联附件引用**——改写会让文件 hash 变、被 push 误判为本地改动而触发假冲突；
  所以正文保持逐字节还原，附件字节只是并排下载供 LLM 读取。
- 单向：只下载不上传（上传留待后续）。

### 4.8 pull 服务端删除对账（已实现）
`pull.go` 的 `reconcileServerDeletions`：增量 `updated_ts >` 过滤感知不到服务端
删除/归档，所以在增量循环后再做一次**全量当前列表**（scopedFilter，无时间过滤），
sync-state 里的 uid 不在 alive 集合里 = 服务端已删/已归档 → 移除本地文件 + 其
`_attachments` + state entry（PullResult.Removed）。**保护**：若本地文件相对基线有未推送
改动（hash 不等），不删除，记入 `res.Orphaned` 并 `⚠` 提示，避免丢失本地工作。
代价：每次 pull 多一次全量 list（v1 可接受，后续可优化成只取 name）。

### 4.9 status（已实现）
`status.go`：只读，连服务端做一次全量 list，同时算两层：
- **本地待 push**：改动(`~`)/新建(`+`)/删除(`-`)——复用 push 的分类逻辑但不写。
- **远端待 pull**：服务端 hash 变(`~`)/新建(`+`)/删除归档(`-`)。
- **冲突(`⚠`)**：两边都变。
- 末尾附 `git status --porcelain` 的脏文件计数（`GitStatusPorcelain`），把"memogit 同步态"
  和"git 工作区态"两个 status 概念分开显示。
本地实测：clone 后 in-sync；本地改+新建→2 to push；服务端归档→远端 `-` 且 pull 移除本地。

### 4.10 冲突落地成 `.remote` sidecar（供 IDE 合并，已实现）
`conflict.go`：memos 是 REST API 不是 git remote，`git fetch` 拿不到"服务端那一方"，
所以 memogit 主动把它写成本地文件供 IDE 两方对比合并。
- 冲突时（pull 或 push 检测到两边都改）→ 写 `<path>.remote` = 服务端内容，并在
  sync-state 记 `ConflictServerHash`（冲突时的服务端 hash）。
- **解决流程**：用户在 IDE 里 diff `foo.md` vs `foo.md.remote`，合并进 `foo.md`，
  **删掉 `.remote`**（sidecar 存在与否 = 是否已解决的信号）→ `memogit push`。
- push 见 `ConflictServerHash != ""`：sidecar 还在 → 仍未解决,跳过；sidecar 已删 →
  `GetMemo` 复查:服务端==冲突时的 hash → 推送合并结果、清除标记;服务端又变了 →
  重新写 `.remote` 并更新标记(正确的 git 语义,避免覆盖服务端更新)。
- `.remote` 加入 `.gitignore`;`listDocFiles` 跳过 `*.remote`(否则会被当新文档 create)。
- 本地实测四场景全过:冲突生成 sidecar / sidecar 在时拒推 / 合并删 sidecar 后成功推送 /
  解决期间服务端再变→重新冲突。

## 5. 测试覆盖

`internal/memogit/*_test.go`，13 个用例，纯逻辑、无需服务端，`go test ./internal/memogit/`：
- RelPath 各 doc_type 扩展名 + CJK + 保留字符 + 防穿越 + 空 title 回退
- sidecar 逐字节还原（content 自带 frontmatter 不被二次包裹）
- PDF 占位含 attachment 引用
- checkPathCollisions 撞名报错
- CanonicalHash 忽略尾换行
- sync-state 存取 + PathIndex 反查
- writeFile 换行规整、pruneEmptyDirs 清理空目录

联调层面（连真实服务端）：login/clone/pull 已在本地 8081 实例跑通鉴权与 workspace 解析；
数据导出待 §4.3 的 workspace 关联问题澄清后再完整验证。

## 6. 后续（阶段 4 起）

1. **阶段 4 push**：路径→uid 反查（PathIndex 已就绪）、新建走 CreateMemo、修改走
   UpdateMemo（`update_mask=[content]`）、删除→ARCHIVED、push 前冲突检查。
2. **阶段 5 附件**：`/file/{attachment}/{filename}` 路由 PAT 鉴权 spike → PDF/图片下载。
3. **阶段 6**：`status`（本地 git diff + 未同步态合并展示）、`commit` 透传。
4. **§4.3 的 workspace 关联问题**：确认并决定是否加"未分类文档"导出模式。
