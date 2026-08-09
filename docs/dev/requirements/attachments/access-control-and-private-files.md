# 附件访问控制与私密附件

两件事：**A. 附件可见性等同所属文档**（已实现）、**B. 私密附件**
（口令闸门，尚未实现，本文档记录设计决策供后续实现参照）。B 的判定要挂在 A 收敛出的
函数上，所以先 A 后 B。

## A. 附件可见性等同所属文档（已实现）

### 当前实现（P0–P1 已实现）

两条访问路径共用**同一个**判定函数
[`attachmentacl.CheckReadAccess`](../../../../server/attachmentacl/attachmentacl.go)：

| 路径 | 入口 | 位置 |
| --- | --- | --- |
| 二进制下载 `/file/attachments/:uid/:filename` | `checkAttachmentPermission` | [fileserver.go](../../../../server/router/fileserver/fileserver.go) |
| 元数据 `AttachmentService/GetAttachment` | `checkAttachmentAccess` | [attachment_service.go](../../../../server/router/api/v1/attachment_service.go) |

两个入口只负责提供各自的输入（用户来自 echo 请求还是 Connect context、是否可能带
share token）并把结果翻译成 HTTP 状态码 / gRPC code，判定本身没有第二份实现。

判定顺序：

1. 未挂文档 → 仅创建者（**管理员无特权**）。
2. 取所属文档；若它是评论，再取被评论的父文档，两者都要过闸（评论关系只有一层）。
3. 归档（回收站）→ 仅创建者，其余一律 404，**share token 也不行**——分享页对归档文档
   同样按"不存在"处理。
4. share token → 校验 token 与该文档一一对应且未过期，命中即放行。
5. 可见性 → PUBLIC 且实例允许匿名则放行；否则要求登录用户；PRIVATE 仅创建者
   （**管理员无特权**，与正文侧 `checkMemoReadAccess` 对齐）。

完整判定矩阵（可见性 × 归档 × 实例是否公开 × 访客身份 × share token）在
[attachment_access_test.go](../../../../server/router/fileserver/attachment_access_test.go)
里对**两条路径同时**断言，再漂移会挂测试。

历史上确实存在过"谁拿到链接谁能下载"的形态：S3 附件曾把 MinIO 预签名 URL 当
`external_link` 直接下发给浏览器，5 天内脱离权限体系。这条已经改掉（见
[ADR-0001](../../adr/0001-attachment-proxy-not-presigned-url.md)），现在只有 `EXTERNAL`
存储类型（用户自己粘的外链）才下发原始 URL，S3 一律走 `/file/` 代理。

### 原有缺口（P0–P1 已全部修复）

1. ~~**归档文档的附件仍可下载。**~~ 已修：判定第 3 步显式检查 `RowStatus`，归档文档的附件
   对创建者以外一律 404。
2. ~~**不继承父文档可见性。**~~ 已修：判定第 2 步取 `ParentUID` 指向的文档一并过闸。注意
   `ParentUID` 是从 `memo_relation` 里 `type = "COMMENT"` 派生的**评论关系**，不是目录树
   父节点——目录层级是 `folder_path` 字符串，文件夹不承载可见性。链路只有一层，不存在递归。
3. ~~**两处判定是两份代码，且已经漂移。**~~ 已修：合并成 `attachmentacl.CheckReadAccess`
   一个函数。`AllowAnonymous` 闸门现在两条路径都生效——**私有实例上 PUBLIC 文档附件的元数据
   对匿名请求由"可读"变成"被拒"，属于收紧，发布说明要点名**。
4. ~~**管理员在附件上越权于正文。**~~ 已修：两条路径都不再放行 `RoleAdmin` / `isSuperUser`。
   写侧（`UpdateAttachment` / `BatchDeleteAttachments`）的管理员权限不变，只有读被收紧；
   `UpdateAttachment` 因此改成直接从 store 回读，不再经 `GetAttachment` 的读闸。
5. ~~**父文档可见性变更不下沉到评论。**~~ 已修：`UpdateMemo` 改可见性时级联更新其 COMMENT
   子项（**双向对齐**，与 `CreateMemoComment` 的赋值语义一致）；存量数据由启动时一次性
   backfill 拉齐，见
   [commentvisibility runner](../../../../server/runner/commentvisibility/runner.go)，
   改写前会把旧值导出到数据目录下的 `comment_visibility_backfill_<ts>.csv`（不可逆操作，
   见计划里的风险 R3）。

注意缺口 5 修好之后，缺口 2 的判定**仍然必须保留**：它挡的是修复前就已经存在的、以及任何
绕过 `UpdateMemo` 写进库的不一致数据。

缩略图/motion 派生物的清理**不是缺口**：`store.DeleteAttachment` 经 `DeleteAttachmentStorage`
一并删除 `.thumbnail_cache` 与 `.motion_cache` 下的派生文件，有回归测试覆盖。

分阶段计划与各阶段验收判据见
[20260808-attachment-access-control-and-private-files.md](../../design/20260808-attachment-access-control-and-private-files.md)。

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

0. 前置：`Authenticator.AuthenticateToUser` 目前只返回 `*store.User`，丢掉了凭证种类；
   `base.ActorKind` 只区分 MCP 通道，PAT 走 REST 时同样是 Human。"vault cookie 只认浏览器
   会话链路"这条显式检查当前**没有地方可写**，须先把凭证种类透出来。
1. 判定第一步：`payload.locked` 为真时要求 `creator_id == 当前用户` 且携带有效 vault
   cookie；share token / 匿名 / PUBLIC 全部不适用，**管理员也拒绝**。
2. 缩略图/motion 派生物走同一判定；响应头加 `Cache-Control: no-store, private`。
3. RSS/memogit/PAT 旁路封堵（同 A 部分的旁路表）；vault cookie 只在浏览器会话链路签发，
   PAT/MCP 令牌即便带上 cookie 也不认，要写成显式检查。
4. 解锁接口按用户限速（如 5 次/分钟），失败计数落库；verifier 比对用常数时间比较。

新接口草案：`AttachmentService/UnlockVault(proof)`、`LockVault()`；verifier 存
`SecretKeyUserSetting`，字段名必须是 `unlock_verifier`——该 message 里**已经有一个叫
`verifier` 的字段**，语义是客户端用来区分"口令错"与"信封损坏"的参数头 HMAC，与本处
服务端比对的 `HMAC(MK, "toucan-attach/unlock/v1")` 完全不同，同名必然被搞混。
已设过主口令的存量用户没有 `unlock_verifier`，需要客户端下次解出 MK 时补写，
且在补写完成前禁止加锁，否则老用户会进入"锁得上、解不开"的死角。

### 已定案的问题

原"待拍板"五问已在
[20260808 计划](../../design/20260808-attachment-access-control-and-private-files.md)
中定案：管理员一律拒绝（并顺带取消普通附件上的管理员特权）；遮挡文件名，标注为显示层；
TTL 30 分钟滑动续期，且与加密块共用同一套闲置计时；就地引导；A 部分作为独立安全修复先行发布。

B 部分整体仍是尚未实现的设计决策记录，不是现状描述。
