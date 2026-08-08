# docs/plans → docs/dev 迁移：分阶段实施计划

把 `docs/plans/` 下 2026-07-03 及之后的 12 个方案目录，按 [../README.md](../README.md)
的两类性质（常青 / 事件）拆进 `requirements/`、`design/`、`adr/`、`launch/`。

工作量约 3600 行旧文，**明确设计成多会话分步执行**：§5 的任务表标了依赖与可并行组，
每个任务自带输入、产出与验收，单独一个会话就能认领并完成。

> **进度不写在本文档里**（[../README.md](../README.md) 第三节）。每个任务完成的唯一信号是
> 一个前缀为 `docs(dev):` 的 commit，见 §6。查当前进度用 `git log --oneline -- docs/dev`。

---

## 1. 前提：一条要先推翻的旧规矩

[../README.md](../README.md) 目前写着「2026-08-07 之前的方案文档……是既成事实，
**不迁移、不改写**」。本计划推翻这句，**T0 第一件事就是改掉它**，否则规范自相矛盾。

同时 `docs/README.md` **尚不存在**（只有 `docs/manual/README.md` 与 `docs/dev/README.md`），
归档标记需要新建这份 docs 总索引。

## 2. 范围

**迁走（12 个目录 ＋ 2 篇散落，26 篇 md）**

`2026-07-03-hierarchical-notes` · `2026-07-04-media_pdf` · `2026-07-06-gallery-view` ·
`2026-07-12-calendar-callout` · `2026-07-12-memo-version-history` · `2026-07-13-memogit-cli` ·
`2026-07-16-rag-search` · `2026-07-19-sheets-block` · `2026-07-30-secret-block` ·
`2026-07-31-mcp-agent-authoring` · `2026-08-03-obsidian-kb-migration` ·
`2026-08-04-standalone-local-deploy`，加 `docs/2026-07-12-rag-requirement.md` 与
`docs/2026-07-12-rag-tech-design.md`。

**原地归档（6 个目录，23 篇）**

`2026-03-23-memo-detail-outline` · `2026-03-23-tag-blur-attribute` ·
`2026-03-24-user-resource-identifiers` · `2026-03-31-quick-voice-input` ·
`2026-04-06-memo-mentions` · `2026-04-21-sso-user-identity-linkage`。

这 6 个是上游 memos 工作流生成的 `definition/design/plan/execution` 四件套，
与本 fork 的增量能力无关。`docs/plans/` 与 `docs/superpowers/` 整体标为
**归档、不再维护、不建议 agent 阅读**。

> **一处待确认的边界**：`2026-04-21-sso-user-identity-linkage` 按上述理由归入保留，
> 若判定它属于本 fork 增量，则需迁走并带出一个 `identity/` 域（连同
> `2026-03-24-user-resource-identifiers` 与 `docs/identity-provider-bootstrap.md`）。
> 开工前确认，不要在执行中途改。

**不动**：`docs/superpowers/`（另一套语料）、`.claude/worktrees/` 下的仓库副本。

## 3. 目标域

| 域 | 覆盖 | 篇数 |
|---|---|---|
| `knowledge-base/` | 层级目录与 workspace、知识库详情页与书架、文档版本历史、跨文档引用修复（已有） | 4 |
| `views/` | html/pdf/view 三类渲染型文档、gallery view、视图布局与配置 | 2-3 |
| `editor/` | calendar 块、sheets 块、secret 加密块、受限内联 style 渲染 | 4 |
| `attachments/` | 上传与媒体内联、S3 代理与按 workspace 分目录、访问控制与私密附件、PDF 预览 | 3-4 |
| `agent-collab/` | memogit 同步、memogit 文档身份与移动语义、MCP 协作写作 | 3 |
| `storage/` | sqlite 单源（已有）、全站备份 | 2 |
| 根下平铺 | `rag-search.md`、`standalone-local-deploy.md` | 2 |

视图相关**合成一个 `views/` 大类**，不拆 extended_views / view_layout。

## 4. 逐文件去向

**R** 提炼进 requirements（对照代码重写）· **D** 迁进 design（冻结，只加迁移注记、剥进度标记）·
**A** 抽成 adr · **L** 进 launch · **X** 不进 docs/dev（git history 保留原文）

| 源（`docs/plans/` 下） | 去向 |
|---|---|
| `2026-07-03/requirement.md` | R → `knowledge-base/hierarchy-and-workspaces.md`；4 张 png 移 `requirements/knowledge-base/imgs/`；末尾「AI执行计划」节 X |
| `2026-07-03/2026-08-04-optimization-workspace-detail-and-shelf.md` | R → `knowledge-base/workspace-detail-and-shelf.md` ＋ D → `design/20260804-workspace-detail-and-shelf.md` |
| `2026-07-04/definition.md` | R 拆二 → `attachments/upload-and-inline-media.md` ＋ `views/render-only-doc-types.md`（PDF 预览部分） |
| `2026-07-04/attachment-access-control.md` | R → `attachments/access-control-and-private-files.md` ＋ A-0002 ＋ A-0003 |
| `2026-07-04/s3-storage-proxy-plan.md` | D → `design/20260704-s3-proxy-and-backup.md` ＋ A-0001 ＋ 备份部分 R → `storage/backup.md` |
| `2026-07-06/requirement.md` | R → `views/gallery-view.md` |
| `2026-07-12-calendar/requirement.md` | R → `editor/calendar-block.md` |
| `2026-07-12-calendar/tech-design.md` | A-0004 ＋ D → `design/20260712-calendar-callout.md` |
| `2026-07-12-version-history/01-*.md` | R → `knowledge-base/document-versioning.md` ＋ D → `design/20260712-memo-version-history.md` |
| `2026-07-13-memogit/01-memogit-cli.md` | R → `agent-collab/memogit-sync.md` |
| `2026-07-13-memogit/02`、`03` | D → **目录** `design/20260713-memogit-cli/`（`02-api-survey.md`、`03-implementation-notes.md`）；「待做 / 状态」段落剥掉 |
| `2026-07-13-memogit/04-move-semantics-and-doc-identity.md` | R → `agent-collab/memogit-doc-identity.md` ＋ A-0007 |
| `2026-07-16-rag/requirement.md` ＋ `docs/2026-07-12-rag-requirement.md` | R 合并 → `rag-search.md`（根下）：07-16 检索方向为正文，07-12 问答方向收进「未排期方向」一节 |
| `2026-07-16-rag/tech-design.md`、`iteration-2-explore-merge.md`、`docs/2026-07-12-rag-tech-design.md` | D → **目录** `design/20260716-rag-search/` ＋ A-0006 |
| `2026-07-19-sheets/requirement.md` | R → `editor/sheets-block.md` ＋ A-0005 |
| `2026-07-30-secret/requirement.md` | R → `editor/secret-block.md` ＋ A-0008 |
| `2026-07-30-secret/tech-design.md` | D → `design/20260730-secret-block.md`（满篇 ✅ 进度标记，必须剥） |
| `2026-07-31-mcp/requirement.md` | R → `agent-collab/mcp-authoring.md` ＋ A-0009…A-0014 |
| `2026-07-31-mcp/tech-design.md` | D → `design/20260731-mcp-agent-authoring.md` |
| `2026-08-03-obsidian/01-platform-support.md` | R 拆二 → `editor/inline-style-rendering.md` ＋ S3 按 workspace 分目录并入 `attachments/` 对应篇 |
| `2026-08-03-obsidian/02-migration.md` | D → **目录** `design/20260803-obsidian-kb-migration/` |
| `2026-08-03-obsidian/03-handover.md` | L → `launch/20260803-obsidian-kb-migration.md`（首篇 launch：实际怎么上的线、改掉了方案的哪些内容、结果数据） |
| `2026-08-03-obsidian/scripts/` | X 删除（迁移已执行完，一次性脚本） |
| `2026-08-04-standalone/requirement.md` | R → `standalone-local-deploy.md`（根下）＋ A-0015 ＋ A-0016 |
| `2026-08-04-standalone/02-backup-bugs.md` | X（bug 单属 Issue；删前先确认两个 bug 已修复合入） |
| `2026-08-04-standalone/03-review-and-plan.md` | D → `design/20260804-standalone-local-deploy.md` |

`design/` 下**一次需求涉及多篇文档时用目录承载**，单篇装得下的用单文件。

### ADR 编号表（T0 冻结，之后只执行不重排）

| 编号 | 主题 | 来源 |
|---|---|---|
| 0001 | 附件走服务端代理，不用 S3 预签名直连 | s3-storage-proxy-plan §1 |
| 0002 | 私密附件复用账号主口令，不引入第二把 | attachment-access-control 决策 1 |
| 0003 | 解锁态是短时 cookie，不是逐请求带参 | attachment-access-control 决策 2 |
| 0004 | 交互块走 CodeBlock 语言分发，不新建 remark 插件 / 文档类型 | calendar tech-design |
| 0005 | 块样式落 node_overlays，不写进正文 | sheets requirement |
| 0006 | 无 CGO ⇒ 放弃 sqlite-vec，FTS5 ＋ 内存向量 | rag tech-design |
| 0007 | memogit 文档身份用文件内 memogit-id 标记 | memogit 04 |
| 0008 | 加密块浏览器端加解密，服务端零明文零口令 | secret requirement |
| 0009-0014 | MCP ADR-1…ADR-6（原文已按 ADR 体例写就，逐条对应） | mcp requirement |
| 0015 | standalone 不引入 Litestream | standalone 决策 1 |
| 0016 | standalone 不支持多端写入，靠文档约束 | standalone 决策 2 |

编号一经分配不回收。0009-0014 是硬需求：proto、Go 源码与 manual 都直接引了 "ADR-5"/"ADR-6"。

### 入链修复清单

所有指向 plans 的入链**都落在要迁走的 12 个目录里**，没有一条指向保留归档的 6 个 ——
这张表必须全改完，漏一处即死链。

| 位置 | 现指向 |
|---|---|
| `README.md:67` | `docs/plans/` 总入口 → 改指 `docs/dev/` |
| `cmd/memogit/main.go:3` | 2026-07-13-memogit-cli |
| `internal/base/actor.go:11` | 2026-07-31-mcp |
| `web/src/utils/secret-block.ts:8` | 2026-07-30-secret |
| `proto/store/memo.proto`（源） | "requirement.md ADR-6" → `docs/dev/adr/0014-*.md`；**改源后跑 `buf generate`**，连带更新 `proto/gen/store/memo.pb.go:65`、`web/src/types/proto/store/memo_pb.ts:96`（不手改生成物） |
| `docs/manual/02-rich-documents.md:218` | s3-storage-proxy-plan |
| `docs/manual/03-gallery-views.md:170` | gallery-view/requirement.md |
| `docs/manual/10-mcp-agent-access.md:278` | "ADR-5" |
| `design/20260807-storage-consolidation.md:143` | 「历史 plan 文档不改」的论述 |
| `design/20260807-cross-reference-repair-plan.md:107` | memogit 04 |
| `../README.md:158` | 「不迁移、不改写」那段（见 §1） |
| plans 内部互链约 12 处 | gallery→hierarchical、calendar→gallery、sheets→calendar、secret→sheets、mcp→version-history、rag→`docs/2026-07-12-*` 等 |

两篇已冻结的 `20260807-*` design 文档**只修路径、不改论述**，正文加一行迁移脚注 ——
事件类文档冻结的是结论，不是失效的链接。

---

## 5. 任务表

`[S]` 一个会话轻松做完 · `[M]` 一个会话 · `[L]` 一个会话吃力，可再拆

| ID | 任务 | 规模 | 依赖 | 可与谁并行 |
|---|---|---|---|---|
| **T0** | 立规矩：改 `../README.md` §1 那段；新建 `docs/README.md`（docs 总索引 ＋ 标 `plans/`、`superpowers/` 归档）；确认 §2 的 sso 边界 | S | — | 无，必须最先 |
| **T1** | 零改写搬运：所有 D 类文件 `git mv` 进 `design/`（日期前缀，多文档用目录）；图片移位；删 obsidian `scripts/` | M | T0 | 无（大量 mv，独占） |
| **T2** | `knowledge-base/` 4 篇 | L | T1 | T3-T8 |
| **T3** | `views/` 2-3 篇 | M | T1 | T2-T8 |
| **T4** | `editor/` 4 篇 ＋ A-0004、0005、0008 | L | T1 | T2-T8 |
| **T5** | `attachments/` 3-4 篇 ＋ A-0001、0002、0003 | L | T1 | T2-T8 |
| **T6** | `agent-collab/` 3 篇 ＋ A-0007、0009-0014 | L | T1 | T2-T8 |
| **T7** | `storage/backup.md` ＋ `rag-search.md` ＋ A-0006 | M | T1 | T2-T8 |
| **T8** | `standalone-local-deploy.md` ＋ A-0015、0016 ＋ `launch/20260803-*.md` | M | T1 | T2-T7 |
| **T9** | 改入链：入链清单全表 ＋ `buf generate` | M | T2-T8 全完 | 无 |
| **T10** | 清场：删已迁走的 12 目录与 `docs/2026-07-12-rag-*.md`；重写 `../README.md` §四 与 `../requirements/README.md` 的文档清单 | M | T9 | 无 |
| **T11** | 校验：① 无失效 `docs/plans` 引用 ② `docs/dev/**/*.md` 每篇在索引中恰好被链一次 ③ 相对链接全部可解析 | S | T10 | 无 |

**T2-T8 是并行组**（7 个任务），互不碰同一个文件。ADR **不单独成任务**，
跟着来源域一起写 —— 写域的会话本来就正在读那批文档。

### 并行会话的三条纪律

1. **索引留到最后统一改。** `requirements/README.md` 与 `../README.md` 是唯一的公共冲突点，
   T2-T8 **一律不碰**，全部推到 T10。
2. **一个任务一个 commit，前缀 `docs(dev):`。** 完成信号只有 commit，不在文档里打勾。
3. **对照代码重写，不猜。** requirements 是常青文档，描述的是**现状**而非当初的意图；
   两者已知有漂移（见 §7）。核不准的地方标 `TODO(确认)` 留给用户，不要靠推测填。

## 6. 验收

- `grep -rn "docs/plans" --exclude-dir=.claude --exclude-dir=.git` 只剩归档 6 目录的自引用。
- `docs/dev/` 下每篇 md 被 `../README.md` 或 `../requirements/README.md` **恰好链接一次**。
- 所有相对链接可解析（一次性脚本校验，跑完即删）。
- 不留 `archive/` 目录；不留 `plan.md` / `execution.md` 式的任务清单与执行日志。
- 迁移后的 requirements 里不出现 `✅` / `⏸️` 进度标记。

## 7. 已知风险

| 风险 | 缓解 |
|---|---|
| 旧文与现状漂移：memogit 01 自带「2026-07-16 重大修订」、版本历史 §9「与最初设计的偏差」、s3-plan §6「实施状态」 | 一律以代码为准；确认不了的标 `TODO(确认)` |
| 生成物（`memo.pb.go` / `memo_pb.ts`）手改会被下次 `buf generate` 覆盖 | 只改 `.proto` 源再重生成 |
| ADR 编号发布后不可回收，中途改主意会留空号 | T0 冻结编号表 |
| 归档的 6 个目录被后来的 agent 误当权威读 | `docs/README.md` 明写归档状态；可另在 `docs/plans/README.md` 放一行同样的话 |
| `2026-08-04/02-backup-bugs.md` 直接丢弃，但 bug 可能还没修 | T10 删除前确认两个 bug 已修复合入，未修则先转 Issue |
| 并行会话同时改索引造成冲突 | 见 §5 纪律 1 |
