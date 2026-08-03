# 计划 3：迁移脚本交接

脚本已写完并对真实源库全链路空跑通过，**停在等待部署**。本文交接三件事：现在是什么
状态、执行时怎么走、以及讨论中改掉了计划 2 的哪些内容。

方案见 [02-migration.md](02-migration.md)，操作手册见
[scripts/README.md](scripts/README.md)。本文只讲这两份文档没有的东西。

---

## 1. 现状

| | |
|---|---|
| 脚本 | 已完成，`scripts/` 下四个文件 |
| 验证 | 对拍测试全绿；对真实源库跑通 `plan` → `stage` → `attach --dry-run` |
| 实际写入 | **零**。至今没向任何服务器发过一个写请求，源库一个字节没动 |
| 阻塞 | 计划 1 需求 B 未部署；目标 workspace 未创建 |

依赖：Python 3 标准库（**无 requests**，本机没装）。对拍测试额外需要 `node`。

### 文件

| 文件 | 作用 |
|---|---|
| [scripts/migrate.py](scripts/migrate.py) | 主脚本，`plan` / `stage` / `attach` / `report` |
| [scripts/slugify_port.py](scripts/slugify_port.py) | 平台标题锚点算法的 Python 复刻 |
| [scripts/test_slugify_port.py](scripts/test_slugify_port.py) | 与 TS 源实现的对拍测试 |
| [scripts/README.md](scripts/README.md) | 逐步操作手册 |

### 对拍是怎么做的

锚点算错等于全库内链失效，所以这块没有用「照着 TS 再写一份 JS」的办法——那等于自己
跟自己比。测试**直接从 [markdown-manipulation.ts](../../../web/src/utils/markdown-manipulation.ts)
原文里切出** `slugify` / `shortHash` / `headingSlug` 三个函数，剥掉类型标注后交给 node
执行。源实现一旦改名或换签名，切片会失败报错，而不是悄悄比对一份过期副本。

语料是源库全部真实标题（含章节编号、emoji、括号、中英混排）加 20 个边界用例
（纯 emoji、星平面字符、多空格、首尾连字符）。`encodeURIComponent` 的括号转义也单独
跟 node 对过。

---

## 2. 空跑实测 vs 计划 2 的预估

| 项 | 计划 2 预估 | 实测 |
|---|---|---|
| 迁入文档 | 62 | **58** |
| 唯一图片 / 上传份数 | 136 / 144 | 136 / **143** |
| 一图多引用需重复上传 | 8 张 | **7 张** |
| 锚点匹配不上需降级 | **7** | **7** ✓ |
| 内链目标文档找不到 | —— | 3 |
| 带 `class` 的 HTML | 6 篇 | **4 篇 17 处** |
| 附件总量 | 47 MB | **38.8 MB**（只算被引用的） |

差异都有出处：

- **58 而非 62**：排除 `index.md` / `home.md` / `未命名.md` 之外，还多排除了
  `resources/Card Demo.md`。它在 `resources/` 目录下（该目录整体排除），本身是 Quartz
  卡片组件的样式演示页，41 个 class div 剥完只剩残渣。要保留的话改 `migrate.py` 顶部的
  `EXCLUDED_DIRS`。
- **38.8 MB 而非 47 MB**：源库 `images/` 里有 **20 个资源从未被任何文档引用**，不上传。
- **4 篇而非 6 篇**：其中两篇是 `index.md` 和 `Card Demo.md`，都已排除。

那 7 处匹配不上的锚点，我逐条核对过源文件，**全部是真·存量腐烂**：

| 链接指向 | 实际标题 |
|---|---|
| `#局部感知 (Local Receptive Fields)` | `### 局部感知 Local Reception` |
| `#长短期记忆网络 LSTM` | `## LSTM` |
| `#单词嵌入 Word Embedding` | `### 词嵌入 Word Embedding` |
| `#回归 (Regression)`、`#分类问题 (Classification)`、`#🥏 回归树 Regression Tree` | 2.5 里根本没有这些标题 |

不是脚本没匹配上。计划 2 预测的就是 7 处，对上了。

---

## 3. 讨论中改掉的计划 2 内容

### 3.1 附件没有 workspace 字段（计划 2 §4 第 2 步写错了）

计划 2 写的是 `CreateAttachment(memo=该篇uid, workspace=目标ws, ...)`。实际
[attachment_service.proto](../../../proto/api/v1/attachment_service.proto) 的 `Attachment`
消息里**根本没有 workspace 字段**，附件归属哪个 workspace 完全由 `memo` 反推（见
[attachment_service.go:161](../../../server/router/api/v1/attachment_service.go#L161)
的注释：blob inherits that memo's workspace directory）。

这把「文档先行」从一个权限考虑升级成了**硬约束**：不带 memo 传上去，附件连该落哪个
存储前缀都定不了。顺序不能变。

### 3.2 用 attachment_id 做幂等（计划 2 没提到的能力）

`CreateAttachmentRequest.attachment_id` 可以由客户端指定，而 `attachment.uid` 在库里有
唯一约束。所以幂等有两道保险，而不是只靠本地清单：

1. 本地 `uploads.json` 清单，每上传一个立刻原子落盘；
2. attachment id = `kbmig-<sha256(文档路径+图片路径)[:24]>`。即便清单丢了、或者在
   「服务端已建好、清单还没落盘」的瞬间中断，重跑时重复创建会撞唯一约束，脚本转而
   `GetAttachment` 认回来，不会产生第二份附件。

只靠清单是不够的——中断恰好发生在两者之间是很正常的。

### 3.3 裸 HTML 标题不参与锚点计算（**与平台实际行为有意不一致**）

本库几乎每篇的大标题都写成 `<h1 style="...">标题</h1>` 而不是 `# 标题`。平台侧的
[rehype-heading-id](../../../web/src/utils/rehype-plugins/rehype-heading-id.ts) 会给 hast
里的 h1–h6 一律赋 id，**包括 HTML 写的那些**，所以严格模拟应该把它们算进锚点体系。

**决定：不算。** 把「标题」永久绑在一段样式 HTML 上不是想要的形态。迁移后由作者把那些
`<h1 style=...>` 改回 `# 标题`，到那时锚点自然就对了。

实测这个决定不影响任何东西：改前改后所有数字完全一致——因为内链指向的都是
`##` / `###` 章节，没有一条指向文档大标题。

> 这是脚本里唯一一处有意偏离平台行为的地方，`extract_headings()` 的 docstring 里写明了
> 原因。将来若要严格对齐，把 `HTML_HEADING_RE` 那段加回去即可。

### 3.4 源库自带的 `](#anchor)` 存量死链：只报告，不改

这是计划 2 完全没覆盖的一类。源库里已经存在 7 处标准 markdown 目录链接在平台的 slug
规则下指不中，它们不经任何转换直接迁入：

| 链接 | 问题 |
|---|---|
| `](#卷积神经网络CNN)` | 平台会转小写成 `#卷积神经网络cnn` |
| `](#CNN-评估指标-Metrics)` | 同上 |
| `](#Vision-Transformers(ViT))` | 大小写 + 括号被 slug 丢掉 |
| `](#语音识别-wav2vec3.0)` | 小数点被 slug 丢掉 |
| `](#正向传播-1)`、`](#反向传播-1)` | 编号后缀对不上 |
| `](#如何找到全局最小值)` | 标题文字重复了两遍 |

**决定：原样迁入，只进复核报告，交作者自己处理。** 这是源库的存量问题，不是迁移引入的。

（脚本保留了 `--fix-anchors` 开关，加上它会修正其中目标唯一确定的 4 处——纯大小写或
标点差异；`prefix` 这类需要判断的一律不动。默认关闭。）

### 3.5 代码块里的假内链（计划 2 没预见）

源库的 Python 代码块里有 `[[ '列1','列2' ]]`、`[[1,3,5]]`、`[['小学', '初中', ...]]`
这类字面量。正则一扫就会被当成 Obsidian 内链改写掉，把示例代码改坏。

所有替换现在都先算出**保护区**（围栏代码块、行内代码、`$` / `$$` 数学公式、HTML 注释）
再跳过落在其中的匹配。101 处 `[[...]]` 里正是有 3 处属于这种，已正确跳过——所以内链
统计是 98 处而不是 101 处。

### 3.6 dry-run 必须用独立的清单文件

早期版本 dry-run 和实跑共用 `uploads.json`，结果 dry-run 把「已上传」写满，紧接着的
实跑会认为一切都已完成、一个附件都不传，而正文里全是不存在的 uid。现在 dry-run 写的是
`uploads.dryrun.json`。

---

## 4. 执行顺序

详细命令见 [scripts/README.md](scripts/README.md)，这里只列关卡。

**开跑前的两个前置条件**：

1. **计划 1 需求 B（S3 附件按 workspace 分目录）必须已部署到 `toucan.huzhi.dev`**。
   否则 143 个附件会落进旧的公共前缀，迁完还得再搬一次。
   （截至写这份文档时，需求 B 的改动还是本仓库里未提交的工作区状态。）
2. 目标 workspace `AI_Handbook` 已在 web 端建好。

**目录约定**（`MemoBase/` 已经是一个含 MPNP / Wuxia / English 的 memogit checkout 根，
`AI_Handbook` 是往同一份 config 里加的第四个 workspace）：

| 角色 | 路径 |
|---|---|
| 源库（**全程只读**） | `~/Workspace/jimmy-pink/jimmy-zhz.github.io/AI-Knowledge-Base` |
| 工作目录 | `~/Workspace/kb-migration-work` |
| 最终干净库 | `~/Workspace/MemoBase/AI_Handbook` |

工作目录刻意放在 `MemoBase/` **之外**。memogit 的
[listDocFiles](../../../internal/memogit/push.go#L522) 只跳过 `_attachments/`、点开头文件
和冲突 sidecar，其余一切都当文档处理——127 个 PNG 一旦进了内容树，就会变成 127 篇正文
是二进制乱码的「文档」。`stage` 步骤对此有硬校验，发现非 `.md` 文件直接中止。

**关卡**：

1. `python3 test_slugify_port.py` — 不能省。
2. `migrate.py plan` — 零写请求。**第一次必须以此模式跑完并人工看过。**
3. `migrate.py stage` → 人工 `memogit clone` + `rsync` + `push`（第一趟，换 uid）。
4. `migrate.py attach --dry-run` → 看报告、抽查 diff → 实跑 `attach`。
5. 人工 `rsync` + `memogit status`（应显示全部为「已修改」）+ `push`（第二趟）。
6. `migrate.py report` → 人工复核。
7. **收尾：手动把该 workspace 的换行设置改成 soft break。**
   源库是 CommonMark 语义，平台默认 `remark-breaks` 把每个换行都变 `<br>`，不改会让
   所有段落排版变形。这一步按共识不写进代码，也不动实例级默认值——`MemoBase` 里另外
   三个库是按现在的 hard break 写的。

脚本**不代跑 memogit**，每一步产物都落在工作目录里，由人核对后再拷进 checkout。

---

## 5. 复核报告该看什么

`migrate.py report` 产出 `kb-migration-work/report.md`。预期条目：

| 分节 | 预期 | 性质 |
|---|---|---|
| 锚点匹配不上，已降级 | 7 | 源库存量死链，**不是迁移故障** |
| 内链目标文档找不到 | 3 | `2.x 模型评估与调优` 不存在；`.canvas` 不迁移；`正向传播与反向传播` 命名对不上 |
| 靠模糊匹配救回的锚点 | 2 | **需抽查确实指对了** |
| 源库自带 `](#anchor)` 指不中 | 7 | 存量问题，原样迁入，交作者处理 |
| 被剥壳的 HTML | 17 处 / 4 篇 | 需扫一眼文本没黏成一行 |
| 重复上传的图片 | 7 张 | 符合「一图多引用就传多份」 |
| 图片引用找不到文件 | **0** | 出现非零就是真问题 |
| 图片 basename 重名 | **0** | 同上 |

数字对不上就停下来查，别往下走。

---

## 6. 遗留 / 未做

- **`.canvas`（3 个）不迁移**，留在源库里归档。源库迁完后作为冻结备份保留，Quartz 门面页
  （`index.md` / `home.md`）也留在那里。
- **20 个未被引用的图片不上传**。清单在 `inventory.json` 的 `unused_assets`。
- **裸 HTML 大标题的后续整改**（§3.3）和 **7 处 `](#anchor)` 存量死链**（§3.4）由作者在
  迁移完成后自行处理。
- 计划 2 §3.3 说「仅带内联 `style` 的标签原样保留，由计划 1 需求 A 负责渲染」。需求 A
  上线前，这批 `<font style=...>`（近 200 处）会显示为无样式的普通文本——属可接受的
  降级，不阻塞迁移。
