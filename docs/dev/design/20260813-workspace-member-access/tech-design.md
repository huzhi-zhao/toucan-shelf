# 知识库成员授权 —— 技术方案

> 状态：**草案，待评审**。配套需求见
> [`workspace-member-access.md`](../../requirements/collaboration/workspace-member-access.md)。

## 0. 现状盘点（已核对代码）

- **`workspace` 表**只有 `CreatorID`（`store/workspace.go`），没有任何共享
  概念。所有查询都写死 `CreatorID = 当前用户`，散落在
  `workspace_service.go`（3 处）、`attachment_service.go`、
  `rag_service.go`、`memo_service.go`、`memo_service_converter.go`，共 15 处
  `FindWorkspace{CreatorID: ...}`。
- **`memo.visibility`**（PRIVATE / PROTECTED / PUBLIC，`memos` 上游遗留）
  与 workspace **完全独立判断**（`memo_service.go:75-90`）：
  PROTECTED 当前语义是"任意登录用户可读"，不看 `workspace_id`。
  RAG 检索的过滤条件（`rag_service.go:176`）抄的同一套语义：
  `creator_id == me || visibility in ["PUBLIC","PROTECTED"]`，
  同样不过滤知识库归属。**这是现状缺陷，不是本方案引入的新问题**，
  但本方案要求前置一层库权限，正好把它堵上。
- **附件**走独立的 `server/router/fileserver/`，走 `StorageSlug` 目录直出，
  不经过 memo 的可见性判断，需要单独接入。
- **角色**只有 `store.RoleAdmin` / `store.RoleUser` 两档
  （`store/user.go`），无第三态，符合本方案"只要 admin/member 二分"的前提，
  不需要扩展 Role 枚举本身——要新增的是**约束**：ADMIN 角色只能落在
  首个用户身上，不能被后续操作再次赋予。

## 1. 核心决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 权限判断顺序 | 库级授权前置闸门 → 库内 visibility 收窄 | 两套模型合成一套漏斗；避免"有库权限但 visibility 又开了后门"的组合爆炸 |
| admin 语义 | 隐式全权，不进授权表 | admin 数量恒为 1，短路判断即可；避免"admin 把自己从某库移除"这类脏状态 |
| admin 单例约束 | 后端强制：CreateUser/UpdateUser 拒绝把非首个用户的 role 设为 ADMIN；前端 Member/CreateUserDialog 去掉角色单选 | 防止"隐式全权"意外长出第二份 |
| 授权粒度（本期） | 知识库级，二值角色 VIEWER / EDITOR | 需求只要"文档级最大读写"，不需要 OWNER 进表（库级操作 admin-only） |
| 授权粒度（预留） | `subject_type` 字段预留 TEAM 等未来取值；角色未来可加 COMMENTER，或在文档/文件夹粒度叠加同构的 grant | 需求 §5 的"整库只读+部分可写"落地时复用同一张表结构，不用另起炉灶 |
| 知识库标题唯一性 | 从 `(CreatorID, Title)` 改为全局 `Title` 唯一 | 只有 admin 能建库后，"撞同名"不再是"两个不同人的库重名"问题，改为强约束更简单 |
| visibility 语义变更 | PROTECTED 从"全实例可读"改为"本库有权限的人可读" | 修复 §0 提到的现状缺陷 |
| 成员删除时文档归属 | 不改 `workspace_id`（知识库本来就 admin 专属管理），只把这批文档的 `creator_id` 转给 admin | 避免署名指向一个已删除的账号；不新增字段 |

## 2. 存储设计

### 新增迁移：`workspace_grant`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 主键 | |
| `workspace_id` | int32 | 外键 → workspace |
| `subject_type` | text | 本期恒为 `'USER'`；预留 `'TEAM'` 等未来取值 |
| `subject_id` | int32 | `subject_type='USER'` 时是 user id |
| `role` | text | `'VIEWER'` \| `'EDITOR'`（不含 OWNER——owner 是 admin，隐式，不进表） |
| `granted_by` | int32 | 操作者（恒为 admin） |
| `created_ts` | int64 | |

`UNIQUE(workspace_id, subject_type, subject_id)`。

对应 `store/workspace_grant.go`：`WorkspaceGrant` / `FindWorkspaceGrant` /
`CreateWorkspaceGrant` / `ListWorkspaceGrants` / `DeleteWorkspaceGrant`，
风格对齐现有 `store/memo_share.go`。

### `workspace.Title` 唯一性

迁移前需要跑一次存量检查：现状允许不同创建者的库同名，改约束前若有历史
撞名数据要先人工/脚本处理（预期本项目当前使用者少，实际冲突概率低，
迁移脚本里带一个前置校验，冲突则报错列出冲突标题，而不是静默改名）。

### 用户单 admin 约束

不需要加字段，在 `CreateUser` / `UpdateUser` 的校验逻辑里加一条：
若目标 role 是 ADMIN 且系统里已存在一个 ADMIN 且目标不是那个 ADMIN 本身，
拒绝请求。首个用户注册那条已有路径（`user_service.go:218-226`）不受影响，
因为那时系统里还没有 admin。

## 3. 权限判断：统一入口

```go
// server/router/api/v1/workspace_access.go（新增）

type WorkspaceRole int

const (
    WorkspaceRoleNone WorkspaceRole = iota
    WorkspaceRoleViewer
    WorkspaceRoleEditor
    WorkspaceRoleOwner // 恒为 admin 或该库 CreatorID（现状创建者，过渡期兼容）
)

func (s *APIV1Service) resolveWorkspaceAccess(ctx context.Context, user *store.User, workspaceID int32) (WorkspaceRole, error)
```

行为：

1. `user.Role == store.RoleAdmin` → 直接返回 `WorkspaceRoleOwner`，不查表。
2. 否则查 `workspace_grant`，命中 EDITOR/VIEWER 就返回对应角色。
3. 未命中 → `WorkspaceRoleNone`。

所有现有的 `FindWorkspace{CreatorID: &user.ID}` 查询模式，改为「先拿
`resolveWorkspaceAccess` 判断能不能碰，再按 `WorkspaceID` 直接查／操作」，
列表类接口（`ListWorkspaces`）改为「admin 返回全部，member 返回
`workspace_grant` 里有记录的那些」。

### memo 可见性收口

`checkMemoViewPermission`（`memo_service.go:75-90`）在原有判断前插入一层：

```go
role, err := s.resolveWorkspaceAccess(ctx, user, memo.WorkspaceID)
if role == WorkspaceRoleNone {
    return status.Errorf(codes.PermissionDenied, "permission denied")
}
```

再走原有 visibility 判断，但 PROTECTED 分支去掉"任意登录用户"的放行，
改为「库内角色 ≥ VIEWER 即可」（已经在上面这层判断过，等价于直接放行）。
PRIVATE 保持"仅作者本人 + admin"。

### RAG 检索收口

`rag_service.go:176` 的过滤条件从

```
creator_id == me || visibility in ["PUBLIC","PROTECTED"]
```

改为先按调用者可访问的 `workspace_id` 集合过滤，再在库内应用 visibility
规则（PRIVATE 仍收窄到作者本人）。可访问集合 = admin 时全量，member 时
`workspace_grant` 命中的 workspace_id 列表，一次查询算好传入检索层，
不在每条候选结果上单独调 `resolveWorkspaceAccess`（避免 N+1）。

### 附件收口

`attachment_service.go` 与 `fileserver/` 里，附件的可访问性目前跟随
其挂载的 memo（若有）或直接判断 creator。改为：先找到附件关联的
memo（若无关联 memo 的独立附件，按其所属 workspace 判断），再复用
`resolveWorkspaceAccess`。`fileserver/` 是直出静态路径，需要在其鉴权
中间件里插入同一次判断，而不是假设"能拿到 URL 就能访问"。

## 4. API 变更

`proto/api/v1/workspace_service.proto` 新增：

- `ListWorkspaceGrants(workspace) -> WorkspaceGrant[]`
- `CreateWorkspaceGrant(workspace, user, role)`
- `UpdateWorkspaceGrant(workspace, user, role)`（VIEWER ⇄ EDITOR 切换）
- `DeleteWorkspaceGrant(workspace, user)`

四个 RPC 全部 admin-only，复用现有 `authz.go` 的角色校验模式。

`UserService` 侧：`CreateUser` / `UpdateUser` 加上 §2 的 admin 单例校验；
`DeleteUser` 加一步——删除前把该用户创建的 memo 批量 `UPDATE creator_id`
为 admin 的 user id（在同一事务内，紧跟现有 `user_delete.go` 的级联删除
逻辑之后）。

## 5. 前端变更

- **Member 页**（`web/src/components/Settings/MemberSection.tsx`）：
  - `CreateUserDialog` 去掉角色单选（新建成员恒为 USER；只有系统里还没有
    任何用户时才会创建出 ADMIN，那条路径走首次注册流程，不经过这个弹窗）。
  - 每行成员增加"分配知识库"入口，弹出该成员当前已分配的库列表
    + 增删操作，复用 `workspace_service` 新增的四个 RPC。
- **知识库设置**：admin 视角下，库详情页（关联
  [workspace-detail-and-shelf.md](../../requirements/knowledge-base/workspace-detail-and-shelf.md)）
  增加"协作者"入口，效果与 Member 页的入口互为镜像（同一份数据，两个
  入口进入，看产品评审时定取舍，技术上是同一组 RPC）。
- **书架 / Explore / 搜索**：`ListWorkspaces` 后端已经按可访问性过滤，
  前端不需要额外过滤逻辑，但要处理"member 看到的书架可能是空的"这种
  空态文案。

## 6. 分期落地

- **P0（后端收口，不带 UI）**：
  1. 迁移：`workspace_grant` 表 + `workspace.Title` 全局唯一约束。
  2. `resolveWorkspaceAccess` 统一入口，替换 15 处 `CreatorID` 判断。
  3. 修复 PROTECTED 跨库可读、RAG 检索跨库泄露。
  4. 附件/fileserver 接入。
  5. admin 单例后端校验。
  
  这一期上线后对外行为几乎不变（授权表是空的，只有 admin 一个用户能建库、
  能看到全部），但地基铺好，且现状漏洞已经堵上。**建议独立发布**，
  不等 P1 UI 一起上。

- **P1（授权管理 UI）**：Member 页 + 知识库设置的协作者入口，四个新增
  RPC 接入前端，admin 可以邀请成员、分配库、设 VIEWER/EDITOR。

- **P2（收紧粒度，按需触发）**：把"库内文档最大读写"收紧为"整库只读 +
  部分文档可写"，在文档（或文件夹）粒度上叠加与 `workspace_grant` 同构的
  `document_grant`（复用 `subject_type`/`role` 设计），VIEWER 默认改为
  库内默认角色，EDITOR 收缩为按文档/文件夹显式授予。

## 7. 未来多 admin / 多团队扩展兼容性（文档说明，暂不开发）

当前前提是"一个实例 = 一个团队 = 一个 admin"（需求 §0）。这里只记录：如果未来
要在 admin 之上再加一层——注册出第二个 admin，其管理的知识库与第一个 admin
完全隔离（互不可见、互不可授权）——本期（P0）的哪些设计决策会成为障碍，哪些
天然兼容。**不改变本期任何实现，只是把坑提前写下来，避免未来推翻重来。**

### 天然兼容，不需要改

- **`workspace_grant` 的 `subject_type`/`subject_id` 设计**：本期已经为
  "USER 之外的未来主体类型"（如 TEAM）预留了 `subject_type`，多团队场景不需要
  改表结构。
- **`workspace.CreatorID`**：本期只有一个 admin，所有 workspace 的
  `CreatorID` 恒等于那个 admin。多 admin 场景下，`CreatorID` 天然就是
  "这个知识库属于哪个 admin（即哪个团队）"的归属字段——因为知识库本来就
  只能由 admin 创建，`CreatorID` 不需要新增字段就能兼任"团队 ID"。

### 会成为障碍，需要未来专门处理

- **`workspace.Title` 全局唯一约束（本期 T1 引入）**：这是最直接的冲突点。
  一旦允许多个互相隔离的 admin/团队，"库标题全局唯一"就不再合理——团队 A
  和团队 B 各自建一个叫"产品笔记"的库应该互不影响。未来要把唯一约束从
  `UNIQUE(title)` 收窄回 `UNIQUE(创建者/团队维度, title)`，等价于回到现状
  `(CreatorID, Title)` 的查重方式，但语义从"按创建者查重"变成"按团队查重"
  （多个 admin 的场景下二者字面相同，只是含义不同）。**本期实现全局唯一
  约束时，迁移脚本要写成"可撤销/可收窄"的独立一步**（见 T1），不要把它和
  `workspace_grant` 建表耦合在同一条不可逆迁移里，方便未来单独回退这一条。
- **`resolveWorkspaceAccess` 的 admin 短路判断**（tech-design.md §3）：
  本期逻辑是"`user.Role == RoleAdmin` → 直接 Owner，不查任何归属"。多 admin
  场景下这个短路必须加一层"该 workspace 是否属于这个 admin 自己的团队"的
  判断，否则会变成"任意 admin 能管任意团队的库"——这正好是多团队要隔离的
  东西。本期实现这个函数时，建议把 admin 短路判断写成单独一步（而不是和
  角色判断糅在一个表达式里），方便未来插入团队归属检查而不用重写调用方。
- **`ListWorkspaces`"admin 返回全部"逻辑**（tech-design.md §3）：同上，
  本期"admin = 全量"在多 admin 场景下要改成"admin = 自己团队的全量"。
- **`store.User` 没有团队归属字段**：本期 member 的"归属团队"是隐式的
  （实例内只有一个团队，所有 member 都算这个团队的）。未来若要支持成员
  属于某个具体 admin/团队，需要新增字段（例如 `team_id`，或者直接用
  "邀请该成员的 admin 的 user id"表示归属），这是本期完全没有的字段，
  需要一次新迁移，不在本期 schema 里预留占位列（预留空字段但暂不使用会
  增加本期复杂度，且字段形态未定，故不预留）。
- **admin 单例约束**（tech-design.md §2「用户单 admin 约束」）：本期在
  `CreateUser`/`UpdateUser` 里硬编码"系统里只能有一个 ADMIN"。这条约束
  在多 admin 场景下要整体替换（从"全局唯一"变成"每个团队一个 owner"或
  类似语义），不是收紧/放宽参数就能兼容，是需要重新设计的校验逻辑。
  实现时建议把这条校验集中写在一处（已经是这样，见 §2），不要在多处重复
  判断"是否已有 admin"，方便未来整体替换。

### 结论

本期不做任何为多团队预留的字段或分支判断——上面列的都是"未来要改的点"，
不是"现在要多写的代码"。唯一需要本期注意的是**实现方式上的可分离性**：
`Title` 唯一约束独立成一步迁移、admin 短路判断独立成一步逻辑、admin 单例
校验集中在一处——这样未来引入多团队时，改动范围可控，不需要推翻本期成果。

## 8. 测试点

- 库级：非 admin 无 grant 时对任意 workspace 的读写全部拒绝；VIEWER
  角色的写操作（CreateMemo/UpdateMemo/DeleteMemo）被拒绝；EDITOR 可以
  文档增删改，但库级操作（改名/删库/管理成员）仍被拒绝。
- 可见性：PROTECTED 文档在库外（无 grant）不可读，库内 VIEWER 可读；
  PRIVATE 文档库内其他成员不可读。
- RAG：搜索结果不跨越未授权的 workspace；跨库泄露的回归测试对齐现有
  `authz_test.go` / `attachment_access_test.go` 的写法。
- 附件：直链访问遵循同一套判断，覆盖"文档不可见但附件 URL 被拿到"的场景。
- 成员生命周期：archive 后授权保留但登录被拒；restore 后授权立即恢复
  生效，不用重新分配；delete 后该用户创建的 memo 的 `creator_id` 转移到
  admin，且 grant 记录级联清除。
- admin 单例：尝试把第二个用户 role 改成 ADMIN 应被拒绝；首个用户注册
  仍能正常拿到 ADMIN。
- 唯一标题：admin 建库撞名应报错；迁移脚本对存量撞名数据的处理路径。
