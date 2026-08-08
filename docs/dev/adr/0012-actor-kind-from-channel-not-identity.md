# 0012. actor 判定依据请求通道，不是用户身份

## Context

MCP 请求携带的是作者本人的 PAT，`CreatorID` 与其网页登录时完全相同——靠用户
身份区分不了人类和 agent。要让
[ADR-0011](0011-agent-write-snapshots-human-baseline.md) 的自动快照逻辑工作，
必须有一个可靠信号判断"这次写入是 agent 发起的还是人类发起的"。

## Decision

判据是请求通道，不是请求携带的身份。`server/router/mcp/adapter.go` 在构造
in-process 请求时注入通道标记，服务端据此判定 actor kind。两条约束：

- 该标记必须由服务端内部注入，外部不得伪造，否则任何人都能伪装成人类写入以
  跳过快照。
- 保守默认：只有 `/mcp` 通道算 agent，其余一律算人类（含直接拿 PAT 打 REST
  API 的脚本）。误判成人类只会多产一个快照，误判成 agent 会漏掉基线——保守
  方向必须偏向前者。

**实现修订**：原定用 `req.Header.Set("X-Memos-Client", "mcp")` 传递标记，实测
不可行——`/api/v1/*` 走 grpc-gateway，默认 header matcher 会静默丢弃自定义头；
配 matcher 放行它，又会让外部客户端能设同名头，第一条约束就退化成纯约定。
最终改为把标记放在请求的 Go `context` 上（`internal/base.WithActorKind`）：
不过网络、key 为包内未导出类型，两条约束都由机制保证而非约定保证。

memogit 不直接访问 store，它的写入走 `UpdateMemo` API 且不带 MCP 标记 → 判为
人类。语义正确：memogit 推回来的是本地 git 里的人工内容。

## Consequences

- actor kind 的正确性完全依赖"谁能调用 `base.WithActorKind`"，而这只有
  in-process 的 MCP adapter 代码路径能做到——审计面很小，容易保证正确性。
- 任何新增的、绕过标准 HTTP 请求路径直接操作 store 的写入通道（未来若有），
  都需要显式决定它算 human 还是 agent，否则默认落到 human（安全但可能漏判）。
- 该标记只承担这一个语义（actor kind 判定），不得被复用为并发控制的锁，见
  [ADR-0014](0014-agent-session-open-not-a-lock.md)。
