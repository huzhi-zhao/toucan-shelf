# ADR-0003：解锁态是短时 cookie，不是逐请求带参

## 状态

已决策（设计阶段，功能尚未实现）。见
[access-control-and-private-files.md](../requirements/attachments/access-control-and-private-files.md) B 部分。

## 背景

私密附件解锁后，需要一种方式让后续的文件请求（图片内联、视频流式播放、直接下载）都带上
"已解锁"状态。候选：URL 带 token、JS 手动加 header、cookie。

## 决策

解锁成功后服务端签发一枚 httpOnly + Secure + SameSite=Lax 的 vault cookie（JWT：user_id /
purpose / exp，用实例密钥签名，TTL 30 分钟、滑动续期）。`/file/` 判定私密附件时校验这枚
cookie。上锁 = 清 cookie + 清前端解锁态，与[加密块](0008-secret-block-client-side-crypto.md)
的自动上锁触发条件一致：闲置超时、登出、清 token。

## 理由

Cookie 顺带解掉了"URL 带 token"或"JS 手动加 header"两个方案都做不到的两件事：

- **内联媒体 `![](/file/...)` 能用**：markdown 渲染器直接把 URL 交给浏览器加载，中间没有
  插 JS 的位置——但浏览器会自动带 cookie。
- **视频/音频能流式播放**：`<video src>` 的 range 请求同样自动带 cookie，
  `serveMediaStream` 那条路不用改。

这两条在"端到端加密"式方案里都做不到，需要 Service Worker 拦截才有戏——这是选 cookie 方案
最大的一笔收益，比省下来的加解密代码更值钱。

SameSite 选 Lax 而非 Strict：下载走顶层导航，Strict 在部分跨站跳转回来的场景会丢 cookie；
闸门要防的不是 CSRF，这些请求全是同站的，Lax 已足够。

## 影响

- 上锁必须真的把已展开的私密预览关掉，不能只是按钮变个样子。
- vault cookie 只能在浏览器会话链路上签发；PAT / MCP 令牌的请求即便带上 cookie 也不认——
  判定时要求"当前认证来自 session"，必须写成显式检查，不能靠"PAT 用户不会有 cookie"这种
  间接推理。
- 解锁接口需要按用户限速，避免在线爆破 verifier 的输入空间。
