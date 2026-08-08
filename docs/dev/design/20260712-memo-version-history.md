# 文档版本历史（Memo Version History）— 需求与技术方案

状态：设计确认，待开发
关联：仿照 Notion / 语雀的"版本"能力，但简化为手动创建、全量快照、不做 diff。

> 迁移注记：对应需求见
> [../requirements/knowledge-base/document-versioning.md](../requirements/knowledge-base/document-versioning.md)。
> 附件版本化的落地方案与切换版本 RPC 已实现，均与本文正文（§8-9）一致。

## 1. 需求背景

当前 memo 的编辑是纯覆盖写（`store/memo.go` `UpdateMemo` 直接 `UPDATE memo SET content=...`），
没有任何历史留存。用户希望在关键节点（比如完成一次大改）手动"存一个版本"，之后可以
查看历史版本列表，并按需切换/恢复到某个历史版本。

## 2. 需求范围（本期）

1. **手动创建版本**：用户在文档操作菜单里选择"创建为版本"，弹窗输入版本名，
   将当前 `memo.content`（连同 `title`/`payload`）存一份快照到历史表。
2. **查看版本列表**：菜单三级子菜单展示该 memo 的所有历史版本（时间倒序 + 版本名）。
3. **切换版本**：选中某个历史版本后，将其内容加载覆盖到 `memo.content`。
   - **切换前置检查**：比较"最新一次版本快照的内容 hash"与"当前 `memo.content` 的 hash"。
     如果不一致（说明用户在创建版本后又做了未保存的修改），拒绝直接切换，
     提示"当前内容尚未保存为版本，请先创建版本"。
   - 通过检查后，才允许把选中版本的内容写回 `memo.content`（这次写回本身
     不新增历史记录，避免历史表膨胀；也不做时光倒流式的"覆盖历史"）。
4. **不做的事**（明确排除，避免过度设计）：
   - 不做自动/定时快照，只能手动创建。
   - 不做版本数量上限/清理策略，数据量由用户自己控制（因为是手动创建，天然可控）。
   - 不做服务端 diff/patch 存储，每个版本都是内容全量快照。
   - 不做"版本对比"UI（如两版本并排 diff），本期只做"列表 + 切换"。
   - 不支持删除单条历史版本（后续按需再加）。

## 3. 数据模型

新增 `memo_history` 表，只在"即将被覆盖前"或"用户主动创建"时插入一行，`memo` 主表
结构不变，`memo.content` 永远是当前生效内容。

```sql
CREATE TABLE memo_history (
  id          <SERIAL/AUTOINCREMENT>  PRIMARY KEY,
  uid         TEXT NOT NULL UNIQUE,        -- 供前端/API 引用，风格与 memo.uid 一致
  memo_id     INTEGER NOT NULL,            -- FK -> memo.id
  name        TEXT NOT NULL DEFAULT '',    -- 用户输入的版本名
  title       TEXT NOT NULL DEFAULT '',    -- 快照时的 memo.title
  content     TEXT NOT NULL,               -- 快照时的 memo.content（全量）
  payload     JSONB/TEXT NOT NULL DEFAULT '{}', -- 快照时的 memo.payload
  content_hash TEXT NOT NULL,              -- 快照内容的 SHA-256，供切换前比对
  creator_id  INTEGER NOT NULL,
  created_ts  BIGINT NOT NULL
);
CREATE INDEX idx_memo_history_memo_id ON memo_history (memo_id, created_ts DESC);
```

落地位置（三个驱动都要加，按现有迁移规范）：
- `store/migration/postgres/0.30/07__memo_history.sql`（若 0.30 已发布则用下一个未发布版本号目录）
- `store/migration/mysql/0.30/07__memo_history.sql`
- `store/migration/sqlite/<下一版本目录>/NN__memo_history.sql`
- 并把同样的 DDL 追加进三个驱动各自的 `LATEST.sql`。

`content_hash` 用 SHA-256(content)，创建版本时算好存下来，避免每次切换都重新算长文本 hash
（虽然重新算也不贵，但存下来能直接比对，逻辑更简单）。

## 4. 后端改动

### 4.1 Store 层
- `store/driver.go` 的 `Driver` 接口新增一组方法（仿照 `MemoRelation` 的
  `Upsert/List/Delete` 三件套，`store/driver.go:34-37`）：
  ```go
  CreateMemoHistory(ctx, create *MemoHistory) (*MemoHistory, error)
  ListMemoHistories(ctx, find *FindMemoHistory) ([]*MemoHistory, error)
  ```
  （不需要 Update/Delete —— 本期历史记录只增不改不删）
- 每个驱动包（`store/db/postgres/`、`store/db/mysql/`、`store/db/sqlite/`）
  新增 `memo_history.go`，镜像同目录下 `memo_relation.go` 的写法。
- `store/memo_history.go`（新文件，对齐 `store/memo.go` 风格）封装
  `Store.CreateMemoHistory` / `Store.ListMemoHistories`，做基础校验（memo 存在、
  内容非空等），并生成 `content_hash`。

### 4.2 Proto / API
`proto/store/memo.proto` 新增：
```protobuf
message MemoHistory {
  string uid = 1;
  string name = 2;
  string title = 3;
  string content = 4;
  string content_hash = 5;
  int64 created_ts = 6;
}
```

`proto/api/v1/memo_service.proto` 新增 RPC（命名参考已有 `MemoShare` 的
`Create/List/Delete` 风格，`memo_service.proto:113-127`）：
```protobuf
rpc CreateMemoHistory(CreateMemoHistoryRequest) returns (MemoHistory);
rpc ListMemoHistories(ListMemoHistoriesRequest) returns (ListMemoHistoriesResponse);
```
不新增 `RestoreMemoHistory` RPC —— "切换版本"复用现有 `UpdateMemo` RPC
（客户端先 `ListMemoHistories` 拿到目标版本 content，做完 hash 校验后，
直接调用已有的 `UpdateMemo(content=历史版本内容)`）。这样后端不用为"恢复"
单独开洞，也天然符合"切换不产生新历史记录"的需求。

hash 校验放在**服务端**做（不能只信前端）：`CreateMemoHistoryRequest` 不需要校验，
但如果前端要在"切换版本"前做校验，应该调用一个轻量的
`GET`-like 校验（或者直接把"最新一条 history 的 content_hash"和"当前 memo 内容
的即时 hash"都通过 `ListMemoHistories`（取第一条）+ 已有的 `GetMemo` 返回值在前端比较，
不必新增专门的校验 RPC）。

### 4.3 服务端权限
沿用 memo 本身的编辑权限校验（创建版本、查看版本列表、切换版本都要求对该 memo
有编辑权限），不引入新的权限维度。

## 5. 前端改动

### 5.1 菜单入口
`web/src/components/MemoActionMenu/MemoActionMenu.tsx`：在 Move 附近新增一个
"版本"子菜单，实现方式参照现有 **Copy 子菜单**（`MemoActionMenu.tsx:96-111`）的嵌套
`DropdownMenu` 写法：

```
版本 ▸
  ├─ 创建为版本        -> 打开"输入版本名"弹窗 (CreateVersionDialog)
  └─ 查看版本 ▸        -> 三级子菜单，列出所有历史版本（时间倒序 + 版本名）
       ├─ v3 "重构大纲" 2026-07-10 14:22
       ├─ v2 "初稿"     2026-07-09 09:03
       └─ v1 "..."      ...
```

状态管理仿照 `Move` 的模式（`MemoActionMenu.tsx` 的 `moveDialogOpen` state +
`hooks.ts` 的 `handleMoveMemoClick`/`confirmMoveMemo`，见 `hooks.ts:139-143`）：
- 新增 `createVersionDialogOpen` state + `handleCreateVersionClick`/`confirmCreateVersion`。
- "查看版本"直接渲染子菜单列表（不需要弹窗），点击某一项触发
  `handleSwitchVersionClick(historyItem)`。

### 5.2 切换版本前置校验
点击某个历史版本时的流程（纯前端逻辑，不新增后端 RPC）：
1. 计算当前编辑器 `memo.content` 的 SHA-256（用浏览器原生
   `crypto.subtle.digest("SHA-256", ...)`，仓库里 `web/src/utils/oauth.ts:16-70`
   已有同样用法可参考/复用为通用 util，建议抽成 `web/src/utils/hash.ts`）。
2. 取"最新一条历史版本"的 `content_hash`（`ListMemoHistories` 结果按时间倒序，取第一条）。
3. 若两者不一致 → 弹提示："当前内容尚未保存为版本，请先创建版本后再切换"，
   阻断切换（不调用 `UpdateMemo`）。
4. 若一致 → 允许切换：直接调用现有 `UpdateMemo(content=目标版本.content, title=目标版本.title)`。
   本次切换不产生新的 `memo_history` 记录。

### 5.3 组件清单（新增）
- `web/src/components/MemoActionMenu/CreateVersionDialog.tsx`（仿 `MoveDocumentDialog` 结构）
- 版本列表子菜单直接在 `MemoActionMenu.tsx` 内渲染（数据量小，不需要独立分页组件）
- `web/src/utils/hash.ts`：`sha256(text: string): Promise<string>` 通用工具

### 5.4 i18n
`web/src/locales/zh-Hans.json` 的 `memo` 命名空间下新增（`zh-Hans.json:209` 附近，
kebab-case 风格）：
```json
"create-as-version": "创建为版本",
"view-versions": "查看版本",
"version-history": "版本历史",
"version-name-placeholder": "给这个版本起个名字",
"switch-version-confirm": "切换到此版本？当前编辑内容将被覆盖",
"switch-version-blocked": "当前内容尚未保存为版本，请先创建版本后再切换"
```
同步镜像到 `web/src/locales/en.json` 及其他语言文件（保持所有 locale 文件 key 对齐的仓库惯例）。

## 6. 开发计划（按依赖顺序）

| # | 任务 | 产出 |
|---|------|------|
| 1 | 三个驱动的 migration SQL + `LATEST.sql` 追加 | `memo_history` 表落地，`make` 迁移可跑通 |
| 2 | `store/driver.go` 接口 + 三个驱动实现 + `store/memo_history.go` | Go 单测覆盖 Create/List |
| 3 | proto 新增 `MemoHistory` 消息 + `CreateMemoHistory`/`ListMemoHistories` RPC，`buf generate` | gRPC/HTTP handler 落地 |
| 4 | 前端 API client 生成物接入（走现有 codegen 流程） | `web/src/grpcweb` 或等价目录出现新方法 |
| 5 | `web/src/utils/hash.ts` | 通用 SHA-256 工具 + 单测 |
| 6 | `MemoActionMenu.tsx` 加"版本"子菜单 + `CreateVersionDialog.tsx` | 创建版本走通 |
| 7 | "查看版本"列表 + 切换逻辑 + hash 校验拦截 | 切换版本走通，含拦截提示 |
| 8 | i18n 补全（zh-Hans + en 等） | 文案上线 |
| 9 | 手动验证：创建版本→修改未保存→尝试切换（应拦截）→创建版本→切换（应成功） | 验收通过 |
| 10 | 用户手册补充 `docs/manual/`（可选，视是否要写用户文档决定） | — |

## 7. 已知取舍 / 后续可扩展点

- 版本无数量上限：符合"手动创建、数据可控"的要求，如果后续用户反馈历史表
  膨胀，可以加"删除单条历史"或"保留最近 N 条"选项，不影响当前设计。
- 不做 diff：全量快照实现简单、无合并冲突风险；如果后续需要"版本对比"，
  可以在前端用现有内容做纯展示级 diff（不需要改数据模型）。
## 8. 附件版本化（已实现，方案2）

版本快照**包含附件**，采用"记录附件引用 + 恢复时重连关联"的方案:

- **快照**: 创建版本时,`memo_history.attachments` (JSON) 存下当时该 memo 的附件列表
  (uid + filename + type),不复制文件本体。
- **hash 扩展**: 切换前置校验的 `content_hash` 从"仅 content"改为 `content + 附件uid集合`
  (`store.HashMemoState`,前后端用相同的规范化: content、NUL、排序后的 uid 以 NUL 连接)。
  这样附件变化也会使 hash 失配 → 必须先存版本才能切换,保证当前附件集合一定已被某个版本保存。
- **恢复语义**: 切换版本时,当前有、目标版本没有的附件执行**解绑**(`memo_id` 置 NULL,
  文件保留为未关联上传),而非硬删除 → 可逆,切回新版本能重新关联。因为现成的
  `SetMemoAttachments` 是硬删除,所以新增了 `UpdateAttachment.UnsetMemoID` 和专门的
  `RestoreMemoHistory` RPC 在服务端原子完成"改正文 + 重连附件"。
- **固有局限**: 若附件在存版本后被**物理删除**(通过正常编辑删附件),旧版本引用的该附件
  无法找回,恢复时静默跳过。这是方案2的已知边界,已在设计时接受。
- **注意**: 解绑产生的"未关联上传"若用户手动跑"清理未使用上传"仍可能被删除,属边缘情况。

## 9. 与最初设计的偏差

- "切换版本"最终采用**新增 `RestoreMemoHistory` RPC**(而非复用 `UpdateMemo`),因为要在
  服务端原子地完成正文恢复 + 附件重连(解绑语义),并把 hash 校验作为服务端后备。前端仍做
  一次前置 hash 校验以提供友好提示。

- 不再固定对比"最新版本",而是检查当前 content + 附件集合 的 hash 是否匹配任意一个已存版本(不管是不是最新那个)。

    如果匹配某个已存版本(哪怕是旧版本)→ 说明当前状态本来就是可恢复的,允许切换。
    如果一个都不匹配 → 说明确实有未保存的改动,拦截并提示先存版本。
