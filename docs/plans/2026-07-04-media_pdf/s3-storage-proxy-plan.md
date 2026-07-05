# S3 存储代理 + Storage 设置页重构 + 全站 SQLite 备份

## 0. 关键澄清（已对齐，2026-07-04 更新）

之前一版认为需求里的"用户级别"意味着"每个用户可以配置自己的 S3、备份只导出触发者自己的数据"，需要发明一套复杂的按 `creator_id`/`uid` 过滤 + 敏感字段脱敏的导出逻辑。

**用户已确认并纠正**：Storage 配置本来就挂在 admin 面板下（`InstanceSetting`，proto/api/v1/instance_service.proto:90-194），**只有管理员能设置，是全站唯一一份配置**，不存在"每用户一套存储"的诉求。既然存储本身就是全站级的，那么：

- **S3 代理化**（第 1 节）不受影响，本来就是全站共用一份 S3 配置，逻辑不变。
- **备份**（第 3 节）大幅简化：既然数据本来就是全站共享一份 sqlite 文件、由 admin 统一管理，就**不需要**按用户过滤、脱敏、拼 JSON、按 uid 重写外键这一整套复杂方案。直接对**整个 sqlite 数据库文件**做备份（文件级复制/官方 backup API）+ gzip + 推 S3 即可，跟"用户是谁触发的"无关——这本质上是一个 admin-only 的全站运维操作，语义上更接近"数据库备份"而不是"个人数据导出"。
- [user-data-backup-plan.md](user-data-backup-plan.md) 里设计的"按用户过滤、按表清单导出 JSON"方案**不再需要**，其价值仅限于"未来如果做成 SaaS 多租户场景下每个用户自助导出自己的数据"这个场景，本次不实现，仅保留该文档作为历史参考。

此前"多租户每用户一套 S3"的顾虑也随之解除，不再是开放问题。

---

## 1. 图片/附件走 Memos 域名代理（而非裸 MinIO 预签名直连）

### 现状（已确认）
- 上传：`attachment_service.go:483-519` 上传到 S3 后立刻调 `PresignGetObject`（line 502），把裸预签名 URL 存进 `Reference` 字段（line 507），5 天有效期。
- 下发：`convertAttachmentFromStore`（417-435）对 `S3`/`EXTERNAL` 类型直接把 `Reference` 塞进 `externalLink` 返回给前端。
- 前端：`web/src/utils/attachment.ts` 的 `getAttachmentUrl` 只要 `externalLink` 存在就优先用它，完全绕开 `/file/{name}/{filename}` 代理路由。
- **好消息：代理路由已经存在且能力齐全** —— `server/router/fileserver/fileserver.go`（挂载于 `v1.go:136` 的 `/file/*`）背后的 `GetAttachmentBlob`（attachment_service.go:524-575）已经支持从 LOCAL/S3/DB 三种存储类型读取字节流并回传，S3 分支已经在调 `s3Client.GetObject`（551-571）。也就是说**服务端代理能力已经齐全，缺的只是"不再对外暴露裸预签名 URL"这一件事**。

### 结论：可行，且改动面比想象中小
本质上是三处改动：

1. **停止把预签名 URL 写入/返回给前端**
   - `attachment_service.go:502-507`：S3 上传成功后不再调用 `PresignGetObject`，`Reference` 改存 S3 object key（内部标识，不对外），不再是可直接访问的 URL。
   - `convertAttachmentFromStore:417-435`：S3/EXTERNAL 类型不再把 `Reference` 塞进 `externalLink`；`externalLink` 只保留给用户手填的"外部链接"类型附件（如果有这个语义的话，需要确认 `EXTERNAL` 类型是否等同于"用户粘贴的外链"——如是则应保留，只去掉 S3 的这条分支）。
2. **前端一律走 `/file/{name}/{filename}` 代理 URL**
   - `web/src/utils/attachment.ts` 的 `getAttachmentUrl` 去掉"优先用 externalLink"的逻辑（或只对真正的外部链接类型保留），S3 存储的附件统一走本地代理 URL 拼装逻辑（与 LOCAL/DATABASE 一致）。
   - 逐一检查引用方（media-item.ts、AttachmentIcon.tsx、MemoEditor/types/attachment.ts、mediaInsertService.ts、AttachmentFileRows.tsx、AttachmentListView.tsx、AttachmentCard.tsx）确认没有遗留假设"S3 附件有 externalLink 直连"的分支。
3. **删除/简化 `server/runner/s3presign/runner.go`**
   - 这个 12 小时轮询、给快过期 URL 续签的后台任务的唯一存在理由就是维护对外暴露的裸预签名 URL。一旦不再对外暴露，这个 runner 及其在 `server/server.go:159-170` 的注册可以整体删除。
   - 内部访问 S3 时（`GetAttachmentBlob` 里的 `s3Client.GetObject`），如果 S3 SDK 需要每次请求都签名（大多数 S3 兼容 SDK 用 AK/SK 直接签，不需要预生成 URL），则完全不需要"预签名续期"这个概念，直接用长期持有的 AK/SK 现签即可，问题自然消失。需要确认当前 `s3Client` 封装（`internal/storage` 或类似目录）的 `GetObject` 是否本来就是"直接用 AK/SK 认证读取"而不是"生成预签名 URL 再自己访问"——如果是，这一步的改动量趋近于 0。

### 风险
- **带宽/CPU 成本转嫁到 memos 服务器**：所有图片/附件下载都要经过 memos 进程中转，而不是浏览器直连对象存储。需求文档里已经明确权衡过（10M 限制 + 非高并发场景，暂不做"大文件走直连、小文件走代理"的折中），按此执行，但要在发布说明里标注这个取舍，避免未来大流量场景下被当作"性能倒退"投诉。
- **缓存**：代理路径目前是否设置了合适的 `Cache-Control`/ETag 需要在 `fileserver.go` 里确认，否则每次预览都要重新打一次 MinIO，浪费。这是本次改动顺带应该检查的点（如果原来就没有缓存头，建议加上）。
- **兼容性**：已经写入数据库的历史 `Reference`（裸预签名 URL，5 天内还没过期的）在改动上线后如果继续被当作"合法值"直接返回会造成新老逻辑不一致。建议：上线时跑一次一次性迁移，把历史 S3 附件的 `Reference` 从"完整预签名 URL"改写为纯 object key（用现有 payload 里的 `S3Object.Key` 覆盖，大概率已经有这个字段，参考 attachment_service.go:511-518 的 `AttachmentPayload_S3Object`）。

### 工作量估计
- 后端：0.5-1 天（改 2 处写入逻辑 + 删 runner + 一次性数据迁移脚本）
- 前端：0.5 天（改 attachment.ts + 排查各调用点）
- 联调/回归：0.5 天（本地起 MinIO 验证上传、预览、跨天缓存）

---

## 2. Settings → Storage 页面重构

### 现状
`web/src/components/Settings/StorageSection.tsx`（358 行）是单一面板：一组 radio（LOCAL/DATABASE/S3）+ 选中 S3 时展开的 endpoint/AK/SK/bucket 表单，保存时整体一次性 PATCH `InstanceSetting_Key.STORAGE`。没有"配置与生效分离"的概念。

### 目标结构（按需求拆成三块）
1. **Storage Configuration**（新增，纯配置/凭证管理）
   - 把现有表单里 S3 的 endpoint/region/AK/SK/bucket 等输入项整体上移到这一块。
   - 支持保存后立即持久化（不需要先"选中 S3 类型"才允许填）。
   - 增加删除按钮：删除即清空该存储源的凭证（后端需要一个允许"配置存在但未激活"的状态，目前 proto 是"当前激活类型 + 内嵌该类型的配置"耦合在一起，需要拆分：`StorageSetting` 需要变成"多个已配置的存储源列表 + 一个当前激活类型指针"，而不是"当前类型 + 该类型专属配置"）。
     - Proto 改动：`InstanceSetting_StorageSetting` 需要能表达"S3 配置已保存但当前激活类型是 LOCAL"，即配置字段要独立于 `storage_type` 存在，不能像现在这样只有激活的那个类型才有意义。这是本次改造里**唯一需要动 proto/DB schema 的地方**。
2. **Attachment storage**（简化为纯下拉）
   - 从 Storage Configuration 里已保存的存储源中选择一个作为当前激活存储（LOCAL/DATABASE/S3，前提是 S3 已配置凭证才能选）。
   - 切换时如果目标不是当前值，弹窗二次确认（提示"数据分散、迁移困难"），确认后才提交。
   - 纯前端交互改动 + 后端一个"仅更新 active type，不动凭证"的 PATCH。
3. **User Data Backup**（新增区域，见第 3 节）

### 风险
- Proto 结构调整涉及一次 schema 变化（如果 `StorageSetting` 存成 workspace_setting 表里的 JSON blob，改动相对轻，只是加字段不删字段，兼容旧数据问题不大；需要在实现前读一下 `store/instance_setting.go` 确认存储形态是 JSON blob 还是结构化列，以确认是否需要 migration）。
- "删除凭证"要考虑：如果当前激活类型正是被删除的那个存储源，必须阻止删除或强制先切换 active type，否则会出现"激活了一个没有凭证的存储源"的悬空状态。

### 工作量估计：前端 1-1.5 天，后端（proto+store 改造）0.5-1 天。

---

## 3. 全站 SQLite → S3 备份（admin-only，简化版）

不再采用"按用户过滤导出 JSON"的方案，直接备份整份 sqlite 数据库文件。这是本次需求里工作量下降最明显的一块。

### 前置条件（gate）
- 仅当 `Profile.Driver == "sqlite"`（internal/profile/profile.go:30，已有字段，直接判断）时展示该 UI 区域和开放该 API；MySQL/Postgres 场景直接隐藏入口（这两种驱动本来就该用其官方工具做备份，不在本需求范围）。
- 仅当 Storage Configuration 里已经保存了一份 S3 凭证时才可用（复用 Attachment storage 同一份 S3 client 封装）。
- 该功能是 admin 面板下的操作（与 Storage 设置同级权限），不需要考虑"谁触发就只备份谁的数据"。

### 备份内容怎么拿（sqlite 文件层面）
两种可行方式，二选一：
1. **`VACUUM INTO` / sqlite 官方 Backup API**：在读写不冲突的前提下生成一份一致性快照文件（`VACUUM INTO 'backup.db'` 是最简单可靠的方式，SQLite 从 3.27 起支持，能在有并发写入时也拿到一致快照，不需要停机）。生成临时文件后 gzip 压缩再上传，用完删除临时文件。
2. 直接复制 `Profile.DSN` 指向的 `.db` 文件字节（配合 WAL checkpoint）：更简单但一致性依赖手动 `PRAGMA wal_checkpoint(TRUNCATE)`，不如方案 1 干净。

**建议用方案 1**（`VACUUM INTO`），一行 SQL 搞定一致性快照，不需要额外处理 WAL/事务细节。

### 后端
1. 新建 `server/router/api/v1/backup_service.go`（或者更贴切地放进现有 instance/admin 相关 service）：
   - `BackupNow(ctx) error`：
     - 执行 `VACUUM INTO` 到临时文件；
     - gzip 压缩；
     - `PutObject` 上传到 S3，路径建议 `backups/{timestamp}.db.gz`（bucket/前缀复用 Storage Configuration 里已保存的 S3 配置，允许在本区域额外指定一个 prefix 输入框）；
     - 清理临时文件；
     - 更新"上次备份时间/状态"到 workspace 级别的一个新 `InstanceSetting` 或直接写一行到现有的 workspace_setting 表（不需要新建表，因为这是全站唯一一条记录，不是每用户一条，所以不适合放 `UserSetting`）。
   - 该 RPC 供"立即备份"按钮和每周 cron 共用同一份实现，只是触发方不同。
2. **保留期/清理策略下沉给 S3 本身**：不变——UI 上提示用户对 bucket 开启版本控制 + 生命周期规则（保留 3 个月），memos 不实现清理逻辑，只做文档引导（复制一段 `mc`/`aws s3api` 生命周期配置命令）。
3. **每周自动备份**：新增 `server/runner/backup/runner.go`，仿照 `s3presign` 的注册方式（server/server.go:153-170 pattern），`time.Ticker`（7 天）触发一次 `BackupNow`。因为只针对全站一个数据库文件，不再有"批量遍历用户"的问题，runner 逻辑非常薄——就是定时调一次 `BackupNow` 并记录结果。

### 前端
- 在 Attachment storage 下方新增 "Database Backup" 卡片（admin-only，与 Storage 设置同一权限层级）：
  - 展示上次备份时间/状态（成功/失败）。
  - "立即备份" 按钮 → 调 `BackupNow`，loading/成功/失败态。
  - 自动备份说明文案（"服务器每周自动备份一次"）。
  - 备份范围文案要明确写清楚："仅备份 SQLite 数据库文件（memo/用户/设置等结构化数据），不包含已上传的附件/图片文件本身"——这一条依然成立，只是不再需要"仅本用户"这个限定语。

### 风险
- **`VACUUM INTO` 对磁盘空间的临时占用**：会在本地生成一份和当前数据库同等大小的临时文件，数据库较大时需要确保磁盘有余量；上传完成后必须保证临时文件被清理（用 `defer os.Remove`）。
- **备份期间的资源峰值**：`VACUUM INTO` 本身对 sqlite 是只读友好操作，不阻塞写入，但涉及一次全量读盘+写盘，数据库很大时会有明显 IO，建议放在低峰期（凌晨）跑每周任务，也允许 UI 上手动触发。
- **备份和第 1/2 节改动的耦合**：备份复用的是"Storage Configuration"里保存的 S3 凭证，因此必须排在 proto/store 改造（第 2 节第 1 点）之后实现。
- **不再需要**（相对上一版方案的简化点，明确记录避免以后又加回去）：不需要按表清单过滤、不需要 uid 重写外键引用、不需要脱敏 password_hash/token（因为不再导出结构化 JSON，直接是数据库文件本身——但这也意味着备份文件里包含 password_hash 等敏感字段，只是以“数据库文件”的形式存在，风险等级和数据库本身一致，管理员需要自行保护好 S3 桶的访问权限，这一点应在 UI 文案里提示）。

### 工作量估计：后端 0.5-1 天（`BackupNow` + runner + 一个状态存储字段），前端 0.5 天。相比上一版方案（1-1.5 天后端）明显下降，因为省去了整套按表导出 + 脱敏 + uid 重写逻辑。

---

## 4. 建议的实施顺序（有依赖关系，不能任意并行）

1. **Storage Configuration/Attachment storage 的 proto+store 拆分**（第 2 节第 1 点）—— 这是地基，第 1、3 节都依赖这个新的数据结构。
2. **S3 代理化改造**（第 1 节）—— 可与步骤 1 的前端部分并行，但依赖同一个 S3 client 封装，建议同一批改。
3. **Storage 页面前端重构**（第 2 节 UI）。
4. **全站数据库备份**（第 3 节，简化版）—— 最后做，依赖 1、2 都稳定；因为不再涉及按用户过滤/脱敏这套复杂逻辑，实际排期可以和 PR2 打包在一起，不必单独拉一个 PR3 的周期。

### 总工作量估计：约 4-5.5 天（含联调与回归，相比上一版下降约 1-1.5 天，主要来自备份方案简化），建议拆成 3 个独立 PR 落地：
- PR1：Storage proto/store 拆分 + Storage 页面重构（配置与生效分离、下拉+弹窗确认）
- PR2：S3 代理化（停用裸预签名、删 s3presign runner、迁移历史数据）
- PR3：全站 SQLite → S3 备份（`VACUUM INTO` + 手动/每周自动上传）

---

## 5. 需要你确认的开放问题

1. `AttachmentType.EXTERNAL`（如果存在，需要在实现时确认）是否就是"用户手动粘贴的外部链接"这个语义？如果是，改造时要明确只去掉 S3 类型的 externalLink 分支，不能连真正的外链附件也代理化。
2. 备份的 bucket/前缀是复用 Attachment storage 同一个 S3 桶（仅换 prefix），还是允许 admin 单独指定一个备份专用桶？如果是后者，第 3 节的"复用同一份凭证"假设需要改成"同凭证、可选自定义 bucket 名"。
3. ~~备份文件本质是整份 sqlite 快照...是否需要额外加一层加密？~~ **已确认：不需要加密**，只做 UI 文案提示（已实现，见下方实施状态）。

---

## 6. 实施状态（2026-07-04）

三个 PR 均已实现并通过 `go build`/`go vet`/`go test ./...`（后端）与 `tsc --noEmit`（前端相关文件）：

- **PR1**（Storage Configuration/Attachment storage 拆分）：proto 层本来就已经把 `s3_config` 和 `storage_type` 存成独立字段，无需 schema 改动；重写了 [StorageSection.tsx](../../../web/src/components/Settings/StorageSection.tsx) 为三段式布局（S3 配置持久化 + 删除按钮、下拉选切换 active 类型 + 二次确认弹窗）。
- **PR2**（S3 代理化）：[attachment_service.go](../../../server/router/api/v1/attachment_service.go) 不再对 S3 附件调用 `PresignGetObject`，`Reference` 只存 S3 key；`convertAttachmentFromStore` 和 [rss.go](../../../server/router/rss/rss.go) 都不再把 S3 附件的 Reference 当外链返回；[fileserver.go](../../../server/router/fileserver/fileserver.go) 的 `serveMediaStream`（视频/音频流）之前是重定向到预签名 URL，已改为走已有的 `getAttachmentReader` 代理流式传输；删除了 `server/runner/s3presign` 整个包及 `PresignGetObject` 死代码。
- **PR3**（数据库备份）：新增 proto `InstanceSetting.BACKUP` key + `BackupSetting` 消息 + `BackupNow` RPC；[server/backup/backup.go](../../../server/backup/backup.go) 用 `VACUUM INTO` 生成一致性快照、gzip 压缩、上传到已配置的 S3；[server/runner/backup](../../../server/runner/backup/runner.go) 提供每周自动触发（不在启动时立即跑一次，避免每次重启服务器都触发一次全量备份）；[StorageSection.tsx](../../../web/src/components/Settings/StorageSection.tsx) 新增 "Database backup" 卡片显示上次备份时间/状态 + 立即备份按钮。

未做的事（按讨论明确排除）：备份文件加密、按用户过滤导出、S3 生命周期规则的自动化配置（仍是文档指引）。

**后续追加（同日）**：新增了可配置的备份路径模板 `InstanceBackupSetting.path_template`（默认 `backups/{timestamp}_{uuid}.db.gz`，支持与 `StorageSetting.filepath_template` 相同的占位符，除 `{filename}` 外），管理员可在 Database backup 卡片里直接编辑并保存，`BackupNow`/每周 runner 都会用这个模板生成 S3 object key。`UpdateInstanceSetting` 对 BACKUP key 的处理从"完全拒绝"改为"允许更新 path_template，但强制保留服务器写入的 last_backup_* 状态字段"，避免管理员改路径时把上次备份状态清空。
