# Agent 经 MCP 协作写作（MCP Agent Authoring）

状态：设计确认，待开发
关联：修订 [2026-07-12 文档版本历史](../2026-07-12-memo-version-history/01-memo-version-history.md)
中"不做自动快照"的结论；与 [memogit CLI](../2026-07-13-memogit-cli/) 互补而非替代。

## 1. 需求背景

在本地用 Claude Code 开发项目时，有一类文档（架构决策、设计推演）不适合放进代码仓库的
`docs/`，它们本来就存在 ToucanShelf 知识库里。但写代码时又需要 CC 参考甚至更新这些文档，
目前只有 memogit 一条路：

- **太重** —— 为了读一篇文档要把整个文件夹拉到本地。
- **和本地仓库的 git 冲突** —— 拉下来的知识库内容落在代码仓库的工作区里，两套版本控制打架。

期望的形态是：**CC 像访问网页一样在线读写知识库，不落盘、不产生本地文件、不碰 git**，
凭 PAT 鉴权。

## 2. 结论：MCP 能承载，且基础设施已具备

[server/router/mcp/](../../../server/router/mcp/) 已有一个可用的 MCP server：Streamable HTTP
传输、挂载在 `/mcp`、把调用方的 `Authorization: Bearer <PAT>` 透传给内部 REST API 复用既有
鉴权（见该目录 [README.md](../../../server/router/mcp/README.md)）。传输层、鉴权、
OpenAPI→工具的转换都不需要重做。

需要留意的出身问题：这套 MCP 是**上游 memos 带来的**（`777d227e feat: add OpenAPI-driven MCP
support (#6026)`），本仓库此后只做过三个小修（反代支持、可发现性、create_attachment）。
它的工具选型建立在"memos 是个社交化速记应用"的假设上，与本项目当前的知识库定位已经脱节 ——
这是下面 ADR-2 的由来。

## 3. 需求范围

1. **精简 MCP 工具集**，从当前 20 个"速记 + 社交"工具收敛为 8 个知识库工具，补齐知识库导航
   能力（workspace 列表 / 目录树 / RAG 检索）。
2. **写入前自动留存人类基线快照**，使 agent 的覆盖写不会造成人类内容不可恢复。
3. **客户端接入方式**的固化（注册、提示、权限）。

明确不在本期范围：乐观并发控制（见 ADR-5）、`folder_path` 过滤（见 §6）。

---

## ADR-1：MCP 在线读写，与 memogit 互补而非替代

**决策**：新增 MCP 通道用于"在线、零落盘"的读写；memogit 保留原职责。

两者的适用区间是分开的，不存在取代关系：

| | MCP | memogit |
| --- | --- | --- |
| 落盘 | 否 | 是 |
| 与本地仓库 git 的关系 | 无接触 | 会冲突（本需求的痛点） |
| 适用 | 边写代码边查/改文档 | 离线、批量、要版本化导出 |

## ADR-2：工具集从 20 精简到 8

**先纠正一个数**：`curatedOperationIDs`（[catalog.go](../../../server/router/mcp/catalog.go)）
实际是 **20** 个，不是 README 表格暗示的 21 个。

当前 20 个按用途拆开：

| 类别 | 数量 | 对本场景 |
| --- | --- | --- |
| 文档 CRUD（list / create / get / update / delete memo） | 5 | ✅ 核心 |
| 附件（4 个 attachment + 2 个 memo 挂载） | 6 | 🟡 偶尔 |
| 评论（list / create comment） | 2 | ❌ |
| 表情反应（list / upsert / delete reaction） | 3 | ❌ |
| 文档关联（list / set relations） | 2 | 🟡 |
| 快捷筛选（shortcut） | 1 | ❌ |
| whoami | 1 | 🟡 |

**决策**：白名单重写为下列 8 项。

```
workspace_list_workspaces      # 有哪些知识库
workspace_get_workspace_tree   # 目录结构（含文件夹树与文档）
rag_search                     # 语义 / 关键词检索
memo_list_memos                # 按条件批量捞
memo_get_memo                  # 读全文
memo_create_memo               # 新建
memo_update_memo               # 修改
auth_get_current_user          # 定位自身
```

三个新增项（`WorkspaceService_ListWorkspaces`、`WorkspaceService_GetWorkspaceTree`、
`RagService_Search`）的 operationId **已存在于生成的 `proto/gen/openapi.yaml`**（分别在
2856 / 3074 / 1596 行），所以不需要改 proto、不需要 `buf generate`。

两条理由：

- **可用性** —— 缺了 workspace 树，agent 根本没有"按文件夹定位文档"的能力，而这正是原始
  痛点。原白名单里没有任何一个 workspace 或检索类工具。
- **context 成本** —— `tools/list` 的结果在连接建立时注入模型上下文并**常驻**，不是调用时
  才加载。而这些 schema 由 OpenAPI 自动推导，相当冗长：单是 `Memo` 这一个 schema 组件在
  `proto/gen/openapi.yaml` 里就占 **7.4 KB**，且内部 `$ref` 的 Attachment / Reaction /
  Relation 等会被展开成 `$defs` 一并塞进工具的 input schema。带完整 Memo 结构的工具有多个，
  实际开销远不止"20 行文字"。

**`memo_delete_memo` 被刻意剔除**：赋予 agent 删除文档的能力，收益接近零，风险不低。

### 补充：白名单只能限到 operation 粒度，字段粒度要另外做

工具白名单是**按 OpenAPI operation 挑的**，而 `MemoService_UpdateMemo` 的 schema 是
`updateMask`（任意字段列表）+ 完整 `Memo` body。所以放行这一个 operation，等于放行了整个更新面
的 19 条 mask 路径 —— 包括 `visibility`（能把私有文档改成 PUBLIC）和 `update_time`（改小会让
memogit 增量同步永远拉不到这篇文档）。

也就是说"没有删除工具"这个保证，在只做 operation 级白名单时是**不成立的**。

**决策**：在 `UpdateMemo` 内按 `base.ActorKindFromContext(ctx).IsAgent()` 加一层
**字段白名单**（`agentWritableFields`，见 [memo_agent_baseline.go](../../../server/router/api/v1/memo_agent_baseline.go)），
放行 authorship（`content` / `title`）与 placement（`folder_path` / `workspace` / `state` /
`pinned`），其余一律 `PermissionDenied`。

三点说明：

- **是白名单不是黑名单。** `updateMask` 会随功能增长，黑名单对每个新字段默认放行，白名单默认
  拒绝 —— 与本设计一贯的保守取向一致（ActorKind 零值取 human、payload 零值取"待快照"）。
- **归档与移动被判定为可接受**：原文档没有丢失，且人工一步可逆。`state` 因此在放行列表里，
  这意味着 agent 能归档文档（从目录树消失），instructions 里对此如实说明。
- **落点只能在 `UpdateMemo` 内。** MCP tool 打的就是 `/api/v1/memos/{id}` 这一个 PATCH，与
  Web 端同一条链路，不存在独立的"MCP 专用 update 接口"可改。

**保持 curated 的设计意图**：不要因为"顺手"把 secret block、IDP、instance 管理之类加进来。
全量导出 OpenAPI 会有上百个 operation，光工具定义就能吃掉数万 token。

## ADR-3：版本快照绑定"人类基线"，不做 pruning

### 问题

[memo_history](../../../store/memo_history.go) 的机制本身是完整的：全文快照 +
`content_hash`（SHA-256 of 内容 + 附件集，`HashMemoState`）+ 附件集快照 + `RestoreMemoHistory`
回滚，且无条数上限。

但 **`UpdateMemo` 里完全没有调用 `CreateMemoHistory`** ——
[memo_history_service.go](../../../server/router/api/v1/memo_history_service.go) 的注释写得很
直白："saves a **manual** snapshot"。版本只在人手动点"创建为版本"时产生。

在纯人工写作时代这没问题。一旦 agent 能调 `memo_update_memo` 全量覆盖 content，
**覆盖前的内容不留任何快照、直接消失**，而且是必然发生而非偶发。

### 被否决的诊断：换存储

曾考虑"SQLite / Postgres 不像 ES、MinIO 那样原生支持文档多版本"。这个判断不成立，记录在此
以免重复讨论：

- **ES 也不支持文档多版本。** `_version` 是乐观并发控制用的单调计数器，更新时旧文档体直接被
  标记删除、不保留历史；要历史得自己另建索引。
- MinIO / S3 的 object versioning 是真的保留旧版本，但那是对象存储语义。

文档版本历史在任何主流存储里都是**应用层的事**。本项目应用层的表和 API 都已建好，缺的只是
"写入时自动触发"这一个钩子。**不需要换存储，也不需要引入新组件。**

### 被否决的方案：自动快照 + pruning

"每次写入都快照，再按保留最近 N 个 / 时间窗合并来清理"。否决理由：

- 一篇长文档被 agent 反复迭代十几次就是十几份全文副本。
- pruning 是"留最近 N 个"，这 N 个里可能全是 agent 的中间态，**真正想回退的那个人类版本反而
  被挤掉**。
- 需要引入保留策略参数和清理任务。

### 采纳的方案：快照 = 人类作者最后交出的基线

快照不是"每次写入的备份"，而是"人类作者最后交出的状态"。规则：

```
写入 memo M，写入方 A：

A 是 agent：
  M 当前内容由人类写的 → 先快照当前内容（这就是基线），置位会话标记
  M 当前内容由 agent 写的 → 直接覆盖，不产快照

A 是人类：
  直接写，清除会话标记（本身不产快照）
```

**快照数量 = 人类编辑会话数，与 agent 迭代次数无关。** agent 改 50 次还是 1 次，都只留那一个
人类确认过的版本。

这比 pruning 好的地方不只是省空间，是**每个自动快照都有语义** —— 都是一个你真的会想回去的
点，天然有界，不需要任何清理任务。

作者的原始意图记录在此：**不为 agent 编写的内容创建版本，只在"有人类内容且 agent 要介入
修改"时创建。** agent 生成的中间版本丢失是可接受的 —— 相同提示词大致能重新得到，
而人类的编辑不可重来。

### 什么算"写入"：authorship 字段，不只是 content

触发快照与翻转 flag 的是 **authorship 字段**：`content` 和 `title`。归档、置顶、换文件夹、
调视图开关都不算 —— 那是归档和装饰，不是创作；在那里清 flag 会让下一次 agent 写入把 agent
自己的产出当成人类基线快照下来。

`title` 计入的理由：标题就是文档的名字（memogit 落盘时它就是文件名），被 agent 改掉且无版本
可回，损失性质与内容丢失同类。

**已知且接受的角落**：`HashMemoState` 只覆盖 content + 附件集，不含 title。因此"人类只改标题
→ 内容一字未动 → agent 再写内容"这条路径上，去重会命中已有版本而跳过快照，人类那次改的标题
不被任何版本记录。要堵上就得把 title 并入 hash，那会让**存量所有 `content_hash` 失效**并改变
`RestoreMemoHistory` 的前置校验语义，为一次改名不值得。主场景（agent 改人类文档的标题）已由
上面的规则覆盖。

### 人类编辑是惰性捕获的

人类的编辑**不立即产生版本**，只在 agent 真的要动它时才被快照下来。因此：纯人工写作、
agent 从未介入的文档，**零版本开销**。这符合原始设想。

### 走查作者提出的关键序列

| 步骤 | 动作 | 建版本？ | flag |
| --- | --- | --- | --- |
| 0 | 人类创建文档写两句 | 否 | `false` |
| 1 | agent 接手 | ✅ V1 = 人类那两句 | → `true` |
| 2 | agent 再改 3 次 | 否 | `true` |
| 3 | **人类修改提交** | **否** | **→ `false`** |
| 4 | agent 再次介入 | ✅ V2 = 步骤 3 的人类内容 | → `true` |

作者的疑问是："步骤 3 没有产生版本记录，步骤 4 的 agent 怎么知道该建版本？"

**答案：判断依据不在版本历史里，而在文档自身的一个 bit 上。** 如果靠"翻 histories 表看上一个
版本是谁建的"来决策，这个死锁确实成立；而 `agent_session_open` 是**每次写入都更新的，与建不
建版本无关**。步骤 3 虽不建版本，但它把 flag 清了，步骤 4 读到 `false` 即知当前内容是人写的。

### 会话过期不处理

若 agent 连续编辑数周而无人介入，唯一还原点就是数周前的人类状态，中间不可回溯。**这是设计的
固有取舍，明确接受**，不引入时间阀门（那会多一个需要调的参数，而是否真痛只有用起来才知道）。

## ADR-4：actor 判定依据是「通道」而非「用户身份」

**MCP 请求携带的是作者本人的 PAT，`CreatorID` 与其网页登录时完全相同** —— 靠用户身份区分不了
人类和 agent。

**决策**：判据是请求通道。[adapter.go](../../../server/router/mcp/adapter.go) 在构造 in-process
请求时注入通道标记，服务端据此判定 actor kind。两条约束：

- **该标记必须由服务端内部注入，外部不得伪造**，否则任何人都能伪装成人类写入以跳过快照。
- **保守默认：只有 `/mcp` 通道算 agent，其余一律算人类**（含直接拿 PAT 打 REST API 的脚本）。
  误判成人类只会多产一个快照，误判成 agent 会漏掉基线 —— 保守方向必须偏向前者。

> **实现修订（P1 落地时）**：原定用 `req.Header.Set("X-Memos-Client", "mcp")`，实测不可行 ——
> `/api/v1/*` 走 grpc-gateway，默认 header matcher 会静默丢弃自定义头；而配 matcher 放行它，
> 又会让外部客户端能设同名头，第一条约束就退化成纯约定。最终改为把标记放在请求的 Go context
> 上（`internal/base.WithActorKind`）：不过网络、key 为包内未导出类型，两条约束都由机制保证。
> 详见 [tech-design.md](./tech-design.md) P1。

memogit 不直接访问 store，其写入走 UpdateMemo API 且不带 MCP 标记 → 判为人类。语义正确：
memogit 推回来的是本地 git 里的人工内容。

## ADR-5：本期明确不做乐观并发控制

**决策：不实现 `expected_content_hash` 之类的并发校验。本期的正确性依赖作者纪律 ——
不要在 agent 写作期间同时在 Web 端修改同一篇文档。**

作者判断：现实中作者不应当一边在 Web 上编辑、一边命令 agent 创作；若如此操作属于不建议的用法，
**风险自负**。

需要如实记录未做此项后残留的风险，以便将来评估：

```
agent 读到 v1  →  人在网页上把文档改成 v2  →  agent 基于 v1 全量写回  →  v2 被覆盖
```

有 ADR-3 的自动快照兜底时，v2 **有可能**已被快照（若 agent 此前未持有会话）而可恢复；但在
agent 会话已开启的情况下，人类的 v2 会被静默覆盖且不产生快照。这是本期已知且已接受的缺口。

### 被否决的替代方案：编辑锁（agent 编辑期间禁止人类提交）

曾提议"最低成本做 flag 的同步锁：有 agent 编辑时不允许人类提交修改"。否决，理由有三：

1. **flag 没有生命周期。** `agent_session_open` 的语义是"一直为真，直到人类编辑"。当作锁则
   agent 编辑一次后**永久持有**，而唯一能解锁的动作恰恰是人类编辑 —— 死锁。当锁用必须另设
   带 TTL 的短期状态，不能复用这一位。
2. **MCP 是无状态的，没有可靠释放点。** MCP server 跑在 stateless 模式、不做 session 跟踪，
   每次 `memo_update_memo` 都是孤立请求。agent 可能读完思考数分钟再写，也可能压根不写
   （用户中断、进程崩溃、模型自行决定不改）。**锁残留是常态而非异常**，最终必然要加 TTL、
   续租、强制解锁 UI，机制只会越滚越大。
3. **它锁错了一边。** 人类的编辑是权威，agent 的中间产物可重新生成。冲突时该输的是 agent。
   锁住人类去保护 agent，把优先级弄反了。

对比之下 `expected_content_hash` 反而更廉价（`HashMemoState` 已现成、加一个可选字段、不匹配
返 409、输的天然是 agent）。因此**将来若要做并发控制，应走 hash 校验路线，而不是锁**。

## ADR-6：`agent_session_open` 不得被复用为锁

承 ADR-5。该 bit 只承担版本语义。将来无论上 hash 校验还是别的并发机制，都必须使用独立状态，
避免两件事互相绊住。

---

## 4. 数据模型

会话标记落在 [proto/store/memo.proto](../../../proto/store/memo.proto) 的 `MemoPayload`：

```protobuf
// 当前内容是否由 agent（MCP 通道）写入。人类写入时清零。
// 用于决定 agent 写入前是否需要留存人类基线快照。
// 注意：这不是锁，不得用于并发控制（见 requirement.md ADR-6）。
bool agent_session_open = 9;
```

选 `MemoPayload` 而非新增列的理由：它是 JSON 列，**三个数据库驱动都不需要写迁移**。该 bit
不参与任何查询过滤，放 payload 没有代价。

**零值恰好是安全方向**：`bool` 零值 `false` = "当前内容是人写的"。老文档没有该字段、字段刚上线、
序列化丢失，都会退化成"下次 agent 写入时建一个快照"，最坏结果是多一个快照，不会丢数据。

`CreateMemo` 时同理：人类创建 → `false`；agent 经 MCP 创建 → `true`（全新文档没有人类内容需要
保护，后续 agent 迭代不应产生快照）。

## 5. 写入路径审计

flag 必须在**所有**人类写入路径上被清除。漏掉任何一条，flag 会停在 `true`，agent 下次写入时
跳过快照 —— 静默丢数据，且最难发现。当前树里 `Store.UpdateMemo` 的全部 4 个调用点：

| 调用点 | 改内容？ | 处置 |
| --- | --- | --- |
| [memo_service.go](../../../server/router/api/v1/memo_service.go) `UpdateMemo` API | ✅ | **唯一的正经咽喉点**，flag 主逻辑放这 |
| [memo_update_helpers.go](../../../server/router/api/v1/memo_update_helpers.go) `touchMemoUpdatedTimestamp` | ❌ 只动 `UpdatedTs` | 无需处理 |
| [memo_history_service.go](../../../server/router/api/v1/memo_history_service.go) `RestoreMemoHistory` | ✅ | ⚠️ **必须显式清除 flag** |
| [runner.go](../../../server/runner/memopayload/runner.go) 后台 payload 重建 | ❌ 内容不变 | 安全，但脆（见下） |

**RestoreMemoHistory 是唯一真实存在的 bug 点。** 它只写 `Content`、不碰 `Payload`。人类回滚
文档是不折不扣的人类编辑，但 flag 会停在 `true` —— 下次 agent 写入直接覆盖、不建版本。

**后台 payload 重建目前安全，但依赖实现细节。** 它写入整个 `Payload` 字段，看似会冲掉
`agent_session_open`；实际不会，因为 `RebuildMemoPayload` 是在**已加载的 payload 上原地修改**，
只覆盖 `Tags` 和 `Property`。也就是说其正确性依赖"原地修改而非重建对象"这一点 —— 哪天有人
改成 `memo.Payload = &storepb.MemoPayload{...}` 就会静默破坏版本机制。需要注释 + 测试钉住。

## 6. 已评估但本期不做

- **乐观并发控制** —— 见 ADR-5，依赖作者纪律。
- **`folder_path` 进 CEL filter schema** —— [internal/filter/schema.go](../../../internal/filter/schema.go)
  的 memo schema 目前没有 `folder_path` 字段（尽管 memo 表有这一列），所以 `memo_list_memos`
  无法按文件夹路径批量捞文档。`workspace_get_workspace_tree` 已能覆盖主要场景，此项推迟；
  若将来做，`RagService_Search` 的 `filter` 用同一套 grammar，会一并受益。
- **路径寻址的复合工具**（如 `doc_read(path="架构/存储层设计")`）—— 现有架构是
  "tool ≡ OpenAPI operation"的严格映射，做复合工具需新增 `MemoService_GetMemoByPath` RPC，
  成本明显偏高。先观察 agent 是否真的在多跳上浪费过多再议。
- **编辑器软提示** —— 人类打开 `agent_session_open == true` 的文档时，顶部显示"此文档有 AI
  编辑且尚未经你确认"。不阻塞任何操作。flag 建好后近乎零成本，可作为后续增量。

## 7. 对既有计划的修订

[2026-07-12 文档版本历史](../2026-07-12-memo-version-history/01-memo-version-history.md) 明确
写了"不做自动/定时快照，只能手动创建"和"不做版本数量上限/清理策略，数据量由用户自己控制
（因为是手动创建，天然可控）"。

本计划**部分推翻前者**：新增一类由 agent 写入触发的自动快照。

但**后者的结论依然成立，且理由不变** —— 因为 ADR-3 的规则把快照数量绑定在人类编辑会话数上，
而非写入次数上，"天然可控"这个前提没有被破坏。这正是选择该方案而非 pruning 的核心原因。

手动命名版本的行为完全不变，与自动基线快照在版本列表中通过 `display_name` 区分。
