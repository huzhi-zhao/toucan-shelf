# draw.io SVG 图的渲染与回写 — 分阶段实施

> 需求见 [../requirements/editor/drawio-diagram.md](../requirements/editor/drawio-diagram.md)，
> 选型取舍见 [ADR-0017](../adr/0017-drawio-svg-with-embedded-xml.md)。

一句话：**渲染不用改**（draw.io SVG 本来就是标准 SVG），要做的是"认出它"
和"改完写回去"。风险几乎全部集中在最后那步——附件内容此前是不可变的。

## 现状盘点

三条已核实的事实，决定了分期切法：

1. **渲染侧零改动。** markdown 的 `img` 已经由
   [markdown/Image.tsx](../../../web/src/components/MemoContent/markdown/Image.tsx)
   接管（[MemoMarkdownRenderer.tsx:281](../../../web/src/components/MemoContent/MemoMarkdownRenderer.tsx)），
   SVG 走 `<img src>` 加载，文件内容不经过 `rehype-sanitize`，
   `content` 属性不会被洗掉。挂操作条只需在这一个组件里加。
2. **`UpdateAttachment` 改不了内容。** 服务端的字段掩码分支只认
   `filename` / `reader_settings` / `locked`
   （[attachment_service.go:399](../../../server/router/api/v1/attachment_service.go)），
   store 层的 `UpdateAttachment` 结构体也没有 blob 字段
   （[store/attachment.go:59](../../../store/attachment.go)）。
   内容可变是本次唯一的后端新增能力。
3. **上传路径上有一串校验**（MIME 归一、体积上限、媒体 100MB 限、EXIF 剥离），
   在 `CreateAttachment` 里是内联写的。覆盖路径必须复用同一套，
   所以 P2 的第一件事是把它抽出来，而不是照抄一份。

## P0 · 识别与只读操作

只做纯前端，不碰后端，先把"认得出 draw.io 图"这件事落地并可验证。

| 产出 | 说明 |
| --- | --- |
| `web/src/utils/drawio.ts` | `extractDrawioXml(svgText): string \| null`、`isDrawioSvg` |
| 单测 `web/tests/drawio.test.ts` | 真实导出样本 + 普通 SVG 负样本 |
| `markdown/Image.tsx` 挂操作条 | 下载 SVG / 下载 XML |

判定只认一件事：根 `<svg>` 元素上有 `content` 属性，且解转义后以 `<mxfile`
开头。**不做启发式嗅探**（比如"含 mxCell 字样"）——宁可漏判一张图，
不能给普通 SVG 挂上会写坏文件的编辑按钮。

抠 XML 需要 fetch 一次原文件（`<img>` 那次请求会命中 http 缓存）。
探测在图片 `onLoad` 之后异步做，失败静默——操作条不出现即可，
不能让一次探测失败影响图片显示。

**验证**：随便找一张 Claude 生成的 SVG 与一张 draw.io 导出图放同一篇文档，
前者无操作条、后者两个下载都能拿到正确文件。

## P1 · 编辑器接入（改完只下载，不回写）

把 embed 往返打通，但**先不接覆盖 API**，保存动作降级成"下载新 SVG"。
这样 embed 协议的联调可以独立于后端改动完成，出问题时不会写坏任何附件。

| 产出 | 说明 |
| --- | --- |
| `web/src/components/DrawioEditorDialog.tsx` | 全屏 iframe + postMessage 收发 |
| origin 常量 | 单独一处，便于将来切自托管 |

协议序列（`?embed=1&proto=json`）：

```
iframe → init
        ← {action: "load", xml, autosave: 0}
iframe → save            （用户点保存）
        ← {action: "export", format: "xmlsvg"}
iframe → export          （data: "data:image/svg+xml;base64,…"）
        ← {action: "exit"}
```

`format: "xmlsvg"` 是关键——它导出的就是带内嵌 XML 的 SVG，
新文件天然满足 P0 的判定，往返可以无限次而不退化。

必须校验 `MessageEvent.origin`，只接受配置的 draw.io origin；
其他来源的消息直接丢弃。iframe 加 `sandbox`，只放 `allow-scripts allow-same-origin`。

**验证**：打开→改一个字→保存→拿到的文件重新上传，图正确、编辑入口仍在。

## P2 · 附件内容可覆盖

后端唯一一块改动，风险最高，所以放最后、单独一期。

| 产出 | 说明 |
| --- | --- |
| 校验逻辑抽取 | 把 `CreateAttachment` 里的 MIME/体积/EXIF 段落抽成可复用函数 |
| `UpdateAttachment` 支持 `content` 掩码 | 走同一套校验 + 写 blob + 更新 `size` |
| store 层 `UpdateAttachment` 增加 blob 字段 | 含 S3 与本地两种后端的覆盖路径 |
| 测试 | 覆盖后 size 正确、非创建者被拒、locked 附件被拒、超限被拒 |

四条约束，逐条都要有测试兜住：

- **MIME 不可变。** 覆盖时新内容的类型必须与原附件一致，
  不允许把一张 SVG 覆盖成可执行文件——那等于绕过上传校验换了个文件类型。
- **权限沿用既有判定**（仅创建者或管理员），不新开口子。
- **locked 附件拒绝覆盖。** 私密附件根本不出现编辑入口，
  服务端仍要拒，前端不是安全边界。
- **S3 后端要覆盖同一个 key**，不能写新 key 留下孤儿对象。

`updated_ts` 随之更新，前端拿到响应后给 `<img src>` 追加一个 cache-busting
参数，否则浏览器会拿着旧图不放。

**验证**：`go test ./server/router/api/v1/... -run Attachment`；
本地与 S3 两种存储各跑一次真实覆盖。

## 明确不做

- 多页图的页签 UI（数据往返不丢，但不给界面）。
- 图的版本历史。覆盖即覆盖。
- 自托管 drawio webapp。留了 origin 常量，将来换成本地路径即可。
- 从 mermaid 块一键转 draw.io。那条路要走 jgraph 的服务端转换，
  等有人真的提出来再说。
