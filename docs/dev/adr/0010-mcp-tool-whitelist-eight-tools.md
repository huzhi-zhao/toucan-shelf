# 0010. MCP 工具集精简为 8 个 + UpdateMemo 字段级白名单

## Context

本仓库沿用的 MCP server 是上游 memos 带来的（`777d227e feat: add
OpenAPI-driven MCP support (#6026)`），工具选型建立在"memos 是个社交化速记
应用"的假设上：`curatedOperationIDs` 原有 20 个工具，拆开看：

| 类别 | 数量 | 对知识库场景 |
|---|---|---|
| 文档 CRUD（list/create/get/update/delete memo） | 5 | 核心 |
| 附件（4 个 attachment + 2 个 memo 挂载） | 6 | 偶尔 |
| 评论（list/create comment） | 2 | 不需要 |
| 表情反应（list/upsert/delete reaction） | 3 | 不需要 |
| 文档关联（list/set relations） | 2 | 偶尔 |
| 快捷筛选（shortcut） | 1 | 不需要 |
| whoami | 1 | 偶尔 |

原白名单里没有任何一个 workspace 或检索类工具，而这正是原始痛点：缺了
workspace 树，agent 没有"按文件夹定位文档"的能力。此外 `tools/list` 的结果在
连接建立时注入模型上下文并**常驻**，不是调用时才加载；这些 schema 由 OpenAPI
自动推导，相当冗长（单是 `Memo` 这一个 schema 组件在 `proto/gen/openapi.yaml`
里就占 7.4 KB，且内部 `$ref` 会被展开成 `$defs` 一并塞进 input schema），保留
无关工具的 context 成本不是"20 行文字"这么小。

另一个独立问题：工具白名单只能限到 operation 粒度。`MemoService_UpdateMemo`
的 schema 是 `update_mask`（任意字段列表）+ 完整 `Memo` body，放行这一个
operation 就放行了整个更新面的全部 mask 路径——包括 `visibility`（能把私有
文档改成 PUBLIC）和 `update_time`（改动会让 memogit 的增量同步永远拉不到这篇
文档）。"没有删除工具"这个保证，在只做 operation 级白名单时并不成立。

## Decision

**工具集收敛到 8 个**（`server/router/mcp/catalog.go` 的
`curatedOperationIDs`）：

```
workspace_list_workspaces      # 有哪些知识库
workspace_get_workspace_tree   # 目录结构
rag_search                     # 语义/关键词检索
memo_list_memos                # 按条件批量捞
memo_get_memo                  # 读全文
memo_create_memo               # 新建
memo_update_memo               # 修改
auth_get_current_user          # 定位自身
```

`memo_delete_memo` 被刻意剔除：赋予 agent 删除文档的能力，收益接近零，风险
不低。

**在 `UpdateMemo` 内部再加一层字段白名单**
（`server/router/api/v1/memo_agent_baseline.go` 的 `agentWritableFields`），按
`base.ActorKindFromContext(ctx).IsAgent()` 判断，只放行
`content`/`title`/`folder_path`/`workspace`/`state`/`pinned`，其余一律
`PermissionDenied`。是白名单不是黑名单——`update_mask` 会随功能增长，黑名单对
每个新字段默认放行，白名单默认拒绝。归档与移动被判定为可接受：原文档没有
丢失，且人工一步可逆。

保持 curated 的设计意图：不因为"顺手"把 secret block、IDP、instance 管理之类
加进来；全量导出 OpenAPI 会有上百个 operation，光工具定义就能吃掉数万 token。

## Consequences

- agent 获得了此前缺失的知识库导航能力（workspace 列表、目录树、语义检索），
  同时整体 context 占用比原 20 个工具更小。
- `UpdateMemo` 的字段白名单是实际生效的安全边界，不是工具白名单本身——新增
  `update_mask` 路径时必须显式决定是否收进 `agentWritableFields`，否则默认
  拒绝（这正是设计意图）。
- 后续每新增一个 memo 字段，都需要人工判断它属于"authorship/placement"还是
  别的类别，这是维护成本，但被判定为比黑名单的风险更可接受。
