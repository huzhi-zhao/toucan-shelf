# 粘贴 HTML 自动转 Markdown

## 是什么

编辑器（[Editor/index.tsx](../../../../web/src/components/MemoEditor/Editor/index.tsx)，CodeMirror 6）
在粘贴时读取剪贴板里的 `text/html`，转成 Markdown 再插入，而不是像默认那样只取 `text/plain`。

解决的是一条**每天都在走的外部依赖**：从大模型对话页、技术文档站、公众号复制一段内容，
必须先粘进 Obsidian 之类的编辑器转成 Markdown，再复制进 ToucanShelf。ToucanShelf 是
Markdown 存储的知识库，"外部富文本 → 库内 Markdown"是入口级能力，不该外包给第三方工具。

浏览器复制网页时剪贴板里同时有两份：`text/html`（保留标题层级、列表、表格、代码块语言、
链接、KaTeX 里的原始 TeX）和 `text/plain`（这些全部拍平成裸文本）。默认行为丢掉的正是有信息量的那份。

实现分两层：

- 转换本身是纯函数，[html-to-markdown.ts](../../../../web/src/utils/html-to-markdown.ts)，
  与编辑器无关，可单测、可复用（评论框、未来的 URL 剪藏走同一个出口）。
- 粘贴接管是 CodeMirror 扩展，[htmlPaste.ts](../../../../web/src/components/MemoEditor/Editor/htmlPaste.ts)。

## 何时不转换

**默认转换会误伤，所以"不转换"的判定和转换本身同等重要。** 命中以下任一条时原样走纯文本：

| 情形 | 判据 | 为什么 |
|---|---|---|
| 纯文本本身已是 Markdown | `text/plain` 里有围栏代码块 / 表格分隔行 / 行首 `#␣` / 连续列表项 / `[]()` | 大模型页面复制出来常常两份都在，plain 那份已经是作者手写的 Markdown 原文。再过一遍转换只会把 `#`、`_`、`*` 转义成 `\#`、`\_`、`\*` |
| 从代码编辑器复制 | 剪贴板存在 `vscode-editor-data` 类型 | 那份 HTML 是语法高亮的一堆 `span`，转出来是彩色噪音 |
| HTML 没有结构信息 | 清洗后不含 `a/strong/em/code/pre/h1-6/ul/ol/table/img/blockquote` 任一 | 转不转结果一样，不如省一次转换、少一次出错机会 |
| 用户显式要求纯文本 | `Mod-Shift-V` | 见下 |

从编辑器内部复制不需要专门识别：CodeMirror 复制只写 `text/plain`，天然走纯文本分支。
从**渲染后的文档正文**复制会带 HTML，转回 Markdown 是符合预期的。

## 转换规则

基础规则用 turndown + turndown-plugin-gfm（表格、删除线、任务列表）。turndown 是这条路线的
事实标准——Obsidian 官方的 Web Clipper、Joplin 的剪藏都用它。选它而不是仓库里已有的
remark/rehype 链，理由见
[ADR-0018](../../adr/0018-html-to-markdown-via-turndown.md)，一句话是：这里的输入是
"脏 HTML"，容错能力比管线一致性重要。

默认规则不够，另加：

- **数学公式**——KaTeX 渲染结果里藏着 `annotation[encoding="application/x-tex"]`，
  取出原始 TeX 输出 `$…$`，`.katex-display` 输出 `$$…$$`，并丢弃 `.katex-html`
  那份用于视觉呈现的重复 DOM。不做这条，从大模型复制的公式会变成一串拆碎的符号。
- **代码块语言**——从 `class="language-xx"` / `class="lang-xx"` / `data-language` /
  `hljs-xx` 里提语言，输出带语言标注的围栏块。
- **Office / WPS 粘贴**——丢掉 `<o:p>`、`mso-` 样式壳、`v:`/`w:`/`o:` 命名空间标签、
  `&nbsp;` 与零宽字符。
- **列表标记**——turndown 默认把标记补齐到四列（`-   item`），改成 `- item`、
  续行缩进跟着前缀宽度走，与编辑器自己写出来的 Markdown 一致。
- **相对路径的图片与链接**——剪贴板 HTML 不带来源页 base URL，相对路径无法补全。
  图片直接丢，链接退化成纯文本，而不是写一条必然 404 的地址进文档。
- **绝对地址的图片**——保留成 `![](https://…)` 远程引用，不自动下载进附件库。
  抓取要走后端代理（跨域），属于剪藏功能，不是粘贴功能。

## 交互约定

- **两段式插入**：先把 `text/plain` 插进去，转换完成后再替换成 Markdown。
  这样异步转换（turndown 是按需 `import()` 加载的）不会有"粘了没反应"的空窗，
  转换抛错时纯文本已经落地，不会丢内容。
- **`Mod-Shift-V` 强制纯文本**。浏览器自身的"粘贴为纯文本"在各家实现不一致，
  所以自己记一个一次性标记，不依赖浏览器行为。
- **不弹提示**。转换是用户粘贴富文本时想要的结果，不是需要确认的副作用；
  `Mod-Z` 撤销即可（两次 dispatch 落在同一个 history group 内时一次撤销到底）。
- turndown 在编辑器首次获得焦点时预加载，粘贴时通常已在内存里。

## 边界

- 只覆盖粘贴。拖入 `.html` 文件、从 URL 剪藏整页（含正文提取，去掉导航栏页脚）
  都不在本篇范围内——选区复制场景下，选区本身就是正文提取的结果。
- 合并单元格的表格会退化：GFM 表格没有 `rowspan`/`colspan`，内容保留、结构拍平。
- 不保证幂等或可逆。这是一次**内容导入**，不是格式往返。

## 验证

转换是纯函数，用真实剪贴板 HTML 样本做断言：
[html-to-markdown.test.ts](../../../../web/tests/html-to-markdown.test.ts)
覆盖标题/列表/表格/代码块语言/KaTeX 公式/Office 壳/相对路径，以及"何时不转换"的每一条判据。
粘贴接管本身在真实 `EditorView` 上跑：
[html-paste.test.ts](../../../../web/tests/html-paste.test.ts)
断言"先落纯文本、再换成 Markdown"的两段式，以及四条跳过路径。

CodeMirror 自己的粘贴处理**无论我们接不接管都会 `preventDefault`**，
所以判断有没有接管只能看文档内容，不能看 `defaultPrevented`——这一条踩过一次。
