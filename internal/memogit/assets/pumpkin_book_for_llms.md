# 南瓜书 · 给 LLM 读的 toucan shelf 操作手册

> **读者**：运行在 Mac 上的 AI 编码代理（Claude Code / Claude 桌面客户端等）。
> **场景**：线上的 toucan shelf 知识库已经用 `memogit` 检出到本地磁盘，你被要求对这些
> 文档做检索、批量编辑、交叉引用，然后把改动同步回服务器。
> **本文目的**：让你在**动手改任何文件之前**，先建立正确的心智模型 —— 这些 `.md`
> 看起来像标准 Markdown，但它们运行在 toucan shelf 环境里，有一批**非标准语法**和
> **同步契约**。踩到它们会静默丢数据或制造假冲突。
>
> 本文是 [`docs/manual/`](.) 下 9 篇正式手册（面向人类）的**浓缩 + 面向代理**版。
> 需要细节时回查对应章节：`01-knowledge-base.md` … `09-epub-reader.md`（视图块见 `06-view-blocks.md`，可运行示例见 `demo-views.md`；文档着色/评论见 `08-document-comments.md`，EPUB 阅读器见 `09-epub-reader.md`）。

---

## 0. 30 秒背景

toucan shelf 是 [usememos/memos](https://github.com/usememos/memos) 的一个 fork。
上游 Memos 是"单条速记 + 扁平时间线"，本 fork 在其之上叠加了一个
**Yuque 式的层级知识库 + Notion 式的视图**：

- **一条 memo = 一篇文档（document）**，没有重型数据库包装。
- 每篇文档属于**唯一一个 workspace（= 知识库 = 项目）**，并挂在一个
  斜杠分隔的 **folder_path** 下（如 `garden/notes`）。文件夹只是路径前缀。
- 文档有 4 种 `doc_type`：`MARKDOWN` / `HTML` / `PDF` / `VIEW`。
- 你在本地看到的目录，是 `memogit clone` 把某个 workspace 抠成文件的结果。

**关键认知**：你操作的不是普通 Markdown 仓库，而是一个数据库的本地投影。文件是
内容的**唯一载体**，绝大部分元数据（doc_type、可见性、同步哈希、附件、关系）都存在
`.memogit/sync-state.json` 里，**不在文件内**。唯一的例外是文档 ID：

> 📌 每篇文档**末尾**有一行 `<!-- memogit-id: memos/<uid> -->`（`.view.json` 里则是
> 顶层的 `"memogit-id"` 键）。这是文档的身份证，**移动/重命名文件时必须让它跟着走**
> （直接 `mv` 就是对的，它在文件里）。**别删、别改、别在新建文件里手写一个。**
> 详见 §1.1。

> ⚠️ **绝不要**为了"整洁"给文档加一个 memogit **头部** —— 文件里第一个 `---`
> 块永远属于用户自己写的 Obsidian frontmatter（喂给视图/看板的属性），不是 memogit 的。
> 身份标记之所以放在**文件末尾**，正是为了不占据这个位置。

---

## 1. 检出目录长什么样（memogit 布局）

```
my-kb/                        ← 检出根目录（只放元数据）
├── .memogit/
│   ├── config.yaml           ← 服务器 URL、token、绑定的 workspace（chmod 600，含密钥）
│   ├── sync-state.json       ← 每篇文档的同步基线（ID ↔ 路径、哈希、可见性、关系…）
│   └── toucanshelf-guide.md  ← 本文（clone/pull 时由 memogit 写入）
├── .git/                     ← 真实的本地 git 仓库（只做快照，无 remote）
├── .gitignore                ← 忽略 config.yaml（含 token）与 *.remote 冲突副本
├── AGENTS.md / CLAUDE.md     ← 指向本文的简报（memogit 管理的块，用户可在块外加自己的规则）
├── .cursor/rules/            ← 同一份简报的 Cursor 规则
└── Default/                  ← 内容树，子目录名 = workspace 标题
    ├── AGENTS.md / CLAUDE.md / .cursor/  ← 同一份简报（在库内启动的代理会读到它）
    ├── garden/notes/todo.md          ← MARKDOWN 文档
    ├── page.html                     ← HTML 文档（原始源码）
    ├── papers/attention.pdf.md       ← PDF 文档的引用桩（见 §3.4）
    ├── dashboards/all.view.json      ← VIEW 文档的配置 JSON（见 §3.5）
    └── _attachments/                 ← 下载下来的附件字节，按附件 uid 分目录
        └── <uid>/attention.pdf
```

> `AGENTS.md`、`CLAUDE.md`、`.cursor/` 是 memogit 生成给你看的，**不是知识库文档**，
> push 会跳过它们。想改自己的项目规则，写在 `<!-- BEGIN memogit -->` 块**外面**。

**路径 ↔ 服务器映射**：`<workspace>/<folder_path>/<title>.<ext>`

| doc_type | 扩展名 | 本地文件内容 |
|----------|--------|-------------|
| `MARKDOWN` | `.md` | Markdown 正文，逐字 |
| `HTML` | `.html` | 原始 HTML 源码 |
| `PDF` | `.pdf.md` | 指向 `_attachments/` 下 PDF 字节的小引用桩，**无可编辑正文** |
| `VIEW` | `.view.json` | 画廊视图的配置 JSON |

服务器对 `(workspace, folder_path, title)` 强制唯一，所以路径决定了文档在知识库里的
位置，文件名里**不含 ID**。**重命名/移动文件 = 重命名/移动服务器上的文档**（push 时体现）。

### 1.1 文档身份标记（`memogit-id`）

每篇文档带一行身份标记，记录它对应服务器上哪篇 memo：

| doc_type | 标记形式 | 位置 |
|----------|---------|------|
| `MARKDOWN` / `HTML` / `PDF` | `<!-- memogit-id: memos/<uid> -->` | 文件**最后一行** |
| `VIEW` | `"memogit-id": "memos/<uid>",` | JSON 对象的**第一个键**（文件仍是合法 JSON） |

**为什么存在**：一篇文档下面可以挂版本历史、评论/批注、reactions、分享链接，还可能被
其他文档引用。这些都绑在 memo 的 uid 上，**不在文件里**。如果 push 靠"路径"认文档，
那你 `mv` 一下，memogit 就只能理解成"旧文档没了 + 新文档出现"——旧文档连同它的全部
历史和评论被归档，新文档从零开始，所有指向它的链接断掉。有了身份标记，`mv` 就是
服务器上的一次真正移动（uid 不变，历史、评论、链接全部跟着走）。

**对你的规则**：

- **移动/重命名**：直接 `mv`。标记在文件里，自然跟着走。别做"复制内容到新文件 + 删旧文件"。
- **编辑**：正常改正文，别碰这一行。**改内容和移动可以同时做**，顺序无所谓。
- **新建文档**：**不要**自己编一个 ID。留空即可，push 创建后 memogit 会自己写进去。
- **复制文档**：复制出来的文件会带着原文档的 ID。memogit 会认出"留在原位的那份是正主"，
  副本按新文档创建——但更稳妥的做法是复制后**手动删掉副本里的那一行**。
- **不小心删了标记**：不会丢数据。push 会退回按路径识别（老行为）并打印提示，
  跑一次 `memogit pull` 就会补回来。

> 标记**只存在于本地文件**。push 时会被剥掉，服务器上的正文永远不含它；
> 它也不参与"文件是否被修改"的判断，所以补写标记不会被当成一次编辑。

---

## 2. 你能改什么、不能改什么（给代理的安全边界）

| 对象 | 可以改吗 | 说明 |
|------|---------|------|
| `*.md` 正文 | ✅ | 主要工作面。改内容、frontmatter、看板块都在这里。 |
| `*.html` | ✅ | 直接改源码。 |
| `*.view.json` | ✅ 谨慎 | 是结构化配置，不是自由文本。改坏 JSON 会让视图退化。见 §3.5。 |
| `*.pdf.md` | ❌ | 生成的引用桩，push 时被忽略。改它没意义。 |
| `_attachments/**` | ❌ | 只读下载。**push 从不上传附件**，改了也不会回传。 |
| 文件的 **路径/文件名** | ✅ | = 移动/重命名文档。folder_path 与 title 由路径推导。直接 `mv`，别复制+删除（见 §1.1）。 |
| 末尾的 `memogit-id` 行 | ❌ | 文档身份证。删了不丢数据，但移动就会退化成删除+新建。见 §1.1。 |
| `.memogit/**` | ❌ | 同步状态，人/工具的账本。不要手改。 |
| `*.remote` | 特殊 | 冲突时服务器版本的副本，见 §5。合并完**删掉它**。 |

> **删除即归档**：本地删掉一个被跟踪的文件，push 会把服务器上的文档**归档（软删除，
> 可恢复）**，绝不硬删。放心删，但要清楚这是个远端副作用。

---

## 3. toucan shelf 的非标准 Markdown 语法（本文重点）

这些是 `.md` 文件里会出现、但**标准 Markdown 渲染器不认识**的东西。你在读、写、
搜索文档时必须认得它们。

### 3.1 YAML Frontmatter（Obsidian 子集）

文档可以以一个 `---` frontmatter 块开头，必须是**文件最开头**：

```markdown
---
title: AI Ethics Week 1
tags: [ai, ethics]
status: completed
date: 2026-07-11
---

# 正文从这里开始
```

- **解析器是行式的，不是完整 YAML**（`web/src/utils/frontmatter.ts`）。只认扁平的
  标量/列表值：`text` / `list`（`[a, b, c]`）/ `number` / `checkbox`（`true`/`false`）
  / `date`（`YYYY-MM-DD`）/ `datetime`。
- **嵌套 map、对象数组、畸形行会被静默忽略**，不报错也不渲染。所以别写嵌套 YAML。
- 属性是自由 key，但两个 key 有特殊行为：

| Key | 类型 | 效果 |
|-----|------|------|
| `displayOutline` | checkbox | `false` → 打开文档时默认折叠大纲侧栏 |
| `hidden` | checkbox | `true` → 隐藏属性面板本身（属性仍解析、仍生效） |

- frontmatter 属性会喂给 **Gallery View 的 scope/sort/cover**（§3.5）和
  **看板**，所以改属性可能影响别处的视图。改之前想想谁在消费它。

### 3.2 Callout（告示块）

`> [!TYPE] 文本` 语法，比 GitHub 更丰富。类型（大小写不敏感）包括：
`NOTE INFO TODO ASIDE IMPORTANT CHECK DONE SUCCESS TIP HINT WARNING CAUTION
ATTENTION ERROR FAILURE FAIL MISSING DANGER BUG EXAMPLE QUOTE CITE ABSTRACT
SUMMARY TLDR QUESTION HELP FAQ`。

```markdown
> [!WARNING] 这是一条警告

> [!TIP(💡)] 带自定义图标的提示 —— 括号里放 emoji 覆盖默认图标
```

**注意**：块与块之间需要空行；`[!TYPE(emoji)]` 的自定义图标是本 fork 扩展。

### 3.3 Highlight（高亮）

两种行内高亮分隔符（Obsidian 风 + 本 fork 扩展）：

| 语法 | 结果 |
|------|------|
| `==text==` | 浅黄底高亮 |
| `===text===` | 浅粉底高亮（**本项目扩展**，非 Obsidian） |

```markdown
这是 ==重点== 也是 ===另一种重点===。
```

解析器优先匹配更长的 `===`。裸的 `=` 串（`====`）或空对不会触发；行内代码/代码块里
的内容不受影响。**编辑器没有快捷键**，直接手打 `=` 分隔符。

### 3.4 PDF 文档 = 引用桩（`*.pdf.md`）

PDF 文档在服务器上由上传的文件字节支撑，本地只写一个小 `.pdf.md` 桩，链接到
`_attachments/<uid>/xxx.pdf`。**它没有可编辑正文**，push 忽略它。要读 PDF 内容，
去 `_attachments/` 找对应字节（你能直接读 PDF）。别试图编辑桩来改 PDF。

### 3.5 View 文档 = 纯配置 JSON（`*.view.json`）

VIEW 是第 4 种 doc_type，`content` **只是一段结构化 JSON 配置**（视图类型 + scope +
排序/封面/卡片规则）+ 可选的 Markdown 前言。它**从不存储渲染后的 HTML**，每次打开都从
当前数据**实时**渲染画廊。

一个 view 可含**多个 gallery block**，每块有：

- **scope**（显示哪些文档）：
  - `{ "type": "folder" }` —— view 所在文件夹的直接子文档
  - `{ "type": "tag", "tag": "..." }` —— 带某标签的所有文档
  - `{ "type": "property", "filters": {...} }` —— frontmatter 属性等值匹配（AND，仅等值）
- **sort**：`updated_desc|updated_asc|created_desc|created_asc|title_asc`，或
  `prop_asc:<key>` / `prop_desc:<key>`
- **cover rule**：`first_image` / `none` / `prop:<key>`
- **card fields**：`__title__` / `__updated__` / `__created__` / `prop:<key>` / `""`
- **badges**：最多 3 个，按属性 `key = value` 过滤给卡片打角标

改这个文件时**保持合法 JSON**；scope 里引用的 `prop:xxx` 依赖目标文档的 frontmatter
存在对应 key。改坏了视图会退化，不会崩文档。

### 3.6 看板块（`` ```kanban ``）

Markdown 文档**内部**嵌的交互式看板，不是独立文档类型。写一个 ` ```kanban ` 围栏，
体是 YAML：

````markdown
```kanban
items:
  - id: t1
    title: Learn Spark
    status: 需求
    priority: high        # highest|high|medium|low|lowest
    due: 2026-07-20
    tags: [BigData]
  - id: t2
    title: Finish AI homework
    status: 开发
    done: true

view:
  type: kanban
  groupBy: status
  descending: false

statusOrder: ['需求', '开发', '测试', '发布']
```
````

- 顶层三键：`items`（卡片）/ `view`（配置）/ `statusOrder`（列的左右顺序）。
- 每张卡片除 `title` 外全可选；无 title 的项被跳过。字段：`id title link status
  priority done order tags due createAt updateAt` + **任意自定义字段**（保留，显示在详情面板）。
- **写回契约**（重要）：在 app 里拖卡/勾选会重写围栏内的 YAML 并保存。YAML 库会
  **规范化格式**（缩进、引号）—— 注释和键顺序保留，手工对齐不保留。所以你手编看板
  YAML 时别依赖精巧的对齐；无 `id` 的卡片首次编辑会被自动补 `id`。
- 畸形 YAML 或无有效 title → 退化成空状态，不会破坏整篇文档。

### 3.7 行内媒体的限制（读文档时要知道）

上游 Memos 的 Markdown 管线用 `rehype-sanitize`，会**剥掉手写的 `<audio>`/`<video>`
标签**。所以文档里**不会**用 `![](clip.mp4)` 这种方式内联音视频 —— 播放器来自
**附件路径**，不是自定义 Markdown 语法。可信 iframe 嵌入（YouTube/Vimeo/Spotify/
SoundCloud/Loom/Google Maps/draw.io）走白名单，仍支持。

**内联图片引用**（`![](...)`）memogit **不会改写**（改写会让文件看起来被本地编辑，
触发假冲突）。图片字节下在 `_attachments/` 里，引用保持原样。**你也不要为了"修好链接"
去改写这些引用** —— 同理会制造假冲突。

### 3.8 其他围栏块

看板之外还有 `` ```calendar `` 和 `` ```grid `` 等特殊围栏块，走同一套"按围栏语言
派发到专用组件"的机制。遇到不认识的围栏语言，当作特殊块**原样保留**，别当普通代码块重排。

### 3.9 标题 = 锚点：别在标题里放标点

每个标题会被 **slugify** 成一个 DOM `id`（`web/src/utils/markdown-manipulation.ts` 的
`slugify`），这个 slug 就是文档大纲、文内 `[x](#slug)` 跳转、以及**评论/批注的 heading
锚点**（§3.10、手册 8）共同依赖的地址。slugify 会**剥掉所有标点**，只留字母/数字/空格
（空格转连字符）。因此：

> ⚠️ **建议标题里不要用任何标点**，以保证标题能当合规、稳定的锚点。原因：
> - 只靠标点区分的两个标题会**塌成同一个 slug**（`Setup (macOS)` 和 `Setup / macOS`
>   都变 `setup-macos`），重复项被追加位置后缀 `-1`/`-2` —— 一旦你增删/重排相邻标题，
>   后缀就会重编号，锚在它上面的评论会跳错段。
> - **纯标点标题**（如 `?!`、`---`）slugify 成空串，直接**拿不到 `id`**，永远无法被锚定。
>
> 你在批量改标题时也要守住这条：把标点从标题里移出去（放进正文），别让稳定锚点因为一次
> "润色"而漂移。

### 3.10 批注 / 高亮 / 评论：不在文件里

app 里对 **Markdown / View 文档、PDF、EPUB** 做的**高亮 / 下划线着色 + 评论**（手册 8、9）
**不写进文档内容**。每条标记/评论是文档（或附件所属 memo）的一条**子 comment memo**，锚点存
在该 memo 的 payload 上（`doc_anchor` / `pdf_annotation` / `epub_annotation`），**不在 `.md`
正文、也不在附件字节里**。对你（通过 memogit 在本地干活的代理）意味着：

- **你在检出文件里看不到任何高亮/评论**，`memogit` 也**不导出**它们（只导出你自己的顶层文档，
  不含子评论）。所以别以为"文件干净"就代表没人批注过。
- **重写一段被标记的文字 = 静默摘掉它的高亮**。文本锚点靠"引号选择器"（原文 + 前后各 32 字
  上下文）在渲染结果里重新定位；只在别处增删不影响它，但**把被标记的那段本身改写掉**，锚点就
  找不回来，退化成更粗的兜底（标题 / 矩形 / 文本快照），读者侧的高亮就消失了。这不是报错，是
  best-effort 降级 —— 你做大规模改写时心里有数即可。
- **EPUB 是附件不是 doc_type**：`.epub` 以只读字节躺在 `_attachments/` 里（和 PDF 字节一样，
  见 §3.4），没有本地桩文件，其批注同样不在文件里。

---

## 4. 编辑与检索的实操建议

1. **搜索**：普通 `grep` / ripgrep 完全可用，这就是检出到本地的意义。搜 frontmatter
   属性、标签、callout 类型都直接文本匹配。
2. **改正文**：像改普通 Markdown 一样改，但守住 §3 的语法约定和 §2 的边界。**标题里别放
   标点**（§3.9，保证锚点稳定）；改写大段正文时留意可能摘掉读者的高亮（§3.10）。
3. **移动/重命名**：直接 `git mv` 或改路径即可 = 移动服务器文档，文档的版本历史、
   评论、分享链接、被引用关系全部跟着走（靠文件里的 `memogit-id`，见 §1.1）。注意
   `(folder_path, title)` 唯一性，别撞名——**已归档的文档也占用这个名额**。
4. **不要**：加 memogit 头部、删/改文件末尾的 `memogit-id` 行、给新文件手写 ID、
   改写内联附件引用、编辑 `.pdf.md` 桩、动 `_attachments/` 和 `.memogit/`。
5. **frontmatter 改动的涟漪**：改了某文档的 `status`/`tags`/自定义属性，可能改变
   引用它的 Gallery View 或看板分组。跨文档改属性前扫一眼有没有 `.view.json` 在消费。

---

## 5. 同步回服务器（memogit 工作流）

memogit 借用 git 词汇但**不是 git 网络协议**，是"数据库 ↔ 本地文件"的桥，版本历史
交给它替你初始化的本地 git 仓。命令都在检出根目录跑。

| 命令 | 作用 |
|------|------|
| `memogit status` | 只读。列出待 push 的本地改动、待 pull 的远端改动、冲突。 |
| `memogit pull` | 拉下服务器自上次同步后的变更，和本地对账，做一次 git commit。 |
| `memogit push` | 把本地改动推上去；`--dry-run` 只打印计划不发送。 |
| `memogit clone [名称]` | 首次检出某 workspace（本地应已是 clone 好的，一般不用再跑）。 |

**push 的行为**（`push --dry-run` 先看计划是个好习惯）：

| 情况 | push 做什么 |
|------|------------|
| 新本地文件 | 建 memo（`+`），从路径/扩展名推导 folder_path/title/doc_type，默认可见性 PRIVATE |
| 改了跟踪文件、服务器未变 | 更新内容（`~`） |
| **移动/重命名了跟踪文件** | **就地移动**该 memo（`→`），uid 不变，版本历史/评论/链接全保留 |
| 移动 + 同时改了内容 | 两件事都做（`→` 再 `~`），先后顺序无所谓 |
| **两边都改** | **冲突**（`⚠`）—— 保留你的文件，服务器版写到 `<path>.remote` 待合并 |
| 本地删了跟踪文件 | **归档**该 memo（`-`，软删除，可恢复） |
| PDF 桩 & 下载的附件 | 忽略（生成物 / 只读下载） |

**冲突解决（`.remote` 副本）**：当 pull/push 发现两边都改，memogit 把**服务器版本**
写成 `<path>.remote`（因为 memos 是 REST，不是 git remote，没法 `git fetch` 出"theirs"）。
解决步骤：

1. 对比 `foo.md`（你的）与 `foo.md.remote`（服务器的），把 `foo.md` 编成你要的合并结果。
2. **删掉 `foo.md.remote`** —— 它的消失就是"已解决"的信号。
3. 跑 `memogit push`。只要服务器没再变，它推你合并后的 `foo.md` 并推进基线。

`.remote` 存在期间，push 视该文档为未解决冲突并跳过。

**归档不腾出名字**：归档是软删除，文档仍留在原 folder_path 下占着
`(folder_path, title)` 唯一约束。所以同名文档删掉后**不能**立刻用同名新建，
需要在网页端彻底删除。（文件夹删除已不受此影响：判空只数未归档的文档。）

**还没实现**：附件**上传**（下载是单向的）、关系写回服务器（v1 只读导出）。

**只同步你自己的文档**：clone/pull 只抓 `creator == 你`。别人共享的 PROTECTED/PUBLIC
文档不会灌进你的本地库（你也 push 不回去）。

---

## 6. 排障速查

- **`connection refused`**：`--server` 指向了前端端口。memogit 必须打**后端**端口。
  前端（Vite）常在一个端口（如 3001），后端在另一个（如 8081）。用
  `lsof -nP -iTCP -sTCP:LISTEN | grep -i memos` 找后端端口，`memogit login` 重新登。
- **`Cloned 0 memos`**：workspace 解析成功但没匹配到文档 —— 文档可能还没归到该
  workspace，或用的是 2026-07-16 前的旧二进制（creator 过滤有 bug，需从源码重建）。
- **改服务器/token**：直接再跑 `memogit login …`，覆盖 `.memogit/config.yaml`。

---

## 7. 一句话备忘（贴在脑门上）

- 文件是内容的唯一载体，元数据在 `.memogit/`，**别加自己的头**。
- 第一个 `---` 块是用户的 frontmatter，喂视图和看板。
- `==高亮==`、`> [!NOTE]` callout、`` ```kanban ``、`.view.json`、`.pdf.md` 是本环境方言。
- 别改写内联附件引用、别动 `_attachments/` 和 `.pdf.md` 桩。
- **标题里别放标点** —— slug 会剥标点，标点标题会撞车或拿不到锚点（§3.9）。
- **高亮/评论不在文件里**（是子 memo，memogit 不导出）；重写被标记段落会静默摘掉高亮（§3.10）。
- 删文件 = 归档文档；重命名 = 移动文档。
- 改完 `memogit status` → `push --dry-run` → `push`，冲突走 `.remote` 合并。
```