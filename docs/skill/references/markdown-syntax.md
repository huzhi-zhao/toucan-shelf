# 定制化 Markdown 语法

这些是 `.md` 文件里会出现、但**标准 Markdown 渲染器不认识**的东西。读、写、搜索文档时
都必须认得它们。（交互式围栏块 kanban / sheets / grid / calendar 见
`blocks-and-views.md`。）

---

## 1. Frontmatter（Obsidian 子集）

必须是**文件最开头**的 `---` 块：

```markdown
---
title: AI Ethics Week 1
tags: [ai, ethics]
status: done
date: 2026-07-11
reviewed: false
---

# 正文从这里开始
```

- **解析器是行式的，不是完整 YAML**。只认扁平的标量/列表值：
  `text` / `list`（`[a, b, c]`）/ `number` / `checkbox`（`true` / `false`，也接受
  `"true"` / `"false"` 字符串形式）/ `date`（`YYYY-MM-DD`）/ `datetime`。
- **嵌套 map、对象数组、畸形行会被静默忽略**——不报错、不渲染。所以**别写嵌套 YAML**，
  写了看起来没事，实际上那部分数据在 app 里根本不存在。
- key 不存在 = "未设置"，走默认行为。
- **改属性有涟漪**：frontmatter 会喂给 **画廊视图的 scope / sort / cover / badge**
  和看板分组。跨文档批量改 `status`/`tags`/自定义属性之前，扫一眼有没有 `.view.json`
  在消费它。

---

## 2. Callout（告示块）

`> [!TYPE] 文本`，类型**大小写不敏感**。块与块之间需要空行。

支持的类型：
`NOTE INFO TODO ASIDE IMPORTANT CHECK DONE SUCCESS TIP HINT WARNING CAUTION
ATTENTION ERROR FAILURE FAIL MISSING DANGER BUG EXAMPLE QUOTE CITE ABSTRACT
SUMMARY TLDR QUESTION HELP FAQ`

**不认识的类型不会退化成裸文本**，而是按 `NOTE` 的样子渲染（与 Obsidian 一致）。

```markdown
> [!WARNING] 这是一条警告

> [!TIP(💡)] 括号里放 emoji 覆盖默认图标 —— 本 fork 扩展
```

### 2a. 折叠 / 悬浮 callout

同一套语法的两个特殊家族，正文里可以放列表、代码、表格、图片等任意 Markdown：

| 语法 | 渲染成 |
|------|--------|
| `> [!Collapse]- 标题` | 可折叠卡片，点标题展开/收起 |
| `> [!Popover] 标题` | 一个 pill 按钮，**悬浮**时在上方浮出正文 |

marker 后面紧跟 `+` / `-` 决定 Collapse 的初始状态（`-` 或不写 = 折叠，`+` = 展开），
与 Obsidian 一致。**这个标记只影响渲染，不会被写回**：在预览里折叠/展开永远不改 Markdown 源码。

```markdown
> [!Collapse]- 部署步骤
> 1. 构建镜像
> 2. 推送仓库
> 3. 滚动重启

> [!Popover] 什么是 workspace？
> 知识库的顶层容器；每篇文档属于且只属于一个 workspace。
```

注意：
- Popover 靠悬浮触发，**移动端不友好**；需要在手机上能打开的内容用 Collapse。
- Popover 正文有宽度上限（`max-w-sm`），别塞长内容。
- **折叠不是访问控制**：被折叠的正文仍在 Markdown 源码里，搜索、memogit、导出都看得到。

### 2b. 标签行 `[!TAGS]`

唯一一个**不渲染成卡片**的 callout：一排彩色 chip，随正文流动换行。
每行一个 chip，形如 `[颜色(图标)] 标签`，颜色和图标都可省略：

```markdown
> [!TAGS]
> [gray(⚙️)] Github
> [orange(🦊)] Gitlab
> [blue] 只有颜色
> 什么都不写也是一个 chip
```

- 变体（决定**整行**的皮肤）：`[!TAGS]`（默认，浅底彩字）/ `[!TAGS:bordered]`（透明 + 彩色边框）/
  `[!TAGS:filled]`（实色底 + 白字）。`[!TAG]` 单数形式等价。
- 12 个色名（Arco 调色板）：`default orangered orange gold lime green cyan blue
  arcoblue purple pinkpurple magenta gray`。大小写不敏感，未知色名回落 `default`，不会崩。
- **标签文本是纯文本**，里面的 `**粗体**`、`` `代码` ``、链接会被拍平成文字。
  需要可点击的链接就放在标签行外面。
- 空的 `> [!TAGS]`（没有 chip 行）什么都不渲染。
- 在不认识这个语法的渲染器（GitHub 等）里，它退化成一段普通引用，可读不破。

---

## 3. 背景着色 `==text==` —— **别主动写**

渲染器仍认识 `==text==`（浅黄）和 `===text===`（浅粉，本 fork 扩展），老文档里会见到。
但**你不要写它们**：

着色是**读者的动作**，不是作者的动作。用户在 app 里选中文字就能加六色高亮/下划线，
还能挂评论、随时改色、一键擦掉（见下面第 6 节）。写死在正文里的 `==` 会污染纯文本、
干扰 diff 和检索，读者也没法取消。

**要强调就用加粗、callout，或者干脆重写句子。** 遇到已有的 `==…==`：原样保留，别扩散。

---

## 4. 点击计数器 `- [N] `

一个存在 Markdown 里的计数器，点一下加一并保存文档：

```markdown
- [1] 用过这个命令
- [12] 复习 Rust 生命周期
- [x] 这是普通任务，不是计数器
```

规则（写的时候容易破）：
- **空格是必需的**：`- [1] label` 是计数器；`-[1] label`、`- [1]label` 都不是。
- **只认纯数字**：`- [x]` / `- [ ]` / `- [/]` 仍是任务勾选框，`- [abc]` 不是计数器。
- 链接定义 `- [1]: https://…` 和链接 `- [1](https://…)` 都不会被误判。
- 代码块（围栏或行内）里的 `- [1]` 保持字面。
- 前导零会被规范化：`- [01]` 点击后变 `- [2]`。
- UI 上**只能加不能减**，要清零就改源码里的数字。

---

## 5. 标题 = 锚点：别在标题里放标点

每个标题会被 **slugify** 成 DOM `id`，这个 slug 是文档大纲、文内 `[x](#slug)` 跳转、
以及**评论/批注的 heading 锚点**共同依赖的地址。slugify **剥掉所有标点**，
只留字母/数字/空格（空格转连字符）。因此：

- 只靠标点区分的两个标题会**塌成同一个 slug**（`Setup (macOS)` 和 `Setup / macOS`
  都变成 `setup-macos`）。重复项被追加位置后缀 `-1`/`-2`，一旦增删或重排相邻标题，
  后缀就重编号，锚在它上面的评论会跳到错误的段落。
- **纯标点标题**（`?!`、`---`）slugify 成空串，**拿不到 `id`**，永远无法被锚定。

批量润色标题时守住这条：把标点移出标题（放进正文）。

---

## 6. 高亮 / 批注 / 评论：不在文件里

app 里对 **Markdown / VIEW 文档、PDF、EPUB** 做的高亮、下划线和评论**不写进文档内容**。
每条标记/评论是文档（或附件所属 memo）的一条**子 comment memo**，锚点存在该 memo 的
payload 上（`doc_anchor` / `pdf_annotation` / `epub_annotation`）。

对你的影响：

- **在检出文件里看不到任何高亮/评论**，memogit 也不导出它们。所以"文件很干净"
  **不代表**没人批注过。
- **重写一段被标记的文字 = 静默摘掉它的高亮。** 文本锚点是"引号选择器"：原文 +
  前后各 32 字上下文，在渲染结果里重新搜索定位。在别处增删不影响它，
  但把被标记的那段**本身**改写掉，锚点就找不回来，退化成更粗的兜底
  （Markdown 用最近的上级标题；PDF 用页码 + 矩形；EPUB 用文本快照）。
  这不是报错，是 best-effort 降级——大规模改写正文时心里有数即可。
- 六色调色板（yellow/green/blue/pink/red/purple）存的是**色名 key 不是 hex**。
- **HTML 文档没有批注和评论**这套东西。

---

## 7. 密文块 ` ```toucan-secret ` —— 只读，绝不改

````markdown
```toucan-secret
v: 1
id: 7Kq2vX9mNb
hint: MinIO 安装过程
```
````

块里**没有任何机密内容**：只有一个指向服务端密文记录的 `id`，加一行 `hint`（明文标题，
渲染时作为卡片标题）。真正的密文在数据库里，用账号主口令在**浏览器端**加解密，
服务端只存不解，不存在任何能返回明文的接口。

对你的约束：

- **`id` 一个字符都别动。** 改掉它等于把用户的凭据永久弄丢——密文记录还在，
  但没人知道该去取哪一条。
- `hint` 是明文标题，用户明确让你改标题时可以改，除此之外别动。
- `id` 以 `local-` 开头表示该块尚未初始化（用户还没设主口令），同样原样保留。
- **别试图"解密"或"补全"它**——你没有口令，服务端也没有。
- 复制文档时这个块跟着走是正常的，两篇文档指向同一条记录是允许的。
- 用户让你"整理/格式化这篇文档"时，**这个块不参与任何重排、合并、格式化**。

### 为什么密文不在文档里（顺带解释了为什么不能动 id）

文档正文在实践中是 append-only 的：每次编辑都会进版本历史，memogit 还会 push 进 git。
如果信封内联在正文里，换口令之后**旧口令的密文仍然永久可读**在历史里，换口令就失去意义。
把密文放在文档外面，轮换才能真正覆写。

代价是刻意接受的：导出到别的实例的文档只带着引用和标题，密文块在那边是惰性的。

---

## 8. 行内媒体的限制

Markdown 管线用 `rehype-sanitize`，会**剥掉手写的 `<audio>` / `<video>` 标签**。
所以文档里**不会**用 `![](clip.mp4)` 这种方式内联音视频——播放器来自**附件路径**，
不是自定义 Markdown 语法（见 `attachments.md`）。

可信 iframe 嵌入走白名单，仍然支持：YouTube / Vimeo / Spotify / SoundCloud / Loom /
Google Maps / draw.io。

**内联图片引用 `![](...)` 不要改写**，即使看起来链接坏了——memogit 刻意不改写它们，
你改写会让文件看起来被本地编辑，触发假冲突。
