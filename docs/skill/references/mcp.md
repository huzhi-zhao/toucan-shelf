# MCP —— 在线通道

通过 HTTP 直接读写知识库，**磁盘上不留任何东西**。典型场景：你在别的代码仓库里干活，
而架构笔记在知识库里——为了看一篇文档把整个库检出来太重，检出到代码仓库里还会和它自己的
git 打架。走 MCP 就像读一个网页。

**memogit 还是 MCP？**

| | MCP | memogit |
|---|---|---|
| 本地文件 | 无 | 完整检出 |
| 与代码仓库 git 的关系 | 无 | 检出在代码仓库里会打架 |
| 擅长 | 在别处工作时读/改几篇文档 | 批量编辑、`grep`、交叉引用、离线 |
| 版本历史 | 服务端快照 | 真实的本地 git 仓 |
| 附件 | **不暴露** | 单向下载 |

经验法则：**从另一个项目里伸手够知识库 → MCP；对知识库本身干活 → memogit。**

---

## 1. 工具集（刻意只有 8 个）

服务端**不暴露完整 API**，因为每个工具的 JSON schema 会在整个会话里占着上下文。

| 工具 | 用途 |
|------|------|
| `workspace_list_workspaces` | 有哪些知识库；把显示名解析成 `workspaces/{uid}` |
| `workspace_get_workspace_tree` | 文件夹 / 文档层级 |
| `rag_search` | 混合语义 + 关键词搜索 |
| `memo_list_memos` | 按 filter 列文档 |
| `memo_get_memo` | 读完整内容 |
| `memo_create_memo` | 新建文档 |
| `memo_update_memo` | 覆写文档 |
| `auth_get_current_user` | 令牌属于谁 |

**没有删除工具，这是刻意的。** 评论、reaction、关系、快捷方式、**附件**也都不暴露——
需要它们请走 memogit 或让用户在网页端处理。

## 2. 寻址：三个字段

| 字段 | 值 | 注意 |
|------|-----|------|
| `workspace` | `workspaces/{uid}` | **不是显示名**，先用 `workspace_list_workspaces` 解析 |
| `folder_path` | `"folder a/folder b"` | 斜杠分隔，相对于库根；空串 = 根目录 |
| `title` | `"plan"` | 显示标题，即文件名，**不带扩展名** |

- **文件夹是隐式的**：写到一个不存在的路径，文件夹自己出现在树上。没有建文件夹这一步，
  工具集里也没有文件夹工具。
- **标题不带扩展名**：扩展名来自 `doc_type`，只在 memogit 落盘时追加。
  传 `plan.md` 会得到一篇字面叫 "plan.md" 的文档，memogit 再检出成 `plan.md.md`。

用户可能会从 app 的 **⋯ → 复制 → 复制信息** 粘一段地址块给你（含 workspace 显示名 + uid、
folder_path、title、`memos/uid`）。有它就直接 `memo_get_memo`，不用再解析。

## 3. **`memo_update_memo` 是全量覆写，不是增量补丁**

这是最容易静默毁掉文档的一条。它替换整个 `content` 字段。

**永远按 读 → 改全文 → 写回 的顺序做**：先 `memo_get_memo` 拿到完整内容，
在完整文本上做修改，再整段写回。用户说"追加一节"，那也是一次对全文的读-改-写，
不是 patch。

可写字段只有六个：`content`、`title`（创作），`folder_path`、`workspace`、`state`、
`pinned`（归档整理）。其余一律被服务端拒绝，其中值得点名的：

- **`visibility`** —— agent 不该有能力把私有文档变成公开的。
- **时间戳** —— 把 `update_time` 往回改会让 memogit 检出停在陈旧副本上且毫无报错。
- `attachments`、`relations`、`doc_type`、各类评论锚点。

`state` 允许**归档**——这是 agent 唯一能让文档"看起来消失"的方式。它不销毁任何东西、
一键可撤销，但仍要清楚这是个可见的副作用。

## 4. 没有并发检查——这条风险要主动说

**服务端没有锁，也没有冲突检测。** 如果用户在你 `memo_get_memo` 之后、
`memo_update_memo` 之前在网页里保存了一次编辑，**他的编辑会被静默覆盖**。

所以：你要长时间处理某篇文档时，提醒用户在此期间别在网页端编辑同一篇；
把工作**串行化**（他改完你再动，或你改完他再动）。

保护措施只有一半：服务端在 agent 写入前，若当前内容最后是**人**写的，
会先把它快照进版本历史（标记为 **AI 编辑前**）。因此历史里是**每个人类编辑会话一个快照**，
而不是每次 agent 迭代一个。但**同一个 agent 会话已经开着的文档，后续覆盖不再产生快照**——
这就是上面那条提醒存在的原因。

## 5. 使用习惯

1. **先找再读**：`workspace_list_workspaces` → `workspace_get_workspace_tree` →
   `memo_get_memo`；只知道主题时用 `rag_search`。
2. **`rag_search` 的关键词放在 `query` 里**，不要塞进 `filter` 的 `content.contains`——
   那会破坏语义召回。`filter` 是用来收窄候选集的（workspace、tag、可见性、时间、doc_type）。
3. **写之前先把内容给用户看**。写工具本来就会弹确认，但长文档在工具参数对话框里很难审阅。
4. **定制语法照样适用。** 通过 MCP 写入的内容和 memogit 写入的是同一批文档：
   frontmatter 只认扁平字段、别写 `==着色==`、标题里别放标点、`toucan-secret` 的 `id`
   别动、看板/表格块的写回契约照旧。见 `markdown-syntax.md` 和 `blocks-and-views.md`。
   唯一不适用的是 `memogit-id`——那是本地文件专有的，服务器正文里不含它，
   **通过 MCP 写入时不要手写这一行**。

## 6. 已知限制

- **不能用 `@` 提及附加文档**：服务端只发布 tools 不发布 MCP resources。
- **没有"按路径一次取文档"**：每个工具 1:1 映射一个 API 操作，按路径拿文档 = 一次树调用 + 一次 get。
- **`memo_list_memos` 没有文件夹过滤**：`folder_path` 还不在 filter 语法里，
  "列出 architecture/ 下所有文档"要走 workspace tree。
- **没有附件、评论、关系**：在网页端或 memogit 检出里看。
