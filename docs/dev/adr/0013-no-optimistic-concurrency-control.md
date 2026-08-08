# 0013. 本期明确不做乐观并发控制

## Context

agent 经 MCP 写入知识库文档时，理论上存在这条竞态：

```
agent 读到 v1  →  人在网页上把文档改成 v2  →  agent 基于 v1 全量写回  →  v2 被覆盖
```

有 [ADR-0011](0011-agent-write-snapshots-human-baseline.md) 的自动快照兜底
时，v2 有可能已被快照（若 agent 此前未持有会话）而可恢复；但在 agent 会话已
开启的情况下（`agent_session_open == true`），人类的 v2 会被静默覆盖且不产生
快照。

**被否决的替代方案：编辑锁（agent 编辑期间禁止人类提交）。** 否决理由有三：

1. `agent_session_open` 没有生命周期——它的语义是"一直为真，直到人类编辑"。
   当作锁用，agent 编辑一次后永久持有，唯一能解锁的动作恰恰是人类编辑——死锁。
   当锁用必须另设带 TTL 的短期状态，不能复用这一位。
2. MCP 是无状态的，没有可靠释放点：MCP server 跑在 stateless 模式、不做
   session 跟踪，每次 `memo_update_memo` 都是孤立请求，agent 可能读完思考数
   分钟再写，也可能压根不写（用户中断、进程崩溃、模型自行决定不改）。锁残留
   是常态而非异常，最终必然要加 TTL、续租、强制解锁 UI，机制只会越滚越大。
3. 它锁错了一边：人类的编辑是权威，agent 的中间产物可重新生成。冲突时该输的
   是 agent，锁住人类去保护 agent 把优先级弄反了。

## Decision

**不实现 `expected_content_hash` 之类的并发校验。** 本期的正确性依赖作者
纪律——不要在 agent 写作期间同时在 Web 端修改同一篇文档。若如此操作，属于
不建议的用法，风险自负。

对比之下，`expected_content_hash` 路线（`HashMemoState` 已现成、加一个可选
字段、不匹配返 409、输的天然是 agent）比锁更廉价。**将来若要做并发控制，应走
hash 校验路线，而不是锁**——这是留给未来的方向性结论，不是本期要做的事。

## Consequences

- 已知且已接受的风险缺口：agent 会话已开启时，人类的并发编辑可能被静默覆盖
  且不产生快照。文档中需如实说明（见
  [mcp-authoring.md](../requirements/agent-collab/mcp-authoring.md) §8）。
- 不需要引入任何新状态、TTL、续租或解锁 UI。
- `agent_session_open` 保持单一语义（版本快照判据），不承担并发控制职责，见
  [ADR-0014](0014-agent-session-open-not-a-lock.md)。
- 未来若要补上并发控制，方向已定为 hash 校验而非锁，减少将来重新评估的成本。
