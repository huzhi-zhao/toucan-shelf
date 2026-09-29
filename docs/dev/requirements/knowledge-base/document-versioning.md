# 文档版本历史（Memo Version History）

全量快照，不做 diff。版本分三种来源：人手动存的、AI 改写前自动留的、
自动保存覆盖前自动留的（见 §1.1），只有最后一种有保留上限。

## 1. 能力范围

- **手动创建版本**：在文档操作菜单里选择"创建为版本"，可选填一个版本名，
  将当前 memo 的 content/title/payload 连同附件集合存一份快照。
- **查看版本列表**：菜单子菜单展示该 memo 的所有历史版本（时间倒序）。
- **恢复到某个版本**：把选中版本的内容与附件集合写回 memo。
- **附件随版本快照**：见 §3。
- **自动版本与保留策略**：见 §1.1。

明确不做：服务端 diff/patch 存储（每个版本都是内容全量快照）、版本对比 UI、
删除单条历史版本。

## 1.1 版本来源与保留策略

`memo_history.source`（`store/memo_history.go` `MemoHistorySource`）标记一条版本
是谁留下的。这是保留策略的唯一依据 —— 只有 `auto` 会被删。

| source | 谁写的 | 保留 |
| --- | --- | --- |
| `manual` | 用户点"创建为版本"并命名 | 永久 |
| `auto` | 编辑器自动保存在覆盖正文前留的 | 90 天内、每篇最多 10 条 |
| `agent_baseline` | AI 改写前的最后一份人类内容 | 永久 |

**为什么 `auto` 要有上限而另外两种没有**：手动版本是用户自己按出来的，数量天然可控；
`agent_baseline` 在 AI 覆盖之后往往是人写的那份唯一的副本，过期删掉等于真丢。
只有 `auto` 是没人按按钮就自己长出来的，所以只有它需要被约束。

**自动版本的产生时机**（`server/router/api/v1/memo_auto_version.go`）：
自动保存每 30 秒提交一次，但不是每次提交都留版本。

- **会话第一次自动保存**：一定留。这一份是"你进来之前文档长什么样"，
  也就是误剪切被自动保存覆盖后唯一能找回原文的东西。
- **之后的每次 tick**：距上一条 `auto` 版本不足 `autoVersionMinInterval`（10 分钟）
  则跳过。否则再留一条。
- 两种情况都会先做 hash 去重：当前状态已经能从任一已存版本恢复时不重复留
  （判定规则同 §3 / §5）。

客户端通过 `UpdateMemoRequest.auto_save` 告知服务端这次写入处在会话的哪个位置
（`AUTO_SAVE_SESSION_START` / `AUTO_SAVE_PERIODIC`），不传即用户手按的保存，不留版本。
MCP 通道上这个字段被忽略 —— agent 写入走 `agent_baseline` 那条规则。

**保留策略的执行时机**：在写入一条 `auto` 版本之后就地执行
（`Store.PruneAutoMemoHistories`，单条 DELETE 同时处理"超期"和"超量"两条规则），
没有后台清理任务。因为 `auto` 版本只在这条路径上产生，这也是文档唯一可能超出配额的时刻。

## 2. 数据模型

`memo_history` 表，在用户主动创建版本、或 §1.1 的两条自动规则触发时插入一行；
`memo` 主表结构不变，`memo.content` 永远是当前生效内容（`store/memo_history.go`）：

- `id` / `uid`
- `memo_id`：所属 memo
- `name`：用户输入的版本名（可空）
- `title` / `content` / `payload`：快照时刻的对应字段
- `attachments`：快照时刻的附件集合（JSON，见 §3）
- `content_hash`：`content + 附件 uid 集合` 的 SHA-256 摘要，见 §3
- `creator_id` / `created_ts`
- `source`：版本来源，见 §1.1

历史记录只增不改（无 Update 接口）；唯一的删除是 §1.1 的 `auto` 保留策略。

## 3. 内容与附件快照的一致性（content_hash）

`content_hash` 覆盖 content 和附件集合两部分，而不是只覆盖 content
（`store/memo_history.go:70` `HashMemoState`）：

```go
HashMemoState(content string, attachmentUIDs []string) string
// sha256(content + "\x00" + 排序后的附件uid以"\x00"连接)
```

创建版本时按此规则计算并落库；恢复前的一致性判断也用同一函数比较，
这样附件变化（增删关联）与正文变化一样会使 hash 失配。

附件快照只记引用，不复制文件本体：`memo_history.attachments` 存
`{uid, filename, type}` 的列表（`MemoHistory.Attachment`，
`proto/api/v1/memo_service.proto:882`）。

**已知边界**：若附件在存版本后被物理删除（正常编辑流程删附件），
旧版本引用的该附件无法找回，恢复时静默跳过该项。

## 4. API

`proto/api/v1/memo_service.proto`：

```protobuf
message MemoHistory {
  string name = 1;           // memos/{memo}/histories/{history}
  string display_name = 2;   // 用户输入的版本名，创建时唯一可写字段
  string title = 3;          // output only，服务端从 memo 当前状态取
  string content = 4;
  string content_hash = 5;   // output only
  google.protobuf.Timestamp create_time = 6;
  repeated Attachment attachments = 7;  // output only
  Source source = 8;         // output only，见 §1.1
}

rpc CreateMemoHistory(CreateMemoHistoryRequest) returns (MemoHistory);
rpc ListMemoHistories(ListMemoHistoriesRequest) returns (ListMemoHistoriesResponse);
rpc RestoreMemoHistory(RestoreMemoHistoryRequest) returns (Memo);
```

`CreateMemoHistoryRequest` 只读取客户端传入的 `display_name`；title/content/
attachments 都是服务端从 memo 当前状态现取的快照，不接受客户端传值。

权限：创建版本、查看版本列表、恢复版本都沿用 memo 本身的编辑权限校验，
不引入新的权限维度。

## 5. 恢复语义（RestoreMemoHistory）

`RestoreMemoHistory` 是独立 RPC，在服务端原子完成"正文恢复 + 附件重连"：

- 目标版本有、当前 memo 没有的附件：重新关联回 memo。
- 当前 memo 有、目标版本没有的附件：**解绑**（`UpdateAttachment.UnsetMemoID`，
  `memo_id` 置 NULL），文件本体保留为未关联上传，不做硬删除 —— 可逆，
  切回更新版本能重新关联。

服务端在恢复前会做一致性校验（拒绝对"当前状态与任一已存版本都不匹配"的
memo 执行恢复，即存在未保存的改动时阻断）；前端也做一次前置 hash 比对
以提前给出友好提示，但服务端校验是最终依据，不能只信前端。

一致性判断**不要求匹配"最新版本"**：只要当前 content + 附件集合的 hash
命中任意一个已存版本（不论是不是最新那条），就认为可安全恢复。

## 6. 前端

- 自动版本在列表里不另起一栏，与手动版本按时间混排，用灰色的"自动保存"
  代替版本名以示区分（`MemoVersionLabel.tsx`）—— 自动版本没有名字，
  标签在前端按 `source` 渲染，所以跟随界面语言而不是写死在库里。
- 入口：`MemoActionMenu.tsx` 的"版本"子菜单 —— "创建为版本"（打开
  `CreateVersionDialog.tsx`）、"查看版本"（列出历史，选中触发恢复流程）。
- 状态与请求封装：`useMemoHistoryQueries.ts`（`useMemoHistories` /
  `useCreateMemoHistory` / `useRestoreMemoHistory`）。
- 前置 hash 校验：浏览器端用 `crypto.subtle.digest` 算当前内容 + 附件集合
  的 hash，与已存版本的 `content_hash` 比对，不一致则先在前端拦截提示
  "当前内容尚未保存为版本，请先创建版本"。

## 7. 与本文档承接的旧方案的差异

旧方案（见 git history）设计为"切换版本复用现有 `UpdateMemo` RPC、只覆盖
content、恢复不触碰附件"。实现时改为独立的 `RestoreMemoHistory` RPC，
原因是需要在服务端原子完成"正文恢复 + 附件重连（解绑语义）"，并把 hash
校验放到服务端做最终把关，前端校验只负责提前给出提示。
