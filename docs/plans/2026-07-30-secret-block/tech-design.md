# 加密文本块 — 分阶段实施

需求与关键决策见 [requirement.md](./requirement.md)。

## P0 · 契约与纯逻辑 ✅

| 产出 | 位置 |
| --- | --- |
| 服务契约 | [secret_block_service.proto](../../../proto/api/v1/secret_block_service.proto) |
| md 块解析/序列化 | [secret-block.ts](../../../web/src/utils/secret-block.ts) |
| 加解密 | [secret-crypto.ts](../../../web/src/utils/secret-crypto.ts) |
| 单测 | [secret-block.test.ts](../../../web/tests/secret-block.test.ts)、[secret-crypto.test.ts](../../../web/tests/secret-crypto.test.ts) |

先做纯函数再动数据库，是为了后面出问题时能一眼排除掉加解密本身。

两个实现上的取舍值得记一笔：

- **解析器拒绝未知 key**，而不是跳过。一个我们看不全的块可能属于未来某个格式，那个格式里
  `id` 的含义可能不同，只认得 id 就照着去取记录有解错记录的风险。
- **测试跑 100k 轮而不是生产的 600k**。迭代次数与被测性质正交，600k 会让整个套件被 KDF
  占满。`encryptSecret` 因此接受 `iterations` 覆盖，应用代码不得调低。

## P1 · 存储层 ✅

| 产出 | 位置 |
| --- | --- |
| Migration ×3 | [sqlite 0.30/09](../../../store/migration/sqlite/0.30/09__secret_block.sql)、[mysql 0.30/09](../../../store/migration/mysql/0.30/09__secret_block.sql)、[postgres 0.30/08](../../../store/migration/postgres/0.30/08__secret_block.sql)（各驱动下一个可用序号不同） |
| LATEST.sql ×3 | 三份均已追加 `secret_block` |
| 模型 | [store/secret_block.go](../../../store/secret_block.go) |
| 驱动实现 ×3 | `store/db/{sqlite,postgres,mysql}/secret_block.go` |
| 测试 | [secret_block_test.go](../../../store/test/secret_block_test.go) |

三个驱动都做了真实现。[memo_chunk.go](../../../store/db/postgres/memo_chunk.go) 那种
postgres/mysql 返回 unimplemented 的做法对 RAG 可以接受（降级成没有语义搜索），对加密块
不行 —— 那会变成"在 MySQL 上文档打不开"。

表结构刻意**不含 `memo_id`、不设外键、不做级联删除**。
`TestSecretBlockStoreSurvivesReferencingMemoDeletion` 把这条守住：删掉引用它的文档之后
密文记录必须还在。

`ListSecretBlockSummaries` 在 SQL 层就不 select 密文列，而不是查出来再丢掉 —— 让"列表
接口泄露密文"在结构上不可能发生。

验证：`go test -run TestSecretBlock ./store/test/...`（5 项通过；mysql/postgres 分支需要
Docker，本机未跑）

> 顺带发现一个**既有问题**（与本功能无关）：[migrator.go](../../../store/migrator.go) 的
> `preMigrate` 对新装库只执行 `LATEST.sql` 并立刻写入当前版本号，因此 `0.30/` 下的增量迁移
> 在全新安装上永不执行。而 `memo_history` 只出现在 mysql 的 LATEST.sql —— sqlite/postgres
> 的全新实例会缺这张表。已单独记为待办。
>
> 同样先记一笔：`TestInstanceSettingStorageSetting` 在**未改动的主干上**即失败，与本次改动无关。

## P2 · 服务层

- `cd proto && buf generate`
- `server/router/api/v1/secret_block_service.go`
- 所有方法都需要登录，**不进** [acl_config.go](../../../server/router/api/v1/acl_config.go)
  的 `PublicMethods`；`GetSecretBlock` 只允许 `creator_id == 当前用户`
- `GetSecretBlock` 响应设 `Cache-Control: no-store`

验证：`go test -v -race ./server/...`

## 编辑器入口（已插队完成）

工具栏"折叠块"下拉菜单底部（分隔线之下）加了一项**密文块**，点击在光标处插入示例围栏。
实现在 [FormattingToolbar.tsx](../../../web/src/components/MemoEditor/Toolbar/FormattingToolbar.tsx)，
文案键 `editor.secret.block`（en / zh-Hans）。

加分隔线是因为密文块并不是折叠标注，只是共用这个菜单作为插入入口。

插入的 id 是占位符 `REPLACE_WITH_SECRET_ID`，**刻意选了一个符合 id 规则的值**：这样块能被
解析，渲染出"记录不存在"而不是"格式错误"——前者提示用户去换 id，后者会让人以为自己写坏了。

这是个临时形态。P4 的加密对话框落地后，这一项应该改成**打开对话框**，让 id 来自一条真实
存在的记录，而不是让用户手填。

## P3 · 渲染与解锁 UI

- `SecretBlock.tsx`，挂到 [CodeBlock.tsx](../../../web/src/components/MemoContent/CodeBlock.tsx)
  的语言分发（`mermaid` / `kanban` / `sheets` 是现成先例）
- 锁定态卡片显示 hint 与解锁按钮，**不预取密文**
- 解锁面板：输口令 → 拉密文 → 本地解密 → 显示明文 + 复制按钮；明文只在组件局部 state，
  关闭即销毁，绝不写回 memo content

## P4 · 加密对话框

独立于主编辑器的对话框：输明文 → 本地加密 → `CreateSecretBlock` → 只把 id 插入正文。

实现后必须逐条走查：明文不进主编辑器 state、不触发草稿 autosave / localStorage、
不进任何 memo 保存请求。这一环做错的话功能看起来正常但完全无效，且不报错。

## P5 · 错误态与边界

- `SecretPassphraseError` / `SecretIntegrityError` / `SecretFormatError` 三类分别给不同文案
- id 解析不到 → "此加密块在当前实例中不存在"
- 未登录访问公开分享文档中的加密块 → "此处有加密内容，需登录"
- 换口令 = 重新加密后 `UpdateSecretBlock` 覆盖同一条记录

## 文档

`docs/manual` 在 P3/P4 落地、功能对用户可见之后再更新 —— 面向用户的手册描述的是操作，
现在还没有可操作的东西。落点是 [06-view-blocks.md](../../manual/06-view-blocks.md)
（同属 fenced block 家族）与 [07-api-reference.md](../../manual/07-api-reference.md)，
以及 [README.md](../../manual/README.md) 的索引表。
