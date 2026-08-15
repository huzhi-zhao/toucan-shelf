# P0 / P1 实施进度

> 记录时间：2026-08-15。对应技术方案 [`tech-design.md`](./tech-design.md) §6。
> **P0（后端收口）与 P1（授权管理 UI）均已完成**，成员删除转交署名（需求 §4）也已完成；
> 只剩 P2（收紧粒度，不在本期）。下半篇是 P1 和删除转交的记录。

## 已完成

### 1. 迁移 + 存储层

- `store/migration/sqlite/0.30/13__workspace_grant.sql`：新建 `workspace_grant` 表
  （`workspace_id` / `subject_type` / `subject_id` / `role` / `granted_by` / `created_ts`，
  `UNIQUE(workspace_id, subject_type, subject_id)`，级联删除跟随 workspace）。
- `store/migration/sqlite/0.30/14__workspace_title_unique.sql`：`workspace.title` 全局唯一，
  **独立成一步**（方案 §7 要求可单独回退）。撞名前置校验用一张临时表做：
  SQLite 的 `RAISE()` 只能写在 trigger 里，所以改成往
  `duplicate_workspace_title_check(title TEXT NOT NULL UNIQUE)` 里灌数据，
  撞名时报错会带上这张表的名字，比裸的建索引失败可读。
- `store/migration/sqlite/LATEST.sql`：同步补上表和唯一索引。
- `store/workspace_grant.go`：模型 + CRUD 门面，另加**权限判定的唯一实现**
  `Store.ResolveWorkspaceAccess(ctx, user, workspaceID) (WorkspaceAccess, error)`
  和 `store.IsTeamOwner`。放在 store 而不是 api/v1，是因为附件 ACL（`server/attachmentacl`）
  也要用同一份判断，放 api/v1 会导致两份实现。
  `WorkspaceAccess` 四档：None / Viewer / Editor / Owner，配 `CanRead/CanWrite/CanAdminister`。
- `store/db/sqlite/workspace_grant.go`、`store/driver.go` 接口补全。
- `store/workspace.go` + `store/db/sqlite/workspace.go`：`FindWorkspace.IDList`。
- `store/memo.go` + `store/db/sqlite/memo.go`：`FindMemo.VisibleWorkspaceIDs`
  —— 语义是「限定在这些库内，PUBLIC 文档豁免」。nil = 不限制（admin），
  空 slice = 只剩 PUBLIC（无授权的成员）。

### 2. 权限入口

- 新增 `server/router/api/v1/workspace_access.go`：
  `WorkspaceRole` 是 `store.WorkspaceAccess` 的别名，`resolveWorkspaceAccess` 是薄封装；
  `accessibleWorkspaceIDs(ctx, user) (all bool, ids []int32, err)` 给列表类查询一次算好；
  `getWorkspaceWithAccess(ctx, name, minRole)` 取代原来的 `getWorkspaceAndCheckOwnership`
  （已删除）。**无权限返回 NotFound，权限不足返回 PermissionDenied**——
  「这个库存在但不是你的」本身也是信息。
- `workspace_service.go`：
  - CreateWorkspace 改为 admin-only；标题查重从 `(CreatorID, Title)` 改成全局 `Title`（两处）。
  - ListWorkspaces：admin 全量，成员按 grant 过滤（`FindWorkspace.IDList`）。
  - GetWorkspace / GetWorkspaceTree：`WorkspaceRoleViewer`。
  - Update/Delete/文件夹增删改/移动：`WorkspaceRoleOwner`。
  - GetWorkspaceTree 里补了一条：库内 PRIVATE 文档对非作者非 admin 不出现在树里。
  - `resolveOrCreateDefaultWorkspace` 改签名收 `*store.User`：找第一个可写的库；
    成员没有可写库时直接 PermissionDenied（**不再给成员自动建库**），只有 admin 会建 "Default"。
  - `resolveWorkspaceForMemo` 改签名收 `*store.User`，按标题查库改成全局唯一查，并要求可写。
  - 新增 `workspaceCreatorUsernames` / `workspaceCreatorUsername`：
    creator 不再等于调用者，署名要查出来而不是拿当前用户顶替。
- `memo_service.go`：
  - `checkMemoReadAccess` 前置库级闸门；PROTECTED 不再是「任意登录用户」；
    PRIVATE 放行作者 + admin。
  - 新增 `checkMemoWriteAccess`，UpdateMemo / DeleteMemo 从「作者或 superuser」改成走它
    （库级授权决定，作者身份不再单独构成写权限）。
  - CreateMemoComment 的可见性判断改为直接复用 `checkMemoReadAccess`。
  - ListMemos：指定库时校验可读；不指定库时用 `VisibleWorkspaceIDs` 限定可访问库。
- `rag_service.go`：`accessibleMemoIDs` 先按可访问库集合过滤，再走原来的 visibility 过滤。
- `server/attachmentacl/attachmentacl.go`：`checkVisibility` 加库级判断，
  并把 PRIVATE 分支对齐文档侧（团队 owner 可读）。直链和元数据两条路径共用这一处。
- `attachment_service.go`：`resolveAttachmentWorkspaceSlug` 里
  `workspace.CreatorID != userID` 换成 `CanWrite()` 判断。

`go build ./...` 通过。

### 3. 测试全绿（2026-08-15 续）

- `server/router/fileserver`：新增 `testhelper_test.go`（`createMember` /
  `createMemberWithWorkspace` / `createWorkspaceFor` / `grantWorkspace`），
  13 处裸 `Store.CreateUser` 改成"建号 + 建库 + 授 EDITOR"。
  `newAccessFixture` 里 owner 和 other **同库**——矩阵要测的是文档 visibility，
  不是库闸门，两人不同库的话测的就变成闸门了。
  矩阵里 admin 对 PRIVATE 的期望从 forbidden 改成 allowed（需求 §3：
  PRIVATE = 作者 + admin），回收站仍然只有作者能进。
- `server/router/api/v1/test`：link/folder 三个测试文件的用户改成 `CreateHostUser`
  （建库和文件夹操作已经是 admin-only，这些用例测的是链接修复不是授权）；
  `test_helper.go` 加 `CreateRegularUserWithWorkspace` / `GrantWorkspace`；
  `TestListMemos` 的两个用户改成同库，`TestGetMemoCommentRequiresParentReadAccess`
  的 other 也放进同库（要测的是 PRIVATE 拒绝，不是库闸门拒绝）。
- `server/router/api/v1`：`sse_service_test.go` 里给 commenter 补父文档所在库的授权。

### 4. admin 单例校验

`user_service.go` 新增 `ensureSingleAdmin(ctx, role, excludeUserID)`，**只此一处**，
CreateUser（excludeUserID=0）和 UpdateUser 的 `role` 分支各调一次。
首个用户注册走 `CreateUserIfNoUsers`，那时系统里没有任何 admin，不受影响。
`excludeUserID` 是为了让 admin 重存自己的 role 不被当成"第二个 admin"。

### 5. 漏网的 CreatorID 归属判断（复查后已改）

原来还有一批"作者或 superuser"的判断绕过了库级闸门，都换成
`checkMemoWriteAccess` / `checkMemoReadAccess`：

- `common.go`：删掉 `canModifyMemo`（它拿不到 store，没法问库级授权）。
- `memo_history_service.go`（4 处）、`memo_relation_service.go`、
  `memo_share_service.go`（3 处）、`memo_attachment_service.go`、
  `attachment_service.go` 创建时挂 memo 的那处 → 写权限。
- `reaction_service.go` 两处、`memo_attachment_service.go` 列附件那处 → 读权限。

保留不动的 `CreatorID` 判断：附件自身的归属（不能挂/删别人上传的文件）、
提及通知、列表按作者过滤。

### 6. 新增授权测试

- `server/router/api/v1/test/workspace_access_test.go`：无授权成员全拒、
  VIEWER 可读不可写、EDITOR 可写文档但库级操作被拒、PROTECTED 不跨库
  （PUBLIC 跨库仍可读）、admin 无需授权通吃。
- `server/router/api/v1/rag_access_test.go`：直接打 `accessibleMemoIDs`
  （RAG 和 Explore 的候选集入口），验证未授权库的 PROTECTED 不进候选集。
- `user_service_registration_test.go`：admin 单例（不能建第二个 admin、
  不能把成员提成 admin、admin 重存自己的 role 不受影响）。
- 附件直链 + 元数据两条路径由 `fileserver` 的矩阵测试覆盖。

错误码约定（测试里已固化）：**库不可达 → NotFound，库内 visibility 拒绝 →
PermissionDenied**。所以"非作者改别人文档"这类老用例的断言从 permission denied
改成了 memo not found。

`go build ./...` 和 `go test ./...` 全绿。

## P1 授权管理 UI（2026-08-15 续，已完成）

### 1. 四个 grant RPC

`proto/api/v1/workspace_service.proto` 新增 `WorkspaceGrant` 消息（含
`Role` 枚举 VIEWER/EDITOR）和 List/Create/Update/Delete 四个 RPC，
实现在新文件 `server/router/api/v1/workspace_grant_service.go`，
connect 适配器补在 `connect_services.go`。

- 资源名 `workspaces/{workspace}/grants/{grantID}`；`user` 字段用的是
  和全站一致的**用户名**形式 `users/{username}`（不是 id）。
- `ListWorkspaceGrants` 的 parent 支持通配 `workspaces/-`，配合 `user`
  过滤，就是 Member 页要的「某个成员在所有库里的授权」。
- 四个 RPC 全部 `requireTeamOwner`——库级操作 admin-only，库内的 EDITOR
  也不能转授（有测试钉住）。
- Create 拒绝：目标是 admin（隐式全权，进表就变成可撤销的了）、
  role 未指定、同一 (库, 成员) 重复授权（改角色走 Update）。
- Update 只允许 `role` 一条 path。

### 2. 前端

- `useWorkspaceQueries.ts`：`useWorkspaceGrantsForUser` +
  create/update/delete 三个 mutation，共用 `workspaceKeys.grants()` 失效。
- 新增 `components/Settings/MemberWorkspaceGrantDialog.tsx`：列出所有知识库
  （含 hidden——隐藏是 admin 的书架偏好，不该顺带决定成员权限），
  勾选=授权、下拉切 VIEWER/EDITOR，**每次改动直接落库**，不做批量保存
  （一行就是一条 grant，攒批要自己编一套 API 没有的 diff）。
  新授权默认给 VIEWER，往上放开是一次点击，反过来则是静默放权。
- `MemberSection.tsx`：成员行的菜单加「分配知识库」（admin 行不出，
  它本来就通吃）。
- `CreateUserDialog.tsx`：按方案 §5 去掉角色单选，`role` 也不再进
  updateMask——后端单例约束下这个选项只能选出一个失败。

选择只做 Member 页这一个入口；方案 §5 提到的「库详情页的协作者入口」是同一组
RPC 的镜像，留给产品评审后再定，不影响后端。

## 成员删除转交署名（需求 §4，已完成）

`store/db/sqlite/user_delete.go` 原来是把该用户的 memo 连同评论子树整棵删掉。
现在删除路径分两条：

- **有 admin 可转交**（删的是普通成员）：`transferUserContentTx` 把
  `memo` / `memo_history` / **挂在文档上的** attachment 的 `creator_id`
  改成 admin，其余「个人的、继承不了的」东西才删——独立附件（没挂文档的上传）、
  reaction、自己建的分享链接、收件箱、身份、设置、`workspace_grant`、用户行。
  文档、评论、关系、他人在其文档上的反应全部原样留下。
- **没有 admin 可转交**（删的就是 admin 自己）：走原来的整棵删除逻辑，
  行为不变。

`DeleteUserResult.Attachments`（上层据此删存储文件）在转交路径下只含独立附件，
挂在存活文档上的附件不能删字节。

`workspace_grant` 的按 subject 清理两条路径都做了（原来只随 workspace 级联）。

未处理、也不是本次引入的：`secret_block.creator_id` 仍指向被删账号
（现状本来就不清理这张表）；`workspace.creator_id` 若是被删成员建的（只有旧数据
可能出现，现在建库是 admin-only）同样不动——admin 短路判断使其仍然可管理。

测试：`store/test/user_delete_test.go` 加
`TestDeleteMemberTransfersDocumentsToOwner`（原
`TestDeleteUserCleansRelatedData` 删的是 host user，正好覆盖无人可转交的那条
路径，断言不变）；API 层
`server/router/api/v1/test/workspace_grant_service_test.go` 里的
`TestDeleteMemberRevokesGrants` 钉住「授权清空 + 文档署名变 admin」。

## 未完成 / 下个会话从这里接

1. **P2：收紧粒度**（需求 §5），不在本期。
2. 库详情页的「协作者」镜像入口（见上，待产品评审取舍）。
3. UI 自测项（后端和类型检查已过，界面需要人工过一遍）：
   - admin 在 Member 页给成员分配/取消库、切 VIEWER↔EDITOR，
     被分配的成员重新登录后书架里出现/消失对应的库。
   - VIEWER 成员在库里只能读不能新建/改文档；EDITOR 可以。
   - 新建成员弹窗不再有角色单选。
   - 删除成员后，其文档仍在原库、作者显示为 admin。

## 需要留意的决策（已做，供评审）

- 成员的写权限完全来自库级授权，**作者身份不再单独授权**：作者被移出某库后，
  对留在库里的旧文档也没有写权限。这比方案文字更严一点，但符合「库级前置闸门」。
- 跨库列表里 PUBLIC 文档不受库授权限制（匿名本来就能读，成员不该比匿名看得少）。
- 测试里的「普通用户」默认带一个自己的库，是为了让与授权无关的用例不用逐个改；
  专门测「无授权成员」的用例用 `CreateUnassignedUser`。
