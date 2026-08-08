# ADR-0001：附件走服务端代理，不用 S3 预签名直连

## 状态

已采纳，已实现。

## 背景

早期实现里，S3 附件上传后立刻生成一个 5 天有效期的 MinIO 预签名 URL，存进 `Reference`
字段直接下发给浏览器，浏览器直连对象存储，完全绕开 memos/ToucanShelf 域名。

## 决策

S3 附件统一走服务端代理路由 `/file/{name}/{filename}`，不再对外暴露裸预签名 URL。
`externalLink` 只保留给用户手动粘贴的 `EXTERNAL` 类型外链。服务端内部访问 S3 时用长期
持有的 AK/SK 现签/直接读取，不需要"预签名续期"这个概念——原来 12 小时轮询续签预签名 URL
的 `server/runner/s3presign` 后台任务随之整体删除。

## 理由

- **域名/网络隔离**：MinIO endpoint 常常只在内网/容器网络可达，浏览器直连在自建场景下会
  直接挂掉。
- **访问控制统一**：所有鉴权收敛在应用自己的会话/权限体系里；预签名 URL 一旦生成，有效期
  内谁拿到链接都能访问，跟平台权限模型完全脱钩——这也是
  [附件访问控制](../requirements/attachments/access-control-and-private-files.md) 能够成立
  的前提，直连模式下无法在下载时做可见性判定。
- **可缓存、可加 CDN**：走自己的域名意味着可以在前面加缓存层；签名直连 URL 带时效参数
  天然不好缓存。

## 代价

所有下载流量都要经过服务器中转，增加服务端带宽/CPU 负担。已知权衡：10M 附件大小限制 +
非高并发场景，暂不做"大文件走直连、小文件走代理"的折中。

## 影响

- `attachment_service.go` 不再对 S3 附件调用 `PresignGetObject`，`Reference` 只存 S3
  object key。
- `convertAttachmentFromStore` 与 RSS enclosure 不再把 S3 附件的 `Reference` 当外链返回。
- 视频/音频流式播放（`serveMediaStream`）从"重定向到预签名 URL"改为走已有的
  `getAttachmentReader` 代理流式传输。
- 历史遗留的裸预签名 URL `Reference` 做过一次性迁移，改写为纯 object key。
