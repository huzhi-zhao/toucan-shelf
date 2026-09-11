# 全站 SQLite 数据库备份

设计与实施背景见 [design/20260704-s3-proxy-and-backup.md](../../design/20260704-s3-proxy-and-backup.md#3-全站-sqlite--s3-备份admin-only简化版)
第 3 节（该文档同时覆盖 S3 附件代理化，与本篇无关，本篇只收敛备份这一块）。

## 定位

admin-only 的全站运维操作，不是"用户数据导出"。本项目单实例、单份 SQLite 数据库文件，
由管理员统一管理，不存在"按用户过滤备份"的需求。

## 范围

- 只备份 **SQLite 数据库文件本身**（memo / 用户 / 设置等结构化数据）。
- **不包含**已上传的附件/图片文件本身——附件走独立的 S3 存储，不在本机制覆盖范围。
- SQLite 专用。MySQL/Postgres 驱动已随
  [存储层收敛](sqlite-as-sole-datasource.md)整体删除，备份侧原有的两处
  `Driver == "sqlite"` 判断也在那次收敛里一并展开，现在
  [server/backup/backup.go](../../../../server/backup/backup.go) 与
  [server/runner/backup/runner.go](../../../../server/runner/backup/runner.go) 都不再判断驱动。
- 依赖：instance 级 S3 存储配置已保存凭证（复用 Attachment storage 同一份 S3 client 封装）；
  未配置 S3 时备份直接返回错误。

## 备份机制

- 快照方式：`VACUUM INTO` 生成一致性快照文件，不停机、不阻塞写入。
- 快照 → gzip 压缩 → 上传到已配置 S3，object key 由可配置的路径模板生成
  （默认 `backups/{timestamp}_{uuid}.db.gz`，管理员可在 Storage 设置页编辑）。
- 临时文件用完即删（`defer` 清理）。
- 触发方式两种，共用同一份实现（[server/backup/backup.go](../../../../server/backup/backup.go) 的 `Run`）：
  - **手动**：管理员在 Storage 设置页点击"立即备份"，对应 `InstanceService.BackupNow` RPC。
  - **自动**：[server/runner/backup/runner.go](../../../../server/runner/backup/runner.go) 每 7 天一次，
    但周期的判定依据是存储里的 `last_backup_time`，不是内存计时器。runner 每小时轮询一次，
    只在「从未备份过」「距上次成功备份已满 7 天」「上次尝试失败」三种情况下才真正执行，
    并在启动时先判定一次——进程停机期间到期的备份会在启动后补跑。未配置 S3 时直接跳过，
    不记失败尝试。
- 每次备份（无论成功失败）都会把结果写回 `InstanceSetting_BACKUP`
  （`last_backup_time` / `last_backup_success` / `last_backup_error`），供 UI 展示。
  两个方向的字段保留都是显式的：管理员编辑路径模板时服务端强制保留这三个状态字段；
  备份写回状态时先读出现有设置，保留管理员配置的 `path_template`
  （`UpsertInstanceSetting` 是整体替换而非字段级 patch）。

## 保留与清理

- 备份文件的保留期/清理策略**下沉给 S3 本身**——引导管理员对 bucket 开启版本控制 +
  生命周期规则（建议 3 个月），memos 不实现清理逻辑，只在文档/UI 里给出配置指引。

## 安全说明

- 备份文件是完整数据库文件，**包含 `password_hash` 等敏感字段**，风险等级与数据库本身一致。
  UI 文案需提示管理员自行保护好 S3 桶的访问权限。
- 备份文件本身**不加密**（已确认的产品决策，非遗漏）。

## 非目标

- 不做按用户过滤导出、不做字段脱敏、不做 uid 重写外键——这些是"个人数据导出"场景的方案，
  本机制是"数据库备份"，语义不同。
- 不备份附件/图片文件本身。
- 不实现 S3 生命周期规则的自动化配置，只做文档引导。
- 不支持 MySQL/Postgres（驱动已删除，`store.Driver != "sqlite"` 直接拒绝）。

## 未决

- 备份的 bucket 是否允许 admin 单独指定一个备份专用桶。已核实代码：`run()` 直接读
  `GetInstanceStorageSetting().GetS3Config()`，只能复用 Attachment storage 的同一个桶换
  prefix，独立桶未实现。这是原设计文档列为未决的产品问题，不是实现遗漏，定了再做。
