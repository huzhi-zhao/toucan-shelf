# Agent 经 MCP 协作写作

CC（或其他支持 MCP 的 agent）可以通过 MCP，不落盘、不碰本地 git，在线读写
ToucanShelf 知识库。这与 [memogit-sync.md](memogit-sync.md) 的适用区间是分开
的，不存在取代关系：

| | MCP | memogit |
|---|---|---|
| 落盘 | 否 | 是 |
| 与本地代码仓库 git 的关系 | 无接触 | 会冲突 |
| 适用场景 | 边写代码边查/改文档 | 离线、批量、要版本化导出 |

选型与取舍见 ADR：

- [ADR-0009](../../adr/0009-mcp-online-readwrite-complements-memogit.md) —— MCP 与 memogit 互补而非替代
- [ADR-0010](../../adr/0010-mcp-tool-whitelist-eight-tools.md) —— 工具集精简为 8 个 + 字段级白名单
- [ADR-0011](../../adr/0011-agent-write-snapshots-human-baseline.md) —— 版本快照绑定人类基线，不做 pruning
- [ADR-0012](../../adr/0012-actor-kind-from-channel-not-identity.md) —— actor 判定依据通道而非用户身份
- [ADR-0013](../../adr/0013-no-optimistic-concurrency-control.md) —— 本期不做乐观并发控制
- [ADR-0014](../../adr/0014-agent-session-open-not-a-lock.md) —— `agent_session_open` 不得被复用为锁

## 1. 基础设施

`server/router/mcp/` 已有一个基于 Streamable HTTP 传输、挂载在 `/mcp` 的 MCP
server，把调用方的 `Authorization: Bearer <PAT>` 透传给内部 REST API 复用既有
鉴权（`server/router/mcp/README.md`）。传输层、鉴权、OpenAPI→工具的转换不需要
重做——这套 MCP 是上游 memos 带来的，本仓库在其上做了工具白名单精简
（ADR-0010）与 actor 判定（ADR-0012）等改造。

## 2. 当前工具集：8 个

`server/router/mcp/catalog.go` 的 `curatedOperationIDs`：

```
WorkspaceService_ListWorkspaces
WorkspaceService_GetWorkspaceTree
RagService_Search
MemoService_ListMemos
MemoService_GetMemo
MemoService_CreateMemo
MemoService_UpdateMemo
AuthService_GetCurrentUser
```

`MemoService_DeleteMemo` 被刻意剔除：赋予 agent 删除文档的能力，收益接近零，
风险不低。详见 [ADR-0010](../../adr/0010-mcp-tool-whitelist-eight-tools.md)。

## 3. `UpdateMemo` 的字段级白名单

工具白名单只能限到 operation 粒度，而 `MemoService_UpdateMemo` 的 schema 是
`update_mask`（任意字段列表）+ 完整 `Memo` body。放行这一个 operation 等于放行
了整个更新面的全部 mask 路径，所以在 `UpdateMemo` 内部按
`base.ActorKindFromContext(ctx).IsAgent()` 加了一层字段白名单
（`server/router/api/v1/memo_agent_baseline.go` 的 `agentWritableFields`）：

```go
var agentWritableFields = map[string]bool{
	"content":     true,
	"title":       true,
	"folder_path": true,
	"workspace":   true,
	"state":       true,
	"pinned":      true,
}
```

放行 authorship（`content` / `title`）与 placement（`folder_path` /
`workspace` / `state` / `pinned`），其余一律 `PermissionDenied`——尤其是
`visibility`（能把私有文档改成 PUBLIC）和 `create_time`/`update_time`（改动会
让 memogit 的增量 pull 拉不到这篇文档，或伪造记录）。这是白名单不是黑名单：
`update_mask` 会随功能增长，黑名单对每个新字段默认放行，白名单默认拒绝。

`state` 在放行列表里，意味着 agent 能归档文档（从目录树消失）——这被判定为
可接受，因为原文档没有丢失，且人工一步可逆。

## 4. 写入前自动留存人类基线快照

`server/router/api/v1/memo_agent_baseline.go` 的
`snapshotHumanBaselineIfNeeded`：agent 覆盖写入前，若当前内容是人类写的（判据
是 `memo.Payload.AgentSessionOpen` 为 false），先创建一份版本快照
（display_name 固定为 `"AI 编辑前"`），再允许覆盖；若当前内容本身就是 agent
写的（`AgentSessionOpen` 为 true），直接覆盖、不再产生新快照。

快照数量因此等于人类编辑会话数，与 agent 迭代次数无关——agent 改 50 次还是
1 次，都只留那一个人类确认过的版本。决策依据见
[ADR-0011](../../adr/0011-agent-write-snapshots-human-baseline.md)。

触发快照与翻转 `AgentSessionOpen` 的是 authorship 字段（`content`、`title`），
`isAuthorshipField` 判定；归档、置顶、换文件夹、视图开关等不算，不会误清空
或误置位这个 bit。

`AgentSessionOpen` 在以下路径上被正确维护（已核对代码，均已落地，不是待办）：

- `MemoService_CreateMemo`（`memo_service.go:168`）：创建时按 actor kind 直接
  置位。
- `MemoService_UpdateMemo`（`memo_service.go:720`）：写入 authorship 字段时按
  actor kind 置位/清零。
- `RestoreMemoHistory`（`memo_history_service.go:206-207`）：回滚是人类操作，
  显式把 flag 清为 false。
- 后台 payload 重建（`server/runner/memopayload/runner.go`）：只在已加载的
  payload 上原地修改 `Tags`/`Property`，不重建整个 `Payload` 对象，因此不会
  意外冲掉这个 bit；代码里有注释标注这一点依赖"原地修改"这一实现细节，改成
  整体替换会静默破坏版本机制。

## 5. actor 判定：看通道，不看身份

MCP 请求携带的是作者本人的 PAT，`CreatorID` 与网页登录时完全相同，靠用户身份
区分不了人类和 agent。判据是请求通道：`internal/base.WithActorKind` 把标记放在
请求的 Go `context` 上，由 `server/router/mcp/adapter.go` 在构造 in-process
请求时注入，不过网络、外部无法伪造。默认值是 `ActorKindHuman`——保守方向：误判
成人类只会多产一个快照，误判成 agent 会漏掉基线。详见
[ADR-0012](../../adr/0012-actor-kind-from-channel-not-identity.md)。

memogit 的写入走 `UpdateMemo` API 但不带 MCP 标记，因此被判为人类，语义正确：
memogit 推回来的是本地 git 里的人工内容。

## 6. 数据模型

`agent_session_open`（`proto/store/memo.proto`）是 `MemoPayload` 里的一个
`bool` 字段：当前内容是否由 agent（MCP 通道）写入，人类写入时清零。选择放进
`MemoPayload`（JSON 列）而非新增数据库列，是因为三个数据库驱动都不需要写迁移，
且该 bit 不参与任何查询过滤。零值 `false`（= 当前内容是人写的）恰好是安全
方向：老文档没有该字段、字段刚上线、序列化丢失，都会退化成"下次 agent 写入时
建一个快照"，最坏结果是多一个快照，不会丢数据。

proto 里的注释明确写了"这不是锁，不得用于并发控制"，对应
[ADR-0014](../../adr/0014-agent-session-open-not-a-lock.md)。

## 7. 明确不做的事

- **乐观并发控制**（如 `expected_content_hash`）——见
  [ADR-0013](../../adr/0013-no-optimistic-concurrency-control.md)，本期依赖
  作者纪律：不要在 agent 写作期间同时在 Web 端修改同一篇文档。
- **`folder_path` 进 CEL filter schema**——`internal/filter/schema.go` 的 memo
  schema 目前没有 `folder_path` 字段，`memo_list_memos` 无法按文件夹路径批量
  捞文档；`workspace_get_workspace_tree` 已覆盖主要场景，此项推迟。
  TODO(确认)：是否已有后续计划排期此项，未找到更晚近的文档，标记待确认。
- **路径寻址的复合工具**（如 `doc_read(path="架构/存储层设计")`）——现有架构是
  "tool ≡ OpenAPI operation" 的严格映射，做复合工具需新增
  `MemoService_GetMemoByPath` RPC，成本偏高，先观察是否真的需要。
- **编辑器软提示**——人类打开 `agent_session_open == true` 的文档时提示"此
  文档有 AI 编辑且尚未确认"。flag 已经建好，后续可低成本补上，但目前未落地。
  TODO(确认)：未在 `web/` 前端代码中找到对应的 UI 实现，确认这仍是未落地状态。

## 8. 已知残留风险

未做乐观并发控制的情况下：agent 读到 v1 → 人在网页上把文档改成 v2 → agent
基于 v1 全量写回 → v2 被覆盖。有自动快照兜底时，v2 有可能已被快照（若 agent
此前未持有会话）而可恢复；但在 agent 会话已开启的情况下，人类的 v2 会被静默
覆盖且不产生快照。这是已知且已接受的缺口，详见
[ADR-0013](../../adr/0013-no-optimistic-concurrency-control.md)。
