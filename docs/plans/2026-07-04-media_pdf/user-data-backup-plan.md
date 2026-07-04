仅备份某用户在 SQLite 中的数据(不含附件文件本身)
1. 范围表清单
按刚才梳理的规则,分四类处理:

表	过滤方式	说明
user	id = :uid	只导出这一行(不含 password_hash 建议脱敏或按需保留)
user_setting	user_id = :uid	直接过滤
user_identity	user_id = :uid	直接过滤(OAuth 绑定信息,是否需要看诉求)
memo	creator_id = :uid	直接过滤
workspace	creator_id = :uid	直接过滤
workspace_folder	workspace_id IN (该用户的 workspace)	需先查出 workspace id 集合
attachment	creator_id = :uid	只导出元数据行(文件名/类型/size/reference/storage_type),明确不含 blob 实体和磁盘/S3 文件
memo_relation	memo_id IN (该用户 memo) AND related_memo_id IN (该用户 memo)	只保留双端都属于该用户的关系,避免恢复后指向不存在/不属于自己的 memo
memo_share	creator_id = :uid	直接过滤
reaction	creator_id = :uid	只备份"我做出的反应",不含"我收到的反应"(语义上属于对方数据)
inbox	不导出	收件箱是系统通知,通常不属于"用户数据备份"范畴,建议排除
system_setting / idp	不导出	全局配置,与用户无关
2. 一致性:单个只读事务里跑完所有查询
tx, _ := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
defer tx.Rollback()
// 依次查 user / memo / workspace / attachment ... 全部用这个 tx
WAL 模式下开一个事务就能拿到一致快照,避免备份过程中用户还在写入导致数据错位(比如 memo 存在但对应的 memo_relation 还没提交)。

3. 导出格式:JSON,按表分组,字段用列名而非位置
{
  "version": "1",
  "exported_ts": 1751600000,
  "user": { "id": 1, "username": "...", "email": "...", "nickname": "...", ... },
  "user_settings": [ { "key": "...", "value": "..." } ],
  "user_identities": [ ... ],
  "memos": [ { "uid": "abc123", "content": "...", "visibility": "PRIVATE", ... } ],
  "workspaces": [ { "uid": "...", "title": "..." } ],
  "workspace_folders": [ { "workspace_uid": "...", "path": "..." } ],
  "attachments": [ { "uid": "...", "filename": "...", "type": "...", "size": 123, "memo_uid": "...", "storage_type": "LOCAL", "reference": "assets/..." } ],
  "memo_relations": [ { "memo_uid": "...", "related_memo_uid": "...", "type": "..." } ],
  "memo_shares": [ { "uid": "...", "memo_uid": "...", "expires_ts": null } ],
  "reactions": [ { "content_id": "...", "reaction_type": "..." } ]
}
关键设计点:

所有跨表引用改成 uid(或该用户上下文里天然唯一的字符串),不带原始整数主键。memo、workspace、attachment、memo_share 本来就有 uid TEXT UNIQUE 字段,直接复用;workspace_folder/memo_relation 原生没有 uid,导出时用它们关联的父表 uid 代替整数 id(如上面 workspace_uid、memo_uid)。
这样这份 JSON 不依赖任何数据库自增 id,可以原样搬到另一台实例、或者同一实例升级 schema 后(id 重新分配)照样能恢复,不会因为主键冲突或漂移而失效。
password_hash、OAuth token 等敏感字段要么脱敏要么加密后存,别裸放进导出文件。
4. 代码落点(基于现有项目结构)
新增 store 层只读查询方法(如果现有 ListMemos 等方法已支持按 CreatorID 过滤,直接复用,不用重新写 SQL)。
新建 server/router/api/v1/backup_service.go(参照 attachment_service.go 的组织方式),提供一个 ExportUserData(ctx, userID) ([]byte, error):
开只读事务
依次查上表清单,拼成上面的 JSON 结构体(用 Go struct + encoding/json,不要拼字符串)
json.Marshal 输出 []byte
上传到 S3(用现有项目里应该已有的 S3 client 封装,如果 attachment 的 S3 storage 已经有 client 初始化逻辑,直接复用同一个 client 和 bucket 配置)
建议导出内容做 gzip 压缩后再传 S3(memo 内容是纯文本,压缩率通常很高)。
5. 成本
比含附件的完整方案小很多——预计 半天到 1 天:

复用现有 store 查询方法或写 6-8 个简单的按字段过滤查询
一个 JSON 序列化 + 打包函数
一次 S3 PutObject 调用(如果项目里已有 S3 client 封装,基本是照抄现成代码)
唯一需要仔细设计的是 workspace_folder / memo_relation 这两个没有 uid 字段的表如何用父表 uid 表示引用,以及 决定哪些字段属于"敏感,不导出/脱敏"(password_hash、identity 的 provider token 等),其余都是直白的 CRUD 过滤查询。