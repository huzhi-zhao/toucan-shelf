# Agent 经 MCP 协作写作 — 分阶段实施

需求与关键决策见 [mcp-authoring.md](../requirements/collaboration/mcp-authoring.md)（迁移后原
`requirement.md` 里的 ADR-1…ADR-6 已重新编号为 ADR-0009…0014，正文下方仍按旧编号引用，
不逐一改写）。

阶段顺序刻意如此：**P0 独立无风险可先落地；P1–P4 构成版本安全网；写工具真正放开给 agent 使用
（P5）必须排在安全网之后。** 在 P4 完成前，不要把 `memo_update_memo` / `memo_create_memo` 交给
日常使用的 CC 会话。

## P0 · 精简 MCP 工具集

| 产出 | 位置 |
| --- | --- |
| 白名单重写 | [catalog.go](../../../server/router/mcp/catalog.go) `curatedOperationIDs` |
| server instructions | [service.go](../../../server/router/mcp/service.go) `sdkmcp.NewServer` 的 `ServerOptions` |
| 工具表与说明同步 | [server/router/mcp/README.md](../../../server/router/mcp/README.md) |
| 测试 | [catalog_test.go](../../../server/router/mcp/catalog_test.go)、[service_test.go](../../../server/router/mcp/service_test.go) |

数组重写为 8 项：

```go
var curatedOperationIDs = []string{
	"WorkspaceService_ListWorkspaces",
	"WorkspaceService_GetWorkspaceTree",
	"RagService_Search",
	"MemoService_ListMemos",
	"MemoService_GetMemo",
	"MemoService_CreateMemo",
	"MemoService_UpdateMemo",
	"AuthService_GetCurrentUser",
}
```

三个新增 operationId 均已存在于 `proto/gen/openapi.yaml`（2856 / 3074 / 1596 行），
**不需要改 proto，不需要 `buf generate`**。移除项见 requirement.md ADR-2；`MemoService_DeleteMemo`
属于刻意剔除，不是遗漏。

README 里的工具表当前有一处笔误（表格行数暗示 21 个，实际 20 个），本阶段一并修正。

`buildCuratedTools` 在 operationId 找不到时会直接返回构造错误、服务启动失败，所以拼写错误不会
静默通过 —— 但仍需靠 `catalog_test.go` 钉住"恰好是这 8 个"。

### server instructions（使用手册）

`NewMCPService` 目前给 `sdkmcp.NewServer` 传的第二个参数是 `nil`，即 `ServerOptions.Instructions`
为空。该字段会在 `initialize` 响应里回给客户端，Claude Code 等客户端会把它作为服务端说明注入
系统提示。**这是"让 agent 快速了解背景"的标准位置，不需要新增工具、也不需要客户端配合。**

必须由服务端下发的原因：

- 工具描述来自 OpenAPI 自动推导，是上游 memos"速记应用"口吻的（ADR-2 的出身问题），
  `memo_get_memo` 这类名字完全传达不出"这是分层知识库"；
- 若改为写在使用方项目的 `CLAUDE.md`（见 P5），每接一个项目要抄一遍，且会与服务端工具集
  演进脱节。instructions 与 `curatedOperationIDs` 同文件维护，改一次全部客户端生效。

**约束：instructions 与 `tools/list` 一样常驻上下文**，ADR-2 砍工具省下来的预算不能在这里还
回去。控制在 25 行以内，只写模型从工具名和 schema 里推不出来的东西：知识库的层级模型、
工具串联顺序、以及会造成静默数据损坏的语义（`memo_update_memo` 是全量覆盖而非增量 patch）。

内容以 [service.go](../../../server/router/mcp/service.go) 的 `serverInstructions` 常量为准，
分 Locating / Creating / Updating 三段。

「update 是全量覆盖、必须先读再写」这条尤其值得占这点 context —— 它是最容易让 agent 静默毁掉
文档的行为，而自动生成的描述里不会有。用英文写是因为它和工具 schema 一起进上下文，与周边
描述保持同一语言，且 token 更省。

**寻址规则也归 instructions，不归提示词。** Creating 一段写死三条：workspace 字段只收
`workspaces/{uid}` 必须先解析显示名、`folder_path` 写不存在的路径会自动出现文件夹、`title`
不带扩展名。这些是**每次写文档都要用且永远不变**的知识，放进 instructions 后用户的提示词
只需表达意图（"存到知识库 X 的 a/b 下，标题 plan"），不必附带调用步骤。判断归属的标准就是
这条：**不随任务变化的操作知识进 instructions，随任务变化的意图留在提示词。**

> **实现修订**：原稿在 Writing 段写了"写入会自动快照人类基线"。P2–P4 落地前这句是**假的**，
> 且方向危险（会让 agent 以为有兜底而更放手），已删除。P3 完成后也**不再加回** —— 这是服务端
> 行为，agent 不需要据此改变动作，写进常驻上下文只是浪费预算。

`service_test.go` 的 `TestMCPInitializeReturnsServerInstructions` 钉住关键约束
（`replaces the whole content field`、`no concurrency check`、`resolve it to workspaces/{uid}`、
`NO file extension`）与长度上限，避免将来重构时被静默丢掉或写成手册。

验证：

```bash
go test ./server/router/mcp/...
```

## P1 · actor 判定（通道标记）

| 产出 | 位置 |
| --- | --- |
| `ActorKind` 与 context 读写 | [internal/base/actor.go](../../../internal/base/actor.go) |
| 注入标记 | [adapter.go](../../../server/router/mcp/adapter.go) `buildAPIRequest` |

### 实现改用 context value，不用 header

ADR-4 原定 `req.Header.Set("X-Memos-Client", "mcp")`。实现时发现这条路走不通，也没必要：

- **grpc-gateway 会把它丢掉。** `/api/v1/*` 由 `runtime.NewServeMux`（[v1.go:99](../../../server/router/api/v1/v1.go)）
  处理，未配置 `WithIncomingHeaderMatcher`，走默认的 `DefaultHeaderMatcher` —— 只放行 IANA
  permanent header 和 `Grpc-Metadata-` 前缀，其余**静默丢弃**。自定义头到不了 handler。
- **要放行就得配 matcher，而那会真的引入伪造面。** MCP adapter 是拿 in-process 请求打同一个
  Echo server，与外部流量共用 `/api/v1/*` 这条链路，服务端无法区分"header 是 adapter 设的"
  还是"远端客户端自己设的"。ADR-4 要求的"不得接受外部同名 header 覆盖"在 header 方案下只能
  靠约定，不能靠机制。

改为把标记放在**请求的 Go context** 上：`base.WithActorKind(ctx, base.ActorKindAgent)`，
adapter 构造请求时 `WithContext`，grpc-gateway 以 `r.Context()` 为基础派生 gRPC context
（[mux.go:408](https://github.com/grpc-ecosystem/grpc-gateway)），值一路传到 handler。
**context value 不过网络，只有 in-process 调用方能设**，ADR-4 的约束由机制保证而非注释保证。
key 是包内未导出类型，外部包也无法碰撞伪造。

判定保守性不变：**仅 `/mcp` 通道为 agent，零值 `ActorKindHuman` 为默认**（含直接打 REST API
的脚本、memogit 推回）。

本阶段只落地判定能力，不接任何行为，便于独立验证。

测试：
- `internal/base/actor_test.go` —— 零值为 human、往返、外部 key 无法伪造。
- `adapter_test.go` —— adapter 构造的请求带 agent 标记；标记能穿过 Echo 到达 handler；
  外部带 `X-Memos-Client: mcp` 头的请求**仍判为 human**。

验证：`go test -race ./internal/base/... ./server/router/mcp/...`

## P2 · payload 字段

| 产出 | 位置 |
| --- | --- |
| `agent_session_open` 字段 | [proto/store/memo.proto](../../../proto/store/memo.proto) `MemoPayload` |
| 生成物 | `cd proto && buf generate` |

```protobuf
// 当前内容是否由 agent（MCP 通道）写入。人类写入时清零。
// 用于决定 agent 写入前是否需要留存人类基线快照。
// 注意：这不是锁，不得用于并发控制（见 docs/dev/adr/0014-agent-session-open-not-a-lock.md）。
bool agent_session_open = 9;
```

`MemoPayload` 是 JSON 列，**三个数据库驱动都不需要迁移**。字段号取 9（8 为 `doc_config`）。

验证：`cd proto && buf lint && buf generate`，确认 `proto/gen/` 与 `web/src/types/proto/` 均已更新。

## P3 · 快照触发

| 触发点 | 行为 |
| --- | --- |
| [memo_service.go](../../../server/router/api/v1/memo_service.go) `UpdateMemo` | agent 的 authorship 写入且 flag 为 `false` → 建快照并置位；人类的 authorship 写入 → 清位 |
| `CreateMemo` | flag = `(actor == agent)` |
| [memo_history_service.go](../../../server/router/api/v1/memo_history_service.go) `RestoreMemoHistory` | **清位** |

要点：

- **触发字段是 authorship（`content` / `title`），不是全部 mask 路径。** 判定见
  [memo_agent_baseline.go](../../../server/router/api/v1/memo_agent_baseline.go) 的
  `isAuthorshipField`，理由与已接受的 title-hash 角落见 requirement.md ADR-3。
- **快照取的是「应用变更之前」的服务端当前状态。** 现有 `CreateMemoHistory` 正是快照当前状态
  （`memo.Content` / `memo.Title` / `memo.Payload` + 当前附件集），语义天然吻合，复用即可。
- **用 `HashMemoState` 去重，且在数据库里比而不是拉出来比。** `FindMemoHistory` 新增
  `ContentHash` 过滤（三个驱动各加一个 where 分支），配合 `Limit=1` 查"这篇文档有没有哪个
  版本的 hash 等于当前状态"。**需要快照的常见路径读 0 行。**
  - 匹配范围是**全部版本**而非最新一条：人类回滚后文档停在旧版本内容、而最新记录是更新的
    那条，只比最新会重复存一份。`RestoreMemoHistory` 的前置校验也是"匹配任一版本"。
  - 原方案"拉最近一条出来比"每次 agent 写入都要读一整篇正文，且丢掉上面这条正确性。
- **自动快照的 `display_name` 用可识别形式**（如 `AI 编辑前`），使版本列表能区分自动基线与
  用户手动命名的版本。手动版本行为完全不变。
- `RestoreMemoHistory` 当前只写 `Content`、不碰 `Payload`，是 requirement.md §5 审计出的唯一
  真实 bug 点，**不能遗漏**。

必须覆盖的测试场景：

1. requirement.md ADR-3 的五步序列（人类建 → agent 接手建 V1 → agent 连改不产快照 →
   人类改清位 → agent 再介入建 V2），断言快照恰好 2 条且内容分别等于两次人类状态。
2. 纯人类反复编辑 → 零快照。
3. agent 连续 N 次写入 → 恰好 1 条快照。
4. `RestoreMemoHistory` 之后 agent 写入 → 建快照（回归防线）。
5. 老文档（payload 无该字段）→ agent 首次写入建快照（零值安全）。
6. agent 只改 `title` → 建快照且置位；agent 只改 `pinned` / `state` → 不建快照、flag 不变。
7. agent 发 `visibility`（或任一非白名单路径）→ `PermissionDenied`，且**文档未被修改**；
   同一路径由人类通道发出 → 正常通过。

验证：`go test -v -race ./server/... ./store/test/...`

## P4 · 防回归

| 产出 | 位置 |
| --- | --- |
| 注释 + 测试 | [runner.go](../../../server/runner/memopayload/runner.go) `RebuildMemoPayload` |

该函数写入整个 `Payload` 字段，看似会冲掉 `agent_session_open`，实际不会 —— 它在**已加载的
payload 上原地修改**，只覆盖 `Tags` 和 `Property`。正确性依赖这个实现细节，改成重建对象
（`memo.Payload = &storepb.MemoPayload{...}`）就会静默破坏版本机制。

加一条注释说明为什么不能重建对象，并加测试断言：payload 重建后 `agent_session_open` 保持不变。

验证：`go test -v ./server/runner/...`

## P5 · 客户端接入

安全网就位后才执行本阶段。

面向用户的完整说明已写入 [docs/manual/10-mcp-agent-access.md](../../manual/10-mcp-agent-access.md)，
本节只保留实施要点。P0–P4 已完成，手册顶部的 Status 声明与 §10.7 的「not yet shipped」标注
已随之删除。

### 注册 MCP server

```bash
claude mcp add --transport http toucanshelf https://<实例域名>/mcp --header "Authorization: Bearer ${TOUCANSHELF_PAT}"
```

PAT 在 Web UI 用户设置里创建。**token 本身绝不入 git** —— 放 shell 环境变量，配置文件里保持
`${TOUCANSHELF_PAT}` 的展开形式。写在项目根 `.mcp.json` 只对该项目生效；`claude mcp add` 默认
写入 `~/.claude.json`，对所有项目生效。

连接检查：`claude mcp list`。

### 在使用方项目的 `CLAUDE.md` 里固化

通用的语义映射与工具串联顺序已由 P0 的 server instructions 下发，这里只写**项目特有**的信息
（哪个 workspace、写前要确认、ADR-5 的纪律）。在**使用知识库的那个代码项目**（不是本仓库）的
`CLAUDE.md` 中加：

```markdown
## 架构文档位置

本项目的架构决策文档不在 `docs/` 里，而在 ToucanShelf 知识库的「<workspace 名>」下，
通过 `toucanshelf` MCP 访问。

- 动手做架构性改动前，先用 `workspace_get_workspace_tree` 看目录结构，再 `memo_get_memo`
  读相关文档；不确定读哪篇时用 `rag_search` 检索。
- 需要更新文档时用 `memo_update_memo`，且必须先向我确认内容。
- 我在 agent 写作期间不会同时在 Web 端编辑同一篇文档（系统不做并发保护）。
```

最后一条是 ADR-5 的纪律要求，写进 CLAUDE.md 是为了让约定有个落点。

### 权限允许列表

默认每次 MCP 工具调用都弹权限确认，读文档时噪音很大。在 `~/.claude/settings.json` 或项目
`.claude/settings.json` 放开只读项：

```json
{
  "permissions": {
    "allow": [
      "mcp__toucanshelf__workspace_list_workspaces",
      "mcp__toucanshelf__workspace_get_workspace_tree",
      "mcp__toucanshelf__memo_get_memo",
      "mcp__toucanshelf__rag_search"
    ]
  }
}
```

**故意不放开 `memo_update_memo` / `memo_create_memo`** —— 写操作保留确认弹窗。

### 可选：斜杠命令

`.claude/commands/kb.md`（或 `~/.claude/commands/kb.md` 做成全局）：

```markdown
---
description: 从 ToucanShelf 知识库检索架构文档
---

用 toucanshelf MCP 检索知识库中与 "$ARGUMENTS" 相关的内容：
先 rag_search 定位，再 memo_get_memo 读全文，然后总结要点。
```

### 已知限制

- **`@` 引用不可用。** 本 MCP server 只声明 tools 能力，不提供 prompts 与 resources
  （见 [server/router/mcp/README.md](../../../server/router/mcp/README.md)），因此无法在输入框
  用 `@toucanshelf:<资源>` 挂载文档，只能通过自然语言驱动工具调用。
- **PAT 是全账号权限。** 当前 token 不带 scope，一个 PAT 等于整个账号的读写能力；`/mcp` 端点
  没有额外的权限收敛层，完全依赖 REST API 的既有授权。若要把 token 铺到多个项目目录，建议
  单独建一个只加入相关知识库的账号来发 token。
- **工作流提示已由服务端下发。** 正确路径 `list_workspaces → get_workspace_tree → get_memo`
  写在 P0 的 server instructions 里，客户端无需手工提示。但 instructions 的落地依赖客户端实现 ——
  部分 MCP 客户端会忽略该字段，这类客户端仍需在 `CLAUDE.md` 或系统提示里手工补上。

## 后续增量（不在本次范围）

见 requirement.md §6。按预估价值排序：

1. **编辑器软提示** —— 人类打开 `agent_session_open == true` 的文档时顶部提示"此文档有 AI 编辑
   且尚未经你确认"，不阻塞操作。flag 建好后近乎零成本。
2. **`folder_path` 进 CEL filter schema** —— 让 `memo_list_memos` 支持
   `folder_path.startsWith("架构/")` 一次批量捞取，省 round-trip；`RagService_Search` 的
   `filter` 同 grammar，一并受益。
3. **乐观并发控制** —— 若将来确有需要，走 `expected_content_hash` + 409 路线，**不要用锁**
   （ADR-5 已记录锁方案被否决的三条理由）。
