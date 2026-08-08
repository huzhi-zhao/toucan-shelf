# RAG 检索搜索 —— 迭代 2：搜索页与 Explore 合并 + 检索质量优化

> 承接 [`requirement.md`](./requirement.md) / [`tech-design.md`](./tech-design.md)。
> 本文件记录第一版落地后（F1/F2/F3 + 后端全链路已实现）的一轮 bugfix 与架构优化。

## 背景问题

第一版交付了两个全局搜索入口：

- `/search`（F1 全局 RAG 搜索页）：语义 + FTS 混合、按相关性排序。
- `/explore`（Explore feed）：结构化过滤 + `content.contains` 关键词（SQL `LIKE`）、按时间排序，默认只看「今天」。

两者语义重叠、结果不一致，造成困惑（同一个词，Explore 用 `LIKE` 实时扫全表，RAG 只搜已建索引的 markdown chunk，且做了相关性裁剪）。结论：**去掉 `/search`，把 Explore 改造成统一的「重搜索」页**。

## 核心决策

**过滤条件定义语料范围，关键词在范围内做相关性排序。**

- **空关键词** → Explore 展示「所有可见文档」的分页 feed（去掉默认「今天」过滤）。
- **有关键词** → 走 RAG 混合检索，并把 Explore 侧栏的**结构化过滤（workspace / visibility / tag / time / doc_type）作为候选集**喂给 RAG；关键词本身作为 RAG query（**不**编码成 `content.contains`，否则语料被塌缩为精确子串、丢失语义召回）。

非 markdown 文档（HTML/PDF）本轮**不处理**：关键词模式下只覆盖已索引的 markdown。

## 本轮改动清单

### 后端

1. **候选集过滤入参** — `proto/api/v1/rag_service.proto` `SearchRequest` 新增 `string filter = 6`（CEL，语法同 `ListMemos.filter`）。
   - `server/router/api/v1/rag_service.go`：`accessibleMemoIDs(ctx, user, workspaceID, extraFilters...)` 把调用方 CEL 过滤 **AND** 到权限过滤上（只能收窄不能放宽），`Search` 传入 `request.GetFilter()`。语料先被结构化过滤圈定，RAG 再在其中排序 —— 顺带把向量暴力扫的 N 压小。

2. **相关性裁剪**（`internal/rag/search.go` `fuseAndDedup`）：
   - 纯语义命中（无关键词匹配）cosine < `semanticMinSimilarity`(0.30) 判噪声丢弃；关键词/子串命中始终保留。
   - 长尾裁剪：融合分 < 最高分 × `relativeScoreCutoff`(0.25) 的结果截断（保留 top1）。
   - 效果：返回条数随实际相关性变化，不再固定凑满 limit。

3. **Embedding 失败优雅降级**（关键 bugfix，起因 Gemini 429）：
   - 查询时 `rag.Search`：`vectorSearch` 出错 → 记日志 + 降级为纯关键词（必要时补跑 FTS），不再整体报错。
   - 索引时 `indexMemo`：`ai.Embed` 失败 → **仍写入 chunks（FTS 立即可用）**，再返回错误让任务重试补向量。此前一失败就 return，导致文档从未进入 FTS 索引。
   - worker 重试 3 次后标 `failed`；已失败文档需重新入队（编辑 memo / RebuildIndex）。

### 前端

4. **Explore 改造**（`web/src/pages/Explore.tsx`）：去掉默认「今天」过滤；`useMemoFilters` 新增 `excludeContentSearch` 选项，构造「不含关键词」的候选集 CEL；有关键词 → `<ExploreSearchResults>`（相关性列表），空 → 原 `PagedMemoList` feed。
5. **新组件** `web/src/components/MemoExplorer/ExploreSearchResults.tsx`：调 `RagService.Search({ query, filter, scope: global })`，渲染排序命中卡片，点击跳转对应文档；带降级提示。
6. **删除 `/search`**：移除 `pages/Search.tsx`、路由、`Routes.SEARCH`；导航去掉 Search 项，Explore 项改用搜索图标（成为统一搜索入口）。

### F2（Notebook 库内搜索）本轮相关修复

- 文件夹树显示「文件名匹配 ∪ 内容命中」的并集（`collectDocMemosByName`）。
- 点击命中项打开文档时**保留搜索状态**（树保持过滤、命中高亮），只有清空搜索框才恢复完整树。

## 验证

- `go build ./...` ✓；`go test ./internal/rag/...`、`store/test` 的 `memo_chunk_test` ✓；前端 `tsc` 0 报错、biome 干净。
- 已知无关失败：`store/test` `TestInstanceSettingMemoRelatedSetting`（ContentLengthLimit 24576 vs 16384，HEAD 上即失败）。

### 手动自测清单
1. Explore 无关键词 → 展示所有可见文档 feed（无「今天」限制）。
2. 输入关键词 → 相关性排序命中列表；侧栏切 workspace/visibility/tag/time → 命中集随之收窄。
3. 未配 / 429 时 → 关键词仍可用（FTS），显示「仅关键词」提示。
4. 点命中项 → 跳转对应文档。
5. 旧 `/search` 直链 → 已移除（导航仅剩合并后的 Explore 入口）。

## 重建索引：改为用户级（2026-07-17）

`RebuildIndex` 原为管理员全量重建。但「我的文档 429 建索引失败」是**按用户维度**的恢复需求，不该要管理员。经确认按**个人实例**模型落地为纯用户级：

- 后端：`RebuildIndex` 去掉管理员门槛（仅要求已登录），改为 `enqueueRebuild(reason, creatorID=&user.ID)` 只重灌**当前用户自己的 memo**。`enqueueFullRebuild` 泛化为 `enqueueRebuild(reason, creatorID *int32)`：`creatorID=nil` 仍是全量（供换 embedding 模型时的实例级重建 hook 使用）。
- 前端：Settings→Preferences「搜索」分组新增一行——展示索引状态（`GetIndexStatus`：已索引/待处理/失败）+「重建索引」按钮，完成后 toast 显示入队数并刷新状态。i18n en + zh-Hans 已加。

## 仍未做（scoped）

- 关键词模式覆盖非 markdown（HTML/PDF）文档 —— 需扩展索引范围，本轮明确不做。
- Explore 关键词模式结果用轻量卡片而非完整 `MemoView`（避免重量级 memo 转换）；如需完整卡片，后续可在 `SearchHit` 内联完整 `Memo`。
