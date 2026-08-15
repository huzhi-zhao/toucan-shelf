# ADR-0017 draw.io 图存成带内嵌 XML 的 SVG 附件

## 背景

mermaid 覆盖不了所有图种，布局也不可控；需要一条"人能精修"的画图路径。
硬约束是**纯前端渲染**：不为画图多起一个服务。

## 决策

draw.io 图以**单个 SVG 附件**存储，SVG 的 `content` 属性内嵌完整
`mxfile` 原文。渲染走标准 `<img>`；编辑走 `embed.diagrams.net` 的 iframe
postMessage 协议，导出格式 `xmlsvg`，覆盖原附件。

## 被否决的选项

**1. Kroki（自托管，服务端渲染 PlantUML / D2 / Graphviz…）**

统一性最好、文本始终是唯一真源、diff 友好。否决理由只有一条：多一个 docker
依赖。产品定位是单机可跑的自托管知识库（见
[standalone-local-deploy](../standalone-local-deploy.md)），为画图增加一个必须
常驻的服务，与该承诺冲突。若将来已经因别的原因引入了旁路服务，这条值得重开。

**2. ` ```drawio ` 围栏 + 自托管 `viewer.min.js`**

技术上完全可行——viewer 只做"照坐标画 SVG"，不需要布局计算，所以能纯前端。
否决理由是内容形态：mxGraph XML 进正文会淹掉文档、污染 memogit diff，
而它换来的能力（渲染）SVG 本身就已经具备。多引入约 1MB 运行时，收益为零。

**3. 让 AI 直接生成 mxGraph XML**

mxGraph XML 无布局语义，坐标要作者自己算。模型同时当作者和布局引擎，
十几个节点以上必然重叠穿框。AI 出图继续用 mermaid。

**4. 附件存 PlantUML 文本，点击跳 draw.io 打开**

页面上渲染不出图（只能显示源码），且 draw.io 的 PlantUML 导入本身是服务端
转换——既没解决渲染，又引入了外部依赖。

**5. 正文存 DB 行 id，图存数据库**

文档不再自包含，离开本数据库即失效，与 memogit 的"同步成纯文本文件"相悖
（见 [ADR-0007](0007-memogit-doc-identity-marker-in-file.md)）。

**6. 内容与源分开存（一个 .svg + 一个 .drawio）**

两份文件可能不同步，且要处理"删一个留一个"。`content` 属性已经让一份文件
兼任两职，没有理由拆。

## 后果

- **接受外部域依赖 `embed.diagrams.net`**：编辑功能在断网/内网环境不可用。
  渲染不受影响（纯 `<img>`）。这是有意的取舍：编辑是低频动作，
  为它把几十 MB 的 drawio webapp 打进镜像不划算。将来可换成自托管
  `jgraph/drawio`（Apache 2.0），embed 协议一致，改一个 origin 常量即可。
- **附件体积约翻倍**：图形数据存两份（SVG 图元 + XML 源）。纯文本可压缩。
- **附件内容变成可变的**：这是本决策唯一的后端影响，`UpdateAttachment`
  此前只支持改元数据。见 [design/20260814](../design/20260814-drawio-svg-round-trip.md)。
- **依赖 draw.io 导出时勾选 "Include a copy of my diagram"**（默认勾选）。
  没勾就退化成普通 SVG——仍然正常显示，只是没有编辑入口，不报错。
- **依赖 `content` 属性这一非标准约定**。若 draw.io 未来改格式，
  存量图仍能显示（SVG 部分不变），受影响的只是编辑入口。
