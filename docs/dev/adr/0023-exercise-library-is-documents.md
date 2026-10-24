# 0023. 动作库就是攻略文档：训练动作用 `doc` 关联文档，文档就是动作的身份

## Context

[ADR 0021](0021-bot-checks-in-with-workouts.md) 把训练记录挂在打卡上，[ADR 0022](0022-bot-plans-workouts-on-habit-todos.md)
把计划训练挂在习惯待办上，两处的动作（`WorkoutExercise`）都只有自由文本的 `name`。用起来发现同一个动作每次叫法不同：
"Hip thrust" / "Bench hip thrust"，"One-arm dumbbell row" / "Single-arm dumbbell row"。Jen 回答"上次臀推多重"只能按名字
模糊搜（`ListWorkouts?exercise=`），叫法一换就漏。

与此同时，用户已经在 Life 知识库 `Health/Exercises/` 下给每个动作写了一篇攻略（要点、常见错误、起始量、视频），一个动作一篇，
frontmatter 带 `kind: exercise`、`group`、`aliases`。

## Decision

**1. 攻略文档就是动作库，文档就是动作的身份。** 不另建动作表。`WorkoutExercise` 加可选的 `doc`（`memos/{uid}`），
打卡和计划共用这个结构，两处都有。`name` 保持必填、自由文本，每次怎么叫都行；认动作看 `doc`。

- 动作要有的说明、别名、分组本来就在文档里，用户在知识库里维护；另建一张动作表就是同一份东西存两处。
- memo 的 uid 在移动、改名后不变，适合做身份。
- 存储上 `doc` 只是训练 JSON 里的一个字段（存 uid），不需要迁移。

**2. 写入时校验，不合法就 400，不静默丢弃。** `doc` 必须是调用者自己的、存在、未归档的文档。
别人的文档和不存在的文档报同一个错，不泄露存在性。服务端**不**检查 `kind: exercise`：那是 app 列动作库时的筛选条件，
服务端去解析 frontmatter 会把"文档内容"变成"接口能否写入"的前提，用户改个 frontmatter 就让 bot 写不进去。

**3. 已经挂着的 `doc` 不随文档归档失效。** 文档后来被归档或删除，已存的 `doc` 原样保留、原样返回，app 上动作名变成普通文字。
重新保存同一份训练记录时（app 每次改动都整份存回，bot 也是整份替换），这份记录里原来就挂着的 `doc` 跳过校验，
否则用户改不了同一次训练里的别的动作。新挂一个归档文档仍然拒绝。

**4. 查询按 `doc`。** `ListWorkouts` 加 `doc` 参数，只返回含这个动作的打卡；`exercise` 参数照旧，给没关联文档的记录用。

**5. app 两种点法。** 有 `doc` 的动作，名称带链接样式，点名称打开攻略，点其余地方或 › 进编辑页；没有的和以前一样。
编辑页可以从动作库选（`kind: exercise` 的文档按 `group` 分组，搜标题和别名），选了填 `doc`、默认名称填文档标题。

**6. 不做的。** 不按名字自动猜 `doc`（旧数据由 toucan-base 按 `aliases` 回填，猜错的代价是一条训练算到别的动作上，
而回填方能在聊天里跟用户确认）；不做按动作的统计图；MCP 不变（写入和 `ListWorkouts` 本来就不进 MCP，
`planner_get_week_progress` 的动作自然带上 `doc`）。

## Consequences

- `WorkoutExercise.doc` 和 `ListWorkouts` 的 `doc` 参数成了对外契约，toucan-base 的 bot 依赖它们。
- 动作库是"用户自己的、`kind: exercise` 的文档"，没有服务端概念；以后要支持别人共享的动作库，得放宽第 2 条的"自己的"。
- 计划里挂了一篇后来归档的文档时，"按计划填"到新打卡会被拒（新打卡没有原来挂着的 `doc`）。少见，先接受；
  要解决可以让新打卡也认那天习惯待办计划里的 `doc`。
- `planner_get_week_progress` 的 MCP 定义多了 `doc` 字段的说明，仍在 `TestPlannerIsReadOnlyOverMCP` 的上限以内。
