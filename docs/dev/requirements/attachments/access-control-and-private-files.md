# 附件访问控制与私密附件

三件事：**A. 附件可见性等同所属文档**（已实现）、**B. 私密附件**（口令闸门，已实现）、
**C. 公开附件**（单个文件的匿名直链，已实现，含撤回清单页）。三者的判定都挂在 A 收敛出的同一个函数上，
所以顺序是先 A 后 B 再 C。

A 是收紧、B 是更紧、C 是**唯一一个放宽**的方向——正因为如此，C 的判定位置（在归档检查
之后、可见性检查之前）比它的功能本身更值得先读一遍。

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

## B. 私密附件（已实现）

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

`AttachmentPayload` 加一个附件级字段（最初是 `bool locked`，C 部分改成三态枚举
`access`），不引入"附件区私密"这个独立状态位（会造成"区是
私密但某个文件不是"的矛盾态）。"设为私密"是纯元数据更新——不搬文件、不重新上传、不改 URL、
正文引用不用动。

### 当前实现（P2–P5 已实现）

解锁一次的完整链路，端到端：

1. 浏览器本地用主口令解出主密钥 MK（[secret-session.ts](../../../../web/src/utils/secret-session.ts)，
   与加密块共用同一把、同一套闲置计时）。**口令和 MK 都不出浏览器。**
2. 客户端算 `proof = HMAC-SHA256(MK, "toucan-attach/unlock/v1")`
   （`computeVaultUnlockProof`），POST `attachments:unlockVault`。
3. 服务端把 proof 与 `user_setting` 里预存的 `unlock_verifier` 做**常数时间**比对
   （[vault_service.go](../../../../server/router/api/v1/vault_service.go)）。失败按用户计数
   限速 5 次/分钟并落库；凭证种类必须是浏览器会话，PAT/MCP 即便 proof 正确也拒（ADR-0003）。
4. 成功后签发一枚 JWT（`aud=user.vault-token`、`sub=userID`）写进 httpOnly + SameSite=Lax
   （HTTPS 下加 Secure）的 cookie `memos_vault`。
5. 下载走普通的 `/file/attachments/{uid}/{filename}`，浏览器自动带 cookie；
   `CheckReadAccess` 的第一分支判 `locked`，要求 `creator_id == 当前用户` **且**
   `VaultUnlocked(cookie, kind == Session)`。
6. `LockVault` 清 cookie；前端 [vault-session.ts](../../../../web/src/utils/vault-session.ts)
   不自带计时器，跟随加密块的 `secretSessionStore` 一起失效（决策见该文件顶部注释）。

**这枚 token 不是一次性的，也拿不到手上。**它是 httpOnly cookie，JS 读不到、拼不进 URL、
复制不到别的设备、`curl` 也取不出来；只能靠同源请求自动携带。这正是决策 2 选 cookie 的
目的（内联 `<img>`、video 的 range 请求都不用改代码）。代价是解锁态是**浏览器级、全量的**：
窗口期内该浏览器上创建者所有 locked 附件都开着，不是按文件授权。

与设计稿的两处偏离，都是有意的，记录在此以免被当成 bug 改回去：

- **TTL 由 30 分钟收紧到 3 分钟**（[token.go](../../../../server/auth/token.go) 的
  `VaultTokenDuration`）。理由：被顺走的 vault cookie 重放时不需要口令，窗口期就是真实暴露面。
- **没有实现滑动续期。**决策 2 写的是"滑动续期"，实现里只有签发没有 renew。

### 已知缺口（未修，按优先级）

1. **locked 附件的缓存头没有收紧。**"服务端改动要点"第 2 条要求 `Cache-Control: no-store, private`，
   实现里 [fileserver.go](../../../../server/router/fileserver/fileserver.go) 对所有附件一律发
   `public, max-age=3600`（图片是 `public, no-cache`）。`public` 的语义是允许共享缓存存储——
   前面挂 CDN/反代时，一个 locked 或 PRIVATE 文档的**非图片**附件字节可能被边缘缓存住，之后
   不带 vault cookie 也能取到。C 部分顺带修了这条（见"C 的实现要点"第 5 点）。
2. **3 分钟窗口内没有续期，流式播放会中途断。**`serveMediaStream` 的每个 range 请求都重新过闸，
   所以一个 locked 的长视频播到第 3 分钟会突然 403，大文件断点续传同理。已建立的单个 HTTP
   下载连接不受影响。要修就补 renew，不是把 TTL 调回 30 分钟。

### 决策与实现的对照

| 设计决策 | 落点 |
| --- | --- |
| 决策 1 复用账号主口令 | `SecretKeyUserSetting.unlock_verifier`（与同 message 里语义完全不同的 `verifier` 严格区分） |
| 决策 2 短时 cookie | `auth.VaultCookieName` / `GenerateVaultToken` / `auth.VaultUnlocked` |
| 决策 3 附件级属性 | `AttachmentPayload.access`（原 `locked` bool，C 部分改成三态枚举） |
| 凭证种类透出 | `auth.CredentialKind`，`AuthenticateToUser` 一并返回 |
| R8 存量用户不得"锁得上解不开" | `canLockAttachment`，`UpdateAttachment` 置 LOCKED 前校验 |
| 就地引导 | [LockedAttachmentRow.tsx](../../../../web/src/components/MemoMetadata/Attachment/LockedAttachmentRow.tsx) |

## C. 公开附件（已实现）

### 要解决的问题

文档和知识库本身不打算公开，但其中某个文件——绝大多数情况是一张图——希望能被不登录的人
直接看到：贴到外部博客、丢进聊天窗口、放进邮件。今天做不到，因为附件严格继承文档可见性，
唯一的对外手段是 share token，而那是**整篇文档**的粒度，用错了就是把不该给的一起给了。

C 是这套体系里唯一一个放宽方向的规则，所以它的边界写得比功能本身更细。

### 决策 5：三态枚举，不是第二个 bool

`locked` 再加一个 `public` 就会有 `locked && public` 这种矛盾态，读侧判定顺序稍微写错就是
直接泄露。改成一个字段：

```
AttachmentAccess: ACCESS_INHERIT(0，默认，继承文档) | ACCESS_LOCKED(1) | ACCESS_PUBLIC(2)
```

矛盾态在类型层面就不可表示，而不是靠 review 盯着两个 bool。API 上 `Attachment.locked`
保留为**只读镜像**（`locked == (access == LOCKED)`）不破坏既有调用方；写侧只认新的
`access` field mask，`locked` mask 仍接受并映射到 `access`。

存量数据由 [15__attachment_access.sql](../../../../store/migration/sqlite/0.30/15__attachment_access.sql)
把 `payload.locked = true` 就地转成 `payload.access = "ACCESS_LOCKED"`；读侧另有一条
LEGACY-COMPAT 兜底（`access` 缺省而 `locked` 为真时按 LOCKED 处理），挡的是任何绕过迁移
写进库的行。写侧同时维护 `locked` 镜像，保留回滚到旧二进制的余地。

### 决策 6：公开只绕过"可见性 + 知识库成员"，不绕过实例级对外开关

`Profile.AllowAnonymous()` 的定义就是"配没配 InstanceURL"。没配的实例本来也给不出一个能贴
到外面的绝对 URL，所以规则定成：

> ACCESS_PUBLIC 放行的前提仍然包含 `AllowAnonymous`。

好处是**这个功能没有新增任何"打穿私有实例"的口子**——实例是否对外仍由 InstanceURL 一处
决定。UI 上没配 InstanceURL 时"设为公开"不可用，并提示先配置实例地址。

### 决策 7：公开不覆盖回收站

文档进回收站 → 它的公开附件同样 404。理由是删除必须是可靠的撤回手段：如果 public 能压过
归档，"把文档删了"就不再等于"停止对外分发"。代价是外链会断，这个要在 UI 上明说，
而不是反过来让用户以为删干净了其实还在发。

判定顺序上这意味着 **public 分支排在归档检查之后**，不能图省事提到最前面和 locked 并排。

### 决策 8：只公开字节，不公开"它挂在哪"

`GetAttachment` 元数据路径与 `/file/` 二进制路径共用同一个 `CheckReadAccess`。如果在里面
直接加一条"PUBLIC 即放行"，匿名请求就顺带能读到 `filename`、`size`，以及 `memo` 字段里的
**文档 uid**——那是一篇私有文档的 ID。

所以 public 分支由 `Request.AllowPublicAttachment` 显式开关，**只有 fileserver 传 true**；
元数据路径对匿名/非成员照旧拒绝。这是本部分最容易埋坑的一处。

### 决策 9：只有创建者能设为公开

普通附件的写侧允许 `creator || isSuperUser`，但"设为公开"是把文件推到公网，管理员替别人
做这个决定属于越权（读侧早已不给管理员任何特权）。`access` 置 PUBLIC 时**只认创建者**，
与 LOCKED 对称。

### C 的实现要点

1. `CheckReadAccess` 的分支顺序固定为：LOCKED（vault）→ 未挂文档 → 取文档/父文档 →
   归档 → **PUBLIC** → share token → 可见性。
2. 未挂文档的 PUBLIC 附件直接放行（没有文档可继承，也就没有归档可言）。
3. PUBLIC 放行不做用户查询——匿名访客加载公开图片零成本，这是这条分支要早退的实际原因。
4. 缩略图 / motion 派生物天然走同一判定，无需另写。
5. 缓存头按三态分开（顺带修掉 B 的已知缺口 1）：PUBLIC → `public, max-age=3600` /
   图片 `public, no-cache`；INHERIT → 同样的值但改 `private`；LOCKED → `no-store, private`。
6. 旁路表（RSS / memogit / PAT）不需要额外封堵：C 只放宽不收紧。memogit 推送会把 payload
   一并带走，`access` 状态随之流转，可接受。

### 不构成风险的几点

- **URL 可猜测性**：uid 是 shortuuid（约 128 bit），公开链接本质就是能力型 URL。
  `CreateAttachment` 允许客户端自选 `attachment_id`，但那是上传者自己的选择。
- **文件名部分**：`/file/attachments/{uid}/{filename}` 只用 uid 查库，filename 段不参与，
  改成任意值都能取到——这在 public 之前就是如此，不是新增面。

### 已落地的代码位置

| 环节 | 位置 |
| --- | --- |
| 三态字段 | `AttachmentPayload.access`（[proto/store/attachment.proto](../../../../proto/store/attachment.proto)）、`Attachment.access`（API，`locked` 降为只读镜像） |
| 存量数据迁移 | [15__attachment_access.sql](../../../../store/migration/sqlite/0.30/15__attachment_access.sql) |
| 读侧判定 | `attachmentacl.EffectiveAccess` + `CheckReadAccess` 的 public 分支 |
| 二进制路径开关 | `fileserver.checkAttachmentPermission` 传 `AllowPublicAttachment: true` |
| 写侧授权 | `authorizeAttachmentAccessUpdate`（owner-only + InstanceURL + R8） |
| 缓存 scope | `resolveCacheScope` / `cacheScope.cacheControl` |
| 前端写入 | [useAttachmentAccess.ts](../../../../web/src/hooks/useAttachmentAccess.ts) |
| 前端菜单与角标 | [AttachmentListView.tsx](../../../../web/src/components/MemoMetadata/Attachment/AttachmentListView.tsx)（图片图块上的悬浮 ⋮ 菜单、`PublicBadge`） |
| 按 access 过滤 | `NewAttachmentSchema` 的 `access` 字段（[internal/filter/schema.go](../../../../internal/filter/schema.go)） |
| 清单页 | [PublicAttachmentsSection.tsx](../../../../web/src/components/Settings/PublicAttachmentsSection.tsx)（设置 → 公开直链） |
| 测试 | [attachment_public_test.go](../../../../server/router/fileserver/attachment_public_test.go)、[attachment_access_update_test.go](../../../../server/router/api/v1/attachment_access_update_test.go) |

`EffectiveAccess` 的冲突解法是**遗留 bool 优先**：`locked = true` 与 `access = ACCESS_PUBLIC`
同时出现时判为 LOCKED。写侧每次都会把 bool 与枚举拉齐，所以出现冲突就说明这行不是写侧写的，
那不是把文件公开出去的时机。

缓存 scope 的判据不是"附件是不是 PUBLIC"，而是**这次判定有没有用到访客身份**
（`CheckReadAccess` 有没有调用 `CurrentUser`）。这条更准：PUBLIC 文档的图片对匿名访客仍然
可以进 CDN，share token 通路也自然归位，而任何靠身份放行的响应一律降为 `private`。

### 撤回路径（已实现）

**"我公开的附件"清单页。**设置里新增一个基础分区"公开直链"
（[PublicAttachmentsSection.tsx](../../../../web/src/components/Settings/PublicAttachmentsSection.tsx)），
列出当前账号所有 `ACCESS_PUBLIC` 的附件，每项可复制链接、跳回所在文档、一键取消公开。
没有这个页面的话该功能是**只写的**：公开的入口是某篇文档里的一个 ⋮ 菜单，半年后想知道
自己往公网放过什么，只能一篇篇文档翻。

服务端侧靠 `ListAttachments` 的 CEL filter 新增的 `access` 字段实现：

```
access == "ACCESS_PUBLIC"
```

它在 [schema.go](../../../../internal/filter/schema.go) 的 `NewAttachmentSchema` 里，是一个
`Expression: "JSON_EXTRACT(%s, '$.access')"` 的 scalar 字段，比对的是 **protojson 的枚举名**
而不是数字。只放开 `==` / `!=`：枚举名之间比大小是按字母序，没有意义。

有一处要留意：`access` 字段出现之前写入的行根本没有这个 key，`JSON_EXTRACT` 返回 NULL，
所以 `access == "ACCESS_INHERIT"` **匹配不到存量行**。对唯一的调用方无所谓（存量行不可能是
public），但将来要做"列出所有继承文档可见性的附件"，得先在这里补 COALESCE。

这条路径整个挂在那个 JSON path 字符串上，而写错它是**静默失败**——清单空着，和"你没有公开过
任何东西"长得一模一样。所以两侧都钉了测试：
[engine_test.go](../../../../internal/filter/engine_test.go) 断言渲染出的 SQL，
`attachment_access_update_test.go` 的 `TestListAttachments_FilterByPublicAccess` 走真实
SQLite 跑一遍"设为公开 → 出现在清单 → 取消 → 从清单消失"。

**删除文档时的提示。**文档还挂着公开附件时，删除确认框会追加一句说明这些外链会失效
（[MemoActionMenu.tsx](../../../../web/src/components/MemoActionMenu/MemoActionMenu.tsx)）。
删除依然照做——决策 7 就是要让删除成为可靠的撤回手段——只是不该让人意外。

### 尚未实现（本轮明确不做）

撤回路径补齐之后，下面三条都不再阻塞上线，本轮**有意跳过**。记在这里是为了将来接手时
不用重新推导落点。

1. **实例级 kill switch**：管理员一键停掉全实例的公开附件。当前的替代品只有 InstanceURL
   这个总开关，但那会连带停掉整个对外访问，粒度太粗。

   真要做的话，落点不在 `attachmentacl` 内部：public 分支的全部价值就是**不查任何东西**
   就早退（决策 5 之后的实现要点第 3 点），在里面读一次实例设置等于把这条早退路径废掉。
   应该照 `AllowAnonymous` 的样子多加一个 `Request` 字段，由 fileserver 在入口处带进来，
   实例设置的读取和缓存留在调用方。

2. **审计**：谁在什么时候把哪个附件设成了公开，目前没有记录。

   写侧已经收敛成一个函数 `authorizeAttachmentAccessUpdate`（owner-only + InstanceURL + R8），
   所以审计记录有且只有一处可挂，不存在"漏了一条写路径"的风险。难点不在埋点而在存哪：
   现在没有通用的审计表。

3. **盗链与流量**：不做 Referer 限制或速率限制，已知会被外站直接引用。这条是**决定不做**，
   不是排期，跟上面两条性质不同。

### 前端待手工验证的点

后端矩阵有测试覆盖，下面这些是纯视觉/交互，需要人肉过一遍：

1. 图片图块右上角的 ⋮ 菜单：鼠标移上去才出现，点它**不能**顺带打开灯箱预览。
2. "设为公开直链"成功后会自动把绝对链接复制到剪贴板；退出登录或换个浏览器打开该链接应能直接看到图。
3. 公开后图块左上角出现"公开直链"角标。
4. 实例未配置 InstanceURL 时，菜单里不出现公开相关条目。
5. 动态照片（motion photo）这类一个图块对应两个文件的项**没有** ⋮ 菜单，只能从下方附件列表操作。
6. 已公开的附件菜单里不再提供"设为私密"，避免两个状态互相打架。
7. 设置 → 公开直链：列表只出现自己公开过的文件；"取消公开"确认后该行立即消失（缓存失效
   靠 `useSetAttachmentAccess` 里对 `attachmentKeys.lists()` 的 invalidate，漏了的话会留着
   一行已经取消了的记录）。
8. 删除一篇挂着公开附件的文档，确认框里应多出一句外链会失效的提示；不挂公开附件的文档
   不应出现这句。

### 与 share token 的关系

两套粒度不同的对外机制并存：share token 是**整篇文档**对外，公开附件是**单个文件**对外。
UI 措辞必须能让人一眼分清，否则会出现"我只想公开一张图，结果分享了整篇文档"。命名上避开
"公开"二字与文档 `PUBLIC` 可见性撞车，中文统一用"公开直链"。
