# 渲染型文档类型（HTML / PDF / VIEW）

除普通 markdown 外，文档树里还有三种"仅渲染/结构化数据"的文档类型，与
`MARKDOWN` 并列，共用同一套按 doc type 分发渲染器的机制。

## 1. doc type 与分发机制

`Memo.DocType`（`proto/api/v1/memo_service.proto`）：

```protobuf
enum DocType {
  DOC_TYPE_UNSPECIFIED = 0;
  MARKDOWN = 1;
  HTML = 2;
  PDF = 3;
  VIEW = 4;   // 结构化"视图"文档，见 gallery-view.md
}
```

store 层用同名字符串表示（`store/memo.go` 的 `Memo.DocType string`），
`server/router/api/v1/memo_service_converter.go` 的
`convertDocTypeFromStore`/`convertDocTypeToStore` 做双向转换；新建/更新时
按 doc type 应用不同的正文长度限制（`getContentLengthLimit`）。

前端分发点在 `web/src/components/Notebook/DocumentView.tsx`：按
`memo.docType` 分派到对应渲染/编辑组件——`HTML` 走 sandboxed iframe/纯文本
编辑器（§2），`PDF` 走 `PdfDocumentView`（§3），`VIEW` 走
`GalleryViewRenderer`/`GalleryViewForm`（见
[gallery-view.md](gallery-view.md)），其余（`MARKDOWN`/未指定）走既有的
`MemoContent`/`MemoEditor`。文档树节点图标（`FileTreeNode.tsx`）按同一字段
区分类型。三种特殊类型都复用"按 doc type 分发渲染器"这一套机制，不新增
平行的类型判断体系。

## 2. HTML 文档

- **预览**：sandboxed `<iframe sandbox="allow-scripts allow-popups
  allow-forms" srcDoc={content}>`，撑满剩余 main content 空间。不带
  `allow-same-origin`，脚本运行在空 origin 的沙箱上下文里，拿不到应用自身
  的 cookie/localStorage。
- **编辑**：只提供纯文本源码编辑器（`<Textarea>`），不做语法高亮，不提供
  任何 HTML 结构化编辑支持——人工编辑场景很少，给源码即可。
- **不支持**：评论、outline 面板、"文档设置"里的 outline/软换行选项——这些
  只对 markdown 文档生效。
- 新建 HTML 文档时预填一份 `<!doctype html>` 骨架内容；按 `.html`/`.htm`
  扩展名上传的文件自动识别为 HTML doc type。

## 3. PDF 文档

- **上传/创建**：读取文件为二进制，先建一条 `Attachment`
  （`origin: MOUNTED`），再建一个 `docType: PDF`、`content: ""` 的 memo 并
  关联该附件；生成的文档挂在目标文件夹下（首页搜索框旁 +号 或文件夹
  三点菜单里的 upload file 入口）。**该文档没有实际文本内容**，正文以
  外的关键信息（文件大小等）走附件记录，不重复存进 memo。
- **归属**：是文档树里的普通节点，与 markdown/html/view 文档同层，不是
  独立的附件区块。
- **渲染**：`PdfDocumentView`（`web/src/components/PdfViewer/`），基于
  `pdfjs-dist` 自行渲染成 canvas（而非依赖浏览器内嵌 PDF 插件），支持
  分页/缩放、文本层与批注层（`PdfAnnotationSidebar`/
  `usePdfAnnotations`）。PDF 文档跳过 Preview/Edit 切换（不可编辑，只能
  预览），批注锚定用 `pdf_annotation` 字段而不是普通文档评论
  （`supportsComments = !isPdf && !isHtml`）。
- **Explore/详情页**：PDF 文档**不从 Explore feed 中排除**（只有 VIEW
  被排除，见 §3.1），会正常出现在 feed、doc 详情页（copy link 指向的
  页面）里，用同一套 `PdfDocumentView` 渲染。

### 3.1 Explore feed 排除

哪些 doc type 该出现在 Explore feed 里，统一维护在**一处**——
`web/src/hooks/useMemoFilters.ts` 的 `FEED_EXCLUDED_DOC_TYPES`
（当前值 `["VIEW"]`）。`excludeNonFeedDocTypes: true` 时，为每个排除类型
追加一条 `doc_type != "VIEW"` 的 CEL 过滤条件，应用在 `Explore` 页。
`HTML`、`PDF` 不在排除列表里，会正常出现在 feed 中；只有 `VIEW`
被排除——它是组织节点，不是可浏览的内容型笔记。新增排除规则只应改这一处，
不建两套并行的判断代码。

## 4. VIEW 文档

结构化配置型文档，独立成篇，见 [gallery-view.md](gallery-view.md)。

## 5. 与本文档相关但不在本域的内容

以下内容与渲染型文档类型有交叉，但按业务域划分不属于 `views/`：

- **PDF/媒体文件的上传链路、S3 存储代理、访问控制**（原
  `docs/plans/2026-07-04-media_pdf/definition.md` 的附件管理与 S3 部分）
  属于 `attachments/` 域，请在负责该域的会话中处理，本次未改动。
- **HTML 内联到 markdown 正文中的富媒体渲染（图片/音视频附件展示）**
  同样属于 `attachments/` 域。
