# Agent 读附件

附件对 agent 是**只读语料**：可以读，永不编辑、删除、移动、上传。这条边界已经定了
（[`docs/skill/references/attachments.md`](../../../skill/references/attachments.md)），
本篇要解决的是它的另一半——**怎么让 agent 真的读到**。

现状是两个通道各缺一块：

| 通道 | 字节可达性 | 缺什么 |
|---|---|---|
| memogit | 已下载到 `_attachments/<uid>/<原文件名>`（[attachments.go:55](../../../../internal/memogit/attachments.go)） | **文档里没有任何指向附件的指针**，agent 不知道有附件、更不知道在哪。功能实际等于不存在 |
| MCP | 完全不可达 | `memo_get_memo` 会返回附件元数据（名字/文件名/MIME/大小），但没有任何取字节的手段 |

memogit 侧唯一的例外是 PDF 文档：`pdfPlaceholder`（[doc.go:137](../../../../internal/memogit/doc.go)）
生成的 `.pdf.md` 桩里写了 `Local file: _attachments/...`，所以这一类 agent 找得到。
其余所有文档的附件，本地字节躺在磁盘上没人读。

## 1. 两个通道的交互模型不同，这是设计前提

这不是可选项，两边的方案不对称正是由它决定的：

- **memogit：agent 自主判断。** 它有文件系统，附件已经在本地躺着，不需要任何"取回"动作。
  它缺的是**知情**——知道这篇文档挂了哪些附件、叫什么、多大，然后自己决定值不值得打开。
- **MCP：用户点名。** agent 没有文件系统，附件必须显式下载才能读。而用户本来就会在
  app 里点附件行的 ⋮ →"复制 Markdown 引用"
  （[AttachmentListView.tsx:284](../../../../web/src/components/MemoMetadata/Attachment/AttachmentListView.tsx)），
  把 `![spec.pdf](/file/attachments/abc123/spec.pdf)` 贴给 agent 说"读这个"。
  **发现附件是用户的事，不是 agent 的事**，所以 MCP 侧不需要任何枚举能力。

## 2. memogit：附件清单写进文档尾部的本地标记

### 2.1 复用已有的本地标记机制

文件末尾那行 `<!-- memogit-id: memos/xxx -->` 已经是"只存在于本地、push 时被剥掉"的
东西（[localid.go](../../../../internal/memogit/localid.go)）。附件清单挂在同一套机制上，
不新造概念：

```
<!-- memogit-attachments:
inline:
- 架构图.png (image/png, 240 KB) -> _attachments/d4e5f6/架构图.png
mounted:
- 2024年度报告.pdf (application/pdf, 12.4 MB) -> _attachments/a1b2c3/2024年度报告.pdf
- 原始数据.csv (text/csv, 8 KB) -> _attachments/b7c8d9/原始数据.csv
-->
<!-- memogit-id: memos/xxx -->
```

选 HTML 注释是因为它在 Obsidian 预览里不可见，但 agent 读文件时一眼看到，`grep` 也搜得到。

**必须带类型和大小**：agent 判断"要不要去翻"有一半是成本判断，12.4 MB 的扫描 PDF 和
8 KB 的 csv 决策不一样。

**strip 必须是注入的精确逆运算。** 所有 hash / push 路径都已经必经 `StripLocalID`，
新块加进同一个函数即可，`push` 那边不需要任何改动。多行块的正则比现在那行单行的容易写错，
这块要有测试兜住——漏剥一次，所有带附件的文档下次 pull 全部变成假冲突。

代价要提前说：**所有已检出的、带附件的文档在下次 `pull` 时会产生一次 diff**，
用户的 git 历史里会出现一批"只加了个注释"的提交。一次性的，可接受。

### 2.2 inline / mounted 的判定：搜正文，不依赖 `AttachmentOrigin`

分组不是排版偏好，它是给 agent 的判断依据：

- **inline 的附件不缺上下文**。正文里就有 `![alt](url)`，alt 文本和前后两句话都在，
  agent 判断相关性有充分依据。清单对这一类的唯一作用是**把服务器 URL 映射到本地路径**。
- **mounted 的附件才是裸奔的**，正文一个字都没提，只剩文件名。风险全集中在这里。

判定方式是导出时在正文里搜 `/file/attachments/<uid>/` 有没有出现——字符串匹配，
不依赖 proto 的 `AttachmentOrigin` 字段。该字段只在创建时由客户端传入，
历史附件可能是 `UNSPECIFIED`，靠它会误判。

### 2.3 判断规则：写进 `references/attachments.md`

清单只解决知情，不解决判断。文件名这个信号本身不够——`IMG_2034.pdf`、`扫描件(1).pdf`
给不了任何信息，而一篇挂了二十张截图的文档又会诱导 agent 全部打开、烧光上下文。
**少读和多读的代价不对称**：少读是答案不完整、用户追问一句就补上；多读是烧时间和上下文，
还可能把不相关内容当依据得出错的结论。所以规则整体偏保守，靠"主动汇报"兜底：

1. **正文提到了这个文件名或它的主题** → 读，无歧义。
2. **文档是 PDF 类型**（`.pdf.md` 桩）→ 必读，桩里没有正文，内容全在字节里。
3. **文件名无信息量**（`IMG_2034.pdf` / `扫描件(1).pdf` / `未命名.png` / `document.pdf`）
   → **不许猜**。直接告诉用户"这篇挂了 N 个附件，文件名看不出内容，要我打开哪个"。
   把不确定性交回给人，比赌一把便宜。
4. **任何情况下都要汇报没打开哪些附件。** 清单可见了，agent 就有能力说"这篇还挂着 X、Y
   我没看，需要的话我去翻"。这条把"少读"从静默失败变成用户一眼可见、一句话可纠正的东西，
   是整套规则里最关键的一条。
5. **防多读的两个闸**：单个附件超过约 5 MB 先问再开；一次任务里主动打开的数量上限约 3 个，
   超了就列清单让用户挑。

`references/attachments.md` 第 3 节现有的"什么时候你应该读附件"写得没问题，
只是之前没有指针、agent 走不到那一步，等于死条文。措辞要从"你应该读"改成
"看到清单之后怎么判断值不值得打开"。

按 [AGENTS.md](../../../../AGENTS.md) 的 Change Routing，改 `docs/skill/` 后要跑
`scripts/sync-agent-skill-docs.sh`，并评估 `serverInstructions` 是否需要同步。
本篇的 memogit 规则属于"仅 memogit"，不进 MCP 的常驻上下文。

## 3. MCP：签发短期下载令牌，agent 自己取到本地

### 3.1 不走 base64

`CallToolResult` 支持 `ImageContent` / `EmbeddedResource`，技术上能把字节塞进返回值，
但 base64 膨胀 33%，一个 5 MB 的 PDF 进上下文就是灾难，多数客户端也消化不了。
**正确形态是给 URL，agent 用自己的 shell 取到本地，再用原生能力读。**

### 3.2 一个工具，宽进严出

只加一个只读工具（工具数 8 → 9），参数是用户贴过来的标识符。必须能吃下用户实际会贴的
所有形态：裸的 `attachments/{uid}`、相对路径 `/file/attachments/{uid}/{filename}`、
带域名的完整 URL、以及整段 `![](...)` markdown 引用。注意 app 复制出来的是
**相对路径，不带域名**。

这个宽容度不是惯着模型：`adapter.go` 里的 `trimCollectionPrefix` 已经为同一个原因存在过
一次——模型会把你给它的东西原样喂回来。

返回：带令牌的绝对 URL、文件名、MIME、字节数、过期时间。

用户懒得贴、直接说"读 X 文档里那个附件"时，agent 也能自己拿到 uid——`memo_get_memo`
的返回本来就带 `attachments` 数组。贴 URI 是主路径但不是唯一路径，这条不需要额外做什么。

### 3.3 令牌

签发前用**调用者的身份**跑一遍 `attachmentacl.CheckReadAccess`
（[attachmentacl.go](../../../../server/attachmentacl/attachmentacl.go)），
过了才签。用户贴一个他自己都读不了的附件，照样拒。

令牌形态照抄 `GenerateVaultToken` / `ParseVaultToken`
（[token.go:211](../../../../server/auth/token.go)）：audience 隔离、单一用途、
几分钟过期、绑定 (userID, attachmentUID)。fileserver 侧在 `checkAttachmentPermission`
里多认一种凭证。

**vault 锁定的附件必须拒**。它靠浏览器 cookie 解锁，MCP 走 PAT 天然没有 vault cookie，
`VaultUnlocked` 传 nil 即 fail closed，行为本来就对——但要给一句明确错误，
不能变成看不懂的 403。

**安全边界没有变化**：同一个 PAT 现在就能直接 GET `/file/attachments/...`
把附件全拖走，memogit 就是这么下载的。本工具只是把已有能力做成 agent 能用的形态。

绝对 URL 依赖 `Profile.InstanceURL`；没配的私有实例需要从请求 Host 推导。

### 3.4 格式白名单，在签发时卡

不在名单里的**直接拒绝，连 URL 都不产生**：

| 支持 | 理由 |
|---|---|
| `text/*` | agent 直接读 |
| `application/pdf` | 核心场景 |
| `image/png` `image/jpeg` `image/gif` `image/webp` | agent 原生读得了 |
| `image/svg+xml` | 本质是文本；draw.io 图就存成带内嵌源码的 SVG 附件（见 [drawio-diagram.md](../editor/drawio-diagram.md)），是真实场景 |
| `text/html` | agent 直接读 |

不支持：Office（场景少，用户自己动手更快，且 `.docx` 是二进制 zip，下到本地 agent 也读不了）、
HEIC（下下来打不开）、音视频、EPUB、压缩包及其余一切。

### 3.5 拒绝发生在工具，不在复制

app 里的"复制 Markdown 引用"是类型无关的，用户照样能把一个 `.zip` 的引用贴给 agent。
所以白名单只在工具这一步起作用，**错误信息必须是能直接转述给用户的人话**——
"这个类型不支持通过 MCP 读取，你可以在 app 里下载后自己处理"——而不是一个干巴巴的
unsupported type。

## 4. 明确不做

- **附件写入/上传。** `push` 永远不上传附件，目前靠遍历时 `SkipDir` 整个 `_attachments`
  保证（[push.go:539](../../../../internal/memogit/push.go)）。用户要加/换/删附件，
  让他在 app 里做。
- **MCP 附件枚举工具。** 发现附件是用户的事（§1）。加了只会撑大常驻上下文。
- **MCP resources 原语。** 概念上更正统，但客户端支持面比 tools 窄得多，
  且解决不了体积和格式这两个真问题。
- **附件内容摘要 / PDF 文本抽取。** 服务端目前没有任何抽取能力（`go.mod` 里没有 PDF 库，
  RAG 也不索引附件正文）。这是"文件名不够用"的真解，但量级完全不同，见 §6 第三期。
- **Office 支持**，理由见 §3.4。

## 5. 验收点

- 一篇带 mounted 附件的普通 markdown 文档，`pull` 之后文件尾部能看到附件清单，
  含文件名、MIME、大小、本地相对路径，且 inline / mounted 已分组。
- 对同一篇文档连续 `pull` 两次不产生 diff；本地不改内容直接 `push` 不产生任何上传。
- 手工删掉标记块再 `push`，不会把清单内容写到服务器正文里。
- MCP：贴一个 PDF 的 markdown 引用，拿到可下载的 URL，`curl` 得到正确字节；
  过期后同一 URL 返回 401/403。
- MCP：贴一个 `.zip` 或 `.docx` 的引用，拿到人话拒绝，且没有签发任何 URL。
- MCP：贴一个 vault 锁定的附件，拿到明确的"已锁定"提示而不是 500。
- MCP：贴一个自己无权读的附件，拒绝，且拒绝理由不泄漏该附件所属文档的存在性。

## 6. 分期

**第一期 —— memogit 清单 + 判断规则**（§2）。纯本地，不动服务端和 proto，
改动集中在 `internal/memogit/` 和 `docs/skill/`。它自足、可独立验收，
而且是当前"功能等于不存在"这个问题的直接修复，优先做。

**第二期 —— MCP 下载令牌 + 工具**（§3）。需要动 `server/auth`、`server/router/fileserver`、
`server/router/mcp`。与第一期无依赖关系，顺序可换，但它改动面更大、涉及新的凭证类型，
放在后面。

**第三期 —— 观察后调优。** 前两期上线跑一段时间后，用真实数据回答三个问题：
"文件名无信息量"的情况到底占多少比例、agent 主动汇报未读附件的机制是否真的挽回了漏读、
白名单是否需要扩。**只有当第一个比例高到无法接受时**，才考虑给 memogit 二进制引入 PDF
解析依赖、在本地抽首页文本写进清单——这是本需求唯一预留的扩张方向，
且必须由数据触发，不预先开工。

## 7. 已知残留风险

- **附件下载没有大小和类型过滤。** 一个塞满视频的知识库 `clone` 下来就是几个 GB，
  而这些字节对 agent 毫无用处。要不要加 `--no-attachments` 或按 MIME 过滤，
  是独立的小需求，与本篇的"只读"无关，未纳入范围。
- **文件名判断的上限。** §2.3 的规则能把漏读变成可见，但变不成不发生。
  扫描件、`IMG_xxxx` 这类文档，agent 只会跳过并汇报。这是方案的上限，不是缺陷。
