# RAG 检索式搜索 —— 技术方案

> 状态：**已确认，待排期实施**。配套需求见 [`requirement.md`](./requirement.md)。
> 前身：[`docs/2026-07-12-rag-tech-design.md`](../../2026-07-12-rag-tech-design.md)（问答方向，已被本文档在检索方向上取代）。

## 0. 现状盘点（本方案相关，已核对代码）

- **DB 驱动**：`modernc.org/sqlite`（纯 Go，**无 CGO**）。→ 决定性约束：**无法加载 C 扩展**，
  `sqlite-vec` / `sqlite-vss` 不可用。FTS5 为 modernc 内置，可用（需在阶段 0 验证 `trigram` tokenizer）。
- **AI 基建**：[`internal/ai`](../../../internal/ai/ai.go) 已封装 OpenAI / Gemini provider，
  含 `ProviderConfig{ID,Title,Type,Endpoint,APIKey}`；现用于 STT / audiollm。
  → embedding 复用此 provider 模式，**新增 embeddings 调用方法**（当前仅有 generate/probe，无 embedding）。
- **memo 表**：已有 `workspace_id` / `folder_path` / `title` / `doc_type`，天然带层级与归属，
  可作为检索的 metadata 过滤维度。
- **配置体系**：proto 驱动，`instance_setting`（实例级）/ `user_setting`（用户级）。
- **迁移**：`store/migration/sqlite` 版本化 SQL。
- **前端**：React，主导航 `web/src/components/Navigation.tsx`，笔记本次级侧栏 `Notebook/`。

## 1. 核心技术决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 向量存储 | embedding 存 SQLite `BLOB`，Go 内存暴力算 cosine | 纯 Go 驱动不支持 sqlite-vec；用户量级下暴力检索亚毫秒~毫秒级，零额外依赖 |
| 抽象 | 定义 `VectorStore` 接口，sqlite BLOB 为首个实现 | 未来 pgvector 直接加实现，检索逻辑不重写 |
| 全文检索 | FTS5 + `trigram` tokenizer | modernc 内置 FTS5；trigram 对中文按三元组子串匹配，无需外挂分词器 |
| 融合 | RRF（倒数排名融合）合并 FTS + 向量两路召回 | 无需调阈值，稳定，适合本项目定位 |
| embedding provider | 复用现有 AI provider，加「embedding 模型」字段 | 少一套配置；未配则降级 FTS |
| 维度变更 | 表存 `model` + `dim`；换模型 → 旧向量作废 + 后台重建 | 个人库量小，重建快（Cherry Studio 同思路） |
| 索引时机 | 异步增量（写入后入队）+ 手动全量重建 | 不阻塞 memo 保存 |
| 结果粒度 | chunk 级检索 → 文档级去重（取最高分 chunk 作 snippet） | 需求为「最大命中文档数」 |

## 2. 存储设计（SQLite）

新增迁移，草案表结构（字段最终以实现时定稿为准）：

### `memo_chunk`
| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `memo_id` | 外键 → memo |
| `workspace_id` | 冗余，便于按知识库过滤（免 join） |
| `folder_path` | 冗余，便于按课程/module 过滤 |
| `chunk_index` | 片在文档中的序号（供 snippet/未来定位） |
| `content` | chunk 原文（也供 FTS 索引） |
| `embedding` | `BLOB`，float32 数组序列化 |
| `embedding_model` | 生成该向量的模型名 |
| `embedding_dim` | 向量维度 |
| `created_ts` / `updated_ts` | 时间戳 |

### `memo_chunk_fts`（FTS5 虚表）
- `USING fts5(content, content='memo_chunk', content_rowid='id', tokenize='trigram')`。
- 外部内容表模式，与 `memo_chunk` 同步（触发器或应用层维护）。

### `memo_index_job`（增量索引队列）
| 字段 | 说明 |
|---|---|
| `memo_id` | 待索引的 memo |
| `status` | `pending` / `processing` / `done` / `failed` |
| `reason` | `created` / `updated` / `model_changed` / `manual` |
| `attempts` / `last_error` / `updated_ts` | 重试与诊断 |

> memo 更新即入队；「换 embedding 模型」= 全量入队重建；全量重建入口清空并重灌队列。

## 3. 索引流程（写路径）

1. memo 创建/更新（仅 `doc_type = MARKDOWN`，经**可扩展过滤器**判定；未来读知识库配置）→ 写 `memo_index_job(pending)`。
2. 后台 worker 消费队列：
   - 取 memo `content` → **分片**（见 §4）。
   - 删除该 memo 旧 chunk，写入新 chunk（`content`）。
   - 若已配置 embedding 模型：对每个 chunk 调 embedding API，写入 `embedding` / `model` / `dim`；
     未配置：只写 chunk（FTS 可用），`embedding` 留空。
   - 同步 `memo_chunk_fts`。
3. memo 删除 → 级联删除其 chunk 与 FTS 行。

## 4. 分片（Chunking）策略（写死默认，不暴露）

- **一级边界**：按 Markdown 标题切（H1/H2 段落为候选 chunk），复用大纲解析思路
  （参照 `web/src/components/Notebook/DocumentOutline.tsx`，后端做等价标题切分）。
- **二级边界**：单段过长时按字数二次切，目标 **~300–500 字/片，~50 字 overlap**，避免超 embedding 输入上限。
- **metadata**：每片挂 `workspace_id` / `folder_path` / `title`，支持先按知识库粗筛再语义检索。

## 5. 检索流程（读路径）

输入：`query`、`scope`（GLOBAL 或 workspace_id）、`mode`（混合/关键词/语义）、`limit`。

1. **权限收敛**：GLOBAL → 限定当前用户有权访问的 memo 集合；workspace → 限定该 workspace。
   在 `memo_chunk` 查询上按 `workspace_id` + 可见性/creator 过滤。
2. **FTS 召回**（mode ≠ 仅语义）：在 `memo_chunk_fts` 上 MATCH，取带 rank 的候选。
3. **向量召回**（mode ≠ 仅关键词，且已配 embedding）：
   - 对 query 调 embedding → query 向量。
   - 载入权限范围内的 chunk 向量，Go 内存算 cosine，取 top-N。
4. **融合**：两路候选用 **RRF** 合并排序（仅一路时直接用该路）。
5. **文档级去重**：按 `memo_id` 聚合，取每文档最高分 chunk，其 `content` 生成 snippet + 高亮。
6. 截断到 `limit`（user 级「最大命中文档数」），返回。

**降级**：未配 embedding 模型 → 强制 `mode = 仅关键词`，只走步骤 2。

## 6. API 面（Connect / gRPC）

新增 `RagService`（命名以实现时定），沿用现有 proto 与 gRPC-gateway 组织方式：

```proto
// 单一检索 RPC，全局搜索与库内搜索前端两处复用，靠 scope 区分
rpc Search(SearchRequest) returns (SearchResponse);

message SearchRequest {
  string query = 1;
  oneof scope {                 // GLOBAL 或 指定 workspace
    bool global = 2;
    int32 workspace_id = 3;
  }
  SearchMode mode = 4;          // MIXED / KEYWORD / SEMANTIC，缺省 MIXED
  int32 limit = 5;              // 缺省取 user 级配置
}
message Hit {
  Memo memo = 1;                // 或精简的 memo 引用（uid/title/folder_path/workspace）
  double score = 2;
  string snippet = 3;
  repeated string highlights = 4;
}
message SearchResponse { repeated Hit hits = 1; SearchMode effective_mode = 2; }

rpc RebuildIndex(RebuildIndexRequest) returns (RebuildIndexResponse); // 手动全量重建
rpc GetIndexStatus(GetIndexStatusRequest) returns (GetIndexStatusResponse); // 队列进度
```

- `effective_mode` 回传实际生效模式，供前端提示（如降级为 KEYWORD）。

## 7. 配置（proto 字段）

- **instance 级**（`instance_setting` 的 AI provider 配置内）：新增 **embedding 模型**字段
  （挂在 provider 下，与生成/STT 模型并列）。
- **user 级**（`user_setting`）：
  - `rag_max_result_docs`（默认 20）。
  - `rag_search_mode`（MIXED / KEYWORD / SEMANTIC，默认 MIXED）。

## 8. 前端

### 8.1 全局搜索页（F1）
- `Navigation.tsx` 加「搜索」入口 → 独立路由/页面。
- 页面：搜索输入框（回车/按钮提交）+ 命中列表（文档卡片：标题 + folder 路径 + snippet 高亮）。
- 调 `Search(global=true, mode=user配置, limit=user配置)`。
- 点击命中项 → 跳转首页并打开对应 workspace + 文档。
- 若 `effective_mode` 被降级 → 顶部提示「配置 embedding 模型以启用语义搜索」。

### 8.2 库内搜索（F2）
- 次级侧栏 Calendar 下方加搜索框，调 `Search(workspace_id=当前, ...)`。
- 提交后：
  - 文件夹树**过滤**：只保留命中文档节点 + 其父级文件夹路径。
  - 预览区**复用命中列表**组件。
- 清空搜索框 → 恢复完整文件夹树与原预览区（保留原状态，不重新拉取）。
- 点击命中项 → 打开对应文档（本期不做片段定位）。

### 8.3 Settings
- Preferences 加：最大命中文档数、检索模式（下拉）。
- AI provider 配置处：embedding 模型字段 + 未配置提示。

## 9. 分期与去风险

- **阶段 0（去风险，先做）**：
  1. 最小测试确认 `modernc.org/sqlite` 当前版本 FTS5 可用且 `tokenize='trigram'` 建表/查询正常。
  2. 用现有 AI provider 打通一次 embeddings 调用（OpenAI `text-embedding-3-small` / Gemini `text-embedding-004`），确认返回向量。
- **阶段 1**：schema + 迁移（`memo_chunk` / `memo_chunk_fts` / `memo_index_job`）+ 异步索引 worker + 分片。
- **阶段 2**：`VectorStore` 接口 + sqlite BLOB 实现 + 检索服务（FTS/向量/RRF/去重/权限）+ `RagService` + 配置字段。
- **阶段 3**：前端全局搜索页 + 库内搜索框 + Settings。
- **未来**：PG + pgvector（新增 `VectorStore` 实现）；知识库详情页配置索引范围；HTML/PDF 索引；片段定位高亮；LLM 生成式问答。

## 10. 主要风险

| 风险 | 应对 |
|---|---|
| modernc FTS5/trigram 不可用 | **阶段 0 先验证**；退路：用 `LIKE`/自建倒排的降级关键词检索 |
| 中文分词质量（trigram 是子串非语义分词） | 混合检索里向量路补语义；trigram 对中文召回已够个人库场景 |
| embedding API 延迟/失败 | 异步队列 + 重试；失败不阻塞 memo 保存；降级 FTS |
| 内存暴力检索随数据增长变慢 | 本期量级可忽略；`VectorStore` 抽象已为 pgvector 留口 |
