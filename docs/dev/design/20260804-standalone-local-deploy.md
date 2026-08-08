# 方案评估与开发计划

对 [requirement.md](requirement.md) 的代码级复核。结论：**方案成立，四个关键决策都同意**，
但需求文档漏了三处会直接导致返工的技术依赖，工期估计偏乐观。

## 一、对已有决策的复核

| 决策 | 结论 |
|---|---|
| 不引入 Litestream | 同意。理由（单文件冲突 + 上游 API 不稳定）成立 |
| 不支持多端，靠文档约束 | 同意。租约是唯一正确解，中途方案只会把静默丢数据变成更隐蔽的静默丢数据 |
| 不强制 S3 | 同意 |
| standalone 凭证走 env | 同意，且**实现成本接近零**：`s3.NewClient` 接受的是 `storepb.StorageS3Config` 结构体（[s3.go:26](../../../internal/storage/s3/s3.go:26)），env 路径只需就地拼一个同类型结构体传进去，不碰客户端本身 |

「恢复时 DB 尚不存在，所以凭证不可能来自 DB」这个论证是对的，而且**比文档写的更强**——
见下面的漏项 3，同一个循环依赖还牵连到备份路径模板。

## 二、需求文档遗漏的三处（会直接返工）

### 漏项 1：S3 客户端没有 ListObjects，恢复路径无从谈起

现有 `Client` 只有四个方法：`UploadObject` / `GetObject` / `GetObjectStream` / `DeleteObject`
（[s3.go:115-158](../../../internal/storage/s3/s3.go:115)）。**没有列举能力**。

而需求 A 的整张状态机建立在「ListObjects 返回 0」这个三态判定上：

- 返回 N>0 个对象 → 有快照，恢复
- 返回 0 个对象且**无错误** → 确认为空，建新库
- 任何错误（网络 / 凭证 / bucket 不存在 / 403）→ 硬失败退出

第二和第三种的区分**必须由这个方法本身负责**，不能让调用方去猜。注意 403 尤其危险：
权限不足的 key 在某些 S3 兼容实现上 List 会返回**空列表而非错误**，会被误判成「首次部署」，
正好踩中需求里点名的最坏情况。因此实现上要先 `HeadBucket` 探活再 List，两步都成功才允许
「确认为空」这个结论。

**新增工作量：`ListObjects` + `HeadBucket`，约 60 行，A 项的前置。**

### 漏项 2：恢复必须发生在 `db.NewDBDriver` 之前

[main.go](../../../cmd/memos/main.go) 当前顺序是 `NewDBDriver` → `Migrate` → `NewServer`。
SQLite driver 一旦 Open 就会**创建空的 db 文件**，此后「本地无 DB」的判定永久失效。

所以恢复必须是 `NewDBDriver` 之前的一个独立阶段，用 `os.Stat` 判断本地文件是否存在，
且失败退出时**不能留下任何半成品文件**（下载到 `.tmp` 再 rename，rename 前校验 gzip 完整性
和 SQLite header）。

这行顺序写反了不会报错、不会有任何症状，只会在用户第一次断网启动时把 S3 上的真数据覆盖掉。
**要求写一条针对启动顺序的单元测试，而不是靠 review 保证。**

### 漏项 3：备份路径模板同样存在「DB 尚不存在」的循环依赖

需求正确识别了 S3 凭证的循环依赖，但漏了同一个环上的另一个：
**`path_template` 也存在 `InstanceSetting` 里**（[backup.go](../../../server/backup/backup.go) 的
`renderPathTemplate(backupSetting.PathTemplate)`）。恢复时读不到它，也就不知道快照在
bucket 里的哪个前缀下。

而且模板可自定义、含 `{uuid}`，**key 的字典序和时间序无关**，不能靠排序找最新。

解法：List 时按 `LastModified` 取最新，前缀来自新增的 `TOUCAN_S3_PREFIX`（默认 `backups/`）。
这条要和凭证 env 一起在文档里写清楚：standalone 模式下改了 `path_template` 而不改 env 前缀，
下次恢复就找不到快照。**更稳妥的做法是 standalone 模式直接忽略 DB 里的 path_template，
强制使用 env 前缀 + 固定命名**，让备份和恢复两侧共用同一个不依赖 DB 的规则。建议采用后者。

## 三、可以直接消掉的一项不确定性

需求「验收测试」第 6 条把 FTS/向量索引能否随快照恢复列为**未验证**。这一条现在可以确定，
不需要单独调研：

- `memo_chunk_fts` 是 **standalone FTS5** 表（[LATEST.sql:201](../../../store/migration/sqlite/LATEST.sql:201)），
  不是 external-content。它的 shadow 表（`_data` / `_idx` / `_docsize` / `_config`）都是
  同一个 db 文件里的普通表。
- embedding 是 `memo_chunk.embedding` 的 **BLOB 列**（[LATEST.sql:186](../../../store/migration/sqlite/LATEST.sql:186)），
  没有用 sqlite-vec 之类的扩展，没有外部索引文件。

`VACUUM INTO` 复制整个逻辑数据库，以上全部包含在内，**恢复后可直接使用，无需重建**。
保留一条回归断言（恢复后 `rag_search` 命中数与备份前一致）即可，不必排调研时间。

一个真正需要注意的相关点：`VACUUM INTO` 期间 FTS5 表体积会显著放大快照。几十 MB 的库
无所谓，但备份间隔缩到 10 分钟后，每次全量传的实际是 db + FTS 索引，要在文档里给出
「快照体积约为可见内容的 2~3 倍」的预期。

## 四、风险登记

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 网络故障被误判为首次部署，建空库并覆盖远端 | **数据全损** | 三态判定 + HeadBucket 前置 + 漏项 2 的顺序测试；任何非「确认为空」一律 exit(1) |
| R2 | 用户同时跑两个实例 | **静默丢数据，无告警** | 仅文档约束（已接受）。建议加一条**极低成本的兜底**：备份时把上一次上传的对象 key 记在本地文件，若远端最新快照的 key 不是自己上传的那个，说明有别的写者，`Warn` 并在 UI 挂条 —— 不阻断，约 30 行，把「静默」降级为「有提示」 |
| R3 | 快照 = 全权凭证（含明文 PAT / IdP secret） | 泄露即全实例沦陷 | 已接受此前提，文档已写。standalone 下 env 凭证是零成本副产品 |
| R4 | 断电 / 合盖，最后一次备份后的编辑丢失 | 最多丢一个间隔 | 间隔默认 10 分钟 + 退出 flush。**不要指望 flush 兜底**，间隔才是真正的 RPO |
| R5 | multipart 上传被 kill -9 中断，留下 orphan part 持续计费 | 成本，非数据 | 快照几十 MB 走单次 PUT（原子，不会产生半个对象），验收第 4 条天然满足；文档建议配 bucket 的 abort-incomplete-multipart lifecycle |
| R6 | 恢复后 memogit 工作区状态与 DB 不一致 | 功能异常 | 见验收 E2E；memogit 侧的本地文件不在快照内，需明确恢复后的行为 |

R1 是唯一的「不可接受」级风险，其余都可接受或有低成本缓解。

## 五、开发计划

Bug 修复独立于 standalone，**先合入主干**。

### P0 — 备份 bug 修复（独立 PR，0.5 天）

- `runner.go`：改为基于 `LastBackupTime` 的追赶式调度。
  **不要用「延迟 30s」**——那是一个不可测的时序耦合。改为 `Start` 成功返回后立即做一次判定，
  之后短周期 ticker（1h）重复判定。
- `runner.go`：日志分级，未配置 S3 → `Info`，已配置但失败 → `Error`。
- `backup.go` `Run()`：先读现有 setting，仅覆写 `last_backup_*`，两侧各留注释说明双向写入。
- 测试：自定义路径 → 备份成功/失败各一次 → 断言 `path_template` 未被重置。

### P1 — S3 客户端扩展（0.5 天）

`ListObjects` + `HeadBucket`，错误与空列表严格分离。带单测（用错误凭证 / 不存在的 bucket）。
**这是 P2 的硬前置。**

### P2 — 启动状态机 + 恢复（2.5 天，核心）

- env 凭证读取（`TOUCAN_S3_*` + `TOUCAN_S3_PREFIX`），env 优先于 DB。
- 恢复阶段插入 `main.go` 的 `NewDBDriver` **之前**。
- 四态判定表实现，下载 → 校验 gzip + SQLite header → 原子 rename。
- 单测覆盖全部四态，其中「本地无 DB + 远端未知」必须断言进程退出且**未创建任何文件**。

### P3 — 备份频率可配 + 退出 flush（0.5 天）

依赖 P0。`runnerInterval` 可配，standalone 默认 10 分钟；SIGTERM/SIGINT 时同步跑一次再退出
（注意 `main.go` 现有 shutdown 是 `s.Shutdown` 后立刻 `cancel()`，flush 要插在 cancel 之前，
否则 ctx 已死，备份必然失败）。

### P4 — 首启引导 UI + 未备份警告条（1.5 天）

管理员账号创建已有；新增的是可跳过的 S3 引导 + 持久警告条。前端占大头。

### P5 — 打包 CI（0.5 天）

GH Actions matrix：darwin arm64/amd64、windows amd64、linux amd64。

### P6 — E2E 验收（1.5 天）

需求里的 6 条全跑，第 3 条（拔网线）用注入错误 endpoint 的方式做成可重复的自动化用例，
不要靠人肉拔网线。

## 六、成本结论

**7 天**（需求估的 3~5 天偏乐观），差额来自：

- P1 的 S3 列举能力是需求未计入的新增；
- P2 的四态判定单测是这个功能里唯一能防住 R1 的东西，不能压缩；
- P6 的 E2E 需求自己也说「测试是大头」，1.5 天是下限。

可压缩项：P4 首启引导可以退化为「文档 + 设置页已有的 S3 表单 + 一条警告条」，省 1 天，
不影响任何数据安全属性。若要赶时间，砍这里。

**不可压缩：P1 → P2 的顺序，以及 P2 的四态单测。**
