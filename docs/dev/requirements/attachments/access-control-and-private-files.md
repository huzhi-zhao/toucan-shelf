# 附件访问控制与私密附件

两件事：**A. 附件可见性等同所属文档**（现状是部分实现，有已知缺口）、**B. 私密附件**
（口令闸门，尚未实现，本文档记录设计决策供后续实现参照）。B 的判定要挂在 A 收敛出的
函数上，所以先 A 后 B。

## A. 附件可见性等同所属文档

### 当前实现

两条访问路径都按文档可见性判定：

| 路径 | 判定函数 | 位置 |
| --- | --- | --- |
| 二进制下载 `/file/attachments/:uid/:filename` | `checkAttachmentPermission` | [fileserver.go](../../../../server/router/fileserver/fileserver.go) |
| 元数据 `AttachmentService/GetAttachment` | `checkAttachmentAccess` | [attachment_service.go](../../../../server/router/api/v1/attachment_service.go) |

规则：未挂文档 → 仅创建者/管理员；PUBLIC → 匿名可读（且实例本身允许匿名）；PRIVATE →
仅创建者/管理员。另有 share token 兜底，校验 token 与 memo 一一对应。

历史上确实存在过"谁拿到链接谁能下载"的形态：S3 附件曾把 MinIO 预签名 URL 当
`external_link` 直接下发给浏览器，5 天内脱离权限体系。这条已经改掉（见
[ADR-0001](../../adr/0001-attachment-proxy-not-presigned-url.md)），现在只有 `EXTERNAL`
存储类型（用户自己粘的外链）才下发原始 URL，S3 一律走 `/file/` 代理。

### 已知缺口（读代码确认，截至本文档写成时仍未修复）

1. **归档文档的附件仍可下载。** `checkAttachmentAccess`/`checkAttachmentPermission` 只看
   `memo.Visibility`，不看 `RowStatus`——一篇 PUBLIC 文档删进回收站之后，正文取不到了，
   附件还在。
2. **不继承父文档可见性。** 附件判定不会沿 `ParentUID` 向上取到根文档做校验，可能出现
   "PRIVATE 父文档下挂一篇 PUBLIC 子文档"时，子文档正文因父校验打不开、附件却能下的情况。
3. **两处判定是两份代码。** `fileserver` 与 `api/v1` 各写了一遍等价逻辑，会持续漂移。
4. **缩略图缓存不复判。** `/file/...?thumbnail=true` 的缓存文件落在
   `Data/.thumbnail_cache`，不对外暴露路径，目前不构成漏洞，但它是一份脱离原文件存在的
   派生副本，删除原附件时是否一并清理待确认。

修复方向：把判定合并成一个函数（如 `CheckAttachmentReadAccess`），两处调用，判定顺序里补上
归档检查与父文档链路检查，`fileserver` 用参数区分 `Profile.AllowAnonymous()` 与
`api/v1` 的 Connect context 用户来源差异。子文档**创建**时的可见性也应按父文档取值（当前
只有**更新**时会拉齐，创建时用请求里带的值）。

### 会被波及的旁路（若实现 B 部分私密附件，每一条都要显式处理）

| 旁路 | 位置 |
| --- | --- |
| RSS enclosure | [rss.go](../../../../server/router/rss/rss.go) |
| share token 通路 | fileserver + `memo_share_service.go` |
| memogit 推送附件字节 | [internal/memogit/attachments.go](../../../../internal/memogit/attachments.go) |
| MCP / PAT 令牌 | `server/auth` |
| 缩略图 / motion clip | fileserver |

## B. 私密附件（尚未实现）

### 威胁模型：这是"锁"不是"加密"

**文件在存储端（本地磁盘 / S3 / MinIO）原样保存，不加密，服务端持有明文。** 口令只决定
"能不能通过 ToucanShelf 读到和下载"。

挡得住：同实例其他登录用户（含管理员）、PUBLIC 匿名访客/share token 接收者、被顺走的会话、
无人看管的浏览器、MCP/Agent 令牌。

挡不住：服务端本身、存储桶配置失误、数据库/磁盘备份的持有者。

这是**与 [加密块](../editor/secret-block.md)（服务端全程不持有明文）不同的安全等级**，
UI 措辞必须区分开，不能都叫"加密"——私密附件应统一用"锁定/保险箱"。真需要"服务端也看不到"
的文件，应做成加密块（贴文本）或不上传。

### 决策 1：复用账号主口令，不引入第二把

用加密块已有的账号主口令，不再单设附件口令。服务端要能验口令，但服务端不知道口令也不知道
主密钥 MK——解法是客户端出示 MK 的持有证明，服务端比对预存校验值：

```
verifier = HMAC-SHA256(MK, "toucan-attach/unlock/v1")   ← 存 user_setting，服务端可见
解锁时：客户端本地解包出 MK → 算出同一个 verifier → 发给服务端比对
```

服务端因此永远看不到口令，也拿不到 MK。

### 决策 2：解锁态是一枚短时 cookie，不是每次请求带参数

解锁成功后签发一枚 httpOnly + Secure + SameSite=Lax 的 vault cookie（TTL 30 分钟、滑动
续期）。选 cookie 而不是"URL 带 token"，是因为它顺带解掉了两个边界：内联媒体
`![](/file/...)` 能用（浏览器自动带 cookie，中间没有插 JS 的位置）；视频/音频 range 请求
同样自动带 cookie，流式播放不用改。三种情况自动上锁：闲置超时、登出、清 token，且上锁必须
真的关闭已展开的私密预览。

### 决策 3：私密是附件级属性，"整区私密"只是批量操作

`AttachmentPayload` 加 `bool locked` 字段，不引入"附件区私密"这个独立状态位（会造成"区是
私密但某个文件不是"的矛盾态）。"设为私密"是纯元数据更新——不搬文件、不重新上传、不改 URL、
正文引用不用动。

### 服务端改动要点（未实现，供后续参照）

1. 判定第一步：`payload.locked` 为真时要求 `creator_id == 当前用户` 且携带有效 vault
   cookie；share token / 匿名 / PUBLIC 全部不适用，**管理员也拒绝**。
2. 缩略图/motion 派生物走同一判定；响应头加 `Cache-Control: no-store, private`。
3. RSS/memogit/PAT 旁路封堵（同 A 部分的旁路表）；vault cookie 只在浏览器会话链路签发，
   PAT/MCP 令牌即便带上 cookie 也不认，要写成显式检查。
4. 解锁接口按用户限速（如 5 次/分钟），失败计数落库；verifier 比对用常数时间比较。

新接口草案：`AttachmentService/UnlockVault(proof)`、`LockVault()`；`UserService` 一处存取
verifier。

### 待拍板的问题（原方案未定案，供实现前再确认）

1. 管理员是否一律拒绝私密附件的平台接口访问（倾向：拒绝）。
2. 锁定态是否遮挡文件名（倾向：遮挡，明确标注为显示层遮挡而非安全边界）。
3. 解锁 TTL 默认值（倾向：30 分钟滑动续期，与加密块闲置上锁对齐）。
4. 首次启用的引导形式：独立"安全设置"页 vs. 首次点"设为私密"时就地引导（倾向：就地引导）。
5. A 部分的缺口修复是否作为独立安全修复先行发布，不等 B 部分一起上。

TODO(确认)：本文档 B 部分整体是尚未实现的设计决策记录，不是现状描述——`proto` 里未找到
`locked` 字段、`server/router/api/v1` 未找到 `UnlockVault`/`LockVault`。下次有会话着手实现
私密附件时，应先确认这些决策是否仍然成立（尤其"待拍板"部分），而不是直接照单实现。
