# 0009. MCP 在线读写，与 memogit 互补而非替代

## Context

在本地用 Claude Code 开发项目时，有一类文档（架构决策、设计推演）本来就存在
ToucanShelf 知识库里，写代码时需要 agent 参考甚至更新它们。此前唯一的路是
memogit：为了读一篇文档要把整个知识库检出到本地，且检出内容落在代码仓库工作区
里会和这个仓库自己的 git 打架。

期望的形态是 agent 像访问网页一样在线读写知识库，不落盘、不产生本地文件、不碰
git，凭 PAT 鉴权。`server/router/mcp/` 已有一个可用的 MCP server（Streamable
HTTP、挂载 `/mcp`、透传 `Authorization: Bearer <PAT>` 复用既有 REST 鉴权），
传输层、鉴权、OpenAPI→工具转换都不需要重做。

## Decision

新增 MCP 通道用于"在线、零落盘"的读写；memogit 保留原职责，两者不是取代关系：

| | MCP | memogit |
|---|---|---|
| 落盘 | 否 | 是 |
| 与本地仓库 git 的关系 | 无接触 | 会冲突（本需求的痛点） |
| 适用 | 边写代码边查/改文档 | 离线、批量、要版本化导出 |

## Consequences

- agent 可以在不离开当前工作目录、不产生任何本地文件的情况下读写知识库文档。
- 两条通道各自演化，不需要互相兼容对方的数据格式（memogit 的本地文件格式、
  身份标记等完全不影响 MCP 路径）。
- 由此产生了"如何区分 MCP 写入与人类写入"的新问题，见
  [ADR-0012](0012-actor-kind-from-channel-not-identity.md)。
