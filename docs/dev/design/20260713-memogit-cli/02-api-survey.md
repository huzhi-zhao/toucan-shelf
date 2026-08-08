# memogit：服务端 API 调研结论与工作量估算

状态：调研完成，用于评估 [[01-memogit-cli]] 方案的可行性与排期。
关联：[[01-memogit-cli]]

## 1. 调研结论：01 号方案的关键假设成立

对照 `proto/api/v1/memo_service.proto` 等实际代码逐条核对，01 号方案里"不改服务端代码，
完全复用现有 API"的假设基本成立：

- **分页/增量拉取**：`ListMemosRequest.page_size`/`page_token` 支持分页；`filter`
  字段支持 CEL 表达式，可查询 `updated_ts`/`created_ts`（时间戳）、`tags`
  （`"work" in tags`）、`visibility`、`pinned` 等（`memo_service.proto:379-424`）。
  增量 pull 用 `filter: updated_ts > <上次同步时间戳>` 完全可行。
  注意 `order_by` 用的是 `create_time`/`update_time`，`filter` 用的是
  `created_ts`/`updated_ts`，两套命名指同一字段，客户端实现时需注意区分。
- **CreateMemo**：`memo_id` 可选，客户端可指定 ID；留空则服务端生成
  （`memo_service.proto:369-376`）。
- **UpdateMemo**：`update_mask` 为 `google.protobuf.FieldMask`，可只更新 `content`
  字段而不影响其他属性（`memo_service.proto:444-451`）。
- **State / 归档语义**：`common.proto:7-11` 定义 `State { NORMAL=1; ARCHIVED=2 }`，
  只有两态，没有独立的"已删除"状态；`DeleteMemo` 是真删除（带 `force` 参数），
  ARCHIVED 是最接近"软删除"的机制。方案实现前需要明确：本地文件删除后 push，
  应该调 `DeleteMemo` 还是把服务端 memo 转成 ARCHIVED 状态。
- **PAT 鉴权**：标准 `Authorization: Bearer memos_pat_xxx` header 即可
  （`server/auth/authenticator.go:141` 按 `memos_pat_` 前缀自动分流到 PAT 校验，
  `server/auth/token.go:51-52`）。客户端无需处理短期 JWT 刷新逻辑。
- **Go 客户端零重新生成**：`proto/gen/api/v1/apiv1connect` 已是 buf 生成好的
  Connect-Go client + message 类型，memogit 作为独立 Go 二进制可直接
  `import "github.com/usememos/memos/proto/gen/api/v1/apiv1connect"` 使用，
  不需要额外维护/重新生成一份 API 数据结构。
  （TypeScript 侧只有 message 类型，没有生成 Connect client stub，如果 memogit
  选 TS 实现则需要额外加一个 `connect-es` 生成目标。）

## 2. 三个方案文档未覆盖、会影响实现的细节

1. **tags 是服务端从 `content` 解析出的只读字段**
   （`memo_service.proto:267-268`，`OUTPUT_ONLY`，doc comment: "The tags extracted
   from the content"）。客户端不能通过 API 单独设置 tags，只能靠编辑正文里的
   `#hashtag` 间接改变。本地文件 frontmatter 里的 `tags` 字段只能是"只读镜像"，
   需要在文件格式说明和 push 逻辑里明确：修改 frontmatter 的 tags 不会生效，
   要改就得改正文。

2. **MemoRelation 是全量替换语义**，不是增量 add。`SetMemoRelations`
   （`memo_service.proto:66-80, 529-562`）每次调用会替换该 memo 的整个关系集。
   如果 memogit 要支持"本地编辑关联再 push 回去"，必须先读出服务端当前完整关系集，
   本地合并后再整体提交，否则会覆盖掉其他客户端（如网页端）同时新增的关联——
   这是一个和内容冲突同构但需要独立处理的冲突面。
   **建议 v1 阶段 relations 只做只读导出**（写入 frontmatter 供 AI 阅读理解上下文关联），
   不支持本地编辑关联再同步回去，把这块复杂度移出 v1 范围。

3. **附件读取走独立的 HTTP 路由，不是 Connect API**。`Attachment.content`
   字段是 `INPUT_ONLY`（只能上传，读不到），实际读取文件字节要走
   `server/router/fileserver/`，路由形如 `/file/{attachment_name}/{filename}`
   （`server/router/api/v1/v1.go:133`，支持 `?share_token=`/`?thumbnail=true`/
   `?motion=true` 参数）。**这个路由是否认可 PAT 的 `Authorization: Bearer`
   header，还是需要走 `share_token`/cookie 等别的鉴权方式，代码调研阶段未直接验证，
   存在不确定性，需要实现前做一次小 spike 实测确认。**

## 3. 工作量估算（单人全职，Go + cobra，MVP 范围）

MVP 范围：`clone`/`pull`/`push`/`status`，含附件同步，relations 只读导出，
冲突处理仅做"检测+拒绝，交人工"。

| 模块 | 估算 |
|---|---|
| CLI 骨架 + PAT 鉴权接入 + config | 0.5–1 天 |
| clone（全量导出 + 目录/frontmatter 格式设计 + git init + 首次 commit） | 2–3 天 |
| pull（增量 + hash 比对 + 新增/删除/归档语义确认） | 1.5–2 天 |
| push（冲突三态判断 + Create/UpdateMemo + 回写 uid） | 2–3 天 |
| 附件同步（上传 CreateAttachment/SetMemoAttachments + 下载 /file 路由，含鉴权 spike） | 1.5–2 天 |
| status（本地 git diff + 本地/远端未同步状态合并展示） | 1 天 |
| 联调/边界（空库、rename、delete vs archive 语义、多 tag 目录冲突文件名） | 1.5–2 天 |
| **小计** | **约 10.5–14 人天（2–3 周）** |

**未计入 v1、后续按需再加的项：**

- relations 读写回同步（读-改-写避免覆盖其他客户端设置的关联）：+2–3 天
- 冲突体验优化（生成 `.conflict` 文件辅助手动比对，而非纯 CLI 报错文本）：+1–2 天
- Homebrew 正式分发打包：+0.5–1 天（原型阶段 `go build` 直接用即可，可以先不做）

## 4. 建议

- 按 MVP 范围排期，约 2–3 周单人工作量，不需要改动服务端代码。
- 实现前优先花 0.5 天做"附件 `/file/` 路由 PAT 鉴权"的 spike，确认是否可行，
  这是当前唯一有实质不确定性的技术风险点。
- relations 双向同步、冲突体验优化、正式分发打包，都作为 v1 之后的迭代项，
  不阻塞首个可用版本。
