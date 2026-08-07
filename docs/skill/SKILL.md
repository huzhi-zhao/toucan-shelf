---
name: toucanshelf
description: 在 ToucanShelf 知识库中读取、编辑、移动、创作文档时使用（memogit 检出的本地目录，或通过 MCP 在线协同）。ToucanShelf 是 memos 的 fork，一条 memo = 一篇文档，带有一批标准 Markdown 渲染器不认识的定制语法（frontmatter 属性、callout、kanban/sheets/grid/calendar 交互块、toucan-secret 密文块、.view.json 画廊视图）和一套同步契约（memogit-id 身份标记、删除即归档、附件只读）。踩到它们会静默丢数据或制造假冲突。
---

# ToucanShelf 操作手册（核心）

ToucanShelf 是 [usememos/memos](https://github.com/usememos/memos) 的 fork：上游是
"单条速记 + 扁平时间线"，本 fork 在其之上叠加了 **Yuque 式层级知识库 + Notion 式视图**。

- **一条 memo = 一篇文档**，属于唯一一个 **workspace（知识库）**，挂在斜杠分隔的
  **folder_path** 下。文件夹只是路径前缀，没有独立实体。
- 文档有 4 种 `doc_type`：`MARKDOWN` / `HTML` / `PDF` / `VIEW`。
- 你可能通过两个通道接触它：**memogit 检出的本地文件**，或 **MCP 在线工具**。
  两者面对的是同一批文档，但失败模式完全不同。

**核心心智模型**：你操作的不是普通 Markdown 仓库，而是一个数据库的本地投影。
文件是内容的唯一载体，但绝大部分元数据（doc_type、可见性、同步哈希、附件、关系、
批注评论）**都不在文件里**。

---

## 0. 先判断你在哪个通道 —— 做完再往下读

**先跑这条命令**（从当前目录往上找检出根）：

```bash
d=$PWD; while [ "$d" != / ] && [ ! -d "$d/.memogit" ]; do d=$(dirname "$d"); done; if [ -d "$d/.memogit" ]; then echo "memogit: $d"; else echo "no memogit checkout"; fi
```

| 结果 | 通道 | 专属细节读 |
|------|------|--------|
| 打印出 `memogit: <路径>` | **memogit 检出**（本地文件） | `references/memogit.md` |
| `no memogit checkout`，但有 `mcp__toucanshelf__*` 工具 | **MCP 在线** | `references/mcp.md` |
| 两者都有 | 问用户走哪条，**别自己挑** | —— |

**确认通道后，本文件下面的 §1 §2 只读适用于你那一栏的行**（每行都标了
`两者` / `仅 memogit` / `仅 MCP`），标着另一条通道的直接跳过。
§3 §4 两个通道都适用。

两个通道**不要混用**：MCP 写入没有并发检查，memogit 有 `.remote` 冲突流程。
同一篇文档在一个会话里只走一个通道。

---

## 1. 六条铁律（其余细节按需查 references）

1. **【两者】文档的身份必须原地保住，绝不"新建一份 + 干掉旧的"。**
   版本历史 / 评论批注 / 分享链接 / 反向引用全绑在 memo uid 上，换了身份就全丢。
   两条通道下它长这样：
   - *仅 memogit*：每篇文档末尾有一行 `<!-- memogit-id: memos/<uid> -->`
     （`.view.json` 则是顶层 `"memogit-id"` 键），**这一行不能动**。移动/重命名
     **直接 `mv`**，标记随文件走。新建文档不要自己编 ID，留空，push 后 memogit 自己写入。
     详见 `references/memogit.md`。
   - *仅 MCP*：改标题 / 换文件夹 / 换知识库，就用 `memo_update_memo` 更新
     `title` / `folder_path` / `workspace` 字段；**绝不要 `memo_create_memo` 建新的、
     再把旧的 `state` 置成归档**——那是同一个错误的在线版本。服务器正文里不含
     `memogit-id`，**通过 MCP 写入时也不要手写这一行**。
2. **【仅 memogit】别在文件顶部加任何 memogit 头部。** 第一个 `---` 块永远属于用户自己的
   Obsidian frontmatter（喂给画廊视图和看板的属性）。身份标记放在文件末尾正是为了让开这个位置。
3. **【两者】别主动写 `==背景着色==`。** 着色是读者在 app 里选中文字做的动作（会连带评论），
   不是作者写在正文里的东西。遇到已有的原样保留，要强调就用加粗或 callout。
4. **【两者】别改写内联附件引用 `![](...)`**，即使看起来"链接坏了"。引用指向的字节你多半
   看不到（MCP 根本不暴露附件），改了只会真的弄坏它；在 memogit 下还会被误判成本地编辑，
   制造假冲突。
5. **【仅 memogit】附件只读。** `_attachments/**` 下的字节可以**读**（这正是它们被下载下来的原因），
   但绝不编辑、不删除、不移动、不上传。详见 `references/attachments.md`。
   （MCP 通道下不存在这个目录，附件完全不暴露。）
6. **【两者】标题里不要放标点。** 标题会被 slugify 成锚点 ID（只保留字母/数字/空格），
   供大纲跳转和评论定位使用。只靠标点区分的标题会撞成同一个 slug，
   纯标点标题拿不到 ID。批量润色标题时把标点移出标题。

---

## 2. 能改 / 不能改

| 通道 | 对象 | 能不能改 | 说明 |
|------|------|---------|------|
| 两者 | Markdown 正文、frontmatter、内嵌块 | ✅ | 主要工作面 |
| 两者 | HTML 文档 | ✅ | 直接改源码 |
| 两者 | VIEW 文档（`*.view.json` / `content` 里的 JSON） | ✅ 谨慎 | 结构化配置，必须保持合法 JSON，见 `references/blocks-and-views.md` |
| 两者 | ` ```toucan-secret ` 块 | ❌ 只读 | 只有 `hint`（明文标题）在用户明确要求时可改，`id` 一个字符都别动 |
| 两者 | PDF 文档 | ❌ | 只读预览，正文是引用桩 |
| 仅 memogit | 文件路径/文件名 | ✅ | = 移动/重命名文档，直接 `mv` |
| 仅 memogit | `*.pdf.md` | ❌ | 生成的引用桩，push 会忽略 |
| 仅 memogit | `_attachments/**` | ❌ 只读 | 可以阅读内容，不能编辑/删除；push 从不上传附件 |
| 仅 memogit | 末尾 `memogit-id` 行 | ❌ | 见铁律 1 |
| 仅 memogit | `.memogit/**` | ❌ | 同步状态账本，不要手改 |
| 仅 memogit | `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/` | ⚠️ | memogit 生成的简报，不是知识库文档；只在 `<!-- BEGIN memogit -->` 块**外面**写自己的规则 |
| 仅 MCP | `title` / `folder_path` / `workspace` / `state` / `pinned` | ✅ | 即改名、移动、归档、置顶，见 `references/mcp.md` |
| 仅 MCP | `visibility` / 时间戳 / `doc_type` / `attachments` / `relations` | ❌ | 服务端直接拒绝，不在可写字段里 |

> **没有任何通道能硬删文档。**
> *memogit*：删掉本地文件 = **归档**服务器文档（软删除，可恢复）。放心删，但要清楚
> 这是个远端副作用。
> *MCP*：工具集里**没有删除工具**，`state` 置归档是最接近的操作，同样可撤销。
> 两边都一样：**归档不腾出名字**——`(folder_path, title)` 唯一约束仍被占用。

---

## 3. 看不见的东西（改动前必须知道）

以下内容存在于服务器上，但**两条通道都看不到**（memogit 不导出，MCP 不暴露）：

- **高亮 / 下划线 / 评论**——每条是文档的一条子 comment memo，锚点存在 payload 上。
  正文"干净"不代表没人批注过。**重写一段被标记的文字会静默摘掉该标记的
  高亮**（文本锚点靠原文 + 前后各 32 字上下文重新定位）。大规模改写正文前心里有数。
- **版本历史、分享链接、reactions、文档间关系**——全部绑在 memo uid 上。
- **文档设置**（是否全宽 / 显示大纲 / 显示文档树 / 显示属性面板）——存在 memo 记录上，
  不在正文里，改它不产生 diff。

---

## 4. 需要更多细节时，按模块读

| 通道 | 主题 | 文件 |
|------|------|------|
| 两者 | workspace / folder_path / 4 种 doc_type / 路径映射 / 唯一性约束 | `references/hierarchy-and-doc-types.md` |
| 两者 | frontmatter、callout（含折叠/悬浮/标签行）、点击计数器、高亮、标题锚点、`toucan-secret` 密文块 | `references/markdown-syntax.md` |
| 两者 | ` ```kanban ` / ` ```sheets ` / ` ```grid ` / ` ```calendar ` 四种交互块，以及画廊视图 | `references/blocks-and-views.md` |
| 主要 memogit | 附件工作原理、AI 何时该读附件、PDF/EPUB 的边界 | `references/attachments.md` |
| 仅 memogit | `memogit status/pull/push`、冲突 `.remote`、检出布局、排障 | `references/memogit.md` |
| 仅 MCP | MCP 工具集、寻址方式、全量覆写语义、并发风险 | `references/mcp.md` |

**上面三行标"两者"的定制语法，两条通道一字不差地同样适用**——它们描述的是文档内容本身，
跟你是通过文件还是通过工具写入无关。不要假设自己已经知道全部细节，这些块的语法都是本
fork 自己的方言。
