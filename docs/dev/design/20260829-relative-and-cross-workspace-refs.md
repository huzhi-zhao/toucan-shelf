# 文档相对路径与跨库引用 — 分阶段实施

需求、术语、语法选型与验收判据见
[requirements/document-reference-forms.md](../requirements/document-reference-forms.md)。
它所扩展的完整性维护基线见
[requirements/cross-reference-repair-on-move-rename.md](../requirements/cross-reference-repair-on-move-rename.md)
与 [20260807-cross-reference-repair-plan.md](20260807-cross-reference-repair-plan.md)（P0–P6）。

原则：**先做不碰权限、不碰异步、不碰 P6 的那一半**，并在这一半里把「前后端孪生解析器」的
测试基础设施建起来；跨库那一半再动权限与 P6 时才有安全网。

顺序不可倒置，也不建议合并成一期——理由见「风险与历史教训 · R1」。

---

> **实施状态（2026-09-04）**：R0、R1、R2 全部实现并通过静态检查（`go test ./...` 除既有失败
> `TestMigrationCopiesInstanceTagsToUserSettings` 外全绿；`web` 侧 tsc / biome 干净，vitest
> 无新增失败）。实现过程中的两处偏离设计：相对路径拆出了「显式 / 裸」两种子形式（见需求文档
> 「显式相对与裸相对：解析失败时的分岔」）；跨库三态中的「受限」与「不存在」被合并（见需求
> 文档「渲染：三态」，理由是可区分即等于给出库名探测接口）。

## R0 · 共享解析测试向量（前置，与 R1 同期交付）

`internal/linkindex/resolve.go` 与
`web/src/components/MemoContent/DocumentLinkContext.tsx` 是**手工维护的孪生实现**。
两边的注释都把这对镜像标为最高风险点：一方能解析而另一方不能，结果就是链接「明明好的却
显示为断链」或「明明断了却能跳转」。当前靠人工同步 + 各自的单测维持，加入两种新形式后，
需要同步的分支从 2 条涨到 4 条。

做法：一份与语言无关的用例文件（`internal/linkindex/testdata/resolve_cases.json`），
描述 `{tree, baseFolder, href, expect}`，Go 侧与 TS 侧各写一个 runner 读取同一份文件。
新增形式必须先加用例、再改两侧实现。

这不是可选项。**R0 未落地则 R1 不予合入。**

---

## R1 · 文档相对路径

纯库内，不涉及权限、不涉及异步、不改动 P6。

### R1.1 解析层（两侧同步）

- `internal/linkindex/resolve.go`
  - 新增 `IsRelativeDocHref(href) bool`：不以 `/` 开头、不以 `@` 开头、非 scheme 限定、
    非空、非纯 fragment。`@` 前缀在此就要排除掉，为 R2 预留，避免 R2 上线时 R1 的判定
    先把它吃掉。
  - 新增 `ResolveRelativePath(tree, baseFolderPath, href) (uid string, ok bool)`：
    把 `baseFolderPath` 与 href 的路径段合并、规约 `.` 与 `..`，越过根则判失败
    （**不允许**通过 `../../..` 逃逸到工作区根之上），随后复用现有 `findDocInFolder`。
  - `ResolveRootRelativePath` 与 `IsRootRelativeDocHref` **一行不改**。
- `DocumentLinkContext.tsx` 镜像同名逻辑。
- `DocumentLinkContextValue.resolve` 签名不变，但 Provider 的实现要闭包捕获当前文档的
  `folderPath` 作为基准。两个 Provider 现场都已持有 `memo`：
  [Notebook.tsx:631](../../../web/src/pages/Notebook.tsx)、
  [MemoDetail.tsx:128](../../../web/src/pages/MemoDetail.tsx)。
- 渲染入口 `Link.tsx` / `Embed.tsx` / `GridCard.tsx` 的判定从
  `isRootRelativeDocHref(href)` 改为 `isRootRelativeDocHref(href) || isRelativeDocHref(href)`。
  注意 `Link.tsx` 现在的 else 分支是「按站外链接新标签打开」——相对路径被纳入后，
  解析失败会落到断链样式而不是站外链接，这是**行为变化**，需求文档已确认接受。

### R1.2 后端解析调用点补基准

四处调用点都需要把「来源文档的 FolderPath」作为基准传入。它们手上都已经有 source memo，
不需要额外查询：

| 位置 | 来源文档 |
|---|---|
| [link_index.go:110](../../../server/router/api/v1/link_index.go) | `memo` |
| [link_repair.go:110](../../../server/router/api/v1/link_repair.go)、:232 | `source` |
| [site_publish.go:466](../../../server/router/api/v1/site_publish.go) | `memo` |
| [workspace_service.go:401](../../../server/router/api/v1/workspace_service.go) | `source` |

`link_repair.go:232` 那处（`rewriteOneMemoOutboundLinksToUID`）要特别注意：它用的是**旧库**
的树，基准也必须是文档在旧库中的 folder path，而不是移动后的。

### R1.3 出向链接固化（新增能力）

这是相对路径唯一新增的修复场景，也是 R1 的核心风险点。

触发点：
- 文档自身移动 —— [memo_service.go:832](../../../server/router/api/v1/memo_service.go)
  的 `folderChanged` 分支，`previousFolderPath` 现成。
- 所在文件夹被改名/移动 —— `repairFolderMoveReferencesBestEffort`
  （[workspace_service.go:346](../../../server/router/api/v1/workspace_service.go)）
  当前只修「指向子树的入链」，需扩为同时处理「子树内文档自身的相对出链」。

做法（单文档、无扇出）：用 `RewriteLinks`，对每条相对 href 按**旧** folder 解析出目标
uid，写回 `CanonicalHref(target.FolderPath, target.Title)`。解析不出的原样保留——它本来
就是断链，不要在移动时把断链变成别的东西。

幂等性：固化后的 href 是库根相对形式，`IsRelativeDocHref` 不再命中，重跑即 no-op。这条
必须有测试。

`link_repair.go:61` 那句 `source-moves-itself: … need no repair` 的注释要一并更新，
否则它会误导下一个读代码的人。

### R1.4 编辑器

`![[` 自动补全（[Editor/index.tsx:38](../../../web/src/components/MemoEditor/Editor/index.tsx)）
继续插入库根相对路径，**不改**。相对路径是给人手写和给外部导入用的，自动插入没有理由
选一个会在移动时被改写的形式。

### R1.5 验收

需求文档验收判据的前 3 条 + 「`![](db.md)` 仍是坏图」那条回归判据。
额外的实现级判据：`../../../` 越过工作区根的 href 判为断链，不得逃逸到别的库。

---

### R1 实现落点（回填）

| 位置 | 内容 |
|---|---|
| [internal/linkindex/testdata/resolve_cases.json](../../../internal/linkindex/testdata/resolve_cases.json) | 33 条共享向量，Go 与 vitest 两侧同一份 |
| [internal/linkindex/resolve_cases_test.go](../../../internal/linkindex/resolve_cases_test.go) | Go runner |
| [web/tests/document-link-resolve-cases.test.ts](../../../web/tests/document-link-resolve-cases.test.ts) | vitest runner |
| `linkindex.ClassifyDocHref` / `ResolveRelativePath` / `ResolveInWorkspace` / `ResolveRelativeToCanonical` | 后端解析与固化原语 |
| `classifyDocHref` / `resolveRelativePath` / `resolveInWorkspace`（DocumentLinkContext.tsx） | 前端孪生实现 |
| `fossilizeOutboundRelativeLinksBestEffort`（link_repair.go） | R1.3 固化，单文档移动与文件夹移动共用 |
| `DocumentLinkContextValue.baseFolderPath` / `resolveFrom` | 渲染基准目录；`Embed` 用 `resolveFrom` 把嵌入文档重定基到它自己的目录 |

一处设计中未预见的问题：`![[...]]` 嵌入的文档是在**宿主文档的 Provider 里**渲染的，
若不重定基，同一篇被嵌入文档的相对链接会因嵌入者不同而解析到不同目标。已由 `resolveFrom` 修正。

## R2 · 跨库链接

### R2.0 前置：知识库标题约束

`CreateWorkspace` / `UpdateWorkspace` 新增校验：标题不含 `/`、不以 `@` 开头
（`validateWorkspaceTitle`）。

原设计在此处还有一段存量迁移方案。**已删除**：跨库链接没有存量数据（2026-09-04 确认），
所以不存在「已写下的 `@库/…` 因库名违规而错误切分」的风险。违规的存量库不静默改名、不阻塞，
只是暂时无法被跨库链接寻址。

### R2.1 解析层

- `IsWorkspaceQualifiedHref(href)`：以 `@` 开头，首段（到第一个 `/`）非空。
- `ParseWorkspaceQualifiedHref(href) (title, rootRelativePath string, ok bool)`。
  路径段按库根相对处理，**不接受 `.` / `..`**（需求已定），含 `..` 一律判失败。
- **同时收窄 `IsRootRelativeDocHref`**：确认 `@` 开头不会进入库内路径分支。当前它只看
  `/` 前缀，`@` 天然不命中，但要有测试把这条钉住——这是 R2 与 R1 之间最容易出错的接缝。

### R2.2 后端：按库取树 + 权限

- `buildWorkspaceLinkTree` 已按 `workspaceID` 参数化，无需改造，只需在调用侧按库缓存。
  `link_repair.go` 里 `trees map[int32][]*TreeNode` 是现成的写法先例。
- 每个跨库解析结果必须过 `s.resolveWorkspaceAccess(ctx, user, targetWorkspaceID)`。
  权限不足时返回「存在但受限」而非「不存在」，二者在 API 上要能区分，但受限响应体中
  **不得包含目标标题与路径**。
- `memo_link` 无需 schema 变更：表只有 `(memo_id, target_memo_id)`，跨库边本就合法，
  `resolveMemoLinkTargets` 的 `GetMemo` fallback 已覆盖跨库目标。

### R2.3 前端：预取而非异步化

`resolve(href)` 目前是同步纯函数，`Link.tsx` 与 `Embed.tsx` 在渲染期直接调用。改成异步
会波及每一个调用点的中间态与降级分支。

**采用预取**：渲染前扫一遍文档内容，收集其中出现的全部 `@库标题`，批量拉取这些库的树
（一次请求，带权限裁决结果），塞进 DocumentLinkContext；`resolve` 保持同步。

代价是预扫与渲染必须看到同一份内容——两者都在 `MemoContent` 的同一次渲染里，可控。
需要新增一个批量接口：给定若干库标题，返回「树 / 受限 / 不存在」三态。注意**不存在与
受限要在同一个响应形状里返回**，否则通过响应差异就能探测出某个库标题是否存在。

`navigate` 要能跨库切换（`handleSelectDocument` 目前默认当前库）。

### R2.4 三态渲染

扩展现有 `markdownStyles.brokenLink`（[Link.tsx:68](../../../web/src/components/MemoContent/markdown/Link.tsx)）
为三态。受限态：不可点击、tooltip 只说「无权访问该知识库」、DOM 中不出现目标信息。

`Embed.tsx` 对库限定 target 直接返回「不支持跨库嵌入」提示，在 `resolve` 之前就短路，
避免任何跨库读取发生。

**内联媒体的受限提示（顺带做掉）**：跨库附件的 ACL 本身已经正确
（见需求文档「跨库内联附件的访问控制」），但拒绝时返回 `ErrNotFound`，读者只看到一张坏图。
`Image.tsx` 应对加载失败的内联媒体给出与链接受限态一致的提示。**注意**：提示文案不得区分
「无权访问」与「不存在」——ACL 刻意用 NotFound 隐藏存在性，渲染层不能把它泄露回去。

### R2.5 P6 反转：拒绝 → 修复

这是 R2 里行为变化最大、测试改动最多的一块。

- [memo_service.go:762](../../../server/router/api/v1/memo_service.go)：跨库移动文档时的
  `findExternalLinkReferences` 拒绝分支，改为放行 + 修复入链为库限定路径。
- [workspace_service.go:520](../../../server/router/api/v1/workspace_service.go)：跨库移动
  文件夹的同一套检查，同样处理。
- `rewriteOutboundLinksToUIDBestEffort`（[link_repair.go:203](../../../server/router/api/v1/link_repair.go)）：
  移动出去的文档指回旧库的出链，从「降级为 `/memos/{uid}`」改为「改写为 `@旧库/…`」。
  UID 降级作为解析不出目标时的兜底保留，不删除。
- 现有测试 `TestCrossWorkspaceMoveRejectedP6`、`TestCrossWorkspaceMovePinsOutboundLinksToUID`
  的**预期行为要改**。改测试时的红线：新预期必须先在需求文档的验收判据里有对应条目，
  不允许为了让实现通过而调整断言。

### R2.6 知识库改名修链（新链路）

`UpdateWorkspace` 的 title 分支当前没有任何修链钩子。新增：改名后，用 `memo_link` 反查
所有指向该库内文档的引用者，对每篇用 `RewriteLinks` 把 `@旧标题/` 前缀换成 `@新标题/`。

比文档改名简单——所有引用者换的是同一个值，不需要 as-of 树。沿用 best-effort + 非阻塞
的既有约定：改名本身已提交，修链失败只记日志。

---

## 风险与历史教训

**R1 · 孪生解析器漂移（高）** —— 见 R0。这是本项目在这块踩过的既有风险，不是新风险；
新形式只是把它放大了一倍。缓解手段就是 R0，且必须先行。

**R2 · 前端同步 resolve 的改造面（高）** —— 见 R2.3。选预取而非异步化，就是为了把改造
限制在 Provider 一层，不扩散到每个渲染组件的中间态。若预取方案在实施中被推翻，需要重新
评估 R2 的工作量，不要就地改成异步。

**R3 · ~~库标题存量违规~~（已消除）** —— 见 R2.0。跨库链接无存量，迁移步骤整段取消。

**R4 · P6 不变式反转（中）** —— 见 R2.5。有测试覆盖是好事，但也意味着「改实现必然要改
测试」，容易顺手把测试改成迁就实现。红线已写在 R2.5。

**R5 · 跨库嵌入的泄露面（中）** —— v1 直接不做，风险归零。但要确保 `Embed.tsx` 是在
解析之前短路，而不是解析之后再拒绝渲染——后者仍会产生一次跨库读取。

**R6 · 移动时改写正文与并发编辑（中，继承既有取舍）** —— R1.3 的固化会改写用户正文，
沿用既有约定：不做并发保护，用户在改名/移动同时编辑该文档会被覆盖。R1 新增的改写点让
这个既有风险的触发面变大了（现在被移动的文档自己也会被改写），需求文档已记录。

**R7 · 批量改写触发 N 次 RAG 索引（低，继承既有 TODO）** —— 既有需求文档已记录
「批量写入的事务与索引重建合并」这条 TODO。R2.6 的库改名修链可能一次改写大量文档，
会让这个问题更明显。本期不解决，但要在 R2.6 的实现处留下指向那条 TODO 的注释。

## 已知取舍

- 相对路径在文档移动时固化为库根相对，书写语义丢失。接受。
- 跨库链接在 memogit 导出后失效（一库一 checkout，且 memogit 不处理链接）。接受，
  需求文档已记录为已知限制。
- 库限定路径按标题而非 uid 寻址，因此依赖标题唯一性与改名修链。选择理由（可读性、
  不碰现有解析入口）见需求文档。

## 开放问题

沿用需求文档「开放问题」一节：隐藏库能否作为跨库目标、grid/kanban 等块的覆盖范围、
库标题大小写敏感性。均可在实施中确定。

原先列在此处的「附件 blob 读取路径是否有跨库 ACL 校验」**已核实并关闭**：
`attachmentacl.checkVisibility` 按附件所挂文档自己的 `WorkspaceID` 判权限，跨库内联的
附件已被正确拦截，无需改动。详见需求文档「跨库内联附件的访问控制」一节。

## 工作量粗估

| | 后端 | 前端 | 测试 |
|---|---|---|---|
| R0 | 0.5d | 0.5d | — |
| R1 | 2d | 1d | 1d |
| R2 | 4d | 3d | 2d |

R2 的后端 4 天中，P6 反转（R2.5）与库改名修链（R2.6）各占约 1.5 天，是主要不确定性来源。

---

## R2 实现落点（回填）

| 位置 | 内容 |
|---|---|
| `validateWorkspaceTitle`（workspace_service.go） | R2.0 标题约束，创建与改名两条写路径 |
| `linkindex.ParseWorkspaceQualifiedHref` / `WorkspaceQualifiedHref` / `RetitleWorkspaceQualifiedHref` | R2.1 解析、构造、改名替换 |
| `parseWorkspaceQualifiedHref`（DocumentLinkContext.tsx） | 前端孪生实现 |
| `internal/linkindex/testdata/resolve_cases.json` | 42 条共享向量（原 33 条 + 库限定 11 条），新增 `other` 目标库树 |
| `workspaceLinkTrees`（link_index.go） | R2.2 索引侧按库标题取树；**不过权限**，索引由内容派生 |
| `BatchGetWorkspaceTreesByTitle`（workspace_service.go） | R2.3 渲染侧批量预取；权限在这里判，受限与不存在同形返回 |
| `extractWorkspaceQualifiedTitles` / `useCrossWorkspaceTrees` / `makeCrossWorkspaceResolver` | R2.3 预取链路，`resolve` 保持同步 |
| `markdownStyles.restrictedLink` + `Link.tsx` 的 `workspaceQualified` 分支 | R2.4 三态 + pending 态 |
| `Embed.tsx` 的 `classifyDocHref` 前置短路 | 跨库嵌入在**解析之前**拒绝，不产生跨库读取 |
| `crossWorkspaceHrefFor` / `repairInboundLinksBestEffort` 的按引用者选形 | R2.5 入链修复 |
| `rewriteOutboundLinksAfterWorkspaceMoveBestEffort`（原 …ToUIDBestEffort） | R2.5 出链改写为 `@旧库/…`，uid 为兜底 |
| `repairWorkspaceTitleReferencesBestEffort`（link_repair.go） | R2.6 库改名修链 |
| `buildWorkspaceLinkTreeAsOf` 的「文档已不在本库则补回」 | 跨库移动后，留守引用者的陈旧 href 才解析得出来 |

设计中未预见的两点：

1. **`buildWorkspaceLinkTreeAsOf` 的注入**。P4/P5 时被改名的文档一直在本库，覆盖即可；跨库
   移动后它已经不在引用者所在库的文档列表里，不补回去的话入链修复会「什么都找不到」而静默
   跳过。
2. **库标题的大小写并存**。标题唯一索引是大小写敏感的，而路由与本形式的匹配是大小写不敏感
   的，因此「Career」与「career」可以同时存在。索引侧与渲染侧用同一条规则化解：精确匹配优先，
   折叠键不覆盖已占用的键——两侧必须一致，否则同一条链接会「索引到一个库、渲染到另一个库」。

### R2 未做

- `GridCard` 内的库限定路径仍按站外链接渲染（需求文档「开放问题」已记录）。
- 已发布站点（`site_publish.go`）不解析库限定路径：快照是单库的，目标不在其中。
- 隐藏库能否作为跨库目标，仍是开放问题；当前实现按普通库处理（可解析、按权限判定）。
