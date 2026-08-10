# 附件访问控制收敛与私密附件的分阶段实施计划

对应需求：[access-control-and-private-files.md](../requirements/attachments/access-control-and-private-files.md)。
相关决策：[ADR-0001](../adr/0001-attachment-proxy-not-presigned-url.md)、
[ADR-0002](../adr/0002-private-attachments-reuse-master-passphrase.md)、
[ADR-0003](../adr/0003-private-attachment-unlock-via-cookie.md)。

本文写于实施开始之前，目的有三个：把需求文档里"读代码得出"的结论重新对着代码核一遍
（其中两条不成立）、把待拍板问题定案、把风险切成可以分别发布和分别回滚的阶段。

---

## 一、核查结论：需求文档的断言 vs. 代码事实

### A 部分

| 需求文档的断言 | 核查结果 | 依据 |
|---|---|---|
| 两条访问路径都按文档可见性判定 | 成立 | `checkAttachmentPermission`、`checkAttachmentAccess` |
| 缺口 1：归档文档的附件仍可下载 | **成立** | 两处都用不带 `RowStatus` 过滤的 `FindMemo` 取 memo；对照正文侧的 `checkMemoReadAccess` 明确处理了 `Archived` |
| 缺口 2：不继承父文档可见性 | **成立，但语义需要更正**（见下） | — |
| 缺口 3：两处判定是两份代码，"会持续漂移" | **成立，且已经漂移了** | `fileserver` 有 `AllowAnonymous()` 闸门与 `share_token` 兜底，`api/v1` 两者都没有 |
| 缺口 4：缩略图缓存删除时是否清理"待确认" | **不成立，已经清理** | `store.DeleteAttachment` → `DeleteAttachmentStorage` 一并删 `.thumbnail_cache/{uid}.jpeg` 与 `.motion_cache/{uid}.mp4`，且有回归测试覆盖 |
| 修复方向里"子文档创建时可见性未对齐，只有更新时会拉齐" | **不成立** | `CreateMemoComment` 在创建时就把 `comment.Visibility` 强制赋成父文档的值 |

**缺口 2 的语义更正。** `Memo.ParentUID` 不是目录树的父节点，它是从
`memo_relation` 里 `type = "COMMENT"` 的记录 LEFT JOIN 派生出来的——即"这条 memo 是谁的
评论"。知识库的目录层级是 `folder_path` 字符串，文件夹本身不承载可见性。因此：

- "父文档"= 被评论的文档，链路**最多一层**，不存在"沿链向上取到根文档"的递归，
  正文侧 `GetMemo` 也只校验一层。修复不需要写循环，也不需要防环。
- `SetMemoRelations` 显式跳过 `COMMENT` 类型，所以评论关系只能由 `CreateMemoComment`
  建立，而它创建时就对齐了可见性。**缺口 2 因此不是"创建时没对齐"，而是缺口 6。**

### 需求文档未记录的两个缺口

**缺口 5：管理员在附件上越权于正文。** 正文侧 `checkMemoReadAccess` **不给管理员特权**
——管理员打不开别人的 PRIVATE 文档正文。但两处附件判定都放行 `RoleAdmin` / `isSuperUser`。
后果：管理员能下载一篇他连正文都读不到的私密文档的全部附件。

这是当前四个缺口里**唯一一个"能读到本不该读的内容"的越权**（缺口 1、2 需要特定的
文档状态组合才能触发，缺口 3 只影响元数据），也是与 ADR-0003"私密附件管理员也拒绝"
这条决策方向一致的。它应当排在最前。

**缺口 6：父文档可见性变更不下沉到评论。** 创建时的对齐是**快照式**的，之后没有级联：
`UpdateMemo` 在更新一篇**有父的** memo 时会把可见性拉回父值，但更新**父**的可见性时
不会去改它的评论。所以 PUBLIC 文档挂了评论、之后改成 PRIVATE，评论仍是 PUBLIC——正文侧
`GetMemo` 会因为那一层父校验拒掉，附件侧不会。这才是缺口 2 真正可复现的路径。

### B 部分

| 断言 | 核查结果 |
|---|---|
| `proto` 里没有 `locked` 字段 | 成立，`AttachmentPayload` 当前只有 `s3_object`/`motion_media`/`origin`/`reader_settings` |
| 没有 `UnlockVault` / `LockVault` | 成立 |
| ADR-0002 的 verifier "存 user_setting" | 方向可行，但**存在命名陷阱**（见下） |
| 有可仿照的 cookie 签发模式 | 成立，`auth_service` 的 refresh token cookie |

**命名陷阱。** `SecretKeyUserSetting` 里**已经有一个叫 `verifier` 的字段**，语义是"对参数头
的 HMAC，让客户端区分'口令输错'和'信封损坏'"——纯客户端用，服务端不参与比对。ADR-0002 要的
是完全不同的东西：`HMAC-SHA256(MK, "toucan-attach/unlock/v1")`，服务端存明文并做常数时间比对。
两者同名必然在实现时被搞混。**新字段一律叫 `unlock_verifier`，且在 proto 注释里写明与
`verifier` 的区别。**

**B 真正的实现障碍不是 proto 字段，是凭证种类没有承载体。** ADR-0003 要求
"vault cookie 只在浏览器会话链路签发，PAT/MCP 令牌即便带上 cookie 也不认，必须写成显式检查"。
但 `Authenticator.AuthenticateToUser` 只返回 `*store.User`，把"这个身份是怎么认出来的"
丢掉了；`base.ActorKind` 只区分 MCP 通道，PAT 走 REST 时同样是 `ActorKindHuman`。
所以那条显式检查**当前没有地方可写**。这决定了 B 的起点是 `server/auth` 的一次重构，
而不是加 proto 字段。

---

## 二、待拍板问题的定案

编号沿用需求文档 B 部分末尾的五问。

1. **管理员一律拒绝私密附件** —— 采纳。并且顺带把缺口 5 一起收敛：普通附件的判定也不再给
   管理员特权，与正文侧 `checkMemoReadAccess` 对齐。理由是"附件比正文更宽松"本身就是 bug，
   不该只在私密附件上单独收紧。
2. **锁定态遮挡文件名** —— 采纳，标注为显示层遮挡。文件名仍会出现在数据库、备份、
   memogit 的历史里，不能当安全边界宣传。
3. **TTL 30 分钟滑动续期** —— 采纳，与加密块的闲置上锁对齐。**同一套超时实现**，
   不新写一份计时器（见风险 R5）。
4. **首次启用就地引导** —— 采纳。
5. **A 部分独立先发** —— 采纳，而且是本计划最重要的一条切分。A 是安全修复，回归面清晰；
   B 的前置（凭证种类透出）本身就是一次触及所有认证入口的重构。把安全修复压在它后面
   意味着越权要多存活一个完整的功能开发周期。

---

## 三、分阶段实施计划

六个阶段，P0–P1 是 A 部分（可独立发布），P2–P5 是 B 部分。每阶段独立可回滚。

**进度：P0、P1、P2、P3（后端，无 UI）已实现（2026-08-09）；P4 已实现（2026-08-10）；P5 未开始。**

### P0 判定收敛与越权修复 —— 已实现

**目标**：两处判定合并成一个函数，补上归档检查，取消附件上的管理员特权。

**做法**：新建单一的 `CheckAttachmentReadAccess`，两处调用。判定顺序：未挂文档 → 仅创建者；
挂了文档 → 复用正文侧 `checkMemoReadAccess` 的语义（归档仅创建者、PRIVATE 仅创建者、
管理员无特权），差异项（`AllowAnonymous()` 闸门、`share_token` 兜底、用户来源是 echo
context 还是 Connect context）用参数传入而不是复制代码。

**落地位置**：新包 [`server/attachmentacl`](../../../server/attachmentacl/attachmentacl.go)，
函数名 `CheckReadAccess`，由 `fileserver.checkAttachmentPermission` 与
`api/v1.checkAttachmentAccess` 两处调用；矩阵测试在
[attachment_access_test.go](../../../server/router/fileserver/attachment_access_test.go)
（按 R1 先写测试：先跑在旧实现上确认只有四个已知缺口对应的格子红，再动实现）。

**实施时与原计划的两处偏差**：

- **share token 排在归档检查之后**，即归档文档的 share token 不再能取到附件。原计划没写
  这两者的先后；分享页对归档文档本来就按"不存在"处理（`GetMemoByShare` 显式拒 `Archived`），
  附件跟着走才一致。
- **`UpdateAttachment` 改成直接从 store 回读**而不是再调 `GetAttachment`。取消读侧管理员
  特权之后，管理员改他人附件会在"写成功之后回读被拒"，是个自相矛盾的失败；写侧权限本身
  没动。

**验收判据**（均已由测试覆盖）：
- 归档的 PUBLIC 文档，其附件对非创建者返回 404/403，创建者仍可下载。
- 管理员对他人 PRIVATE 文档的附件，二进制与元数据两条路径都被拒。
- 私有实例（无 `InstanceURL`）上，PUBLIC 文档附件的**元数据**对匿名请求也被拒——
  这条是修掉 `api/v1` 相对 `fileserver` 的漂移，属于收紧，需要在发布说明里点名。
- 现有的公开分享场景（PUBLIC 文档 + 公开实例、share token 页面）全部不受影响。

**回滚**：单函数替换，回滚即还原两处旧实现。

### P1 评论可见性下沉 —— 已实现

**目标**：修掉缺口 6——父文档可见性变更后评论仍停留在旧值。

**做法**：`UpdateMemo` 更新可见性时，级联更新其 COMMENT 子项
（`cascadeCommentVisibility`）。存量数据由启动时的一次性 backfill 拉齐
（[server/runner/commentvisibility](../../../server/runner/commentvisibility/runner.go)）。

**实施时定案**：取**双向对齐**，与 `CreateMemoComment` 创建时的赋值语义一致；只收紧会
留下"改回 PUBLIC 后评论还是 PRIVATE"这一类新的不一致。R3 要求的旧值留存做成了 backfill
改写前先写 `comment_visibility_backfill_<ts>.csv`（memo_id / memo_uid / parent_memo_id /
旧值 / 新值）到数据目录；**导出失败则整个 backfill 不执行**，宁可让数据继续不一致，也不
做没有回头路的改写。

**验收判据**（已由
[memo_comment_visibility_test.go](../../../server/router/api/v1/test/memo_comment_visibility_test.go)
与 [runner_test.go](../../../server/runner/commentvisibility/runner_test.go) 覆盖）：
PUBLIC 文档挂评论 → 父改 PRIVATE → 评论的正文与附件对第三方均不可读。
存量数据迁移后不存在 `visibility != 父 visibility` 的评论。

**回滚**：级联逻辑可回滚；**存量迁移不可逆**，见风险 R3。

### P2 凭证种类透出（B 的前置，无用户可见变化）—— 已实现

**目标**：让"当前请求是浏览器会话 / PAT / MCP 令牌"成为判定函数可以读到的事实。

**落地位置**：`server/auth` 新增 `CredentialKind`（`CredentialKindSession` /
`CredentialKindPAT` / `CredentialKindMCP` / `CredentialKindNone`）。判定：Access Token V2
（无论走 header 还是——不适用，V2 只走 header）与 refresh cookie 都记为 session；PAT
默认记为 PAT，若 `base.ActorKindFromContext(ctx).IsAgent()`（MCP 适配器在构造请求前已经
打上这个标记）则改记为 MCP——同一枚 PAT 经 MCP 通道打来时区分的依据是通道，不是令牌本身。

- `Authenticator.Authenticate`（`AuthResult.CredentialKind`）与
  `Authenticator.AuthenticateToUser`（新增返回值）都携带凭证种类。
- `auth.ApplyToContext` 把凭证种类写进 context（`auth.GetCredentialKind(ctx)` 读取），
  gRPC-Gateway 中间件与 Connect 拦截器都经过它，因此 `api/v1` 全部 handler 无需改动即可在
  未来读到。
- `fileserver.getCurrentUser` 同步返回凭证种类；`checkAttachmentPermission` 里暂时丢弃
  （`_`）——`attachmentacl.CheckReadAccess` 还没有消费它的分支，P3 加 locked 分支时再接。
  丢弃点留了注释说明原因，避免看起来像遗漏。

**实施时确认**：`AuthResult`/`AuthenticateToUser` 是当前仅有的两个"权威判定点"，
`api/v1` 侧所有调用者（`v1.go`、`connect_interceptors.go`）都通过它们再经
`ApplyToContext` 落地，不需要逐个 handler 改签名；`sse_handler.go` 直接调用
`Authenticator.Authenticate` 但不经过 `ApplyToContext`，本阶段不需要它读凭证种类，未改动。

**验收判据**（均已覆盖）：
- 所有现有认证测试通过且行为不变（`go test ./...` 全绿，无新失败）。
- 新增 [auth_test.go](../../../server/router/api/v1/test/auth_test.go) 的
  `TestAuthenticatorCredentialKind`：Access Token V2 header → session；refresh
  cookie → session；直接使用的 PAT → PAT；同一枚 PAT 经 `base.WithActorKind(ctx,
  base.ActorKindAgent)` 标记的 MCP 通道 → MCP；无凭证 → None。
- `TestApplyToContextCarriesCredentialKind` 断言 `ApplyToContext` → `GetCredentialKind`
  这条链路能取到值。

**回滚**：纯加法（新类型、新字段、新返回值），回滚无数据影响。

### P3 locked 元数据与解锁链路 —— 已实现（后端，无 UI）

**目标**：附件可以被标记 locked，用户可以解锁与上锁，服务端能验证解锁态。

**落地位置**：

- Proto：`AttachmentPayload.locked`（[attachment.proto](../../../proto/store/attachment.proto)）；
  `SecretKeyUserSetting` 加 `unlock_verifier`/`failed_unlock_attempts`/
  `failed_unlock_window_start`（[user_setting.proto](../../../proto/store/user_setting.proto)），
  API 侧 `SecretKeySetting` 与 `Attachment` 消息同步加对应字段；新增
  `AttachmentService.UnlockVault(proof)` / `LockVault()`
  （[attachment_service.proto](../../../proto/api/v1/attachment_service.proto)）。
- vault token/cookie：[server/auth/token.go](../../../server/auth/token.go) 新增
  `VaultTokenClaims`/`GenerateVaultToken`/`ParseVaultToken`（HS256，30 分钟 TTL，
  audience `user.vault-token`，与 access/refresh token 同一套签名机制），
  [server/auth/extract.go](../../../server/auth/extract.go) 新增
  `ExtractVaultTokenFromCookie`/`VaultUnlocked`（package 级函数 + `Authenticator` 方法两个
  入口，分别给 api/v1 和 fileserver 用）。Cookie 构建见
  [vault_service.go](../../../server/router/api/v1/vault_service.go) 的 `buildVaultCookie`，
  逐字段照抄 `buildRefreshTokenCookie`（httpOnly + Secure + SameSite=Lax），只换了 cookie
  名和 TTL。
- 判定：`attachmentacl.CheckReadAccess` 在最顶部加了 locked 分支
  （`checkVaultAccess`），locked 附件完全跳过原有的归档/可见性/share token 逻辑——
  只看 `creator_id == 当前用户` 且 `Request.VaultUnlocked(userID)` 为真；`VaultUnlocked`
  是新加的闭包字段，`nil` 时按拒绝处理（fail closed）。`VaultUnlocked` 内部同时检查凭证
  种类（必须是 P2 加的 `CredentialKindSession`）与 cookie 的 subject 是否等于该 userID。
- 限速与常数时间比对：`UnlockVault` 里做 `subtle.ConstantTimeCompare` 比对 proof 与
  `unlock_verifier`；失败计数与窗口起点存在 `SecretKeyUserSetting` 里，5 次/分钟，
  见 [vault_service.go](../../../server/router/api/v1/vault_service.go)
  的 `vaultUnlockRateLimited`/`recordFailedVaultUnlock`/`resetVaultUnlockFailures`——
  这仨函数是本阶段唯一的限速实现，全仓库之前没有任何登录/校验类限速代码可复用。
- `UpdateAttachment` 加 `locked` field mask 分支：设 `true` 前调用 `canLockAttachment`
  检查创建者的 `unlock_verifier` 是否非空，否则 `FailedPrecondition`（R8）。顺带修了一个
  潜在 bug：原来 `reader_settings` 分支每次都从 `attachment.Payload` 重新 clone，如果同一次
  update 里出现两个 payload 字段，后写的会覆盖先写的；现在改成 `ensurePayload()` 只 clone
  一次、后续复用。

**存量用户回填**：本阶段实现的是"缺失时禁止加锁"这一半（`canLockAttachment`
返回 false 时拒绝设置 `locked=true`）。客户端在下次成功解出 MK 时补算并上传
`unlock_verifier` 的那部分是前端工作，属于 P5，未做——目前没有前端代码会写这个字段，
所以**现在所有用户（新老一致）都还锁不了任何附件**，直到 P5 补上客户端写入路径。

**已实现但未接入使用方（等 P4/P5）**：

- 缩略图/motion 派生物**没有**接到 locked 判定上（P4 的工作，见下）。
- vault cookie **没有滑动续期**：当前是拿到 token 时的固定 30 分钟 TTL，不会在后续请求里
  自动展期。R5 要求的"与加密块共用同一套闲置计时"也未实现——加密块的计时器目前完全在
  浏览器内存里，不会调用服务端的 `LockVault`。这两项都留给 P5 的前端工作。
- 没有任何前端 UI：设置 `locked` 只能直接调 `UpdateAttachment` 的 API。

**验收判据**（已由
[vault_test.go](../../../server/router/api/v1/test/vault_test.go) 与
[attachment_lock_test.go](../../../server/router/fileserver/attachment_lock_test.go) 覆盖）：
设为私密是纯元数据更新——文件不搬、URL 不变、正文引用不动。
锁定后未解锁时二进制与元数据均被拒（含"是创建者但没 cookie"、"cookie 是别人的"、
"other/admin 即使拿到 owner 的合法 cookie 也不行"）；解锁后同一枚 cookie 能让
metadata 与二进制两条路径都放行。带 PAT 且同时带 vault cookie 的请求被拒
（`TestAttachmentAccess_LockedRequiresSessionCredential`）。5 次错误 proof 后第 6 次
即使 proof 正确也被限速拒绝。缺 `unlock_verifier` 时 `UnlockVault` 与
"设 locked=true" 都返回 `FailedPrecondition`，不会静默放行或静默拒绝解锁。

**回滚**：proto 字段是加法；已被标记 locked 的附件在回滚后会退回普通附件——
**这是一次静默的权限放宽**，回滚前必须先清掉 locked 标记，写进发布检查单。

### P4 旁路封堵 —— 已实现

**目标**：把需求文档旁路表里的每一条显式处理掉，不依赖"它大概走了同一个函数"。

**实施时核查结论**：逐条核对后，清单里五条只有一条是真正的旁路，其余四条已经
经由 P0 的 `attachmentacl.CheckReadAccess` 统一收口，不需要改代码：

| 旁路 | 结论 |
|---|---|
| RSS enclosure | 不是旁路。`generateRSSFromMemoList` 只拼 `/file/...` URL，不读字节；实际取字节仍走 fileserver 判定，锁定附件的 URL 会被拒 |
| share token 取字节 | 已接入。`fileserver.checkAttachmentPermission` 把 `share_token` 传给 `CheckReadAccess` |
| memogit 推拉附件字节 | 已接入。底层是 HTTP GET `/file/...` 带 PAT，复用同一路由与判定 |
| MCP / PAT 令牌访问附件 | 已接入，同上；未发现 MCP 侧绕开 fileserver 直连 store 的路径 |
| 缩略图 / motion 派生物 | 已接入且顺序正确。`serveAttachmentFile` 里 `checkAttachmentPermission` 发生在 `getOrGenerateThumbnail`/motion 缓存读取**之前** |

**真正的旁路**：`GetMemoByShare`（[memo_share_service.go](../../../server/router/api/v1/memo_share_service.go)）
直接 `ListAttachments` 把附件元数据（含文件名、`locked` 标记）塞进分享页返回值，
完全没有调用 `CheckReadAccess`——分享链接对任何拿到链接的人有效，但锁定附件"只答
应创建者本人解锁后的 vault"，原实现会把锁定附件的文件名泄漏给分享页的匿名访客，
与"锁定态遮挡文件名"的决定直接冲突。

**修复**：新增 `filterShareableAttachments`，对 `ListAttachments` 的结果逐条跑
`attachmentacl.CheckReadAccess`（`ShareToken` 传分享 ID），只保留判定通过的附件。
复用同一个判定函数而不是在这里重新写一遍"是不是 locked"，两处不会再漂移。

**验收判据**（已由
[memo_share_service_test.go](../../../server/router/api/v1/test/memo_share_service_test.go)
的 `TestGetMemoByShare_HidesLockedAttachments` 覆盖）：
PUBLIC 文档挂一个普通附件和一个锁定附件，创建分享链接后，匿名读取
`GetMemoByShare` 只能看到普通附件的文件名，锁定附件完全不出现在返回列表里。
其余四条旁路暂未逐条补充"现状快照"回归测试（风险见下）。

**遗留**：R6 要求"清单式，每条一个测试"，本阶段对确认无需改动的四条旁路没有
补测试，只在本文档记录了核查结论。如果这四条底层实现（fileserver 路由复用）
将来被重构，回归可能不会被自动捕获——建议 P5 或后续维护时补上。

### P5 前端

附件级"设为私密"开关、就地引导首次启用、解锁交互（复用既有的 MK 解包逻辑与
`useSecretMasterKey`）、锁定态的文件名遮挡、上锁时**真的关闭**已展开的私密预览
（ADR-0003 明确要求，不能只是按钮变样）。

**验收判据**：本阶段产出测试要点清单交人工走一遍，不做自动化视觉验证。

---

## 四、风险登记

| # | 风险 | 触发条件 | 影响 | 应对 |
|---|---|---|---|---|
| R1 | 判定收敛写错，公开文档的附件对匿名访客失效 | P0 合并两处逻辑时把 `AllowAnonymous()` 闸门的适用范围搞反 | 所有公开分享页图片全挂，是本计划回归面最大的一处 | 先补齐**现状**的表驱动测试（可见性 × 归档 × 实例是否公开 × 凭证种类 × 是否带 share token），再动实现；测试先绿在旧实现上 |
| R2 | 取消管理员特权破坏既有运维动作 | P0；管理员可能正靠这个做数据排查、迁移、故障支持 | 运维流程静默失效，且报错是 403 不易归因 | 发布说明点名；若确有运维需求，走"管理员在服务器上直接访问存储"而不是恢复 API 特权 |
| R3 | 存量评论可见性迁移不可逆 | P1 一次性迁移把评论可见性改写成父值 | 若"双向对齐 vs 只收紧"的决定事后反悔，原值已丢失 | 迁移前把 `(memo_id, 原 visibility)` 落一张临时表或导出文件；迁移与级联逻辑分两次提交 |
| R4 | 凭证种类重构触及所有认证入口 | P2 | 认证是全站单点，改错即全站不可登录 | P2 严格限定为"只传信息不改判定"；任何行为差异视为 bug 而非预期；本阶段单独发布、单独观察 |
| R5 | vault cookie 与加密块两套超时语义打架 | P3；两处各写一份 30 分钟计时器 | 用户体验上出现"加密块还开着但附件锁了"或反之，且难复现 | 共用同一份闲置计时与上锁触发（闲置超时 / 登出 / 清 token），不新建第二套 |
| R6 | 旁路遗漏 | P4；主路径测试通过就认为做完了 | 功能宣称"锁住了"但存在一条能拿到字节的路，是本计划最严重的失败模式 | P4 的验收判据是清单式的：每条旁路一个测试，测试名对上条目；宁可多写重复测试 |
| R7 | `unlock_verifier` 与既有 `verifier` 混用 | P3 | 校验永远通过或永远失败，且看起来像是 KDF 问题 | 命名强制区分；proto 注释写明两者语义；比对函数只接受 `unlock_verifier` 一个来源 |
| R8 | 存量用户回填遗漏 | P3；已有主口令但无 `unlock_verifier` 的用户 | 老用户把附件锁上后解不开，等同于数据丢失 | 回填缺失时**禁止加锁**，而不是允许加锁后再想办法；这条要作为 P3 的硬性验收项 |
| R9 | 锁定前已生成的缩略图仍可取 | P4；判定写在读缓存之后 | 锁定的图片能以缩略图形式被看到 | 判定前置于缓存读取；测试覆盖"先访问生成缩略图 → 再加锁 → 再访问"这个顺序 |
| R10 | memogit 拉取遇到锁定附件静默丢文件 | P4 | 本地仓库看起来同步成功但缺文件，用户不知情 | 明确定义行为（跳过并在输出里报告，而不是静默跳过或整体失败） |

---

## 五、不做什么

- **不做文件加密。** 文件在存储端原样保存，服务端持有明文。这是"锁"不是"加密"，
  与[加密块](../requirements/editor/secret-block.md)是不同的安全等级。UI 措辞统一用
  "锁定/保险箱"，不得出现"加密"。
- **不做"附件区整区私密"的独立状态位。** locked 是附件级属性，"整区私密"只是批量操作。
- **不引入第二把口令**（ADR-0002）。
- **不做递归的父链校验。** 评论关系只有一层，写循环是过度设计。
