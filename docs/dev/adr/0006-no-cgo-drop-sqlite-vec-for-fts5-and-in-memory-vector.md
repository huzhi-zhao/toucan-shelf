# ADR-0006：无 CGO ⇒ 放弃 sqlite-vec，FTS5 ＋ 内存向量

## 状态

已采纳。

## 背景

[RAG 检索式搜索](../rag-search.md)需要选一套向量存储与检索方案。项目的 DB 驱动是
`modernc.org/sqlite`（纯 Go 实现，**无 CGO**）——这是一个决定性约束：**无法加载 C 扩展**，
`sqlite-vec` / `sqlite-vss` 均不可用。

更早的 2026-07-12 讨论里，`sqlite-vec` 曾被列为"优先"方案，前提是当时还没有确认驱动层的
CGO 约束。见 [rag-search.md](../rag-search.md) 的"未排期方向"一节。

同时 FTS5 是 modernc 驱动内置能力，可用（中文场景需用 `trigram` tokenizer，因无分词器）。

## 决策

- 向量存储：embedding 直接存进 SQLite `BLOB` 列，不引入任何向量扩展或外部向量数据库。
- 向量检索：不做全库向量召回，而是"FTS 候选集（`candidateLimit = 50` 篇）内，Go 内存暴力算
  cosine 相似度重排"。
- 全文检索：FTS5 + `trigram` tokenizer。
- 融合：RRF（倒数排名融合）合并 FTS 与向量两路召回，不引入需要调阈值的加权方案。

实现见 [internal/rag/vector.go](../../../internal/rag/vector.go)、
[internal/rag/search.go](../../../internal/rag/search.go)。

## 理由

1. **CGO 约束是硬限制，不是取舍**。纯 Go 驱动是项目"单 Go 二进制、无需 CGO 交叉编译"的既有
   取向的直接后果，sqlite-vec 这条路在当前驱动下物理上不可用。
2. **用户量级下暴力检索足够快**。候选集固定为 50 篇文档的 chunk，性能上有界且与总文档量
   无关，个人/小团队场景下亚毫秒到毫秒级，不需要专门的向量索引结构。
3. **零额外依赖**，符合项目"不引入新基础设施"的一贯选择（[存储层收敛](../requirements/storage/sqlite-as-sole-datasource.md)
   同样的取向）。

## 影响

- **能力边界，非性能边界**：这是"关键词候选 + 语义重排"，不是"全库语义召回"——FTS 未命中的
  文档，语义搜索也捞不回来。见 [rag-search.md](../rag-search.md)。
- **换 embedding 模型需要全量重建**：表结构存了 `model` + `dim`，模型一变旧向量整体作废，
  触发后台重建。个人库量小，重建成本可接受。
- **将来若需要全库语义召回**，按
  [sqlite-as-sole-datasource.md](../requirements/storage/sqlite-as-sole-datasource.md)
  的复评结论重新引入 PostgreSQL + pgvector，这是独立的能力决策，与当前数据量无关，
  预算 3–5 人日。在此之前不会因为"数据变多"而被动触发（暴力 cosine 的性能与总量无关）。
- FTS5 的 `trigram` tokenizer 索引体积约为原文的 3–5 倍（远高于 unicode61 的 0.3–0.5
  倍），监控库体积需按此系数换算真实文档量，见
  [sqlite-as-sole-datasource.md](../requirements/storage/sqlite-as-sole-datasource.md)
  的容量边界一节。
