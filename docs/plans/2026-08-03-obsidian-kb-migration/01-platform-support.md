# 计划 1：迁移前的两项平台支撑需求

## 背景

要把一个 Obsidian/Quartz 知识库（62 篇 Markdown、165 个图片附件）整体迁入
ToucanShelf（见 [计划 2](02-migration.md)），事前发现两处平台能力缺口。这两项**不是
为迁移临时打的补丁**，都是通用能力；但其中第二项**阻塞迁移**，必须先落地。

| | 需求 | 是否阻塞迁移 |
|---|---|---|
| A | 受限的内联 `style` HTML 渲染 | 否 |
| B | S3 附件按 workspace 分目录 | **是** |

另有一项「双链（`[[...]]` / `![[...]]`）渲染支持」经评估后**明确放弃**，理由记录在
文末，以免日后重复讨论。

---

## A. 受限的内联 `style` HTML 渲染

### 现状

渲染管线（[MemoMarkdownRenderer.tsx:261](../../../web/src/components/MemoContent/MemoMarkdownRenderer.tsx#L261)）
已经启用 `rehypeRaw`，所以裸 HTML 标签本身能通过。但紧随其后的
`rehypeSanitize` 用的是 [SANITIZE_SCHEMA](../../../web/src/components/MemoContent/constants.ts)，
它基于 `rehype-sanitize` 的 `defaultSchema` —— **`style` 属性不在任何标签的白名单里，
会被整个剥掉**。

结果是这样一段：

```html
<h1 style="text-align: center; font-size: 3em; color: #2c3e50;
           border-top: 4px solid #3498db; letter-spacing: 3px;">NLP 入门</h1>
```

渲染出来是个样式全无的普通 `<h1>`。

### 需求

允许**属性级白名单过滤后的**内联 `style`。不是放开 `style` 属性本身。

### 关键决策：白名单化 CSS 属性，而不是放行 `style`

直接把 `style` 加进 schema 的 `attributes` 是错的。裸 `style` 至少有两类可利用面：

- **UI redressing** —— `position: fixed` + `z-index` + 大尺寸，可以让一段文档内容
  盖住应用自身的真实按钮（删除、分享、授权确认），点击落到用户没预期的控件上。
- **外链探测** —— `background-image: url(https://attacker/…)`，文档一被打开就向外部
  发起请求，泄露「谁在什么时候读了这篇」。ToucanShelf 的文档可以是 PUBLIC 分享的，
  这条不是理论风险。

所以做法是：在 `rehypeSanitize` **之前**插入一个 `rehype` 插件，把每个元素的 `style`
解析成声明列表，只保留白名单内的属性，其余丢弃；然后 schema 里对相应标签放行
`style`（此时它已被规范化过）。

**允许的 CSS 属性（初版）**

```
color, background-color
font-size, font-weight, font-style, font-family
text-align, text-decoration, text-transform, letter-spacing, line-height
margin, margin-*, padding, padding-*
border, border-*, border-radius
width, max-width, height, max-height
display（仅 block / inline / inline-block / flex，其余值一律丢弃）
```

> **实现时修正（2026-08-03）：`display: none` 不在白名单内。** 原文写的是「仅
> block / inline / inline-block / none 之外的值一律丢弃」，字面意思会保留 `none`——那意味着
> 一篇文档（包括 PUBLIC 分享出去的）可以把自己的一部分内容对读者藏起来。改为只允许
> `block / inline / inline-block / flex`。

**无条件丢弃**：`position`、`z-index`、`top/right/bottom/left`、`transform`、
`content`、`filter`、`mix-blend-mode`、`pointer-events`、`opacity`，以及**任何值里
出现 `url(`、`expression(`、`@import`、`javascript:` 的声明**（不管属性名是否在白名单里，
值级别再过一道）。

`font-family` 允许，但只保留通用族名和字面字体名；不允许通过它触发网络请求（`url()`
已在值级别拦掉）。

### 关键决策：带 `class` 的标签不走这条路

本次需求明确划了一条边界：**只渲染「无自定义 class、仅带内联 style」的标签**。带
`class=` 的 HTML 依赖外部 CSS，而 ToucanShelf 不加载文档携带的样式表——渲染出来必然是
半成品（结构在、样式全丢），比不渲染更糟。

渲染器侧的行为保持现状即可（`defaultSchema` 本来就会剥掉大部分 `className`，只有
`span` / `code` / `mark` / `li` 等少数标签放行了受控的 class 值）。**带 class 的 HTML
由内容侧处理**——迁移脚本负责剥壳留文本，见 [计划 2](02-migration.md#3-带-class-的-html-剥壳)。
这是内容治理，不是渲染器责任。

### 影响面与成本

新增一个 `web/src/utils/rehype-plugins/rehype-inline-style.ts`，加进
`MemoMarkdownRenderer` 的 `rehypePlugins` 数组（位置：`rehypeRaw` 之后、
`rehypeSanitize` 之前），并在 `SANITIZE_SCHEMA` 里对常用标签放行 `style`。

**成本：0.5–1 天**（含单测：白名单穿透、`url()` 拦截、`position` 丢弃、空 style 清理）。

**不阻塞迁移**：本次待迁内容里，重度内联排版集中在 `index.md` / `home.md` 两篇 Quartz
门面页，而这两篇不迁入（见计划 2 的排除清单）。正文里零星的 `<h1 style>` 由脚本降级成
普通标题即可。本项可独立排期。

---

## B. S3 附件按 workspace 分目录（阻塞项）

### 需求

附件在 S3 的对象 key 中带上所属 workspace 的名字（清洗为「仅中英文数字」并做去重），
使不同知识库的附件在存储层物理隔离。

**动机不是整洁，是差异化的数据保全策略。** 不同知识库的附件价值差异极大：本次要迁的
AI 知识库，图片基本是网上能重新搜到的示意图；而另一些知识库里是课堂讲义、手写扫描件，
丢了就是真的没了。混在同一前缀下，就无法对后者单独配置更严的备份周期、版本控制或
生命周期规则。

### 现状与结构性障碍

存储路径由**实例级**模板 `InstanceStorageSetting.FilepathTemplate` 决定，占位符解析在
[`replaceFilenameWithPathTemplate`](../../../server/router/api/v1/attachment_service.go#L643)，
目前只支持 `{filename} {timestamp} {uuid} {year} {month} {day}`——是个**纯字符串函数，
不持有任何上下文**。

真正的障碍在上一层：

- 写盘入口 `SaveAttachmentBlob(ctx, profile, stores, create *store.Attachment)`
  （[attachment_service.go:499](../../../server/router/api/v1/attachment_service.go#L499)）
  拿到的 `create` **只有 `MemoID`，没有 `WorkspaceID`**；workspace 挂在 memo 上
  （[store/memo.go:55](../../../store/memo.go#L55)）。
- 更关键：**Web 编辑器上传附件时 memo 根本还不存在**。
  [uploadService.ts:16](../../../web/src/components/MemoEditor/services/uploadService.ts#L16)
  不传 `memo` 字段，先传附件拿 uid，保存文档时才回填关联。所以在写盘那一刻，
  **workspace 是未知的**。

### 关键决策：上传时显式传入 workspace（方案 A）

给 `CreateAttachment` 增加一个**可选**的 `workspace` 入参，由调用方在上传时提供：

- Web 编辑器从当前所在的 workspace 上下文带上；
- 迁移脚本 / memogit / MCP 等程序化调用天然知道目标 workspace，直接带上；
- 未提供时落到一个固定的兜底前缀（如 `_unassigned/`），行为退化但不报错。

`SaveAttachmentBlob` 据此解析新占位符 `{workspace}`。

**被放弃的方案 B：延迟搬迁。** 即上传时仍无状态地写入临时前缀，等附件首次关联到 memo
时再把 S3 对象搬到正确前缀并更新 `Reference` / `payload.s3_object.key`。语义上更干净
（不需要调用方配合），但要处理搬迁失败的补偿、并发关联、旧 key 回退，且每个附件多一次
S3 复制 + 删除。成本和故障面都明显更大，收益只是省掉一个入参。**不采用。**

### workspace 目录名的生成规则

- 取 workspace 的 display title，仅保留中英文字母、数字，其余字符丢弃；
- 全部被丢弃（如纯符号标题）时回落为 workspace 的 uid；
- **去重**：清洗后可能与另一个 workspace 撞名，需保证目录名与 workspace 一对一。
  建议在 workspace 上持久化一个 `storage_slug` 字段，创建时生成并保证唯一（撞名时
  追加短后缀），之后即便标题被改也不变动——**目录名一旦确定就不能再变**，否则已写入的
  对象 key 会指向不存在的路径。这与
  [memogit 用 workspace id 而非 title 做锚点](../2026-07-13-memogit-cli/01-memogit-cli.md)
  是同一条理由。

### 待定：存量附件怎么办

线上已有相当数量的附件落在最外层的默认前缀下，其中**包含重要知识库的附件**——这正是
本需求想解决的那部分数据。三个选项：

1. **放任不管。** 读路径永远走服务端代理（`/file/...`，见
   [attachment_service.go:487](../../../server/router/api/v1/attachment_service.go#L487) 的注释），
   老对象的 key 存在每条记录的 `payload.s3_object.key` 里，新旧混存**完全不影响访问**。
   零风险，但重要知识库的存量附件仍然混在公共前缀下，差异化策略只对新附件生效。
2. **一次性搬迁全部存量。** 按 memo → workspace 反查，逐个 S3 copy + 更新 key + delete。
   彻底，但要处理未关联 memo 的孤儿附件（它们没有 workspace 可归属）、搬迁中断的
   幂等重跑、以及搬迁期间的读一致性。
3. **只搬重要知识库（推荐）。** 指定若干 workspace，只对这些 workspace 下的附件做
   搬迁，其余留在原地。工作量和风险都远小于选项 2，而**它恰好百分之百覆盖了本需求的
   实际动机**——不重要的那批附件本来就不需要隔离。

> **已拍板（2026-08-03）：选项 3。** 搬迁脚本作为独立子任务排在主功能之后，且必须先在
> 只读模式下产出「将要搬迁的对象清单」供人工核对，再执行。待用户指定要搬迁的 workspace。

### 实现时的补充决策（2026-08-03）

- **`{workspace}` 只对 S3 生效。** 模板本身是 LOCAL / S3 共用的，本地存储下该占位符展开为空
  并折叠掉多余的路径分隔符——本需求的动机（差异化的 S3 生命周期/备份规则）对本地盘不成立，
  而重排已有的本地 data 目录没有收益。
- **默认模板改为 `assets/{workspace}/{timestamp}_{uuid}_{filename}`。** 未显式配置模板的实例
  会随之改变新对象的 key；读路径按记录里的 `payload.s3_object.key` 走，存量不受影响。
- **缺省与错误分开处理。** 调用方**没传** workspace → 落到 `_unassigned/`（不报错）；
  传了但查不到 / 不属于当前用户 → 直接报错，不静默兜底。上传时若带了 `memo`，则从该 memo
  的 workspace 推导，无需调用方重复传。
- **`storage_slug` 惰性回填。** 迁移脚本只加列（默认空串）；从中文标题派生 slug 无法用 SQL
  表达，因此首次用到时生成并持久化（`EnsureWorkspaceStorageSlug`）。重名冲突时追加
  workspace uid，一步到位不循环重试。

### 影响面与成本

- `proto/api/v1/attachment_service.proto`：`CreateAttachmentRequest` 增加可选
  `workspace` 字段（需重新生成 Go / TS 代码）
- `attachment_service.go`：`CreateAttachment` 解析并向下传递；
  `replaceFilenameWithPathTemplate` 增加 `{workspace}` 占位符（需要改签名以接收上下文）
- `store`：workspace 增加 `storage_slug`（含迁移脚本回填存量 workspace）
- `uploadService.ts`：带上当前 workspace
- 实例存储设置的默认 `FilepathTemplate` 更新，并在设置页说明新占位符

**成本：1–2 天**（不含存量搬迁）。

---

## 附：为什么不做双链渲染

需求提出过「是否支持 `[[文档]]` / `![[图片]]`」，评估后**放弃**。理由记录在此。

### `![[图片.png]]` —— 与附件模型正面冲突

ToucanShelf 的图片是 **attachment 模型**：uid 寻址、挂在 memo 上、访问权限跟随所属 memo
的可见性（[checkAttachmentAccess](../../../server/router/api/v1/attachment_service.go#L736)）。
`![[x.png]]` 是**文件名寻址**。要支持就得在渲染时按 filename 反查 attachment，而 filename
在全局远不唯一——这等于凭空造出一个扁平的全局命名空间，**与本文档需求 B 想建立的
按-workspace 隔离是正相反的方向**，且绕开了 attachment 的归属权限模型。

### `[[文档#标题|别名]]` —— 诉求合理，形式错误

「写内链时不必知道文档 uid」这个诉求本身完全成立。但 Obsidian 的解法建立在
「一个库 = 一个扁平文件名空间」的前提上，而 ToucanShelf 的唯一性是
`(workspace, folder_path, title)`（[naming.go:118](../../../internal/memogit/naming.go#L118)），
**裸 title 全局不唯一**。真要支持，必须定义一整套消歧规则：同文件夹优先 → 本 workspace
内唯一匹配 → 跨 workspace 如何处理 → 匹配不到渲染成什么 → 目标改名后链接是断还是跟随。
这不是插件成本，是**长期的语义债**。

而且只做渲染器没有用：用户手打 `[[` 依然记不住标题全称，**必须配编辑器自动补全才成立**，
这就从「加个 remark 插件」变成一个完整功能。

决定性的一点是：本次是**一次性迁移，之后放弃 Obsidian**。为一个即将停用工具的专有语法
给渲染器背上永久的模糊解析语义，是本末倒置。迁移脚本一次性转换 245 处双链是确定性的
文本处理（见计划 2），成本低得多。

### 如果以后仍然想要这个能力

正确形态是**编辑器侧**：输入 `[[` 弹出文档选择器，用户选中后**插入的是标准 Markdown
链接**（`[标题](/m/{uid})`）。所存即所见，没有解析歧义，与 Obsidian 兼容性无关。那是一个
值得单独排期的需求，双链**渲染**不是。
