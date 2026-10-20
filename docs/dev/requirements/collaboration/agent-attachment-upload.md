# Agent 经同意追加附件

[`agent-attachment-reading.md`](agent-attachment-reading.md) §4 把"附件写入/上传"列为明确不做。
本篇只放开它的一个角：**memogit 可以在用户同意后给一篇文档追加附件**，删除、替换、改名
仍然不做，用户要做这些就引导他去 app。

两条规则是需求的全部边界：

1. **agent 加附件必须先征得用户同意**，一次同意只管一次上传清单。
2. **只开追加**。客户端里不存在删除、替换、解绑附件的代码路径，遇到这类需求只给引导。

## 1. 现状

- memogit 附件是单向下载：`push` 遍历时 `SkipDir` 跳过整个 `_attachments/`
  （[push.go:616](../../../../internal/memogit/push.go)），从不上传。
- 服务端已经有一条只追加的路径：`CreateAttachment` 请求里带 `Attachment.memo`，
  服务端会先 `checkMemoWriteAccess`，再直接把附件挂到这篇文档上，已有附件不受影响
  （[attachment_service.go](../../../../server/router/api/v1/attachment_service.go) `CreateAttachment`）。
  本需求**不改服务端、不改 proto**。
- `SetMemoAttachments` 是整体替换语义，传漏就等于删除。memogit **永远不调用它**。

## 2. 命令：`memogit attach`

```
memogit attach <文档路径> <本地文件>... [--confirm]
```

上传只走这条显式命令，不走 `push`。不做"把文件丢进 `_attachments/` 再 push 就上传"：
那样本地删文件、改文件是什么意思就说不清了，和规则 2 冲突；而一条独立的命令有名字，
权限提示、日志、hook 都能挂在它上面。

### 2.1 两步走：预演 → 确认

**不带 `--confirm`** 时只预演，不发任何写请求。输出这次的上传清单后以非零状态退出：

```
Attach 2 file(s) to notes/项目/周报.md (memos/abc123), mounted:
  + 架构图.png (image/png, 240 KB) <- ./out/架构图.png
  + 原始数据.csv (text/csv, 8.0 KB) <- ./data/原始数据.csv
Already attached: 2024年度报告.pdf
error: preview only, nothing uploaded — show this list to the user, and once they agree re-run with --confirm
```

**带 `--confirm`** 时先把所有前置检查（§2.3）重新跑一遍，全部通过才逐个上传。

这一步关卡防不住一个故意绕过的 agent，它有 shell，可以直接带 `--confirm` 跑。
这一点已经接受：两步走的目的是让"征得同意"成为每次都要经过、事后也查得到的一步，
不是在 agent 和服务器之间做物理隔离。真正的人工关卡（TTY 交互确认、app 内待确认状态）
评估过，不做。

### 2.2 只做 mounted

上传时 `origin = MOUNTED`，附件只挂在附件区，**不改正文**。
inline（在正文里插 `![](...)`）等于同时修改正文，同意的范围会变大，不在本期。

### 2.3 前置检查，任何一条不过就整体拒绝

一次命令要么全部通过检查，要么一个都不上传。检查失败时说清原因，能引导的给出 app 链接
`<server>/memos/<uid>`。

| 情况 | 处理 |
|---|---|
| 文档还没 push 过（本地没有 `memogit-id`） | 拒绝，先 `push` |
| 文档上已有同名附件 | 拒绝。替换算修改，请用户在 app 里操作 |
| 本次参数里有重复的文件名 | 拒绝 |
| PDF 类型文档（`*.pdf.md`） | 拒绝。它的首个附件就是文档本体，追加附件容易打乱 |
| 超过上传上限 | 拒绝。在本地先判断，不把请求发出去。实例上限（`UploadSizeLimitMb`）存在 STORAGE 设置里，服务端只给管理员看；拿不到时本地只按服务端写死的两条硬上限判断（媒体 100 MB、API 请求 256 MB），剩下的交给服务端 |
| 本地文件不存在，或不是普通文件（目录、软链接等） | 拒绝 |
| 知识库是 `--no-attachments` 检出 | 允许上传，但不落盘，见 §2.4 |

服务端拒绝（无写权限、vault 锁定等）时，原样报出，不重试。

如果上传到一半失败（第 1 个成功、第 2 个失败），**在失败处停下，不回滚**，因为回滚就是删除。
后面的文件不再尝试。报告哪些已经挂上、哪些没有，用户要撤掉已挂上的，同样去 app 里删。

### 2.4 上传成功后立即落盘

上传结束后（只要有一个成功），重新取一次这篇文档，走 pull 处理"只有附件变了"的同一步
（`refreshAttachments`）：把新附件**从服务器下载**到 `_attachments/<uid>/<文件名>`，
更新 sync-state 里的附件基线和文末的 `memogit-attachments` 清单块，然后做一次 git commit。
这样下次 `pull` 不会产生差异，也不会再下载一遍。

下载而不是直接复制本地文件，是因为服务端会剥掉图片的 EXIF，存下的字节和本地文件可能不同；
基线必须记服务器的大小，否则下次 pull 会判定为变化。
`--no-attachments` 的知识库什么都不写，与 `pull` 的行为一致。

## 3. 删除和修改：不开口子，只做引导

- 客户端（[client.go](../../../../internal/memogit/client.go)）只新增一个 `CreateAttachment` 封装，
  且必须带 `memo`。不封装 `SetMemoAttachments`、`DeleteAttachment`、`UnlinkAttachment`、
  `UpdateAttachment`。
- `memogit status` 增加一项检查：`_attachments/` 下的文件和基线对不上（大小变了、被删了），
  就提示"这个改动不会同步，要改附件请在 app 里操作"，附上 app 链接。判断只看大小，
  和 pull 判断是否重新下载用的是同一个信号，同样大小的改动发现不了。
- agent 收到删附件、换附件、给附件改名的请求时，不碰本地文件，只回复引导和链接。
  SKILL 里给一段固定话术。

## 4. agent 侧规则（写进 `docs/skill/`）

- 只在用户明确要"加附件"，或 agent 判断挂个附件确实有用时才发起。后一种情况必须先问。
- 先跑预演，把输出的清单**原样**贴给用户，等用户在对话里明确同意，再带 `--confirm` 跑。
  一次同意只管这次贴出的清单。清单有任何变化（加了文件、换了目标文档），就重新预演、重新问。
- 用户说"以后加附件不用问我"也不行：规则 1 不接受持久授权。
- 一次可以上传多个文件，但清单必须逐个列出。

## 5. 要改的文档

- [`attachments.md`](../../../skill/references/attachments.md)：一句话总结和禁止表里
  "试图上传附件"一行，改成"只能经同意用 `memogit attach` 追加"；新增一节写本篇 §4 的流程和引导话术。
- [`memogit.md`](../../../skill/references/memogit.md)：命令表加 `attach`；§6 已知限制改为
  "只能追加、只做 mounted"。
- [`agent-attachment-reading.md`](agent-attachment-reading.md) §4：改指向本篇。
- `cmd/memogit/main.go` 里 `push` 的 Short 文案 "attachments are download-only" 改为指向 `attach`。
- [`mcp.md`](../../../skill/references/mcp.md) §7：补一句"要加附件可以走 `memogit attach`"。
- MCP 通道**不变**，继续不开上传。`serverInstructions`（[service.go](../../../../server/router/mcp/service.go)）
  里写的 "Read-only here" 说的就是 MCP 这个通道，保持原样。

## 6. 验收点

- 不带 `--confirm`：打印清单，非零退出，服务器上附件数不变。
- 带 `--confirm`：服务器上这篇文档多出对应附件，origin 为 MOUNTED，已有附件一个不少；
  本地 `_attachments/` 和文末清单块同步更新；随后 `pull` 无 diff，也不触发重新下载。
- 同名、PDF 文档、未 push 的文档、超限、参数里重名：全部拒绝，服务器上无变化。
- 3 个文件中的第 2 个被服务端拒绝：第 1 个保留，报告写清楚哪些成功、哪些失败，没有删除动作。
- 本地改动或删除 `_attachments/` 下的文件后，`status` 给出提示；随后 `push` 不产生任何附件相关请求。
- 客户端代码里不存在对 `SetMemoAttachments`、`DeleteAttachment`、`BatchDeleteAttachments`、
  `UnlinkAttachment`、`UpdateAttachment` 的调用（`TestNoAttachmentRemovalCalls` 守着）。
