# 单机本地部署（standalone local deploy）

常青需求文档，对照代码整理，描述当前实现的现状。历史方案见
[docs/dev/design/20260804-standalone-local-deploy.md](design/20260804-standalone-local-deploy.md)，
决策见 [ADR-0015](adr/0015-no-litestream.md)、[ADR-0016](adr/0016-no-multi-instance-lease.md)。

## 一句话目标

把 ToucanShelf 打包成一个可执行文件，让没有服务器的个人开发者能直接在自己的电脑
（典型场景：常年开机的 Mac mini + 局域网访问）上跑起来，数据落本地 SQLite，定期把数据库
快照备份到 S3。目标是把使用成本压到"下载一个文件、双击、打开浏览器"。

## 现状

### 打包本身已成立

```bash
CGO_ENABLED=0 go build -o memos ./cmd/memos
```

产出单文件可执行程序，`GOOS=windows` 交叉编译同样通过。前端已 `go:embed dist/*`
（见 [frontend.go](../../server/router/frontend/frontend.go)），SQLite 驱动是纯 Go 的
`modernc.org/sqlite`，没有 cgo 依赖，因此打包这一步零改动。

### S3 备份是单向的

| 能力 | 现状 |
|---|---|
| 单可执行文件 | 已成立 |
| S3 客户端 | [internal/storage/s3/s3.go](../../internal/storage/s3/s3.go) |
| 附件走 S3 | 已有 |
| DB 备份到 S3 | [server/backup/backup.go](../../server/backup/backup.go)：`VACUUM INTO` 快照 + gzip + 上传 |
| 定时备份 | [server/runner/backup/runner.go](../../server/runner/backup/runner.go)，见下方"已知问题" |
| 手动备份 | `BackupNow` API |
| 备份状态 | 记在 `InstanceSetting_BACKUP`，UI 可见 |
| 从 S3 恢复 | **没有**——已核实仓库内不存在任何"启动时从 S3 拉取快照恢复"的代码路径 |
| 首启引导 UI | 没有——没有配置 S3 的引导流程，也没有"未配置远程备份"的警告条 |
| 打包 CI | 未核实是否已配置多平台构建 pipeline，`TODO(确认)` |

## 已知问题

自动备份存在两个尚未修复的 bug，影响**现有线上实例**，与 standalone 部署与否无关，
应先修再谈 standalone 化：

### 间隔硬编码 + 无启动补跑

[server/runner/backup/runner.go](../../server/runner/backup/runner.go) 里
`runnerInterval` 硬编码为 `7 * 24 * time.Hour`，调度靠一个纯内存 `time.Ticker`：

- **启动时不跑**，第一次触发必须等进程连续运行满 7 天。
- **进度不持久化**，计时器活在内存里，每次重启归零；`LastBackupTime` 只被写入和展示，
  没有任何一处读它来决定该不该跑。
- 也没有配置项能把这个间隔改短——间隔既是硬编码常量，也不存在把它接到
  `InstanceSetting` 或环境变量的路径。

线上是积极开发的项目，部署频率远高于 7 天，两个缺陷相乘的结果是自动备份实际上
从未真正按周期触发过，只能靠手动 `BackupNow`。

### 自定义备份路径被静默重置

[server/backup/backup.go](../../server/backup/backup.go) 的 `Run()` 记录备份状态时，
新建一个 `InstanceBackupSetting{LastBackupTime, LastBackupSuccess}` 并整体覆盖写回，
没有带上已有的 `PathTemplate` 字段。`UpsertInstanceSetting` 是整体替换而非字段级
patch，所以用户在设置里配置的自定义路径模板每备份一次就被清空一次，下次读取时又被
自动填回默认模板——配置悄悄消失，UI 上不会有任何提示。

这两个 bug 原记录在 `docs/plans/2026-08-04-standalone-local-deploy/02-backup-bugs.md`
（该文件随 docs/plans 迁移清理已删除，内容并入本节）。`TODO(确认)`：两个 bug 截至本文
整理时是否已排期修复，未在代码或 issue 跟踪中找到结论。

## 关键决策

### 不引入 Litestream

评估后明确不用 Litestream（无论作为独立进程还是嵌入库），改为复用现有 `VACUUM INTO`
全量快照方案。理由与备选方案见 [ADR-0015](adr/0015-no-litestream.md)。

### 不支持多端写入

SQLite + 对象存储备份只能有一个写者，多台机器先后启动会导致后启动的一方覆盖先启动
一方的数据，且是静默丢失。评估后决定不实现 S3 租约机制，靠文档约束"同一份 S3 备份
只能被一个实例使用"。理由见 [ADR-0016](adr/0016-no-multi-instance-lease.md)。

**这是一条靠文档约束的规则，没有代码兜底。**

### 不强制配置 S3

首次启动不强制要求填 S3 配置。计划中的做法是允许无 S3 启动、功能完整，未配置远程
备份时界面持续显示警告条。`TODO(确认)`：截至本文整理时，代码里未找到这条警告条或
无 S3 时的降级提示逻辑，是否已实现存疑。

## 凭证与快照安全

数据库快照本质上是一个全权凭证：S3 key、用户 PAT（个人访问令牌，明文，见
[user_setting.go](../../store/user_setting.go)）、IdP OAuth client secret（明文，见
[idp_bootstrap.go](../../store/idp_bootstrap.go)）都在快照里，不存在"备份前清洗敏感
字段"这种解法——擦哪个都会破坏恢复能力或留下别的凭证。谁拿到快照就等于拿到整个实例。

standalone 模式下计划让 S3 凭证只能来自环境变量（`TOUCAN_S3_ENDPOINT` /
`_REGION` / `_BUCKET` / `_ACCESS_KEY_ID` / `_ACCESS_KEY_SECRET`），因为恢复发生时
本地 DB 还不存在，不可能从一个尚未存在的数据库里读出连接 S3 所需的凭证。副产品是
快照天然不含 S3 密钥。`TODO(确认)`：这条环境变量读取路径是否已在代码中实现未核实。

线上（docker）部署仍从 DB 读凭证，靠 IAM 权限收敛（Access Key 锁死单 bucket + bucket
私有）而非代码兜底。

面向用户的风险说明见 [docs/manual/11-backup-and-storage.md](../manual/11-backup-and-storage.md)。

## 未排期 / 明确不做的方向

- 本地目录备份（S3 之外的本地/外接盘备份选项）
- 本地图片资源向 S3 的批量迁移工具
- 多端写入 + S3 租约（见上方决策）
- MySQL / Postgres 的 standalone 部署形态（仅支持 SQLite）
