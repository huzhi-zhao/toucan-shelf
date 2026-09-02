# 附件对象迁移 —— 技术方案与分阶段实施

需求、承诺与验收判据见
[requirements/storage/20260826-attachment-object-migration.md](../requirements/storage/20260826-attachment-object-migration.md)。
上线执行见 [launch/20260826-attachment-object-migration.md](../launch/20260826-attachment-object-migration.md)。

本篇只写方案取舍与实施切分。

---

## 1. 骨架：一个附件的迁移是三步

```text
①  算出目标 key            （纯函数，不碰网络，可 dry-run）
②  把对象复制到目标位置     （幂等：已存在且大小一致就跳过）
③  改数据库指针            （reference / payload.key / payload.s3_config）
```

没有第四步。**源对象不删**（需求 §3），因此整个流程里没有任何不可逆操作，
任何一步失败都可以原地重跑。

三步之间不需要事务：②做完③没做，重跑时②跳过、③补上；③做完再跑，①算出的
目标与当前 key 相同，整条跳过。**幂等性完全由"①是纯函数且结果稳定"支撑**，
这是下一节所有约束的来源。

## 2. 目标 key 怎么算

### 规则

```text
目标 key = expandDir(当前 filepath_template 的目录部分) + "/" + basename(原 key)
```

- **目录部分**：模板去掉最后一段（含 `{filename}` 的那段）。默认模板
  `assets/{workspace}/{timestamp}_{uuid}_{filename}` 的目录部分是
  `assets/{workspace}`。
- **`{workspace}`** 展开为该附件所属知识库的 `storage_slug`；解析不出知识库时
  用 `_unassigned`，与新上传时的行为一致（`unassignedWorkspaceSlug`）。
- **时间类占位符**（`{year}` `{month}` `{day}` `{hour}` `{minute}` `{second}`
  `{timestamp}`）展开时用**附件的 `created_ts`**，不是"现在"。
- **`basename` 原样保留**：原 key 的最后一段（如
  `1755847231_9f3a..._diagram.png`）不做任何改写。

### 为什么不整套重新套模板

重新套一遍模板会重算 `{timestamp}` 和 `{uuid}`，等于给每个文件改名：既没有
价值，又让同一个附件在两次迁移里算出不同的目标，直接破坏"可重复跑"。
保留 basename 还顺带解决了唯一性——原文件名里的 uuid 段已经保证了不撞。

时间占位符用 `created_ts` 而不是"现在"，是同一个理由：用"现在"的话，今天跑
和明天跑算出的目录不同，重跑会把文件搬来搬去。

### 模板合法性检查（必须前置拦截）

如果模板的**目录部分**含有 `{uuid}`，则目标 key 不稳定，幂等性不成立。
这种情况下迁移必须**直接拒绝执行**并提示先改模板，而不是"尽力而为"。
`{filename}` 出现在目录部分同理拒绝（会把文件名塞进目录层）。

这个检查放在 dry-run 的最前面，一次性对整个实例判定，不是逐条判定。

## 3. 知识库归属怎么解析

`attachment.memo_id → memo.workspace_id → workspace.storage_slug`。

三种落不到知识库的情况，全部归入 `_unassigned`：附件没有关联文档（上传了
没用上的孤儿）、关联的文档已不存在、知识库还没有 `storage_slug`。

最后一种要注意：`storage_slug` 是懒生成的（`EnsureWorkspaceStorageSlug`
在第一次上传时才写入），老知识库可能是空的。迁移**应当主动补齐**——对每个
涉及的知识库调一次 `EnsureWorkspaceStorageSlug`，而不是把它们扔进
`_unassigned`。否则技术债只修了一半。

补齐分两种模式，因为 dry-run 必须是只读的：dry-run 用 `GenerateStorageSlug`
**只算不写**，在报告里把这条标成"slug 将被补齐"；`--apply` 才真的调
`EnsureWorkspaceStorageSlug` 落库。两者用的是同一个生成函数，所以报告里看到
的目录名就是最终会用的目录名。落库这一步必须做，否则迁移之后新上传的附件会
再生成一个 slug，跟迁移用的目录对不上。

## 4. 对象怎么复制

**源在哪**：优先用该附件 `payload.s3_object.s3_config` 里的 endpoint 与 bucket
（它记录了这个对象实际被写到哪），快照为空时退回实例当前配置。
**目标**永远是实例当前配置的 bucket。

两种复制路径：

| 场景 | 做法 |
|---|---|
| 源与目标 endpoint 相同（含同桶换前缀、同 endpoint 换桶） | 服务端 `CopyObject`，字节不经过本机 |
| 源与目标 endpoint 不同（换了云厂商） | `GetObjectStream` + `UploadObject`，走本机中转 |

为此需要给 `internal/storage/s3/s3.go` 补两个方法：`CopyObject` 和
`HeadObject`（后者用于②的幂等判定与③之前的存在性校验）。目前那个 client
只有 Upload/Get/Delete。

**幂等判定**：目标 key 已存在时，比对 `HeadObject` 返回的 size 与
`attachment.size`——一致则认为是上次跑留下的，跳过复制直接进③；不一致则
判定为**键冲突**，跳过这一条并计入错误报告，不覆盖。给定 basename 里带 uuid，
真实冲突的概率极低，出现了就是有别的东西在写这个桶，值得人看一眼。

## 5. 数据库指针怎么改

一次 `UpdateAttachment` 同时写三样：

- `reference` = 新 key（虽然当前没有读取方，但两处不一致迟早咬人）
- `payload.s3_object.key` = 新 key
- `payload.s3_object.s3_config` = **实例当前配置**

第三条是顺带修的一个隐患：快照如果一直停留在旧桶，将来实例的 S3 配置被清空
时，`ResolveAttachmentS3Config` 的兜底会指向一个已经被整桶删掉的位置。迁移
既然已经把对象搬到当前配置的桶里，快照就该同步过去。

## 6. 入口：CLI 子命令，不做 UI

在 `cmd/memos` 下加一个子命令（复用现有的 profile/flag 与 store 初始化）：

```text
memos migrate-attachments            # 默认 dry-run，只打印计划
memos migrate-attachments --apply    # 真的执行
```

dry-run 的输出是这次迁移的**决策依据**，必须包含：附件总数、已在位数量、
待迁移数量（按知识库 slug 分组）、孤儿数量、无法处理的条目及原因
（缺 payload、模板非法、源对象不存在）。

**为什么不做管理端 API + 后台任务 + 进度条**（BackupNow 那套）：这是技术债
清理加偶尔的运维动作，不是日常功能；2000 个对象串行跑几分钟就结束，进度条
的信息量约等于零。真出现"经常换桶"的场景再包一层 API 不迟，届时本方案的
①②③三步可以原样复用。

**为什么不是 SQL 脚本**：目标 key 依赖模板展开与知识库解析，且必须与真实的
S3 对象状态对账，纯 SQL 做不到，硬做就是把逻辑复制一份到脚本里。

## 7. 存储后端锁定放在哪

判定落在 `UpdateInstanceSetting` 处理 `STORAGE` 这一支里（
[instance_service.go](../../../server/router/api/v1/instance_service.go) 已有
S3 config 的校验分支，加在同处）：**当请求把 `storage_type` 改成与当前不同的
值时**，统计存量附件里 `storage_type` 与目标不符的数量，非零则拒绝。

对照关系：设置里的 `LOCAL` 对应附件的 `LOCAL`，`S3` 对应 `S3`，`DATABASE`
对应 `ATTACHMENT_STORAGE_TYPE_UNSPECIFIED`（库内 blob 的附件不写
storage_type，见 `SaveAttachmentBlob` 两个分支之外的情况）。`EXTERNAL` 不参与
判定。

错误信息必须带上数量与后端名，例如"当前有 1987 个附件存在 S3，切换到本地
存储前需要先迁移"。前端不预判、不灰化选项，直接把后端的错误 toast 出来——
预判需要再开一个计数接口，而这个操作一年也点不了一次。

## 8. 被否决的选项

**把旧对象移动（copy 后立刻 delete）**：省一份存储，但让整个流程变成不可逆。
以 2000 个附件的体量，多一份拷贝的成本可以忽略，不值得用可回滚性去换。

**在读取时做路径兜底（先试新 key，404 再试旧 key）**：不用迁移就能"看起来
正常"。否决理由是它把技术债变成永久的运行时开销和一条永远删不掉的兼容分支，
且换桶场景根本救不了（旧桶已经被删）。要治就一次治干净。

**给附件表加一列记录"迁移状态"**：三步流程的幂等性已经由"①是纯函数 + ②③
可重入"保证，状态列只会引入一个需要维护的、可能与真实 S3 状态不一致的副本。

## 9. 分阶段

**P0 —— 存储后端锁定（先做，与迁移解耦）。** 只改 `UpdateInstanceSetting`
的校验与错误文案，加测试。风险为零，先落地，防止在迁移能力就绪前有人制造
出混合实例。

**P1 —— s3 client 补 `CopyObject` / `HeadObject`。** 纯增量，带单测。

**P2 —— 迁移子命令的 dry-run。** 只读：算目标 key、解析知识库、对账 S3、
出报告。此时就能拿到真实数据判断存量长什么样，且完全不改任何东西。

**P3 —— `--apply`。** 复制 + 改指针。先在测试桶上跑，再上生产。

**P4 —— 补齐知识库 slug。** 实施时并入了子命令本身（见 §3）：dry-run 预览
slug，`--apply` 顺手落库。所以不再是一个需要人工先跑一遍的独立步骤，只需在
读 dry-run 报告时确认标了"slug 将被补齐"的那些知识库名字是对的。

## 10. 风险登记

| 风险 | 触发条件 | 处置 |
|---|---|---|
| 迁移后桶体积翻倍 | 不删源（设计如此） | 上线前告知；换桶场景整桶删旧桶，原地场景配生命周期规则 |
| 目标 key 冲突 | 桶里有非本实例写入的同名对象 | 跳过并计入报告，绝不覆盖 |
| 模板含不稳定占位符 | 用户把 `{uuid}` 放进目录段 | dry-run 阶段整体拒绝执行，提示先改模板 |
| 迁移中途有人上传 | 迁移与使用并行 | 新附件本就写在目标位置，①算出的 key 与现状相同，自动跳过 |
| 快照 endpoint 已下线 | 换了云厂商且旧厂商已注销 | 源读不到，条目失败并记录；这种情况下附件本来就已经丢了，迁移只是把事实暴露出来 |
