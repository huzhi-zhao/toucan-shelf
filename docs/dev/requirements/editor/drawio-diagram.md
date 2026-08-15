# draw.io 图：带内嵌源码的 SVG 附件

## 是什么

文档正文里一张普通的图片引用：

```markdown
![登录时序图](/file/attachments/xxx/login-seq.svg)
```

如果这个 SVG 是从 draw.io 导出的（勾选了 "Include a copy of my diagram"），
渲染时在图片下方多出一组操作：**在 draw.io 中编辑 / 下载 SVG / 下载 XML**。
点编辑弹出 draw.io 编辑器，改完保存，原附件被就地覆盖，页面上的图随之更新。

不是 draw.io SVG 的图片（Claude 生成的、Figma 导出的、随手截的），
渲染行为与现在完全一致，不出现任何多余控件。

## 为什么不是一个新的代码块

[calendar](calendar-block.md)、[sheets](sheets-block.md)、[secret](secret-block.md)
这些块都走 `CodeBlock` 语言分发（[ADR-0004](../../adr/0004-interactive-blocks-via-codeblock-dispatch.md)），
draw.io 刻意**不**走这条路，原因是内容形态不同：

- calendar/sheets 的块内容是**人写得出、读得懂**的文本，放正文里合理。
- draw.io 的 mxGraph XML 是编辑器产物，一张十几个节点的图就上百行，
  每个节点写死 `x/y/width/height`。塞进正文会把文档淹掉，
  diff 全是坐标噪音，对 [memogit](../collaboration/memogit-sync.md) 尤其糟。

所以 draw.io 图归**附件**，正文只留一行图片引用。这也让不装本系统的人
（GitHub、任意 markdown 阅读器）看到的仍然是一张正常的图。

## 为什么一份 SVG 就够，不需要另存 XML

draw.io 导出 SVG 时，会把**完整的 `.drawio` 原文**（HTML 转义后）塞进根
`<svg>` 元素的 `content` 属性里：

```xml
<svg ... content="&lt;mxfile host=&quot;app.diagrams.net&quot;&gt;…&lt;/mxfile&gt;">
```

里面是整个 `mxfile`——所有页、所有 `mxCell`，一个不落，抠出来解转义就能
直接扔回 draw.io 打开。于是同一个文件同时是：

- **可直接渲染的图**——标准 `<img>`，不需要引入 drawio 的 `viewer.min.js`，零运行时依赖。
- **可回编辑的源**——编辑时现抠 `content`，不用单独存一份 XML、也就不存在两份不同步。

代价是体积约翻倍（图形数据存两份），纯文本，可接受。

`content` 不是 SVG 标准属性，只有 draw.io 会写。因此"这张 SVG 是不是 draw.io 图"
的判定是**结构性的、无误判的**：根节点有 `content` 且值以 `&lt;mxfile` 开头。
存量 SVG 附件不受任何影响。

## 图从哪来

三条来源，都收敛到同一份 SVG 附件上：

1. **人直接在 draw.io 里画**，导出 SVG 上传。
2. **AI 先出 PlantUML / mermaid 文本，人导入 draw.io 再调整。**
   这是引入 draw.io 的主要动机——[mermaid](../../../../web/src/components/MemoContent/MermaidBlock.tsx)
   适合 AI 生成（只描述关系，布局交给渲染器），但布局不可控、画不了的图种也不少；
   draw.io 补的正是"人要精修"这一段。导入进来的是真正的 UML 图元
   （`shape=umlLifeline` 一类），不是拼出来的死图，可以继续编辑。
3. **系统内已有的图，点编辑改一版。**

注意第 2 条的导入（draw.io 的 `Insert → Advanced → PlantUML`）是发到 jgraph
服务器转换的，需要联网。这是人主动发起的一次性动作，不在文档渲染路径上。

## AI 不生成 mxGraph XML

明确排除"让模型直接产出 drawio XML"这条路。mxGraph XML 没有布局引擎语义，
坐标必须写图的人自己算；模型要同时当作者和布局引擎，超过十几个节点就是
框重叠、连线穿框。AI 出图仍然走 mermaid。

## 渲染与编辑的算力都在浏览器

`embed.diagrams.net` 是纯静态前端应用，jgraph 只提供 HTML/JS，编辑、布局、
导出全在用户浏览器内完成。没有 API key、没有配额、不产生服务端调用。
文档内容也不会离开浏览器——除非用户主动使用上面提到的 PlantUML 导入。

要彻底去掉外部域依赖，可自托管 `jgraph/drawio`（Apache 2.0），协议一致、
只是换成同源 iframe。本期不做，见
[ADR-0017](../../adr/0017-drawio-svg-with-embedded-xml.md)。

## 边界

- **不做多页图。** `mxfile` 支持多 `diagram` 节点，编辑器里也能建多页，
  但 SVG 只渲染第一页。允许存在（编辑往返不丢数据），不为它做 UI。
- **不做深色模式适配。** 图什么样由作者在 draw.io 里定，系统不改写图内颜色。
- **不做版本历史。** 覆盖就是覆盖，前一版不保留。图的历史随
  [文档版本历史](../knowledge-base/document-versioning.md)走正文引用，不覆盖附件二进制。
- **不引入 Kroki 一类的服务端渲染器。** 纯前端是硬约束。

## 权限与安全

- 编辑走 `UpdateAttachment`，沿用附件既有的"仅创建者或管理员可改"判定。
- 覆盖内容时必须重新校验 MIME 与体积，与上传路径同一套规则——
  不能因为"这是更新"就跳过。
- 私密（locked）附件不提供编辑入口。解密内容进第三方 iframe 不可接受，
  见 [附件访问控制](../attachments/access-control-and-private-files.md)。
- 渲染侧不变：SVG 始终走 `<img>` 加载，不内联进 DOM，
  `rehype-sanitize` 的既有约束不受影响。
