# 存储层收敛 — 分阶段实施

需求、决策依据与复评条件见
[requirements/storage/sqlite-as-sole-datasource.md](../requirements/storage/sqlite-as-sole-datasource.md)。

原则：**每个阶段独立可提交、可回滚，且结束时 `go build ./... && go test ./...` 全绿。**
删除类改动无法靠测试兜底（被删的代码本来就没有测试），因此靠小步提交保证可回退。

---

## P-1 · 前置基线（必须先做）

在删任何东西之前，先确认被删的东西现在是什么状态。这一步的产出是决策证据，不是代码。

```bash
DRIVER=postgres go test ./store/test/... 2>&1 | tail -40
DRIVER=mysql    go test ./store/test/... 2>&1 | tail -40
```

需要本地 Docker（testcontainers 会拉 `mysql:8` 与 postgres 镜像）。

| 结果 | 处理 |
|---|---|
| 大面积失败 | 证实「名义支持、实际半残」，按本计划删除 |
| 基本通过 | 说明代码仍活着，**暂停并重新评估**是否改为「保留但不再新增迁移」的保守档 |

同时记录一份当前基线，供 P4 调优前后对比：

- `ls -la memos_prod.db*` 体积
- 一次典型 RAG 搜索的耗时

---

## P0 · 冻结（零风险，可先单独合入）

在真正删除前先止血，让后续新功能不再产生三份税。

| 动作 | 位置 |
|---|---|
| `NewDBDriver` 的 mysql/postgres 分支改为返回明确错误，提示驱动已不受支持 | [store/db/db.go](../../../store/db/db.go) |
| 在 `AGENTS.md` 记录：新增 schema 变更只写 `store/migration/sqlite/` | `AGENTS.md` |

这一步不删代码，收益是立刻停止交税；即使后面全部回滚也不亏。

---

## P1 · 删除驱动实现与迁移

| 删除对象 | 规模 |
|---|---|
| `store/db/mysql/` | 2944 行 / 19 文件 |
| `store/db/postgres/` | 3186 行 / 19 文件 |
| `store/migration/mysql/` | 40 个 .sql |
| `store/migration/postgres/` | 33 个 .sql |

配套改动：

- [store/db/db.go](../../../store/db/db.go) — 去掉两个 import 与两个 `case`，
  `switch` 塌缩为 `if profile.Driver != "sqlite" { return error }`
- [internal/profile/profile.go](../../../internal/profile/profile.go) — 注释
  `// sqlite, mysql` 更新；`Driver` 字段保留（见「边界」）
- 检查 `store/migrator.go` 是否按驱动名拼装迁移目录路径，确认删除后不会踩空

**验证**：`go build ./... && DRIVER=sqlite go test ./store/... ./server/...`

---

## P2 · 收敛 filter 方言

[internal/filter/render.go](../../../internal/filter/render.go)（980 行）中
`DialectMySQL` / `DialectPostgres` 分支约 18 处，散布在
`schema.go` 的 `Expressions map[DialectName]string` 与 `render.go` 的多个 `switch`。

做法：

1. `schema.go` 保留 `DialectName` 类型与 `DialectSQLite` 常量，删除另两个常量
2. `Expressions map[DialectName]string` 若收敛后每处只剩一个键，改为普通 `string` 字段
3. `render.go` 中形如 `case DialectSQLite, DialectMySQL:` 的合并分支要**逐个看**——
   sqlite 与 mysql 共用的写法不一定是 sqlite 的最优写法，但本阶段**只做删除、不做改写**，
   保持行为不变
4. 同步更新 `internal/filter/README.md`、`MAINTENANCE.md`

**这是本计划风险最高的一步**，理由见「风险」。`engine_test.go`、`functions_test.go`
里有多方言断言，需一并调整——**注意区分**「因方言删除而失效的断言」与「sqlite 断言本身
挂了」，后者说明改错了，必须回退重来。

**验证**：`go test ./internal/filter/... -v`，逐条确认 sqlite 断言全部原样通过。

---

## P3 · 清理泄漏点与测试脚手架

三处驱动判断，删除后条件恒真，直接展开：

| 位置 | 处理 |
|---|---|
| [server/server.go:187](../../../server/server.go) | 去掉 `if s.Profile.Driver == "sqlite"`，RAG worker 无条件启动 |
| [server/runner/backup/runner.go:31,49](../../../server/runner/backup/runner.go) | 去掉两处提前 `return` |

测试脚手架：

- [store/test/containers.go](../../../store/test/containers.go)（382 行）— 删除
  `mysqlContainer` / `postgresContainer` 及 `GetMySQLDSN` / `GetPostgresDSN`，
  文件规模应大幅缩小
- [store/test/store.go](../../../store/test/store.go) — `switch driver` 只留 sqlite；
  `getDriverFromEnv()` 可整体删除
- `go.mod` — 移除 `testcontainers-go/modules/mysql`、`.../postgres`、
  `go-sql-driver/mysql`，跑 `go mod tidy`
- [.github/workflows/backend-tests.yml:83](../../../.github/workflows/backend-tests.yml)
  — `DRIVER` 环境变量整体删除

**注意**：`testcontainers-go` 主包可能仍被其他测试使用，确认后再决定是否一并移除。

**验证**：`go mod tidy && go build ./... && go test ./...`

---

## P4 · sqlite 专属调优（收敛后的红利）

[store/db/sqlite/sqlite.go:53](../../../store/db/sqlite/sqlite.go) 当前：

```
?_pragma=foreign_keys(0)&_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=mmap_size(0)
```

`mmap_size(0)` 关闭了内存映射。库长到几百 MB 后，开启 mmap（如 256MB）通常能明显降低
读延迟。24G 内存的部署环境完全吃得下。

**必须查清 `mmap_size(0)` 是被谁、为什么设成 0 的**（`git log -S 'mmap_size'`）——
上游 memos 可能是为了规避某平台的已知问题而显式关闭的，不能想当然改掉。查清前不动。

改动后用 P-1 记录的基线做前后对比，**有实测数据才合入**。

这一步与前面几步无依赖，可以延后做，也可以不做。

---

## P5 · 文档与配置

- `AGENTS.md`、`README.md` 中的多驱动说明改为「仅支持 SQLite」，并链回
  [需求文档](../requirements/storage/sqlite-as-sole-datasource.md)的复评条件
- `docs/dev/design/20260716-rag-search/2026-07-12-rag-tech-design.md` 中涉及多驱动的表述同步修正
- 历史 plan 文档（`docs/plans/` 下各目录）中的多驱动描述**不改**——那是当时的事实记录

> 迁移脚注（2026-08-08）：上面提到的 `docs/2026-07-12-rag-tech-design.md` 已随
> [docs/plans → docs/dev 迁移](20260808-plans-to-dev-migration.md)移到
> `docs/dev/design/20260716-rag-search/2026-07-12-rag-tech-design.md`，本节论述不变，只改路径。

---

## 风险

### 高：filter 方言收敛改错行为（P2）

`render.go` 里存在 `case DialectSQLite, DialectMySQL:` 这类合并分支。删除时若把
sqlite 归错分支，会产出语法合法但语义错误的 SQL——**这类 bug 不会报错，只会让搜索
和过滤悄悄返回错的结果**，且 CEL 过滤器覆盖了 memo 列表的核心查询路径。

缓解：P2 单独成一次提交；只删不改写；`internal/filter` 的 sqlite 断言必须**逐条**
确认原样通过，不接受「改断言让测试变绿」。

### 中：删除后才发现某处隐式依赖多驱动

排查基于 grep，可能有遗漏（比如通过 `GetDB()` 拿到 `*sql.DB` 后写方言相关 SQL 的地方）。

缓解：分阶段提交，`go build` 会抓到编译期依赖；运行期依赖靠 P1/P3 后的完整测试与
一次本地起服务冒烟。

### 中：外部使用者被静默破坏

如果有人（哪怕只有一两个）用 `MEMOS_DRIVER=postgres` 跑本项目，升级后直接起不来。

缓解：P0 的错误信息要写清楚「本项目已仅支持 SQLite」而非笼统的 `unknown db driver`；
CHANGELOG 明确标注 breaking change。

### 低：将来需要 postgres 时重写

3–5 人日，已在需求文档的 Q1 中评估并接受。删除的代码在 git 历史里可完整取回，
`git revert` 或从 tag 检出即可作为重写起点。

### 低：上游 memos 同步冲突

将来若要 cherry-pick 上游改动，涉及 mysql/postgres 的部分会冲突。

缓解：本 fork 已大幅偏离上游（workspace、memogit、RAG、secret block 均为自研），
同步成本本就很高，此项属边际增量。

---

## 边界

**不碰的**：

- 线上数据。全程不涉及任何生产数据变更，`memos_prod.db` 不动
- sqlite 的表结构与迁移链。`store/migration/sqlite/` 69 个 .sql 一个不改
- 业务逻辑、API 契约、proto 定义、前端
- `store/driver.go` 的 69 方法接口。**保留接口不改成具体类型**——这层抽象正是将来
  重新支持 postgres 成本可控的原因，删掉等于把 Q1 的结论作废
- `profile.Driver` 字段。保留它才能在 P0 给出明确错误，而不是让配置被静默忽略
- 历史 plan 文档

**明确不做的**（各自独立议题）：

- 数据迁移工具
- pgvector / 全库语义召回
- `SearchMemosLike` 全表扫描优化
- FTS5 trigram 索引体积优化

**做完之后**：`store/migration/sqlite/` 成为唯一 schema 事实来源；新增功能写一份迁移、
一份实现；CI 覆盖到全部存活的存储代码。
