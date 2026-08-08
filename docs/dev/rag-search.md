# 检索式搜索（RAG Search）

常青需求文档，对照代码整理，描述当前实现的现状。历史方案见
[docs/dev/design/20260716-rag-search/](design/20260716-rag-search/)（技术方案，含
[ADR-0006](adr/0006-no-cgo-drop-sqlite-vec-for-fts5-and-in-memory-vector.md) 的选型决策）。

## 一句话目标

在几百篇文档的知识库里，通过一次搜索快速定位到相关文档并跳转打开。**不做 LLM 生成回答**，
只做"搜索 → 命中列表 → 跳转"。

## 已实现

### 检索方式

混合检索：FTS 全文（trigram tokenizer，覆盖中文子串匹配）+ 向量语义，用 RRF（倒数排名融合）
合并两路召回结果，见 [internal/rag/search.go](../../internal/rag/search.go)。

除"混合 / 仅关键词 / 仅语义"三种模式外，代码里还多了第四种 `ModeLike`：绕开 chunk/FTS/向量
索引，直接对 memo 标题/正文做 SQL `LIKE` 子串匹配。这是 07-16 版需求之外新增的兜底模式，
用户可在 Preferences 里选择。

结果按文档去重：一个文档命中多个 chunk 会合并为一条，取最高分作为展示片段。长尾结果按相对
分数阈值（`relativeScoreCutoff`）裁剪；纯语义命中（无关键词匹配）还受一个最低相似度阈值
（`semanticMinSimilarity`）过滤，避免噪音。

### 索引范围

只索引 `DocType == MARKDOWN`（或空值，历史数据）的文档。HTML/PDF（渲染类型）与 `.view`
（配置类型）不索引，见 [internal/rag/index.go](../../internal/rag/index.go) 的 `IsIndexable`。
该函数本身已设计成未来可扩展的过滤点（预留按知识库配置索引范围的空间），但目前尚无 UI 配置。

### 降级策略

未配置 embedding provider 时，检索自动降级为纯 FTS 关键词检索，功能始终可用（见
`internal/rag/search.go` 里 mixed 模式对 embedding 缺失的兼容逻辑）。前端在降级时展示提示
（`search.keyword-only-hint`）。

### 权限收敛

检索范围限定在调用者可访问的 memo 集合内（`SearchParams.MemoIDs` 由调用方计算好的
permission-scoped 候选集传入），不会检索到无权限内容。

### 搜索入口（与原需求的实现路径有差异）

- **全局搜索（原 F1）**：不是独立的左侧主导航"搜索"入口 + 专属搜索页，而是**并入了
  Explore 页面的搜索框**——`Explore` 现在是统一的"搜索 + 浏览"入口，见
  [web/src/components/MemoExplorer/ExploreSearchResults.tsx](../../web/src/components/MemoExplorer/ExploreSearchResults.tsx)
  与 `usePrimaryNavLinks.tsx` 里的说明注释。检索范围仍是全局（`scope: { global: true }`），
  且支持叠加 Explore 已有的结构化 CEL filter（workspace / tag / 时间等），关键词单独通过
  `query` 字段传递（不编码进 filter，以免丢失语义召回）。
- **知识库内搜索（F2）**：已实现，在 Notebook 侧栏搜索框提交后，预览区切换为
  [LibrarySearchResults.tsx](../../web/src/components/Notebook/LibrarySearchResults.tsx)
  展示命中列表，同时文件夹树过滤为"命中文档 + 其父级路径"；清空搜索框恢复原状。检索范围
  限定当前 workspace（`scope: { workspace: ... }`）。

点击命中项跳转到对应文档，本期不做片段内定位/滚动高亮，与原需求一致。

### Settings 配置

- **instance 级**：embedding provider/模型配置在 AI Provider 设置页新增的一块
  （[AISection.tsx](../../web/src/components/Settings/AISection.tsx)），复用现有 AI provider
  配置体系，支持"测试连接"。
- **user 级**（[PreferencesSection.tsx](../../web/src/components/Settings/PreferencesSection.tsx)）：
  - 检索模式：混合 / 仅关键词 / 仅语义 / Like（见上）。
  - 最大命中文档数（`maxResultDocs`，默认 20）。

### 索引维护

`RagService` 提供 `RebuildIndex`（instance owner 权限，清空并重新入队全量索引）与
`GetIndexStatus`（索引队列进度），对应 07-16 需求里"异步增量 + 手动全量重建"的手动重建部分。
异步增量索引由 [internal/rag/worker.go](../../internal/rag/worker.go) 承担。

### 向量存储

无 CGO（`modernc.org/sqlite` 纯 Go 驱动），`sqlite-vec` 不可用；向量存成 SQLite `BLOB`，
检索候选集（FTS 召回的 `candidateLimit=50` 篇）内用 Go 内存暴力算 cosine 重排。这不是"全库
语义召回"，而是"关键词候选 + 语义重排"——FTS 未命中的文档语义搜索也捞不回来。完整决策见
[ADR-0006](adr/0006-no-cgo-drop-sqlite-vec-for-fts5-and-in-memory-vector.md)。

换 embedding 模型后旧向量整体作废，触发后台重建。

## 明确不做

- LLM 生成式回答（问答/聊天）——见下方"未排期方向"。
- PG / pgvector 全库语义召回（未来方向，见
  [sqlite-as-sole-datasource.md](requirements/storage/sqlite-as-sole-datasource.md)
  的复评触发条件）。
- 外部向量数据库、独立检索微服务。
- HTML / PDF / `.view` 文档的索引。
- 命中片段的精确定位与滚动高亮。
- 分片大小 / overlap 暴露为用户配置。

## 未排期方向：RAG 问答

以下内容来自更早的 2026-07-12 讨论，是"检索 + LLM 生成回答"（而非本文档描述的纯检索）方向
的共识记录，**未排期，不在当前开发计划内**。

### 动机

托管一份两年积累的 AI 课程知识库（20 余门课程、几百篇文档），已超出"翻文件夹能一眼找到"的
量级，存在"直接对话检索资料"的诉求：用户提问，检索相关片段后交给 LLM 生成回答（即 RAG 的
完整形态：Retrieval-Augmented Generation）。

### 与现状检索的差异

若启动，在当前"仅检索"基础上要补的是生成环节：检索 top-K chunk → 连同问题交给 LLM → 生成
回答，回答附来源文档链接。当前的混合检索、chunk/embedding 存储可以直接复用，不需要另起一套。

### 触发条件

仅当出现以下情况之一时，才回来规划排期：

1. 用户在真实使用中反复遇到"翻目录/关键词搜索找不到想要的资料"的痛点，验证检索问答确有
   日常使用价值；或
2. 用户主动决定投入时间做一次 RAG 实操练习，无论是否有强烈使用痛点驱动。

### 若启动，最小可行范围

- 复用已有的 AI provider 配置做生成式回答调用，不新增一套独立 provider 配置。
- 一个搜索/聊天入口：提问 → 检索 → 连同问题交给 LLM 生成回答，回答附来源文档链接。
- 用真实会问的 10-20 个问题做人工评估检索质量，而非一上来打磨聊天 UI。
- 明确不做：多租户隔离、按用户维度权限收敛（不面向陌生用户）、外部向量数据库/独立检索服务、
  承诺"生产级"精度或复杂 rerank 管线。

## TODO(确认)

- `internal/rag/index.go` 的 `IsIndexable` 已预留"未来按知识库配置索引范围"的扩展点，
  但目前是否有排期把这个过滤器做成知识库详情页的可配置项，未在代码或现有设计文档中找到结论。
