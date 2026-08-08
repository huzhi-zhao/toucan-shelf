# 0011. 版本快照绑定"人类最后交出的基线"，不做定时 pruning

## Context

`store/memo_history.go` 的机制本身是完整的：全文快照 + `content_hash`
（`HashMemoState`）+ 附件集快照 + `RestoreMemoHistory` 回滚，且无条数上限。但
`UpdateMemo` 里此前完全没有调用 `CreateMemoHistory`——版本只在人手动点"创建为
版本"时产生。纯人工写作时代这没问题；一旦 agent 能调 `memo_update_memo` 全量
覆盖 `content`，覆盖前的内容不留任何快照、直接消失，而且是必然发生而非偶发。

**被否决的诊断：换存储。** 曾考虑"SQLite/Postgres 不像 ES、MinIO 那样原生支持
文档多版本"，这个判断不成立：ES 的 `_version` 是乐观并发控制用的单调计数器，
更新时旧文档体直接被标记删除、不保留历史；MinIO/S3 的 object versioning 是真的
保留旧版本，但那是对象存储语义。文档版本历史在任何主流存储里都是应用层的事，
本项目应用层的表和 API 都已建好，缺的只是"写入时自动触发"这一个钩子。

**被否决的方案：每次写入都快照 + 按保留最近 N 个/时间窗 pruning。** 否决理由：
一篇长文档被 agent 反复迭代十几次就是十几份全文副本；"留最近 N 个"的 N 个里
可能全是 agent 的中间态，真正想回退的那个人类版本反而被挤掉；还需要引入保留
策略参数和清理任务。

## Decision

快照不是"每次写入的备份"，而是"人类作者最后交出的状态"：

```
写入 memo M，写入方 A：

A 是 agent：
  M 当前内容由人类写的 → 先快照当前内容（这就是基线），置位 agent_session_open
  M 当前内容由 agent 写的 → 直接覆盖，不产快照

A 是人类：
  直接写，清除 agent_session_open（本身不产快照）
```

快照数量 = 人类编辑会话数，与 agent 迭代次数无关。触发快照与翻转 flag 的是
**authorship 字段**：`content` 和 `title`（`isAuthorshipField`）。归档、置顶、
换文件夹、调视图开关不算——那是归档和装饰，不是创作；在那里清 flag 会让下一次
agent 写入把 agent 自己的产出当成人类基线快照下来。

`title` 计入的理由：标题是文档的名字（memogit 落盘时就是文件名），被 agent
改掉且无版本可回，损失性质与内容丢失同类。已知且接受的角落：
`HashMemoState` 只覆盖 content + 附件集，不含 title，因此"人类只改标题 →
内容一字未动 → agent 再写内容"这条路径上，去重会命中已有版本而跳过快照，
人类那次改的标题不被记录。要堵上就得把 title 并入 hash，会让存量所有
`content_hash` 失效并改变 `RestoreMemoHistory` 的前置校验语义，为一次改名
不值得。

人类的编辑不立即产生版本，只在 agent 真的要动它时才被快照下来（惰性捕获）。
纯人工写作、agent 从未介入的文档，零版本开销。

会话过期不处理：若 agent 连续编辑数周而无人介入，唯一还原点就是数周前的人类
状态，中间不可回溯。这是设计的固有取舍，明确接受，不引入时间阀门。

## Consequences

- 版本数量天然有界，等于人类编辑会话数，不需要任何清理任务。
- agent 生成的中间版本丢失是可接受的——相同提示词大致能重新得到，人类的编辑
  不可重来。
- `RestoreMemoHistory`（人类回滚）必须显式清除 `agent_session_open`，否则
  下次 agent 写入会跳过快照——这条路径已核对代码，`memo_history_service.go`
  在回滚时显式清零，不是遗留 bug。
- 后台 payload 重建逻辑必须保持"原地修改已加载 payload"而非整体替换，否则会
  静默冲掉这个 bit；这是一条隐性的实现约束，需要注释和测试钉住。
