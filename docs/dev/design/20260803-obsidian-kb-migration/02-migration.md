# 计划 2：Obsidian 知识库迁移方案与脚本需求

## 目标

把 `jimmy-zhz.github.io/AI-Knowledge-Base`（Obsidian 库 + Quartz 静态站）一次性迁入
ToucanShelf 的一个 workspace。**迁移后放弃 Obsidian**，此后该知识库只在 ToucanShelf 与
memogit checkout 之间同步。

因为是一次性操作，方案的取舍原则是：**能在脚本里一次性做掉的，绝不做成平台的长期能力**
（双链就是按这条原则否掉的，见 [计划 1 附录](../../requirements/editor/inline-style-rendering.md)）。

前置依赖：[计划 1](../../requirements/editor/inline-style-rendering.md)（拆入 `editor/` 与 `attachments/` 两域） 的 **需求 B（S3 附件按 workspace 分目录）
必须先上线**。否则这批 165 个附件会落进旧的公共前缀，迁完还得再搬一次。

---

## 1. 源库盘点

盘点自 `AI-Knowledge-Base/`（2026-08-03）：

| 项 | 数量 |
|---|---|
| Markdown 文档 | 62 篇，正文约 38.3 万字符 |
| 目录结构 | 13 个顶层目录，最深 3 层 |
| 图片资源 | 165 个（127 png / 19 webp / 6 svg / 2 gif / 1 jpg），共 47 MB |
| `![[图片]]` 嵌入 | 144 处（136 个唯一目标） |
| `[[文档]]` 内链 | 101 处 |
| Obsidian frontmatter | 仅 3 篇 |
| 数学公式 | 26 篇含块级 `$$`，32 篇含行内 `$` |
| mermaid | 1 篇 |
| 含裸 HTML | 12 篇（其中 6 篇含 `class=`） |
| `.canvas` 白板 | 3 个 |

**目标平台已原生支持、无需处理的**：GFM、KaTeX、mermaid、代码高亮与折叠、frontmatter
属性面板、任意深度文件夹树。

---

## 2. 关键决策：文档先行，附件后挂

这是整个方案里唯一有实质约束的决策。

`CreateAttachment` 的 `attachment.memo` 是可选的，**技术上允许先上传一批不挂文档的
附件**。但 [checkAttachmentAccess](../../../../server/router/api/v1/attachment_service.go#L736)
规定：

- **未挂载的附件：只有创建者本人能访问**，其他任何人一律拒绝；
- 已挂载的附件：访问权限跟随所属文档的可见性。

所以「先传 165 张图，再传文档」会埋下一个不会自愈的坑：**这批文档一旦设为 PUBLIC 分享
出去，所有图片对访问者全部 403**。而 memogit push 创建文档时并不会回头把附件关联上。

因此顺序**必须**是：先建文档拿到 uid → 上传附件时带上 `memo` → 再回写正文里的 URL。

### 一图多引用的处理

有 8 张图被两篇不同文档各引用一次。附件只能挂一个 memo，因此：

**同一张图被 N 篇引用，就上传 N 份**，各自挂在引用它的文档上。

代价是几十 KB 的重复存储，换来的是每篇文档的图片可见性都正确且自洽。共享同一个
attachment uid 的话，第二篇文档的图片能否显示将诡异地取决于**第一篇**的可见性设置——
这是一个日后极难排查的坑。不省这点存储。

---

## 3. 内容转换规则

### 3.1 `![[图片.png]]` → 标准 Markdown 图片

**可行性已验证，且是确定性的**：136 个唯一嵌入目标全部能在库内找到对应文件，且
**没有任何一个 basename 在整个库范围内重名**——文件名到实际文件是严格一对一，不存在
需要人工消歧的情形。

转换后形如：

```markdown
![图片说明](/file/attachments/{attachment_uid}/{filename})
```

URL 必须是**根相对**形式（`/file/...`），不能带协议和域名——理由见
[attachment.ts:5](../../../../web/src/utils/attachment.ts#L5) 的注释：渲染器的 sanitize
schema 把 `src` 协议限制为 `https`，绝对的 `http://` URL 在本地开发或纯 HTTP 自建部署下
会被整个剥掉。文件名部分按同文件的 `encodeAttachmentFilename` 规则编码，**特别注意括号
必须转义**（未转义的 `)` 会提前终止 Markdown 链接语法，而本库文件名里括号很常见）。

两个特例单独处理：1 处带 `|` 参数（Obsidian 的尺寸语法），1 处写成路径形式
（`images/xxx.png`）。

### 3.2 `[[文档#标题|别名]]` → 标准 Markdown 链接

目标形式：`[别名](/memos/{uid}#{anchor})`（路由见
[router/index.tsx:114](../../../../web/src/router/index.tsx#L114)）。

- **文档解析**：62 篇文档在 `(目录, 标题)` 维度无冲突，`path → uid` 映射由第一趟
  push 产出，解析是确定性的。
- **锚点生成**：必须严格复刻平台的 slug 算法，否则锚点全废。算法在
  [markdown-manipulation.ts:188](../../../../web/src/utils/markdown-manipulation.ts#L188)
  的 `slugify` / `headingSlug`：NFC 归一化 → 转小写 → 去掉非字母数字空格连字符的字符
  （emoji 会被丢掉）→ 空白和下划线转 `-` → 折叠连续 `-` → 去首尾 `-`；结果为空时回退
  到 `h-{sdbm哈希的base36}`。同名标题按出现顺序追加 `-1`、`-2`（见
  [rehype-heading-id.ts](../../../../web/src/utils/rehype-plugins/rehype-heading-id.ts)）。
  这段需要在脚本里用 Python 精确重写一遍，**并写一组对拍用例**。

**已知的存量链接腐烂——这不是脚本的锅，但脚本必须暴露它。**

101 处内链中 83 处带 `#` 锚点，其中 52 处是同文档内锚点（直接转 `#slug` 即可），
31 处是跨文档锚点。对这 31 处做匹配：

| 匹配方式 | 数量 |
|---|---|
| 标题文本精确匹配 | 14 |
| 去掉章节编号 / emoji / 标点后归一化匹配 | 22（含上面 14 的超集） |
| 归一化后的前缀匹配 | 2 |
| **仍然匹配不上** | **7** |

那 7 处**在 Obsidian 里就已经是死链**了——源库的标题后来加了章节编号
（`### 2.2 简单线性回归 (Simple Linear Regression)`），而链接还指向旧的
`#简单线性回归 (Simple Linear Regression)`；其中 `2.x 模型评估与调优` 这个文档甚至根本
不存在。

因此规则是：**按「归一化匹配 → 前缀匹配」两级解析，仍匹配不上的一律降级为文档级链接
（丢掉锚点），并写进人工复核清单**。绝不静默生成一个指向不存在锚点的 URL——那会把
「源库早就坏了」伪装成「迁移搞坏了」。

### 3.3 带 `class` 的 HTML：剥壳留文本

6 篇文档含 `class=`（`card` / `tag` / `phase-title` 等 Quartz 主题的类名）。这些结构依赖
外部 CSS，而 ToucanShelf 不加载文档携带的样式表，渲染出来只会是散架的结构。

规则：**凡带 `class=` 属性的 HTML 标签，脚本剥去标签外壳，只保留其中的纯文本**（保留
可读的换行/分隔，避免多段内容黏成一行）。

不带 class、仅带内联 `style` 的标签**原样保留**——它们由
[计划 1 需求 A](../../requirements/editor/inline-style-rendering.md) 负责渲染。需求 A
上线前，这类标签会显示为无样式的普通标签，属可接受的降级，不阻塞迁移。

### 3.4 软换行

源库是 CommonMark 语义（单个换行不构成断行），而 ToucanShelf 默认启用
`remark-breaks`（每个换行都变 `<br>`）。直接迁入会让所有段落的排版变形。

处理：迁入的文档统一关闭 hard break（用文档级的 soft break 配置，见
[MemoMarkdownRenderer.tsx:106](../../../../web/src/components/MemoContent/MemoMarkdownRenderer.tsx#L106)），
或将该 workspace 的默认值设为 soft break。**优先用 workspace/实例级默认**，避免给 62 篇
文档逐个写配置。

### 3.5 排除清单

以下内容**不迁入**，由脚本从工作副本中剔除：

| 对象 | 理由 |
|---|---|
| `index.md`、`home.md` | Quartz 站点门面页：整段 landing HTML、外链 Google Fonts、`<link rel=stylesheet>`。它们是「站点」不是「知识」，迁进去只会是一堆剥完壳的残渣 |
| `未命名.md` | 空文件 |
| `*.canvas`（3 个） | Obsidian 白板格式，ToucanShelf 无对应文档类型。**单独归档保存**，不随迁移丢弃 |
| `.obsidian/`、`.git/`、`node_modules/` 等 | 非内容 |
| `images/`、`resources/` 下的资源文件 | 见下条——它们必须走附件 API，**绝不能留在 checkout 内容树里** |

> **必须重视的一条**：memogit 的
> [`listDocFiles`](../../../../internal/memogit/push.go#L522) 只跳过 `_attachments/`、
> 点开头文件和冲突 sidecar，**其余一切文件都当文档处理**。若把 `images/` 留在 checkout
> 内容树里，push 会把 127 个 PNG 当成 MARKDOWN 文档创建，标题是 `xxx.png`、正文是二进制
> 乱码。图片目录必须放在 checkout 之外。

---

## 4. 执行流程

脚本产出一个**干净的工作副本**，人工核对后再由使用者自己执行 memogit 命令。脚本不代跑
memogit。

### 第 0 步：准备（人工）

1. 确认 [计划 1 需求 B](../../requirements/attachments/upload-and-inline-media.md#s3-附件按-workspace-分目录) 已上线
2. 在 ToucanShelf 创建目标 workspace
3. 生成 PAT，`memogit login`

### 第 1 步：建文档骨架，拿 uid 映射

脚本产出「仅含 62 篇原始 md、已剔除排除清单、已按目标结构组织」的目录，人工执行：

```bash
memogit clone <workspace> --dir ./kb-migration
# 拷入脚本产出的文档树
memogit push
```

产出：`path → memo uid` 映射（从 `.memogit/state/<ws>.json` 读取）。

此时正文里的 `![[...]]` / `[[...]]` **尚未转换**，文档内容是「能读但链接失效」的中间
状态。这是有意的——先拿 uid，才能生成正确的 URL。

### 第 2 步：上传附件 + 回写正文

脚本读入第 1 步的映射，逐篇处理：

1. 解析该篇引用的所有图片
2. 逐个 `CreateAttachment(memo=该篇uid, workspace=目标ws, content=bytes)`，拿 attachment uid
3. 按 §3.1 回写图片 URL
4. 按 §3.2 回写文档内链
5. 按 §3.3 剥壳带 class 的 HTML

**必须支持断点续跑**：47 MB / 165 个附件的上传中途失败很正常。用一个本地的
`已上传清单（源文件路径 + 所属文档 → attachment uid）` 做幂等，重跑时跳过已完成项，
绝不重复上传。

同时检查上传大小限制：受
[`UploadSizeLimitMb` 实例设置](../../../../server/router/api/v1/attachment_service.go#L142)
约束，脚本应在开跑前先扫一遍最大文件并与该设置比对，**提前报错而不是传到一半失败**。

### 第 3 步：推送最终内容

```bash
memogit status   # 人工核对：应显示 62 篇全部为「已修改」
memogit push
```

### 第 4 步：人工复核

脚本输出一份复核报告，至少包含：

- 降级为文档级链接的锚点清单（预期 7 处，见 §3.2）
- 被剥壳的 HTML 片段清单（预期涉及 5 篇正文）
- 重复上传的图片清单（预期 8 张）
- 附件上传的总数与总字节数
- 任何未能解析的引用

---

## 5. 脚本的硬性要求

1. **幂等 / 可断点续跑**。任何一步中断后重跑，不产生重复附件、不重复改写已改写的文本。
2. **不原地修改源库**。全程在工作副本上操作，源库保持只读。
3. **先 dry-run**。提供只输出计划、不发任何写请求的模式，且第一次必须以此模式跑完并
   人工看过。
4. **不静默降级**。任何解析不到、匹配不上、被剥掉的内容，都必须进复核报告。这是判断
   「迁移是否成功」的唯一依据。
5. **产出可核对的映射文件**：`源文件路径 → memo uid`、`源图片路径 + 所属文档 →
   attachment uid`。迁移出问题时，这两份文件是回溯的唯一线索。

---

## 6. 风险与不做的事

| 风险 | 处理 |
|---|---|
| 附件先传后挂导致 PUBLIC 分享时图片 403 | 由 §2 的「文档先行」流程规避 |
| 图片留在 checkout 内容树被 push 成二进制文档 | 排除清单 §3.5 强制剔除；dry-run 时校验内容树中无非文档扩展名文件 |
| 锚点 slug 算法与平台不一致导致内链全废 | 精确复刻 `headingSlug` 并写对拍用例 |
| 上传中断留下半程状态 | 幂等清单 + 断点续跑 |
| 源库存量死链被误认为迁移故障 | 复核报告显式列出（预期 7 处） |

**明确不做**：

- 不做 `.canvas` 的转换（单独归档）
- 不迁 Quartz 站点门面页
- 不为兼容 Obsidian 语法而改动平台渲染器（理由见
  [计划 1 附录](../../requirements/editor/inline-style-rendering.md)）
- 不做双向持续同步的特殊处理——迁完之后内容就是标准 Markdown，memogit 的
  `pull / push` 正常工作，无需额外机制
