# 线上备份功能的两个 bug

发现于 2026-08-04，在评估 [standalone 本地部署](requirement.md) 时顺带查出。两个都影响
**现有线上实例**，与 standalone 无关，应当先行修复合入。

---

## Bug 1：自动备份从未执行过

### 现象

线上定时备份没生效。`InstanceSetting_BACKUP` 里的 `LastBackupTime` 只有手动点
`BackupNow` 时才更新。

### 根因

[server/runner/backup/runner.go:35](../../../server/runner/backup/runner.go:35)：

```go
ticker := time.NewTicker(runnerInterval)   // 7 * 24h
for {
    select {
    case <-ticker.C:
        r.RunOnce(ctx)     // ← 唯一的触发点
    case <-ctx.Done():
        return
    }
}
```

两个缺陷叠加：

1. **启动时不跑**。第一次触发必须等进程**连续运行满 7 天**。
2. **进度不持久化**。计时器活在内存里，每次重启归零。`LastBackupTime` 全库范围内只被
   写入和展示（[instance_service.go:522](../../../server/router/api/v1/instance_service.go:522)），
   **没有任何一处读它来决定该不该跑**。

线上是在积极开发的项目，部署频率远高于 7 天。两者相乘的结果是：**自动备份自上线以来
一次都没有触发过**。

### 为什么一直没被发现

[runner.go:52](../../../server/runner/backup/runner.go:52) 把失败日志压到了 `Info`：

```go
// Most commonly this just means S3 storage isn't configured yet ...
slog.Info("scheduled database backup did not complete", "error", err)
```

出发点是不惊扰没配 S3 的用户，但代价是「配了 S3 且真的失败了」这种情况也一并静音了。
没有告警，没有人看日志，所以没人察觉。

### 修法

调度改为**基于 `LastBackupTime` 的追赶式**，而不是纯内存 ticker：

- 启动后延迟约 30s（等 store 就绪）做一次判断，`now - LastBackupTime >= interval`
  就立即补跑。
- 之后用**短周期** ticker（如 1 小时）反复做同一判断。ticker 周期不再等于备份周期。

这样重启不重置进度，也天然覆盖「关机一段时间后开机」——正好是 standalone 那边
Mac mini 的日常。

日志分级同时修掉：

- 未配置 S3 → 保持 `Info`
- 已配置但执行失败 → `Warn` 或 `Error`

这两种情况混在一起，是这个 bug 藏了这么久的直接原因。

---

## Bug 2：自定义备份路径每次备份后被重置

### 现象

用户在设置里配置了 bucket 内的备份路径模板，备份跑过一次之后路径就变回默认值
`backups/{timestamp}_{uuid}.db.gz`，自定义配置没有持久化。

### 根因

[server/backup/backup.go:35](../../../server/backup/backup.go:35) 的 `Run()` 在记录备份
状态时，**新建了一个 `InstanceBackupSetting` 并整体覆盖写回**：

```go
backupSetting := &storepb.InstanceBackupSetting{
    LastBackupTime:    timestamppb.Now(),
    LastBackupSuccess: runErr == nil,
}
// ← PathTemplate 没有带上
stores.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
    Key:   storepb.InstanceSettingKey_BACKUP,
    Value: &storepb.InstanceSetting_BackupSetting{BackupSetting: backupSetting},
})
```

`UpsertInstanceSetting` 是整体替换而非字段级 patch，所以 `PathTemplate` 被写成空串。
下次读取时 [instance_setting.go:312](../../../store/instance_setting.go:312) 发现为空，
自动填回默认模板——用户的配置就这样悄悄消失了。

讽刺的是，**反方向的同一个坑已经被正确处理过**。
[instance_service.go:266](../../../server/router/api/v1/instance_service.go:266) 有一段注释
专门解释为什么写入时要把 `last_backup_*` 带上：

> Only path_template is client-editable; last_backup_* is written exclusively by the
> backup runner/RPC, so always carry the existing status forward regardless of what the
> client sent

API 侧记得把状态字段带过去，backup 侧忘了把配置字段带过去。两边是对称的，只补了一半。

### 修法

`Run()` 写状态前先读出现有 setting，在其基础上只改 `last_backup_*` 字段，其余原样保留。

更彻底的做法是给 `UpsertInstanceSetting` 加字段级更新能力，但那是更大的改动；
本次按前者修，并在两处都留注释说明这个 setting 是「双向写入」的，任何一方整体覆盖
都会踩到对方。

### 回归测试

- 设置自定义路径 → 触发备份 → 确认路径仍是自定义值，且对象确实落在该路径下
- 触发一次**失败**的备份（如故意填错 bucket）→ 确认路径同样没被重置

---

## 修复顺序

两个 bug 互相独立，但建议一起修一起测：Bug 1 修好之后自动备份才会真的跑起来，
Bug 2 的破坏面（每次备份都重置一遍路径）也才会真正显现。
