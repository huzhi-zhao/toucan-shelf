# 附件上传与媒体内联

## 上传时的分流：媒体进正文，其他进附件区

编辑器判定被上传/粘贴的文件是否为"广泛认可的多媒体文件"（图片/视频/音频，按 mime type，见
[splitMediaFiles](../../../../web/src/components/MemoEditor/services/mediaInsertService.ts)）：

- 媒体文件：上传成功后不放进附件区，而是生成 `![alt](url)` 引用插入光标处
  （[buildMediaMarkdown](../../../../web/src/components/MemoEditor/services/mediaInsertService.ts)）。
- 非媒体文件（文本类、其他不被识别的格式）：放进文档下方的附件区。
- 底部工具栏"+"按钮的 Media 选项支持图片及主流音频/视频格式，不止图片。
- 从剪贴板粘贴受支持的媒体文件会走与拖拽/选择同样的判定（直接内联插入 `![]()` 引用）；
  通过"+ → Media"显式选择插入的，走同一套判定，不因入口不同而改变落点。不被识别为媒体的
  文件无论哪种方式插入都直接挂附件区，不询问。

TODO(确认)：定义文档里写的"限制媒体文件不超过 10M"，未在当前 `uploadService.ts` /
`mediaInsertService.ts` 中找到对应的大小校验常量，需确认该限制是在别处实现、已被后续调整，
还是尚未落地。

## 正文内联渲染：图片/视频/音频统一走 `![]()` 语法

这是相对最初调研结论的一处**关键演进**：最初排查（见本篇历史版本）认为 markdown 正文只有
`Image` 一个自定义渲染节点，音视频只能作为附件区的独立播放器展示，正文内嵌 `![video](...)`
不会变成播放器。当前实现已经不是这样——

[Image.tsx](../../../../web/src/components/MemoContent/markdown/Image.tsx) 统一接管所有
`![]()` 引用：编辑器插入媒体时图片/视频/音频都用同一套 `![alt](url)` 语法
（[buildMediaMarkdown](../../../../web/src/components/MemoEditor/services/mediaInsertService.ts)
的注释明确记录了这个决定），渲染时按 URL 的文件扩展名（
[getMediaKindFromUrl](../../../../web/src/utils/attachment.ts)）分流成 `<img>` / `<video controls>`
/ `<audio controls>`，而不是新增独立的 remark 语法节点。

这意味着：

- Explore 列表、doc 详情页等所有复用 `MemoContent` 渲染管线的场景，天然获得音视频内联播放
  能力，不需要逐处适配。
- 附件区（[AttachmentListView.tsx](../../../../web/src/components/MemoMetadata/Attachment/AttachmentListView.tsx)）
  仍然是独立的播放器实现（[VideoPoster.tsx](../../../../web/src/components/VideoPoster.tsx)、
  [AudioAttachmentItem.tsx](../../../../web/src/components/MemoMetadata/Attachment/AudioAttachmentItem.tsx)）——
  两套播放 UI 并存，一套服务"正文内联"场景，一套服务"附件区列表"场景，是同一份底层附件数据
  的两种呈现，不是重复实现。

TODO(确认)：`rehype-sanitize` 的 `SANITIZE_SCHEMA`（[constants.ts](../../../../web/src/components/MemoContent/constants.ts)）
是否已经放行 `<video>`/`<audio>` 标签本身——`Image.tsx` 渲染的是这两个标签，但它是自定义
组件替换 `img` 节点产出的，不是原始 HTML 经过 sanitize 管线；未逐一核对 sanitize 层是否需要
配合放行，下次接触这块代码时应确认。

## S3 附件走服务端代理，不再暴露裸预签名 URL

见 [ADR-0001](../../adr/0001-attachment-proxy-not-presigned-url.md)。上传/预览统一走
`/file/{name}/{filename}` 代理路由（[fileserver.go](../../../../server/router/fileserver/fileserver.go)），
`externalLink` 只保留给用户手动粘贴的 `EXTERNAL` 类型外链，不再用于 S3 附件——完整实现记录见
[design/20260704-s3-proxy-and-backup.md](../../design/20260704-s3-proxy-and-backup.md) §1。

## S3 附件按 workspace 分目录

存储路径模板支持 `{workspace}` 占位符（默认模板
`assets/{workspace}/{timestamp}_{uuid}_{filename}`），使不同知识库的附件在 S3 对象 key 层面
物理隔离——动机不是整洁，是差异化的数据保全策略：不同知识库对附件的价值/备份诉求不同
（网上能重新找到的示意图 vs. 丢了就真没了的手写扫描件），混在同一前缀下就无法对后者单独配置
更严的备份/版本策略。

- `{workspace}` 只对 S3 生效；LOCAL 存储下该占位符展开为空并折叠掉多余的路径分隔符。
- 目录名取 workspace 的 display title 清洗（仅保留中英文数字），全部被丢弃时回落为 workspace
  uid；持久化在 `workspace.storage_slug` 字段，惰性生成（`EnsureWorkspaceStorageSlug`，见
  [attachment_service.go](../../../../server/router/api/v1/attachment_service.go)）、一旦生成
  不再变动——目录名变了会让已写入对象的 key 指向不存在的路径。
- 上传时**没有**提供 workspace 落到 `_unassigned/`（不报错）；提供了但查不到/不属于当前用户
  直接报错，不静默兜底。若上传请求带了 `memo`，从该 memo 的 workspace 推导，调用方不必重复传。
- 存量附件（改动前已写入默认前缀的对象）**不做统一搬迁**：读路径按记录里的
  `payload.s3_object.key` 走，新旧混存不影响访问；只搬迁指定的重要 workspace，脚本先以
  只读模式产出待搬迁清单供人工核对。TODO(确认)：该搬迁脚本是否已经跑过/是否仍待执行，
  未在代码库中找到对应脚本，需向用户确认当前状态。

## PDF 上传与预览（不在本文档范围）

上传 `.pdf` 生成一篇不可编辑、只能预览的文档，复用附件上传链路但落地成一条 doc 记录，涉及
Explore 列表卡片、文档详情页的渲染型文档类型问题——这部分与
[render-only-doc-types](../views/render-only-doc-types.md)（`views/` 域）重叠，按迁移计划
应拆到该篇文档而不是本篇。本会话未接触 `views/` 域，留给负责该域的会话核实/续写。
