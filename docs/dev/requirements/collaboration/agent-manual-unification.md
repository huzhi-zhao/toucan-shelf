# Agent 操作手册统一到 `docs/skill/`

给 agent 看的"怎么操作 ToucanShelf"目前有**三份独立内容**，不是两份：

| 位置 | 谁在读 | 现状 |
|---|---|---|
| [`docs/skill/`](../../../skill/)（SKILL.md + references/） | 没人 | 已按"两者/仅memogit/仅MCP"标签设计成两通道共用的单一真源，但没有接进任何投喂链路 |
| [`internal/memogit/assets/pumpkin_book_for_llms.md`](../../../../internal/memogit/assets/pumpkin_book_for_llms.md)（南瓜书，410 行） | memogit checkout 里的 agent | `go:embed`（[agentdocs.go:18](../../../../internal/memogit/agentdocs.go)）打进二进制，`clone`/`pull` 时落地成 `.memogit/toucanshelf-guide.md` |
| `serverInstructions`（[service.go:31](../../../../server/router/mcp/service.go)，58 行硬编码 Go 字符串） | MCP agent | 通过 MCP `initialize` 响应注入，独立手写，跟 SKILL.md 内容有交叉但不是同一份 |

三份各自维护，已经在漂移。目标：**只保留 `docs/skill/` 一份内容真源**，两个通道各自的"怎么喂"是实现细节，不再各写一份手册正文。

## 1. 为什么不能简单地"一份文件两边共用"

两个通道的投喂机制约束不同，这是本篇设计的前提，不是可选项：

- **memogit 通道**：agent 有本地文件系统。`docs/skill/` 本来就是按这个假设写的——
  SKILL.md 是路由 + 常驻铁律，references/ 按需 `cat`。这个模式可以照搬。
- **MCP 通道**：agent **没有文件系统**，只能看到协议 `initialize` 响应里注入的文本，
  这段文本是"resident context for the whole session"（[service.go:27](../../../../server/router/mcp/service.go) 注释原话），
  不能把 SKILL.md + 6 篇 references（约 5 万字）整段塞进去——但**它没有字数上限**
  （2026-09-04 去掉，原为 2000 字节）。理由：需求只会不断增加，而一条规则的精确表达有其
  长度下限，硬上限最终只会逼出两种坏结果——要么漏掉一条准确的规则，要么把已有的规则压到
  产生歧义。agent 按歧义规则动手会毁掉文档，多读几十个 token 不会。取而代之的判据是
  质的：每句话都必须是模型无法从工具名与 schema 推断的内容，并用「只剩一种读法」的最少
  措辞表达；可以精简措辞，不可以牺牲语义；真要缩，整块砍掉一个主题，而不是把它压糊。
  MCP server 目前只声明 `tools` 能力，不声明 `resources`
  （[server/router/mcp/README.md](../../../../server/router/mcp/README.md)："The service advertises the **tools** capability only —
  no prompts, no resources"），也不打算为此新增按需读取的工具或 resource——
  见下面"明确不做"。

## 2. 决定的方案

### 2.1 memogit：整个目录搬迁，保留目录结构

`internal/memogit/agentdocs.go` 里 `//go:embed assets/pumpkin_book_for_llms.md` 换成
`//go:embed` 指向 `docs/skill/` 整个目录，`WriteAgentDocs` 落盘时原样搬进
`.memogit/skill/`（SKILL.md + references/*.md 保持相对路径不变），而不是拼成单文件。

保留目录结构是必须的：SKILL.md 正文里的引用（`references/memogit.md` 等）都是相对路径，
拼成单文件会破坏"按需读"这个设计本身依赖的引用关系。

`agentBrief`（[agentdocs.go:30](../../../../internal/memogit/agentdocs.go)，写进 AGENTS.md/CLAUDE.md/.cursor rule 的常驻简报）
指向的路径要从 `.memogit/toucanshelf-guide.md` 改成 `.memogit/skill/SKILL.md`；
`GuideFile` 常量的语义也要跟着从"一个文件"变成"一个目录里的入口文件"。

### 2.2 MCP：`serverInstructions` 继续手写，但作为 SKILL.md 的摘要维护，不自动生成

不做编译期自动摘取，也不加"按需读 reference"的工具/resource（预算和收益不匹配，
见下面"明确不做"）。改成一条**流程纪律**：编辑 `docs/skill/SKILL.md` 或
`docs/skill/references/*.md` 时，必须评估 `server/router/mcp/service.go` 的
`serverInstructions` 是否需要同步更新——不是每次改都要动，是每次改都要**过一遍这个问题**。

落地方式：在根目录 [`AGENTS.md`](../../../../AGENTS.md) 的"Change Routing"表里加一行，
让人类和 AI agent 在改这两处文件时都会看到这条纪律。

### 2.3 南瓜书：迁移增量，立即删除，不共存

`pumpkin_book_for_llms.md` 里如果有 `docs/skill/references/` 目前没覆盖到的有价值内容，
迁移过去；迁移完成后**立即删除**这个文件和它的 `go:embed`，不保留过渡期、不留兼容层。

初步过一遍南瓜书目录，看起来可能有增量、需要核实的几处（不是结论，留给实际迁移时核实）：

- §3.7 内联媒体限制：`rehype-sanitize` 剥离手写 `<audio>`/`<video>` 标签、可信 iframe
  白名单（YouTube/Vimeo/Spotify/SoundCloud/Loom/Google Maps/draw.io）——
  `references/attachments.md` 需要确认是否已覆盖。
- §5 同步工作流的几个具体行为：`.remote` 冲突解决步骤、"归档不腾出名字"、
  "同步范围按角色"（普通用户按 creator 过滤，管理员不过滤）——`references/memogit.md`
  需要确认颗粒度是否够。
- §6 排障速查（`connection refused` 端口误配、`Cloned 0 memos`、重新 `login`）——
  目前 SKILL.md/references 里似乎没有排障章节的对应位置。
- §3.3 高亮语法的双分隔符细节（`==` 浅黄 / `===` 浅粉，后者是本 fork 扩展，
  解析器优先匹配更长串）——需要确认 `markdown-syntax.md` 是否写到这个精度。

## 3. 明确不做

- **MCP 按需读 reference 的能力**（新增 MCP resource 或 `docs_get_reference` 工具）。
  MCP server 当前架构原则是"tool ≡ OpenAPI operation 的严格映射"
  （见 [mcp-authoring.md](mcp-authoring.md) §7），额外加一个不对应 REST 操作的文档查询工具
  是这条原则之外的口子；先接受 MCP 端只拿 SKILL.md 摘要级别的规则，细节问题留给用户自己去翻
  `docs/manual/` 或 `docs/skill/`。
- **`serverInstructions` 编译期自动摘取**。改成靠流程纪律（§2.2）而不是工具强制同步，
  代价是有漂移风险，但避免了给 SKILL.md 加提取标记这层复杂度。
- **本轮不做 `docs/skill/` 内容本身的修订**。哪怕迁移南瓜书增量时会touch到
  references 正文，改动范围限定在"补齐南瓜书里独有的内容"，不借机做通用的内容改进/重写——
  那是另一件事，分开立。

## 4. 完成状态的验收点

- `internal/memogit/assets/pumpkin_book_for_llms.md` 不存在，`agentdocs.go` 不再引用它。
- `memogit clone`/`pull` 后的 checkout 里，`.memogit/skill/` 下能看到 SKILL.md +
  完整 references/ 目录，AGENTS.md/CLAUDE.md/.cursor rule 里的链接指向这里。
- `serverInstructions` 的六条铁律级别规则与 SKILL.md §1 一致（允许 MCP 特有的取舍，
  比如 MCP 没有 `references/memogit.md` 里那些仅 memogit 的规则）。
- 根 `AGENTS.md` 的 Change Routing 表里能看到"改 `docs/skill/`→检查 MCP 摘要"这条。
