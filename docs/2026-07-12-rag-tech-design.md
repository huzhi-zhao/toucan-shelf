# RAG 知识库检索问答 —— 技术方案（暂缓实施，仅记录思路）

> 状态：**未排期**，配套需求见 [`2026-07-12-rag-requirement.md`](./2026-07-12-rag-requirement.md)。
> 本文档记录讨论中已对齐的技术方向，作为启动时的起点，不代表最终设计——真正排期时应先重新核对
> 届时的代码现状（表结构、AI provider 实现是否有变化）再细化。

## 现状盘点（与本方案相关）

- **文档结构**：`memo` 表已有 `workspace_id` / `folder_path` / `title` / `doc_type`
  （`MARKDOWN` / `HTML` / `PDF` / `VIEW`），文档天然带层级归属，可作为检索的 metadata 过滤维度。
- **AI provider 基建**：`InstanceSetting.AISetting`（`proto/api/v1/instance_service.proto`）已支持
  配置多个 `AIProviderConfig`（`OPENAI` 兼容 / `GEMINI` 等），每个 provider 下可挂 `AIModelConfig`；
  `internal/ai/` 包（`ai.go` / `generate.go` / `models.go` / `probe.go`）封装了 provider 调用逻辑，
  当前用于转写（Transcribe）和 Markdown 格式化（FormatMarkdown）。RAG 的 embedding 调用与生成式
  回答调用应直接复用这套 provider 配置，不新增平行的 AI 连接配置。
- **存储**：项目默认 SQLite（也支持 MySQL/Postgres），本次讨论明确不引入外部向量数据库。

## 存储方案：SQLite 内的向量检索

- 优先评估 **`sqlite-vec`**（SQLite 官方扩展生态里的向量搜索扩展，轻量、无需额外进程）。若目标
  部署环境无法加载 SQLite 扩展（例如某些托管环境限制自定义 extension），退化方案是自建一张
  `memo_chunk` 表，把 embedding 存成 `BLOB`（float32 数组），检索时在应用层做暴力余弦相似度计算——
  几百篇文档、预计数千个 chunk 的量级下，暴力计算的延迟可接受，不需要 ANN 索引。
- 新增表（草案，字段以启动时再定稿为准）：
  - `memo_chunk`：`id` / `memo_id`（外键关联 memo）/ `workspace_id`（冗余存一份，便于按知识库过滤
    不必 join）/ `folder_path`（冗余，便于按课程/module 过滤）/ `chunk_index` / `content`（chunk 原
    文）/ `embedding`（向量）/ `created_ts`。
  - 是否需要单独的 `memo_embedding_job` 表跟踪"哪些 memo 还未生成 embedding / 需要因内容变更重新
    生成"，视启动时是否要做增量更新而定；MVP 阶段可先做"全量离线生成，改动后手动触发重新生成"。

## Chunking 策略：按文档结构切，而非无脑定长切分

这是本次讨论认为"最值得练手"的部分，因为课程知识库天然带层级结构（course → module → 讲件/笔记），
比通用文本 RAG 更有实验空间：

- **一级边界：按 Markdown 标题切**（复用文档已有的 outline 提取逻辑，即
  `web/src/components/Notebook/DocumentOutline.tsx` 用到的标题解析思路，在后端侧对 `content` 做同样
  的标题切分）。每个 H1/H2 段落作为一个候选 chunk，避免把无关小节硬拼在一起。
- **二级边界：单个标题段落过长时再按字数/token 数二次切分**，避免超出 embedding 模型的输入上限。
- **metadata 挂载**：每个 chunk 记录来源 memo 的 `workspace_id`、`folder_path`、`title`，让查询时可以
  先按"课程"（workspace 或 folder_path 前缀）粗筛，再做语义检索，兼顾准确率与检索范围可控性——
  这是通用 RAG 客户端（如 Cherry Studio 直接吃导出文件）不具备的优势，因为它们拿不到 MemoBase 的
  结构化归属信息。
- **HTML / PDF 文档**：HTML 用现成的正文提取（去标签取文本）；PDF 复用已有的
  `web/src/components/PdfViewer/extractPdfText.ts` 文本提取逻辑（后端侧需要一个 Go 等价实现，或者
  在前端触发时把提取结果回传持久化——具体走哪条路径，留到启动时再定）。`VIEW` 文档不参与
  embedding（其 content 只是配置 JSON，没有可检索的自然语言内容）。

## 检索与生成流程

1. 用户在搜索/聊天入口输入问题。
2. （可选）前端/表单允许限定检索范围（当前 workspace / 全部知识库），对应查询时按
   `workspace_id`/`folder_path` 过滤 `memo_chunk`。
3. 对问题文本调用 embedding API（复用配置好的 `AIProviderConfig`），得到 query 向量。
4. 在 `memo_chunk` 中做相似度检索，取 top-K（K 待调参，起点可设 5-8）。
5. 把 top-K chunk 原文 + 用户问题拼成 prompt，调用生成式 `AIProviderConfig` 得到回答。
6. 回答连同引用的来源文档（memo 标题 + 跳转链接，复用已有的 *Copy link* 详情页路由）一起返回前端。

## API 面（草案）

沿用现有 proto 的组织方式，新增一个专用 service（暂命名 `RagService`，最终命名以启动时决策为准）：

- `SearchChat(question, scope?)` → 返回 `{ answer, sources: [{memo, snippet}] }`，对应上述流程 3-6。
- `ReindexWorkspace(workspace)` / `ReindexMemo(memo)` —— 手动触发（重新）生成 embedding，MVP 阶段
  用手动触发替代自动增量更新，降低复杂度。

是否复用 Connect/REST 双栈网关（沿用项目现有 gRPC-gateway 模式）取决于启动时的实现分工，本文档不
预先锁定。

## 前端面（草案）

- 一个搜索/聊天入口（具体挂在 Notebook 侧边栏还是独立页面，留到启动时结合当时的 UI 布局决定）。
- 回答区域下方列出来源文档卡片（标题 + 跳转链接），复用已有的文档卡片组件风格
  （参考 `GalleryDocCard.tsx` 的卡片呈现方式，不必是同一组件，但视觉语言应保持一致）。

## 验收方式（MVP 阶段）

- 不追求自动化评测指标，采用**人工评估**：准备 10-20 个用户真实会问的问题（覆盖多门课程、
  跨 module 的问题），人工判断检索出的 chunk 是否命中预期文档/段落，以及最终回答是否可用。
- 若命中率不理想，优先调整 chunk 切分粒度和 top-K，其次再考虑是否需要 hybrid search
  （关键词 + 向量结合）——但明确后者不是 MVP 阶段要做的事。

## 明确不做（MVP 阶段）

- 外部向量数据库、独立检索微服务。
- 多租户权限隔离（不面向陌生用户，见需求文档）。
- 自动增量索引（memo 变更后自动重新 embedding）——先手动触发。
- rerank 模型、hybrid search、query rewriting 等检索质量优化手段——先验证最简单方案是否够用。

## 启动时的第一步

排期启动时，第一个动作应是重新核对：

1. `internal/ai/` 包届时是否已支持 embedding 调用（当前只看到 Transcribe / FormatMarkdown /
   Probe，未确认是否已有 embedding 相关方法，需要启动时重新 grep 确认）。
2. `sqlite-vec` 或等价扩展在目标部署环境（Docker 镜像、`go-sqlite3` 驱动）下是否可用，如不可用则
   直接走"应用层暴力余弦相似度"方案，不必强求扩展。
