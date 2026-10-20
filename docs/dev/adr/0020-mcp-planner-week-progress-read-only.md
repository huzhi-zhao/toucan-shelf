# 0020. MCP 加一个只读的每周习惯进度工具

## Context

[ADR 0010](0010-mcp-tool-whitelist-eight-tools.md) 把 MCP 工具收敛到知识库编写所需的最小集合，理由是
`tools/list` 在连接建立时注入模型上下文并常驻，每多一个工具都是每个会话都要付的成本。之后
`attachment_get_download_url` 加入，白名单是 9 个。

计划页（`PlannerService`）此前完全不在 MCP 上。现在有两个调用方要读它：

- toucan-base 的英语口语 Discord bot 扮演健身监督：每 30 分钟用 PAT 调 REST 接口，按每周进度提醒、周末评分。
- Claude Code 会话要能回答"这周、这个月履约得怎么样"。

两者要的都是"按周汇总的打卡事实"。客户端自己拼（`ListHabitVersions` + `ListPlannerEntries` + 自己划周）不可行：
周从哪天开始、一周内换计划时以哪个为准、待办带出的打卡算不算，这些规则在 app 里，调用方拼出来的数会和
app 上的"2/3"对不上。所以由服务端算，做成一个接口 `PlannerService.GetWeekProgress`
（`GET /api/v1/planner/weekProgress`）。为此，"每周第一天"这个设置从手机本地挪到了服务端
（`PlannerService.Get/UpdatePlannerSettings`），否则服务端无从知道。

## Decision

**白名单加入 `PlannerService_GetWeekProgress`，成为第 10 个工具 `planner_get_week_progress`，只读。**
计划的其他操作（建习惯、打卡、建待办、启用计划……）一律不进 MCP。

为什么只读：

- 计划是个人数据，由人在手机上写。agent 替人打卡就是在造假，收益为零。
- 这个工具的用途是"汇报事实"，不是"执行计划"。只读也让它不需要 `mcp:write` scope，只读连接就能用。
- 接口本身不判及格、达标。规则写在知识库的习惯计划文档里，随计划版本变；接口只把计划关联的文档
  （名字和标题）和这周的备忘带出来，判断交给调用方。工具描述里明说"facts only"，免得模型把计数当成评分。

上下文成本：`planner_get_week_progress` 的完整定义（描述 + input schema + output schema）约 **5.3 KB**，
input schema 只有 0.3 KB（`date`、`weeks` 两个参数）。加入前 9 个工具合计约 115 KB（大头是
`memo_create_memo` / `memo_update_memo`，各约 33 KB），加入后约 121 KB，增量约 5%。
（最初是 5.1 KB；2026-10-20 每周加了备忘 `notes`，output schema 多一个两字段的消息，+0.35 KB。
加它是因为计划规定记了"病""旅行 到 …"时 bot 要暂停提醒，而 bot 只调这一个接口。备忘原样返回，
接口不解析，仍然只给事实。）
`TestPlannerIsReadOnlyOverMCP` 把这个工具的定义钉在 8 KB 以内，并断言它是 GET、只读、计划只有这一个操作进 MCP。

`serverInstructions` 不加内容：工具名和描述已经说清用途，按 0010 的原则，常驻文字只放模型推不出来的东西。

## Consequences

- agent 能回答"这周/这个月计划完成得怎样"，bot 能拿到和 app 一致的周进度，都不必了解计划页的内部规则。
- 返回的消息结构（`WeekProgress` 等）成了对外契约：改字段要考虑 toucan-base 的 bot 和 MCP 会话。
- PAT 目前没有 scope，bot 用的 PAT 技术上能调所有接口。约定是 bot 只调这一个接口（见
  `docs/dev/requirements/planner-and-check-in.md` §2.4.3）；只读 PAT 留作以后单独做。
- 以后若要再开放计划的其他读接口，同样逐个评估上下文成本，不整体放开 `PlannerService`。
