# 受限内联 `style` HTML 渲染

## 是什么

渲染管线（[MemoMarkdownRenderer.tsx](../../../../web/src/components/MemoContent/MemoMarkdownRenderer.tsx)）
启用了 `rehypeRaw`，裸 HTML 标签能通过，但紧随其后的 `rehypeSanitize`
（[SANITIZE_SCHEMA](../../../../web/src/components/MemoContent/constants.ts)）会把 `style`
属性整个剥掉。本机制允许**属性级白名单过滤后**的内联 `style` 通过，而不是放开 `style` 本身。

实现是在 `rehypeRaw` 之后、`rehypeSanitize` 之前插入一个 rehype 插件
（[rehype-inline-style.ts](../../../../web/src/utils/rehype-plugins/rehype-inline-style.ts)），
把每个元素的 `style` 解析成声明列表，只保留白名单内的属性，其余丢弃；随后 schema 里对相应标签
放行 `style`（此时已被规范化过）。

## 白名单

允许的 CSS 属性：

```
color, background-color
font-size, font-weight, font-style, font-family
text-align, text-decoration, text-transform, letter-spacing, line-height
margin, margin-*, padding, padding-*
border, border-*, border-radius
width, max-width, height, max-height
display（仅 block / inline / inline-block / flex，其余值一律丢弃）
```

`display: none` 不在白名单内——放行会让一篇文档（包括 PUBLIC 分享出去的）把自己的一部分内容
对读者藏起来。

无条件丢弃：`position`、`z-index`、`top/right/bottom/left`、`transform`、`content`、
`filter`、`mix-blend-mode`、`pointer-events`、`opacity`，以及**任何值里出现 `url(`、
`expression(`、`@import`、`javascript:` 的声明**（不管属性名是否在白名单里，值级别再过一道）。

`font-family` 允许，但只保留通用族名和字面字体名；`url()` 已在值级别拦掉，不会触发网络请求。

### 为什么不能直接放行 `style`

裸 `style` 有两类可利用面：

- **UI redressing**——`position: fixed` + `z-index` + 大尺寸，可以让文档内容盖住应用自身的
  真实按钮（删除、分享、授权确认），点击落到用户没预期的控件上。
- **外链探测**——`background-image: url(https://attacker/…)`，文档一被打开就向外部发起请求，
  泄露"谁在什么时候读了这篇"。ToucanShelf 的文档可以是 PUBLIC 分享的，这不是理论风险。

## 带 `class` 的标签不走这条路

只渲染"无自定义 class、仅带内联 style"的标签。带 `class=` 的 HTML 依赖外部 CSS，而
ToucanShelf 不加载文档携带的样式表——渲染出来必然是半成品（结构在、样式全丢），比不渲染更糟。
渲染器侧维持现状（`defaultSchema` 本来就剥掉大部分 `className`，只有 `span`/`code`/`mark`/`li`
等少数标签放行受控的 class 值）。带 class 的 HTML 是内容治理问题，不是渲染器责任——迁移/导入
内容时应在内容侧剥壳留文本。
