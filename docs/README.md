# docs/ 总索引

| 目录 | 面向 | 状态 |
|---|---|---|
| [dev/](dev/README.md) | 开发者：需求、设计与决策记录 | 维护中 |
| [manual/](manual/README.md) | 使用者：操作手册 | 维护中 |
| [identity-provider-bootstrap.md](identity-provider-bootstrap.md) | 使用者/运维：IdP 初始化 | 维护中 |
| [skill/](skill/SKILL.md) | agent：技能包 | 维护中 |
| [plans/](plans/) | —— | **归档，不再维护，不建议 agent 阅读** |
| [superpowers/](superpowers/) | —— | **归档，不再维护，不建议 agent 阅读**（另一套语料，与 `plans/` 无关） |

## `plans/` 归档说明

`plans/` 下按日期建目录，是上游 memos 工作流遗留的 `definition/design/plan/execution`
四件套语料。2026-07-03 及之后的 12 个目录已拆入 [dev/](dev/README.md)（进度见
[dev/design/20260808-plans-to-dev-migration.md](dev/design/20260808-plans-to-dev-migration.md)，
迁完即从 `plans/` 删除，原文留在 git history）。以下 6 个目录判定与本 fork 的增量能力无关
（上游通用能力，非本 fork 新增），**原地保留、不迁移**：

- `2026-03-23-memo-detail-outline`
- `2026-03-23-tag-blur-attribute`
- `2026-03-24-user-resource-identifiers`
- `2026-03-31-quick-voice-input`
- `2026-04-06-memo-mentions`
- `2026-04-21-sso-user-identity-linkage`

> `2026-04-21-sso-user-identity-linkage`：曾评估是否算本 fork 增量（因为它会牵出一个
> `identity/` 域），结论是**不算**——它描述的是 IdP 身份与本地用户名解耦这一通用 SSO
> 问题，不依赖本 fork 新增的任何能力，判定为上游范畴，随其余 5 个目录一并归档。
