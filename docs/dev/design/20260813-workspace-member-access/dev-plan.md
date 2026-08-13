# 团队成员与知识库授权 —— 开发计划（本期 = P0）

> 配套需求：[workspace-member-access.md](../../requirements/collaboration/workspace-member-access.md)
> 配套技术方案：[tech-design.md](tech-design.md)

## 0. 范围界定

技术方案 §6 把整个项目分成 P0/P1/P2。**本期只做 P0**：后端权限收口，
不带 UI，`workspace_grant` 表建好但暂时是空的（只有 admin 能建库/能看到
全部，行为对外几乎不变）。理由见 tech-design.md §6 原文：P0 独立发布，
不等 P1 UI 一起上——现状里 PROTECTED 跨库可读、RAG 检索跨库泄露是真实
存在的缺陷，越早堵上越好，不必等 UI 就绪。

P1（Member 页 + 知识库设置协作者入口）、P2（文档/文件夹粒度收紧）**不在
本期**，仅在 §5 留一个衔接点确认。

## 1. 任务分解与依赖

```
T1 迁移 ─┬─→ T2 store 层 ──┬─→ T3 resolveWorkspaceAccess ──┬─→ T4 workspace_service 收口
         │                 │                                ├─→ T5 memo_service 收口
         │                 │                                ├─→ T6 rag_service 收口
         │                 │                                └─→ T7 attachment/fileserver 收口
         └─→ T8 admin 单例校验（与 T2-T7 无依赖，可并行）
T4/T5/T6/T7 完成后 ──→ T9 回归测试与 authz_test.go 补充 ──→ T10 独立发布
```

可并行组：**{T1, T8}** 先行；T1 完成后 **{T4, T5, T6, T7}** 四个收口任务
互相独立，可并行认领（各自触碰不同 service 文件，冲突面小）；T9 依赖前面
全部任务收敛。

## 2. 任务详情

### T1：迁移 —— `workspace_grant` 表 + `workspace.Title` 全局唯一

- **输入**：`store/migration/sqlite/0.30/`（当前最新版本目录，新迁移开
  `0.31/` 或按项目版本号规则递增）；`store/workspace.go` 现有 `Workspace`
  结构。
- **产出**：
  - `store/migration/sqlite/<next>/00__workspace_grant.sql`：建表，字段见
    tech-design.md §2（`id/workspace_id/subject_type/subject_id/role/
    granted_by/created_ts`），`UNIQUE(workspace_id, subject_type, subject_id)`。
  - 同目录 `01__workspace_title_unique.sql`：**先跑存量撞名检查**——若
    `(CreatorID, Title)` 现状里有跨创建者同名记录，脚本报错列出冲突标题，
    不静默改名（tech-design.md §2 原文要求）；确认无冲突（或本地实例只有
    单一创建者，符合"实际冲突概率低"的预期）后再加 `UNIQUE(title)` 约束。
  - 同步更新 `LATEST.sql`。
- **验收**：`go run` 迁移工具跑通；对已有开发库跑一遍确认不报错或按预期
  报冲突。

### T2：store 层 —— `store/workspace_grant.go`

- **输入**：T1 的表结构；对齐风格的参考文件 `store/memo_share.go`。
- **产出**：`WorkspaceGrant` struct，`FindWorkspaceGrant` / `CreateWorkspaceGrant`
  / `ListWorkspaceGrants` / `DeleteWorkspaceGrant`（无 Update——VIEWER⇄EDITOR
  切换用 delete+create 或者直接给个 `UpdateWorkspaceGrant`，跟 memo_share.go
  的写法保持一致，看那边有没有 update 先例再定）。
- **验收**：store 层单测（`store/*_test.go` 惯例）覆盖增删查与唯一约束冲突。

### T3：`resolveWorkspaceAccess` 统一入口

- **输入**：T2 的 store 方法；tech-design.md §3 的接口签名。
- **产出**：新文件 `server/router/api/v1/workspace_access.go`，
  `WorkspaceRole` 枚举 + `resolveWorkspaceAccess(ctx, user, workspaceID)`。
  admin 短路返回 Owner，不查表；否则查 grant 返回 Viewer/Editor/None。
- **验收**：单测覆盖三种角色分支 + admin 短路路径。

### T4：`workspace_service.go` 收口（15 处 `CreatorID` 判断里属于这个文件的部分）

- **输入**：T3；现状 5 处命中（`workspace_service.go:33,70,115,717,758`，
  已用 grep 核对，见方案 §0）。
- **产出**：
  - `ListWorkspaces`：admin 走原逻辑返回全部；member 改为查
    `workspace_grant` 命中的 workspace_id 集合。
  - 单个 workspace 的读写操作，从「`FindWorkspace{CreatorID}`」改为
    「先 `resolveWorkspaceAccess` 判断，再按 `WorkspaceID` 直查」。
  - 库级操作（创建/改名/删除/改设置/文件夹增删/未来的 grant 管理 RPC）
    维持 admin-only，不因为这次改动放开给 Editor。
- **验收**：非 admin 且无 grant 对任意 workspace 读写全部拒绝；admin 行为
  不变（回归测试见 T9）。

### T5：`memo_service.go` 收口

- **输入**：T3；`checkMemoViewPermission`（`memo_service.go:75-90`）。
- **产出**：按 tech-design.md §3「memo 可见性收口」代码块原样实现——
  先 `resolveWorkspaceAccess` 前置闸门（None 直接拒），再走原有
  visibility 分支；PROTECTED 分支去掉"任意登录用户"放行（已被前置闸门
  等价覆盖），PRIVATE 保持"仅作者本人 + admin"。
- **验收**：PROTECTED 文档库外（无 grant）不可读、库内 VIEWER 可读；
  PRIVATE 文档库内其他成员不可读。

### T6：`rag_service.go` 收口

- **输入**：T3；`rag_service.go:176` 现有过滤条件。
- **产出**：调用侧先算好「可访问 workspace_id 集合」（admin 全量，member
  查一次 grant 表拿列表），传入检索层做前置过滤；库内再套 visibility
  规则。**注意**：不在每条候选结果上单独调 `resolveWorkspaceAccess`，
  避免 N+1（方案原文强调点）。
- **验收**：搜索结果不跨越未授权 workspace 的回归测试，对齐现有
  `authz_test.go` / `attachment_access_test.go` 写法（T9 里落地）。

### T7：附件 / `fileserver/` 收口

- **输入**：T3；`server/router/fileserver/`、`attachment_service.go`。
- **产出**：附件可访问性判断改为——先找到附件关联的 memo（若有），复用该
  memo 的 workspace 判断；无关联 memo 的独立附件，按其所属 workspace 直接
  判断。`fileserver/` 的直出鉴权中间件里插入同一次 `resolveWorkspaceAccess`
  调用，不能再假设"拿到 URL 就能访问"。
- **验收**："文档不可见但附件直链能下"的场景必须被拒绝（这是需求 §3
  明确点名的口子）。

### T8：admin 单例校验（可与 T1 并行，独立于授权表）

- **输入**：`user_service.go:218-226`（首个用户注册路径，保持不受影响）；
  `store/user.go` 的 Role 枚举。
- **产出**：`CreateUser` / `UpdateUser` 加校验——目标 role 为 ADMIN 且系统
  已存在其他 ADMIN 时拒绝。`DeleteUser` 级联逻辑（`user_delete.go`）后面
  加一步：把被删用户创建的 memo 批量转移 `creator_id` 给 admin，同一事务，
  并级联清除该用户的 `workspace_grant` 记录（这一步依赖 T2 的表存在，实际
  排期上跟 T1/T2 之后再落地，逻辑本身可以先写）。
- **验收**：把第二个用户改成 ADMIN 应被拒绝；首个用户注册仍正常拿到
  ADMIN；delete 一个成员后其 memo 的 `creator_id` 转移到 admin，
  `workspace_grant` 记录级联清除。

### T9：回归测试收尾

- **输入**：T4-T8 全部落地。
- **产出**：对齐 tech-design.md §7 测试点逐条补测试用例（库级/可见性/RAG/
  附件/成员生命周期/admin 单例/唯一标题七类，唯一标题的迁移脚本冲突路径
  也要有一个用例）。
- **验收**：`go test ./...` 全绿；手动跑一遍现有 admin 单用户场景确认无
  行为回归（本期没有 member 账号做真实的多角色手测，因为没有 UI 分配
  入口——T9 的多角色场景靠单测直接插 grant 记录验证，不依赖 UI）。

### T10：独立发布

- 不等 P1 UI，本期任务全部合并后即可发版。发版说明里注明："地基铺好，
  行为对外几乎不变，但修复了 PROTECTED 跨库可读与 RAG 跨库检索泄露"。

## 3. 明确不做（本期边界）

- 不做 Member 页"分配知识库"UI、不做知识库设置的"协作者"入口（P1）。
- 不做四个新增 RPC（`ListWorkspaceGrants` / `CreateWorkspaceGrant` /
  `UpdateWorkspaceGrant` / `DeleteWorkspaceGrant`）——这些是 P1 才需要
  暴露给前端的接口；本期 store 层（T2）已经把底层方法写好，但不接
  proto/API 层，除非 T9 测试需要直接调 store 方法造数据。

  > 待确认：如果 T9 的测试需要通过 API 而非直接插库来造 grant 数据，
  > 可能需要提前把 T2 的 store 方法包一层内部可调用的 service 方法（不
  > 暴露 proto），而不是等到 P1 才接 RPC。这个粒度留给认领 T9 的人决定，
  > 不影响本期范围判断。

- 不做 P2 的文档/文件夹级授权收紧。

## 4. 与 §5/§6 需求条款的对应关系

需求文档 §6（"与现状的差异，需要一并修的口子"）**就是本期的核心交付**：
T5（memo PROTECTED）+ T6（RAG 检索）直接对应。需求 §5（后续收紧方向）
不在本期，但 tech-design.md 的表结构（`subject_type` 预留、role 只做
VIEWER/EDITOR 不含 OWNER）已经为 P2 铺好路，T1/T2 落地时不需要额外考虑
P2，只要照抄 tech-design.md §2 的字段定义即可。
