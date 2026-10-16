# References 里的外链（URL 引用）

References 区块原先只放子文档（[sub-documents.md](sub-documents.md)）。本篇给它加第二种条目：
**外链**。输入一个 URL，References 把它显示成一张卡片，和子文档并列挂在文档底部。

外链和子文档**完全不是一种东西**：子文档是本系统里的一篇 memo，外链指向系统外的一个页面。
它们放进同一个区块，只是因为**一样重要**：都是这篇文档的组成部分，读这篇文档时
（尤其是 agent 读）必须有意识地去打开，不能只看正文就下结论。

---

## 1. 外链放什么

外链是对正文的**重要补充**，典型的三类：

- **支撑结论的依据**——正文给出结论，依据在外面：一份报告、一个数据源、一份原始记录。
- **知识点的补充**——本来也可以写进正文，但为了不让文档超长，放在外面引用。
- **Google 文档全家桶**——Docs / Sheets / Slides 的格式比 Markdown 丰富，承载的往往是
  **更重要的内容**；Markdown 正文可能只是对它的补充，或者和它配合使用。

所以「正文 + References」才是一篇完整的文档。外链不是附录，也不是「延伸阅读」。

## 2. 每条外链带一个备注：什么时候该打开

外链可以带一句备注，写的是**什么时候应该打开它**，不是它为什么存在。例如：

- 「改动任何预算数字之前打开」
- 「讨论第 3 节的结论时打开，原始数据在这里」
- 「排期相关的问题先看这个表」

备注是写给读者的，主要是写给 agent 的：agent 据此判断当前任务落没落进这条外链的范围，
落进了就必须打开读。备注可以不填，不填就只显示卡片。

备注是一句话：输入框单行，上限 120 字。

## 3. 存储：文档 frontmatter 里的 `references`

```yaml
---
references:
  - "[改动任何预算数字之前打开](https://docs.google.com/document/d/abc)"
  - "https://example.com/rfc-123"
---
```

- 一条外链是一个列表项：方括号里是备注，圆括号里是 URL，即一条 Markdown 链接；
  没有备注时只写 URL。整项用双引号包起来。
- 仍然是**扁平的字符串列表**，不违反「frontmatter 只认扁平字段」的约定
  （[markdown-syntax.md §1](../../../skill/references/markdown-syntax.md)）。
- 只接受 `http://` / `https://` 链接。系统内的文档用子文档或正文链接，不走这里。

### 3.1 为什么放 frontmatter，不放 payload

frontmatter 是文档的**内容**，payload（如 `doc_config`）是 app 的外观设置。外链是内容，
而且放在内容里，「让 agent 有意识去读」这件事就是零成本的：

| | frontmatter | payload 字段 |
|---|---|---|
| memogit 检出的文件里能看到 | ✅ 文件第一屏就是它 | ❌ 要新做导出/导入 |
| MCP `memo_get_memo` 能看到 | ✅ 就在 content 里 | ❌ 要扩接口 |
| agent 能写 | ✅ 改 frontmatter 本来就允许 | ❌ 要扩 MCP 可写字段 |
| 版本历史 / diff / 回滚 | ✅ 沿用 | ❌ 要另做 |
| 不泄露到公开站点 | ✅ 发布流程本来就丢掉整个 frontmatter（[frontmatter.go](../../../../internal/publish/frontmatter.go)） | 要另外保证 |

### 3.2 长度

一条外链一行。预览态**看不到**这些行：属性面板隐藏 `references`（加进
`HIDDEN_PROPERTY_KEYS`），外链只以卡片形式出现在 References 区块。
只有编辑态的源码和 agent 读到的内容里能看到原文——对 agent 来说，出现在文档最顶上正合适。

## 4. 格式与容错：写入严格，读取宽容，读不懂就说出来

frontmatter 是 YAML，缩进和引号都敏感。实测过当时的解析器（`web/src/utils/frontmatter.ts`）：

| 写法 | 当时的结果 |
|---|---|
| 缩进的 `- "[备注](url)"` | 识别成列表 |
| `- ` 顶格不缩进（YAML 合法写法） | `references` 变空值，**同时多出一个叫 `- "[备注](https` 的乱码属性** |
| 列表项下再缩进写 `note: x` | 整个 key **静默忽略**，外链全部消失 |
| `[` 开头不加引号 | 我们能读；标准 YAML 把它当 flow 序列，**整个 frontmatter 解析失败**（Obsidian 打开 memogit 检出的文件会受影响） |
| 缺结尾 `---` | 整块被当成正文显示（既有行为） |

存储的数据不会坏：内容原样存，解析只用来显示。要解决的是「静默消失」和「乱码属性」：

1. **通用属性解析器认顶格 `- `。** 紧跟在空值 key 后面的顶格 `- ` 行属于这个 key 的列表，
   与 YAML 一致；不再被误读成属性名。改写单个属性（`setFrontmatterProperty`）时，
   顶格的列表项同样算作旧值的一部分，一并替换。
2. **`references` 单独解析，宽容读取。** 缩进或顶格、带不带引号都认；条目是
   Markdown 链接或裸 URL。
3. **UI 写入一律用标准格式。** 两格缩进、整项双引号；备注里的 `[` `]` `\` 转义，
   URL 含空格或括号时用 `<…>` 包起来。只改写 `references` 这一块，frontmatter
   其余行原样不动；列表清空时删掉这个 key，frontmatter 因此变空时连 `---` 块一起删掉。
   文档原本没有 frontmatter 时，添加第一条外链会新建一个。
4. **读不懂就说出来。** `references` 下有识别不了的行时，References 区块显示
   「N 行外链无法识别」，并且**禁用 UI 上的增删改**——否则 UI 一写回就会把它读不懂的行覆盖掉。
   用户到源码里修好即可。
5. **agent 手册给出逐字照抄的模板**，明确两格缩进、整项双引号。

## 5. 交互

### 5.1 卡片

外链卡片和子文档卡片在同一个区块里，长得不一样，一眼能分清：

- **外链卡片**：网站图标 + 标题 + 备注 + 域名，新标签页打开。
- **子文档卡片**：文档图标 + 标题 + 正文首行摘要（不变）。

顺序：子文档在前，外链在后；外链按 frontmatter 里的顺序。区块标题的计数是两者之和。

标题来自页面元数据；拿不到时（见 §6）显示域名，卡片照样显示，不降级成纯文字链接。

### 5.2 增删改只在编辑态

与子文档一致（[sub-documents.md §4.1](sub-documents.md#41-区块位置与形态)）：往文档里加东西是一次编辑。
编辑态 References 区块头部加「添加链接」按钮，弹出两个输入框：

- URL（必填，必须是 http/https）
- 备注（选填，占位文案：「什么时候该打开它？例如：改动预算数字之前」）

每张外链卡片在编辑态有「编辑」和「删除」。改动写进编辑器的草稿（与源码编辑同一份内容），
随文档一起保存；在源码里直接改 `references` 也一样生效。

预览态只读。

### 5.3 显示条件

区块以及大纲里的入口，原先以「有没有子文档」为条件，改为「有没有子文档或外链」。
外链存在 frontmatter 里，所以只有带 frontmatter 的文档类型（Markdown、VIEW）才有。

## 6. 页面元数据：网站图标与需要登录的链接

复用 `GetLinkMetadata`（[memo_service.go](../../../../server/router/api/v1/memo_service.go)），
`LinkMetadata` 新增 `favicon` 字段。

- **网站图标**：优先页面里的 `<link rel="icon">`（含 `shortcut icon`），其次
  `apple-touch-icon`，都没有就用该站点的 `/favicon.ico`。前端图片加载失败时兜底一个地球图标。
- **需要登录的链接给默认显示。** 未登录打开 Google Doc 会被跳转到 `accounts.google.com`
  的登录页，抓回来的标题是「Sign in」。规则：
  - 响应不是 2xx，或者请求**被跳转**到了登录页（落点域名以
    `accounts.` / `login.` / `signin.` / `auth.` / `sso.` 开头，或路径里有
    login / signin / ServiceLogin / sso / oauth 等段），**丢弃**标题、描述、图片。
    只看跳转：链接本身就指向登录页，那是作者的选择；普通跳转（如 `example.com` →
    `www.example.com`）照常取元数据；
  - 这时网站图标用**原始链接所在站点**的 `/favicon.ico`。Google Docs 的就是文档图标，
    正好是想要的效果。
- 抓取整个失败（超时、不是 HTML）时，前端同样显示域名 + 原始站点的 `/favicon.ico`。

正文里单独一行的链接预览卡片（`LinkMetadataCard`）用的是同一个接口，所以它也不再把
登录页显示成「Sign in」卡片，而是退回普通链接。

## 7. agent

规则写进 [`docs/skill/`](../../../skill/)（memogit 通道）和 MCP 的 `serverInstructions`：

> References 是文档内容的一部分，不是附录。外链放的是支撑正文结论的依据、为控制篇幅
> 而移出正文的知识点补充，以及格式比 Markdown 更丰富的 Google 文档——它们承载的内容
> 可能比 Markdown 正文更重要，正文只是补充或配合。每条外链的备注写的是「什么时候该打开它」：
> 当前任务一旦落进这个范围，就必须打开读，不能只凭正文下结论。

- agent 能不能打开某个外链（比如 Google Doc），取决于用户自己给 agent 配了什么连接器。
  系统不做兜底：用户希望 agent 读却没配，是使用问题。
- agent 加外链就是改 frontmatter，按 §4 的模板写。

memogit 不需要任何改动：frontmatter 本来就随文件原样往返。

## 8. 附带：预览态改属性去掉 ✓

预览态的属性面板，每个字段本来就是即时保存的（失焦、回车、选中选项就写回），
最后那个 ✓ 只是退出编辑态，不保存任何东西，却让人以为要「提交」一次。
改为：保留铅笔按钮进入编辑态，去掉 ✓；点到面板外面或按 Esc 退出编辑态。

## 9. 不做

- **不缓存元数据、不检测死链。** 卡片每次渲染按需取元数据（前端查询缓存足够）。
- **不抓取外链正文给 agent。** 读外链是 agent 自己的事，靠它自己的工具和连接器。
- **RAG 不索引外链指向的内容**；frontmatter 本身是否进索引维持现状。
- **不在预览态增删改外链**，理由同子文档。

## 10. 验收

- 编辑态添加一条带备注的 Google Doc 链接并保存：frontmatter 出现
  `references:` + 一条 `  - "[备注](https://docs.google.com/…)"`；预览态 References 区块
  出现外链卡片，显示 Google Docs 图标、域名和备注；属性面板里没有 `references` 行。
- 把 `references` 的列表项改成顶格写：卡片照常显示，属性面板不出现乱码属性。
- 在某个列表项下加一行 `note: x`：References 显示「1 行外链无法识别」，编辑态的增删改按钮禁用。
- 删除最后一条外链：`references` key 消失；frontmatter 只剩它时整个 `---` 块消失。
- MCP `memo_get_memo` 返回的 content 里能看到 `references`；memogit 检出的文件顶部能看到。
- 预览态编辑属性：改完一个字段即保存，点面板外面退出编辑态，界面上没有 ✓。
