# 知识库内文档引用在移动/重命名/删除时的完整性维护

分阶段实施计划见
[design/20260807-cross-reference-repair-plan.md](../design/20260807-cross-reference-repair-plan.md)。

## 背景

类似 Obsidian、Notion 的知识库产品，在文档被重命名或移动时会自动维护/修复知识库内部
`[doc name](url)` 形式的引用链接。产品侧提出同等诉求：文档/文件夹移动、重命名、
归档、删除时，应检查知识库内部的引用依赖，并按操作类型分别做「静默修复」「弹窗确认后
修复」「弹窗告知并拒绝操作」。

## 现状事实（可证伪，来自对当前实现的调研）

以下每条都能通过读代码或实测复现，是本文档需求边界的依据，不是假设。

- **文档详情页链接以 uid 寻址，不以标题/路径寻址。** 复制链接生成的是
  `{host}/memos/{uid}`（[web/src/components/MemoActionMenu/hooks.ts:121](../../../web/src/components/MemoActionMenu/hooks.ts)、
  [web/src/pages/Notebook.tsx:559](../../../web/src/pages/Notebook.tsx)），路由定义在
  [web/src/router/index.tsx:116](../../../web/src/router/index.tsx)。`uid` 在文档整个生命周期
  （含改名、跨文件夹/跨工作区移动）里不变（`UpdateMemo`，
  [server/router/api/v1/memo_service.go:523](../../../server/router/api/v1/memo_service.go)）。
  **因此这类链接天然不会因为移动/重命名而失效。**
- **站内相对路径链接（多为 Obsidian 迁移遗留）在渲染时按标题兜底解析。**
  [web/src/components/MemoContent/DocumentLinkContext.tsx:81](../../../web/src/components/MemoContent/DocumentLinkContext.tsx)
  的 `resolveWorkspacePath`：先按相对路径解析，失败则退化为在整棵工作区树里按标题
  （忽略大小写、去扩展名）匹配，注释明确写着是为了让文档移动后链接仍然可用。
  **因此「移动文件夹」不会破坏这类链接**，只有「改标题」会——因为兜底本身就是按标题匹配的。
- **没有 wiki-link / 插入文档引用的编辑器功能**，只有标准 markdown 链接语法
  （[web/src/components/MemoContent/markdown/Link.tsx](../../../web/src/components/MemoContent/markdown/Link.tsx)）。
  `@mention` 语法（[web/src/utils/remark-plugins/remark-mention.ts](../../../web/src/utils/remark-plugins/remark-mention.ts)）
  指向用户，与文档引用无关，不可复用。
- **没有反向引用索引。** 已有的 `memo_relation` 表
  （[store/memo_relation.go](../../../store/memo_relation.go)）是用户手动设置的「关联文档」，
  与正文里的 markdown 链接完全独立，改一个不影响另一个。`internal/markdown` 下只有
  `mention`、`tag` 两种解析扩展，没有链接解析。
- **删除前依赖检查已有先例，但不完整。** `DeleteWorkspaceFolder`
  （[server/router/api/v1/workspace_service.go:463](../../../server/router/api/v1/workspace_service.go)）
  和 `DeleteWorkspace`（同文件 151 行）在删除前会统计文件夹/工作区内是否还有
  `RowStatus=NORMAL` 的文档，非空则 `FailedPrecondition` 拒绝。但这只检查「容器是否为空」，
  不检查「容器外的文档是否引用了容器内的内容」；单文档硬删除 `DeleteMemo`
  （同文件 719 行）完全没有依赖检查。
- **RAG 的 FTS trigram 索引**（`memo_chunk_fts`，
  [store/migration/sqlite/0.30/08__rag_search.sql](../../../store/migration/sqlite/0.30/08__rag_search.sql)）
  能对目标 uid 做子串粗筛，但无法判断命中的字符串是否真的出现在链接位置，不能替代精确解析。

## 需求边界（相对最初提案的调整）

最初提案假设「移动」也会破坏引用，因此要求移动文档/文件夹时弹窗确认并自动修复。
但上述事实表明，本系统的链接寻址方式已经让移动操作天然不产生断链——无论是 uid 链接
还是按标题兜底的相对路径链接，移动文件夹都不影响命中。据此调整范围：

| 操作 | 是否需要处理 | 处理方式 |
|---|---|---|
| 移动文档（同/跨工作区，不改标题） | 否 | 不产生失效引用，不做检查、不弹窗 |
| 移动文件夹（含跨工作区） | 否 | 同上 |
| 重命名文档 | 是 | 静默检查引用它的文档，自动修复锚文本，不弹窗 |
| 重命名文件夹 | 否 | 文件夹名不出现在链接寻址路径中（链接按标题匹配文档，不按文件夹路径匹配），不影响引用 |
| 归档文档/文件夹 | 是 | 检查是否被引用，被引用则弹窗列出引用来源并拒绝操作 |
| 删除文档/文件夹（含移出知识库，如该操作存在） | 是 | 同上：弹窗列出引用来源并拒绝操作 |

「重命名文档」是唯一需要写操作（自动改写别的文档正文）的场景，且改写对象严格限定为
「引用它的文档里，锚文本与旧标题完全一致的那部分」——用户手动改写过的自定义锚文本不动，
避免自动化覆盖用户的表达意图。

## 验收判据

- 文档 A 被文档 B、C 引用（B 用绝对链接，C 用相对路径链接）。重命名 A 后，
  B、C 中锚文本等于旧标题的链接自动更新为新标题；B 中若锚文本被手动改写过
  （不等于旧标题），保持不变。整个过程不向用户弹窗。
- 文档 A 被文档 B 引用。移动 A 到另一个文件夹（含跨工作区），B 中的链接不产生 404，
  不触发任何弹窗或后台修复动作。
- 文档 A 被文档 B 引用。尝试归档或删除 A，操作被拒绝，弹窗列出「文档 B」作为引用来源；
  确认后 B 中的引用不会被自动清理，需要用户自行处理。
- 文档 A 未被任何文档引用。归档/删除/移动 A 均直接成功，不产生任何弹窗。
- 文件夹 F 下的文档被 F 外的文档引用。删除/归档 F 时，弹窗列出 F 内被引用文档及其引用来源
  （不只是判断 F 是否为空，是判断 F 内容是否被 F 外引用）。

## 非目标

- 不做「插入文档引用」的编辑器功能（自动补全、选择文档插入链接）。当前链接产生渠道
  只有「复制链接」手动粘贴与 Obsidian 迁移导入，不在本次需求范围内新增。
- 不处理 `memo_relation`（用户手动设置的关联文档）的同步维护，它与正文链接是两套独立机制。
- 移动操作是否要展示「有 N 篇文档引用了它」这类非阻断提示（仅供参考，不影响操作），
  留待产品决定，不在本期强制要求。
