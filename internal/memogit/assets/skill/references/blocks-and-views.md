# 特殊块与视图

两类东西：

- **交互式围栏块**——嵌在 Markdown 文档**内部**：` ```calendar ` / ` ```kanban ` /
  ` ```grid ` / ` ```sheets `。
- **VIEW 文档**——第 4 种 doc_type，整篇文档就是一份画廊配置（`*.view.json`）。

围栏块走同一套机制：代码块渲染器按**围栏语言**派发到专用组件。
**遇到不认识的围栏语言，当作特殊块原样保留，别当普通代码块去重排或美化。**

> ⚠️ **不主动发起，只在用户明确要求时写。（看板和GridView除外，这两者可根据需要使用）** 这些块是结构化数据（不是排版装饰，
> 所以不受 `markdown-syntax.md` §2 那条"装饰语法一概不写"的限制）：用户说"做个看板"
> "把这些排成画廊"时，你按下面的规则写或改；但**不要自己决定**把一篇普通文档改造成
> Calendar/Sheets/.view.json，这三者只适用于特殊场景不适合AI使用除非有用户授权。

所有块都**优雅降级**：畸形输入渲染成空状态或原始源码，不会破坏整篇文档；
剩余异常被 ErrorBoundary 兜在块内。

> ⚠️ **写回契约（对你最重要的一条）**：calendar / kanban / sheets 在 app 里被用户
> 直接操作时会**重写围栏内的内容并保存文档**。所以你手编这些块时**别依赖精巧的手工对齐**——
> 第一次写回就会被规范化掉。注释和键顺序会保留，缩进和引号风格不保留。

编辑权限是上下文相关的：只有用户打开**自己的**文档、且当前上下文能保存时才可直接操作。
在 Explore 信息流、分享视图、别人的文档里，这些块是只读的。

---

## 1. ` ```kanban `

体是 **YAML**，三个顶层键：

````markdown
```kanban
items:
  - id: t1
    title: Learn Spark
    status: 需求
    priority: high        # highest|high|medium|low|lowest
    due: 2026-07-20
    tags: [BigData]
  - id: t2
    title: Finish AI homework
    status: 开发
    done: true

view:
  type: kanban
  groupBy: status
  orderBy: order
  descending: false
  lock: false

statusOrder: ['需求', '开发', '测试', '发布']
```
````

**卡片字段**（除 `title` 外全可选；**无 title 的项被直接跳过**）：

| 字段 | 说明 |
|------|------|
| `id` | 写回用的稳定身份。缺失时首次编辑会**自动补上** |
| `title` | 卡片标题，**必填** |
| `link` | 让标题变成链接：库内相对文档路径（`milestones/M-008.md`）或绝对 URL（新窗口打开） |
| `status` | 卡片所在列（`groupBy` 为 status 时） |
| `priority` | 彩色徽标：`highest` / `high` / `medium` / `low` / `lowest` |
| `done` | 完成态：置灰、删除线、勾选 |
| `order` | 列内排序位（默认排序键） |
| `tags` | chip，列表 `[a, b]` 或逗号字符串 `"a, b"` |
| `due` | 到期日 |
| `createAt` / `updateAt` | 时间戳，`updateAt` 每次写回都会被刷新 |
| 任意其他键 | **保留**，显示在卡片详情面板 |

**列顺序**：`statusOrder` 里的列先渲染（**包括空列**），未列出的分组值按首次出现顺序追加，
缺 `groupBy` 字段的卡片收进末尾的 *Ungrouped* 列。

**`view.lock: true`** 让整块变只读——用来冻结一块已完成的看板。

**用户能做的手势**：勾选完成（写 `done`）、拖卡换列（写 `status`）、列底部"添加任务"
（新建带 `id`/`title`/`status`/时间戳的项）。拖动和添加**只在 `groupBy: status`
且不是 Ungrouped 列时可用**。列内重排、行内改字段、删卡片当前不支持。

---

## 2. ` ```sheets `

基于 CSV 的交互式表格（canvas 网格），支持公式和防抖写回（约 600ms）。

````markdown
```sheets
sheet:销售数据
name,price,qty
苹果,3.5,10
香蕉,2.1,20
,,,总价,=B2*C2+B3*C3

view:
  lock: false
```
````

- **`sheet:<名字>`** 开启一个命名 tab；多个 marker = 多个 tab；没有 marker = 一张无名表。
- **CSV 行**用 papaparse 解析，第一行是表头。以 `=` 开头的单元格是**公式**。
- **`view:`** 目前只有 `lock: true|false`。视口高度**不写在这里**——用户拖动网格底部
  手柄调整的高度存在 memo 的 node overlays 里（与单元格样式一起），不进正文。

### 公式：什么能用，什么不能用

网格引擎只内置 **8 个函数**：`SUM AVERAGE MAX MIN IF AND OR CONCAT`。
项目额外注册了一批兜底实现：`PRODUCT DIVIDE SUBTRACT COUNT COUNTA ABS INT SQRT
ROUND LEN` 等。既非内置又未实现的（`VLOOKUP` / `SUMPRODUCT` / `COUNTIF`）
回落成安全的 `#N/A`，不会抛异常。

**不支持区间/数组运算。** 引擎把 `A1:A3` 展平成参数列表，没有逐元素数学，所以
`=SUM(B2:B3*C2:C3)` 和 `=SUMPRODUCT(B2:B3,C2:C3)` **算不出**逐行的 price × qty。
**必须展开成对单元格的普通算术**：`=B2*C2+B3*C3`。你替用户写公式时守住这条。

> 主题限制：网格画在 `<canvas>` 上、引擎硬编码浅色且无运行时主题 API，
> 所以这个块在暗色模式下刻意固定为浅色卡片。这是引擎限制，不是 bug，别去"修"。

---

## 3. ` ```grid `

响应式封面卡片墙（或两行文字条）。**纯展示，没有写回。**

块级配置写在**第一个 `- ` 卡片之前**，卡片随后：

````markdown
```grid
columns: 3

- title: 带封面 + 链接的卡片
  subtitle: 副标题（灰）
  cover: https://picsum.photos/seed/one/400/300
  url: https://example.com
  作者: 赵华
```
````

**块级配置**：`style`（别名 `type`）= `card`（默认）或 `longbar`（两行文字条，永不显示封面）；
`nocover: true` 隐藏**所有**卡片封面；`columns` 固定列数，**钳制在 1–8**，不写则按宽度自适应。

**卡片字段**：`title`（**必填**，缺失的卡片被丢弃）、`subtitle`、
`cover`（`attachments/…` 资源名或 URL）、`url`（整张卡变链接）、`nocover`（单卡强制文字卡）、
**其他任意键**按源码顺序收集成副标题下方的展示字段（空值丢弃）。

---

## 4. ` ```calendar `

月历网格 + 每日详情面板，由带日期的清单行驱动。

````markdown
```calendar
events: 瑜伽, 早睡, 喝水
showTaskDot: true
weekStartDay: 1
allowMaxUpdateDays: 30
- 2026-07-20
- [ ] Kick off sprint planning
- [x] Send calendar invites
- @瑜伽
- 全天：团队 offsite（纯文本，无勾选框）
```
````

- `events: a, b, c`（逗号或中文逗号分隔）**声明事件集**，每个事件按下标拿到固定颜色。
- `- YYYY-MM-DD` **开启一个日期分组**，后续行归属该组：
  - `- [ ] 文本` / `- [x] 文本` → 勾选框条目
  - `- @名字` → 该日的**事件发生**（名字必须是已声明的事件）
  - `- 文本` → 纯文本条目
- 任何日期分组**之前**的条目收进月历上方的 *Ungrouped* 区。
- 配置行：`showTaskDot: true`（窄屏在日期数字旁画"有任务"蓝点，默认关）、
  `allowMaxUpdateDays: N`（只允许编辑最近 N 天及未来，更早的格子只读）、
  `weekStartDay: N`（1 = 周一 … 7 = 周日，不写则跟随实例设置）。
- 空行和不匹配的散文被忽略；**不相邻的同日期分组会合并**；空 body 显示友好空状态。

用户可勾选任务、为选中日添加条目、通过弹层勾选事件（写入/移除 `- @名字` 行），
这些都会重写围栏内容并保存。

---

## 5. VIEW 文档（`*.view.json`）

第 4 种 doc_type。`content` **只是一段结构化 JSON 配置**（视图类型 + scope + 排序/封面/
卡片规则）加可选的 Markdown 前言。它**从不存储渲染后的 HTML**，每次打开都从当前数据
**实时**渲染画廊——改子文档标题、换封面图、增删文档，下次打开自动反映，没有"重新生成"这一步。

一个 view 可含**多个 gallery block**，自上而下用分隔线隔开，每块独立配置：

- **scope**（这块显示哪些文档）：
  - `{ "type": "folder" }` —— view 所在文件夹的**直接子文档**
  - `{ "type": "tag", "tag": "..." }` —— 带某标签的所有文档
  - `{ "type": "property", "filters": {...} }` —— frontmatter 属性匹配，多条 **AND**，
    **仅支持等值**（列表属性中任一元素相等即命中）
- **sort**：`updated_desc` / `updated_asc` / `created_desc` / `created_asc` / `title_asc`，
  或 `prop_asc:<key>` / `prop_desc:<key>`（缺该属性的文档排到最后）
- **cover rule**：`first_image`（首个图片附件或正文首张内联图）/ `none` / `prop:<key>`
  （`attachments/...` 资源名解析成该附件，其他当 URL）
- **card fields**：primary（粗体）+ secondary（灰），取值
  `__title__` / `__updated__` / `__created__` / `prop:<key>` / `""`（该行不显示）
- **badges**：每块最多 3 个角标。每个有样式（`tag` / `ribbon` / `corner`）、
  文本（截断到 5 字）、颜色（hex）、以及一条 `key = value` 属性过滤。渲染时按顺序匹配，
  **第一个命中的角标生效**；`tag` 样式还会把整张卡片降透明度 + 灰度处理（"已完成"观感）。
  角标是纯展示叠加，**不改变**这块包含哪些文档。

对你的约束：

- **必须保持合法 JSON。** 改坏了视图会退化（不渲染），但不会损坏文档本身。
- 顶层的 `"memogit-id"` 键是文档身份标记，**不要动**（见 `memogit.md`）。
- scope / sort / cover / badge 里引用的 `prop:xxx` 依赖**目标文档**的 frontmatter
  存在对应 key。你改了别处文档的 frontmatter，可能让这里的视图变空——反向也成立。
- VIEW 文档是组织节点不是内容笔记，**被排除在 Explore 信息流之外**。
- VIEW 文档没有自己的标题结构，但每块的前言（`description`）和页脚 Markdown 里的标题
  是可锚定的；**画廊卡片墙被显式排除在锚定之外**（卡片是实时查询结果，随数据出现消失，
  批注不能挂在上面），卡片标题也不是标题、不能当锚点。
