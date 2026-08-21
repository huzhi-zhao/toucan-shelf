# ADR-0018 粘贴的 HTML 用 turndown 转 Markdown，不复用 remark/rehype 管线

## 背景

编辑器要把剪贴板里的 `text/html` 转成 Markdown（见
[html-paste-to-markdown](../requirements/editor/html-paste-to-markdown.md)）。
仓库里已经有一整套 unified 生态（`rehype-raw`/`rehype-sanitize`/`remark-gfm`/
`remark-math`/`mdast-util-*`），用于**渲染方向**（Markdown → HTML）。
反方向是否复用同一套，是本决策要回答的问题。

## 决策

用 **turndown + turndown-plugin-gfm**，按需 `import()` 加载，
封装在 [html-to-markdown.ts](../../../web/src/utils/html-to-markdown.ts) 里，
对外只暴露一个纯函数。DOM 清洗（Office 壳、KaTeX、相对路径）自己做，
turndown 只负责结构映射。

## 被否决的选项

**1. `rehype-parse` → `rehype-remark` → `remark-stringify`**

一致性最好，且能直接复用现有的 remark 插件。否决理由是输入性质不同：
渲染方向的输入是自己库里的 Markdown，可控；粘贴方向的输入是任意站点的 DOM
片段——Word 的 `mso-` 壳、公众号的多层嵌套 `section`、React 站点的
`div` 冒充段落。turndown 是围绕"脏 HTML"长出来的（Obsidian 官方 Web Clipper、
Joplin 剪藏都用它），这些畸形输入有现成的处理经验；unified 链在这里要自己补的
边界情况远多于省下的依赖。体积也差三到四倍。

**2. 自己写 DOM 遍历**

初版看着简单，但列表嵌套、表格对齐、代码块内不转义、inline 元素边界空格
这些都要重新踩一遍——turndown 花了十年在踩。不值得。

**3. 服务端转换**

需要一个 HTML 解析器和一次网络往返，而剪贴板 HTML 本来就在浏览器里、
浏览器本来就有解析器。唯一能换来的是"抓取远程图片"，那属于剪藏功能，
本决策不覆盖。

## 后果

- **多两个运行时依赖**（turndown ≈ 12KB gz，gfm 插件 ≈ 2KB），
  按需加载，不进首屏包。
- **转换质量取决于上游**：turndown 的 bug 我们只能绕，不能修在源头。
  缓解方式是自定义规则都写在自己这边，且转换有纯函数级的样本测试。
- **两个方向的实现不共享代码**：渲染侧改 GFM 支持不会自动反映到粘贴侧。
  这是有意接受的——两侧的正确性标准本来就不同（渲染要忠实，粘贴要能读）。
- 若将来引入服务端剪藏（抓 URL、取正文、下载图片），前端这条路径仍然保留，
  两者面向不同场景（选区 vs 整页）。
