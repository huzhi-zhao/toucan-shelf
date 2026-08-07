# 跨文档引用完整性维护 — 分阶段实施

需求、事实依据与验收判据见
[requirements/cross-reference-repair-on-move-rename.md](../requirements/cross-reference-repair-on-move-rename.md)。

原则：反向引用索引是地基，先做「只读」的检测与拒绝（风险低、立刻有产品价值），
再做「写」的自动改锚文本（风险高，涉及自动改写用户正文，需要更谨慎的边界判断）。
每个阶段独立可提交。

---

## P0 · 反向引用索引

新增一张轻量表，记录「某文档的正文里，出链到了哪些文档」。以 `target_uid` 而非文字
路径存储，保证目标改名后索引本身不失效，只是锚文本需要走 P2 的修复。

- 解析时机：文档保存（`UpdateMemo` 命中 `content` 变化）时，对本文档全量重新解析出链，
  覆盖写入索引——不做增量 diff，全量重解析最简单也最不容易脏。
- 解析范围：markdown 链接的 href，识别两种形式——
  - 绝对形式 `/memos/{uid}` 或 `{host}/memos/{uid}`，直接取 uid；
  - 相对路径形式，复用 `DocumentLinkContext.resolveWorkspacePath`
    （[web/src/components/MemoContent/DocumentLinkContext.tsx:81](../../../web/src/components/MemoContent/DocumentLinkContext.tsx)）
    的解析算法在后端重新实现一份（该逻辑目前只存在于前端渲染路径，落库需要在后端跑一遍
    同样的相对路径 + 标题兜底匹配，得到确定的目标 uid）。
- 索引解析失败（目标不存在/歧义）的链接直接丢弃，不报错、不阻塞保存——引用索引是
  「尽力而为」的辅助数据，不是正文的强约束。

## P1 · 只读的依赖检查与拒绝弹窗

覆盖「归档 / 删除文档或文件夹」两类操作，复用
`DeleteWorkspaceFolder`（[server/router/api/v1/workspace_service.go:463](../../../server/router/api/v1/workspace_service.go)）
和 `DeleteWorkspace`（同文件 151 行）已经在用的「先查、非空拒绝」模式，把查询目标从
「容器内是否还有 NORMAL 文档」换成「容器内文档是否被容器外的文档引用」：

- 单文档删除 `DeleteMemo`（[server/router/api/v1/memo_service.go:719](../../../server/router/api/v1/memo_service.go)）
  目前完全没有依赖检查，这里要新增。
- 文件夹/工作区删除、归档，按 P0 的反向索引查询「子树内文档」作为目标集合，
  「子树外文档」引用了目标集合中任意一篇则视为存在依赖。
- 命中依赖时返回结构化列表（引用来源文档的 uid + 标题），前端弹窗展示并阻止提交，
  文案参考「以下文档引用了本次操作涉及的内容，需要先手动处理」。
- 归档路径需要确认现有 `state` 更新是否与删除走同一入口；若归档是 `UpdateMemo` 的
  `state` 分支（[memo_service.go:611](../../../server/router/api/v1/memo_service.go)），
  依赖检查要挂在这条分支上，不是新开一个接口。

此阶段不涉及任何写操作，风险最低，可以独立上线验证「反向索引查得准不准」。

## P2 · 重命名时静默修复锚文本

只处理「文档标题变化」这一种触发（`UpdateMemo` 的 `title` 分支，
[memo_service.go:660](../../../server/router/api/v1/memo_service.go)）。移动
（`folder_path`/`workspace` 变化）不触发，理由见 requirements 文档的「需求边界」表。

- 用 P0 索引反查「谁引用了这篇文档」，得到候选文档集合。
- 对每篇候选文档的正文重新做一次链接解析（同 P0 的解析器），逐个匹配「href 指向本次
  改名的 uid」的链接节点。
- 只替换锚文本完全等于旧标题的节点；锚文本不等于旧标题（用户自定义过）的跳过，
  不覆盖用户的表达意图——这是本阶段最容易出错、也最需要测试覆盖的边界。
- 写回候选文档正文时只动被命中的锚文本片段，其余字节原样保留，操作要求幂等
  （同一次改名重复触发不应产生二次 diff）与可重试。

### 风险与历史教训

memogit 移动语义早期把「移动」实现成「归档旧的 + 新建一个」，导致所有引用该文档的
链接全部断链（详见
[../plans/2026-07-13-memogit-cli/04-move-semantics-and-doc-identity.md](../../plans/2026-07-13-memogit-cli/04-move-semantics-and-doc-identity.md)
§4.2、§6.1）。当前 `UpdateMemo`/`RenameWorkspaceFolder` 已经是原地更新、uid 不变，
不会重蹈这个坑，但它确立的原则本阶段仍然适用：**自动改写文档内容必须幂等、可逆、
不产生误伤 diff**。P2 是本计划里唯一自动改写「别的文档」正文的动作，出错代价最高，
上线前需要至少覆盖：同一文档被多处引用、循环引用（A 引用 B、B 也引用 A）、
锚文本被自定义过、目标 uid 同时出现在代码块/非链接上下文中（不应被误改）这几类用例。

### 一致性

`RenameWorkspaceFolder` 批量改写 `folder_path` 时绕过了 `UpdateMemo`，需要手动
`reindexFolder` 补一次 RAG 索引（[workspace_service.go:263](../../../server/router/api/v1/workspace_service.go)）；
P0 的反向引用索引如果也挂在 `UpdateMemo` 上，同样要检查这条批量路径是否需要补一次
反向索引重建，避免和 RAG 索引重复同一个坑。

## 开放问题（留给产品，不阻塞开发排期）

- 移动文档/文件夹时，是否仍要展示「有 N 篇文档引用了它」的非阻断提示？
  技术上不需要（不会断链），但可能有产品价值（提醒用户内容关联度）。
- `DeleteWorkspace` 目前的空检查不像 `DeleteWorkspaceFolder` 那样过滤
  `RowStatus`（见 requirements 文档「现状事实」一节），P1 顺手做依赖检查时是否
  一并修掉这个不一致，还是单独开一张 bug 记录。
