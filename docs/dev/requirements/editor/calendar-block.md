# calendar 代码块

## 是什么

在任意文档正文里写一个语言标签为 `calendar` 的 fenced code block，预览时渲染成一个
可翻页的月历网格 + 当日详情区，用来记"按日期分组的流水账"（当天做了什么/待办）。
技术路线上与 `mermaid` 同构：复用 [CodeBlock.tsx](../../../../web/src/components/MemoContent/CodeBlock.tsx)
的代码块语言分发，不是独立文档类型，不做跨文档聚合——那是 [gallery-view](../views/gallery-view.md)
的问题域。

块内容随文档正文一起保存，不产生独立 DB 字段。

## 语法

```
```calendar
events: 健身, 阅读
weekStartDay: 1
allowMaxUpdateDays: 7

- 2026-07-13

- [ ] 制定规范的 Vision
- [x] 完成雅思学习
- @健身

- 2026-07-08

- [/] 项目管理 HTML 页面
```
```

逐行状态机解析（[parseCalendarBlock.ts](../../../../web/src/components/MemoContent/calendar/parseCalendarBlock.ts)），不依赖 remark/mdast——代码块内容对渲染管线本来就是不透明文本：

- **配置行**（可选，出现在任意位置，`@` 前缀可有可无）：
  - `events: a, b` —— 预定义 event 名称列表，顺序即后续显示的颜色下标。
  - `weekStartDay: 1..7` —— 周起始日（1=周一…7=周日），省略时跟随实例设置。
  - `allowMaxUpdateDays: N` —— 只允许编辑最近 N 天内日期的分组，避免误改历史流水账。
  - `showTaskDot: true|false` —— 移动端格子是否画"当天有任务"的圆点。
- **日期行** `- YYYY-MM-DD`（仅日期，无其他内容）：开启一个新分组，之后的条目归入该组，直到下一个日期行或块结束。
- **事项行**三种形态：
  - `- [ ] xxx` / `- [x] xxx`：任务，checkbox 状态见下方"扩展任务状态"。
  - `- @事件名` 或 `- @1`（1 基下标，指向 `events:` 列表）：event 打点。数字引用的意义是重命名 event 时历史数据不用改。
  - `- xxx`（无 `[]`）：纯文本条目。
- 日期行之前出现的事项归入一个不带日期头的"未分组"分组，渲染在网格上方、不受翻月影响。
- 空行、无法识别的行直接跳过，不报错、不中断分组归属。

### 扩展任务状态

不满足于 GFM 的 `[ ]`/`[x]` 两态，复用全项目通用的
[task-status.ts](../../../../web/src/utils/task-status.ts) 状态集（Obsidian Tasks 插件同款约定）：

| marker | 含义 | 别名 |
|---|---|---|
| ` ` | 未开始 | — |
| `x` | 已完成 | `X` |
| `/` | 进行中 | — |
| `-` | 已作废（删除线+弱化） | `~` |
| `<` | 已排期 | — |
| `>` | 已延后 | — |
| `?` | 有疑问 | — |
| `!` | 重要 | — |

未识别的 marker 字符（如 `[z]`）不当作任务，原样保留为文本的一部分。

## 预览态交互

1. 打开文档，`CodeBlock.tsx` 按 `language === "calendar"`（大小写不敏感）分发给
   [CalendarBlock.tsx](../../../../web/src/components/MemoContent/CalendarBlock.tsx)。
2. 默认选中日期为**今天**（若今天不在数据范围内，网格仍以今天所在月打开）。
3. 网格渲染当月每一天，有事项/event 的日期打标记；月外的对齐格子留白、不可点击。
4. 点击日期格子 → 下方详情区展示该分组的事项/event 列表；无数据的日期展示空态文案，不报错。
5. 翻月不影响选中日期；若翻走后选中日期不在新月份内，详情区清空。
6. 未分组事项固定展示在网格上方，翻月不影响。

### 详情区支持写回文档（与最初设计的差异）

最初方案把这个功能定位成"只读渲染，编辑态仍是手写 markdown"。当前实现已经不是——
详情区支持**直接在预览态里增删事项、切换任务状态、勾选 event**，改动通过
[upsertCalendarItem.ts](../../../../web/src/components/MemoContent/calendar/upsertCalendarItem.ts)
按行级字符串编辑写回块所在的原始 markdown 文本（不经过 AST），再走文档的常规保存流程。

- `allowMaxUpdateDays` 是这条写回能力的护栏：超出天数窗口的历史日期在 UI 上禁止编辑，
  避免"手滑改了三年前的流水账"。
- 分组内事项按状态排序展示（重要 → 未开始 → 已完成/其他 → 已作废），不是原文出现顺序——
  这也是相对最初设计的一处修订，最初方案里明确"不做自动排序"。

TODO(确认)：写回能力是哪次迭代加上的、是否有独立的需求记录（当前只能从代码状态反推），
如果有对应的会话/commit 记录，应在此补一条来源链接。

## 明确不做的事

- 不做跨文档聚合（数据源永远只是当前这一个代码块）；有该诉求应走 view 文档路线，见
  [gallery-view](../views/gallery-view.md)。
- 不新增编辑器侧的辅助 UI（插入工具栏按钮见下方"入口"一节，属于既有能力，不是本机制新增）。
- 不做日期格式的自动纠错——写错格式的"日期行"按普通事项处理。

## 入口

工具栏"折叠块"下拉菜单可插入示例 calendar 代码块（与 sheets、secret 共用同一个插入菜单的模式，
见 [FormattingToolbar.tsx](../../../../web/src/components/MemoEditor/Toolbar/FormattingToolbar.tsx)）。
TODO(确认)：具体菜单文案 key，未逐一核对。
