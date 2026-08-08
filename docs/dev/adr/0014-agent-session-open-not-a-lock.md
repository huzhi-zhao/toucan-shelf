# 0014. `agent_session_open` 不得被复用为并发锁

## Context

承 [ADR-0013](0013-no-optimistic-concurrency-control.md)：曾考虑把
`agent_session_open` 这个已有的 bit 兼职当一把简易的编辑锁（agent 编辑期间
禁止人类提交），被否决——理由是它没有生命周期、MCP 是无状态的没有可靠释放点、
且锁的方向本身就选错了边（见 ADR-0013 的详细论证）。

`proto/store/memo.proto` 里这个字段目前只承担一个语义：当前内容是否由 agent
写入，用于决定下次 agent 写入前是否需要先留存人类基线快照
（[ADR-0011](0011-agent-write-snapshots-human-baseline.md)）。

## Decision

**`agent_session_open` 只承担版本快照判据这一个语义，不得被复用为锁或其他
并发控制机制。** proto 定义里显式注释这一点。将来无论上 hash 校验
（`expected_content_hash`，ADR-0013 指向的方向）还是别的并发机制，都必须使用
独立的状态字段，不能与这个 bit 混用。

## Consequences

- 任何未来给这个字段追加"顺便也当锁用"之类逻辑的改动，都违反本决策，应在
  code review 中被拒绝。
- 并发控制若要落地，需要新增字段/表，不能省这一步——这是刻意的隔离成本，
  换来两件事故障域分离：版本快照逻辑不会被并发控制的边界情况牵连，反之亦然。
- 这条决策本身没有直接的功能收益，纯粹是给后来者立一条"不要偷懒复用"的护栏，
  价值体现在预防未来的一次不易察觉的耦合。
