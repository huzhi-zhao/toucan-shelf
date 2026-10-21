# 0021. bot 可以打卡：训练记录挂在打卡上，来源按凭证判定

## Context

[ADR 0020](0020-mcp-planner-week-progress-read-only.md) 定了计划只读：agent 替人打卡就是造假，bot 只调
`GetWeekProgress` 一个接口。

之后 toucan-base 的 Discord bot（Jen，当健身教练）实际用起来是这样的：用户去健身房，一边练一边在 Discord 里
跟 Jen 报"罗马尼亚硬拉 2.3 kg 15/12/12"，Jen 记下来、给建议。练完，这份记录写成 Markdown 存在 bot 那边，
和计划页上的打卡是两份东西：打卡要用户自己再去手机上点一次，训练明细在 app 里看不到，Jen 下次想看"上次臀推多重"
只能翻自己的文件。

这里 bot 不是在"替人打卡"：它记的是用户本人在会话里报的、刚发生的事，和用户自己点没有区别，只是少点一次。
0020 担心的造假，指的是 agent 在没有事实依据时自己决定"你今天算运动过"。

## Decision

**1. bot 可以打卡，训练记录挂在打卡上。**

- 一次训练 = 一个打卡（习惯 + 日期），打卡上带 `workout`：总时长 + 动作列表（名称、器械、重量 kg、每组次数、时长、
  设置、备注）。不按动作拆到不同习惯：去健身房整体算一次 💪，外面走路滑冰游泳算一次有氧，用户自己定挂哪个习惯。
- bot 在会话结束时整理好整份记录，**一次**调 `SetCheckIn` 上报，不是每做完一个动作报一条。
  `SetCheckIn` 本来就是按（习惯，日期）upsert，重发同一份结果不变，天然幂等；同一天第二次训练要带上完整列表。
  `workout` 不传表示不动它，传空的表示删掉。
- 不能提前打卡的规则照旧（服务端按 UTC+14 判"未来"）。
- 新增只读的 `ListWorkouts`（`GET /api/v1/planner/workouts`），按日期范围、习惯、动作名拉近期训练，
  供 Jen 回答"上次臀推多重"。`GetWeekProgress` 的每条打卡加上 `source` 和 `workout`，只加字段。

**2. 来源由服务端按凭证判定，调用方不能自报。**

打卡多一个 `source`：`MANUAL`（在 app 里点的）、`TODO`（完成待办带出的）、`AGENT`（用 PAT 或 MCP 打的）。
判据是请求用的凭证：app 用登录会话，bot 用 PAT。这和 [ADR 0012](0012-actor-kind-from-channel-not-identity.md)
的 actor kind 是两件事：0012 只把 `/mcp` 算 agent，是为了"漏判也只是多一个快照"的保守方向；计划这里要区分的是
"人在 app 里点的"和"程序打的"，PAT 直接打 REST 的脚本正是要标出来的那一类，所以 PAT 也算 agent。

权限跟着来源走：

- 用户在 app 里能看、能改、能删 agent 打的卡，日历上的按钮带 🤖 标记。
- bot 只能删 agent 打的卡。对用户自己打的卡（手动或待办带出的），bot 只能补上 `workout`，备注保持原样，
  来源不变——用户先在 app 上点了，练完 bot 再把明细挂上去，这是正常流程。
- 那天这个习惯挂着没完成的习惯待办时，bot 打卡就顺带完成这条待办（打卡记 `AGENT`）；bot 撤销这个打卡，
  待办重新打开。app 这边规则不变：有待办时只能在待办里完成。

**3. 只记事实，不判有效性。** 练没练够、算不算达标，和 0020 一样由调用方按计划文档判断。服务端只校验格式和
明显的垃圾值（最多 30 个动作、每个最多 30 组、重量 0～1000 kg 等）。

**4. 不加 MCP 工具。** Claude Code 会话要看训练，`planner_get_week_progress` 返回的打卡已经带 `workout`，
够回答"这周练了什么"。写入（`SetCheckIn`）不进 MCP：在 Claude Code 里没有教练会话这个场景，打卡还是由
app 或 bot 来做。`ListWorkouts` 也不进 MCP，等真有"跨很多周查某个动作"的需要再按 0010 的原则评估。

上下文成本：`planner_get_week_progress` 的完整定义从约 **5.5 KB** 涨到约 **6.9 KB**（+1.45 KB，output schema
多了 `Workout` / `WorkoutExercise` 两个消息和 `source` 枚举），仍在 `TestPlannerIsReadOnlyOverMCP` 的 8 KB 以内。
MCP 工具合计约 123 KB。

## Consequences

- 训练明细只存一份，在 ToucanShelf 里；bot 那边不再写 Markdown。app 打开打卡就能看、改动作。
- **bot 的 PAT 现在会写数据**。PAT 仍然没有 scope，技术上这个令牌能调所有接口（包括知识库的写接口），
  约束只是约定：bot 只调 `SetCheckIn` / `DeleteCheckIn` / `ListWorkouts` / `GetWeekProgress`。
  风险是令牌泄露后能改的不止计划。以后收窄的办法：给 PAT 加 scope（至少分"只读"和"只能写计划"），
  或者单独做一种只能访问 `PlannerService` 的令牌；做之前，泄露时立刻在设置里吊销这个 PAT。
- 打卡的 `source` 和 `workout` 成了对外契约，toucan-base 的 bot 依赖它们。
- 0020 里"计划只读、agent 打卡是造假、bot 只调一个接口"这几条被本 ADR 部分取代；MCP 上计划仍然只读。
