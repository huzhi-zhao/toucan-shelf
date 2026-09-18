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
| 定时备份 | [server/runner/backup/runner.go](../../server/runner/backup/runner.go)：启动时检查到期状态，之后每小时复查 |
| 手动备份 | `BackupNow` API |
| 备份状态 | 记在 `InstanceSetting_BACKUP`，UI 可见 |
| 从 S3 恢复 | **没有**——已核实仓库内不存在任何"启动时从 S3 拉取快照恢复"的代码路径 |
| 首启引导 UI | 没有——没有配置 S3 的引导流程，也没有"未配置远程备份"的警告条 |
| 打包 CI | 未核实是否已配置多平台构建 pipeline，`TODO(确认)` |

## 自动备份现状

[server/runner/backup/runner.go](../../server/runner/backup/runner.go) 在启动时读取持久化的
`LastBackupTime`，到期便补跑；之后每小时复查。成功备份的间隔仍固定为 7 天，失败
后最早 1 小时重试，尚无可配置间隔。未配置 S3 时不运行自动备份。

[server/backup/backup.go](../../server/backup/backup.go) 记录成功或失败状态时保留已有的
`PathTemplate`，不会清除管理员设置的自定义路径。

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
备份时界面持续显示警告条。已核对：界面仍没有这条警告或无 S3 时的降级提示逻辑，
见根目录 [TODO.md](../../TODO.md)。

## 凭证与快照安全

数据库快照本质上是一个全权凭证：S3 key、用户 PAT（个人访问令牌，明文，见
[user_setting.go](../../store/user_setting.go)）、IdP OAuth client secret（明文，见
[idp_bootstrap.go](../../store/idp_bootstrap.go)）都在快照里，不存在"备份前清洗敏感
字段"这种解法——擦哪个都会破坏恢复能力或留下别的凭证。谁拿到快照就等于拿到整个实例。

standalone 模式下计划让 S3 凭证只能来自环境变量（`TOUCAN_S3_ENDPOINT` /
`_REGION` / `_BUCKET` / `_ACCESS_KEY_ID` / `_ACCESS_KEY_SECRET`），因为恢复发生时
本地 DB 还不存在，不可能从一个尚未存在的数据库里读出连接 S3 所需的凭证。副产品是
快照天然不含 S3 密钥。已核对：这条环境变量读取路径尚未实现，见根目录
[TODO.md](../../TODO.md)。

线上（docker）部署仍从 DB 读凭证，靠 IAM 权限收敛（Access Key 锁死单 bucket + bucket
私有）而非代码兜底。

面向用户的风险说明见 [docs/manual/11-backup-and-storage.md](../manual/11-backup-and-storage.md)。

## 未排期 / 明确不做的方向

- 本地目录备份（S3 之外的本地/外接盘备份选项）
- 本地图片资源向 S3 的批量迁移工具
- 多端写入 + S3 租约（见上方决策）
- MySQL / Postgres 的部署形态。本项目仅支持 SQLite，见
  [sqlite-as-sole-datasource.md](requirements/storage/sqlite-as-sole-datasource.md)
