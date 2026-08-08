> 迁移注记：对应需求见
> [../requirements/editor/calendar-block.md](../requirements/editor/calendar-block.md)。
> 本文档冻结的是当时的实现方案；calendar 代码块后续迭代出的 events/扩展任务状态/预览态
> 写回等能力不在本文档范围内，以需求文档为准。

## 实现路线：复用 mermaid 的代码块分发机制，不新建 remark 插件

项目现有两种"识别约定语法 → 特殊渲染"的机制：

1. **remark 插件改写 AST**（[remark-alert.ts](../../../web/src/utils/remark-plugins/remark-alert.ts)）：在 mdast 阶段把 `> [!NOTE]` 的 blockquote 打上 `data-alert` 属性，再由 [Alert.tsx](../../../web/src/components/MemoContent/markdown/Alert.tsx) 接管渲染。这条路径用于"改写已有 markdown 结构的语义"（blockquote 本身的含义变了）。
2. **代码块语言分发**（[CodeBlock.tsx:26-35](../../../web/src/components/MemoContent/CodeBlock.tsx)）：react-markdown 把 fenced code block 渲染成 `code` 组件时自带 `language-xxx` className，`CodeBlock` 组件按 `extractLanguage` 取出语言标签，`language === "mermaid"` 时直接换成 `<MermaidBlock>`（[MermaidBlock.tsx](../../../web/src/components/MemoContent/MermaidBlock.tsx)）渲染，不需要新的 remark 插件——fenced code block 的边界识别是 remark/react-markdown 内置能力。

calendar 代码块语法本身就是标准 fenced code block（```` ```calendar ```` ... ```` ``` ````），选择第 2 条路径：**新增一个 `language === "calendar"` 分支 + 一个 `CalendarBlock` 组件**，和 mermaid 完全同构，不需要动 remark 插件层。

## 改动点

### 1. `CalendarBlock.tsx`（新建，参照 [MermaidBlock.tsx](../../../web/src/components/MemoContent/MermaidBlock.tsx) 的骨架，内部拆成网格 + 详情区两个子组件）

```tsx
interface CalendarBlockProps {
  children?: React.ReactNode;
  className?: string;
}

export const CalendarBlock = ({ children }: CalendarBlockProps) => {
  const codeContent = extractCodeContent(children); // 复用现有 utils.ts，不重新实现
  const groups = useMemo(() => parseCalendarBlock(codeContent), [codeContent]);
  // groups: CalendarGroup[]，见下方解析器

  const datedGroups = useMemo(() => groups.filter((g) => g.date), [groups]);
  const ungroupedItems = groups.find((g) => !g.date)?.items ?? [];

  // 默认月份 = 数据中最晚日期所在月；无数据则回落到当前自然月
  const [visibleMonth, setVisibleMonth] = useState(() => defaultVisibleMonth(datedGroups));
  const [selectedDate, setSelectedDate] = useState<string | undefined>();

  if (groups.length === 0) {
    return <CalendarEmptyState />; // 空内容渲染空态，不报错
  }

  const selectedGroup = datedGroups.find((g) => g.date === selectedDate);

  return (
    <div className="flex flex-col gap-3">
      {ungroupedItems.length > 0 && <CalendarUngroupedSection items={ungroupedItems} />}
      <CalendarMonthGrid
        month={visibleMonth}
        onMonthChange={setVisibleMonth}
        markedDates={new Set(datedGroups.map((g) => g.date!))}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />
      <CalendarDayDetail group={selectedGroup} selectedDate={selectedDate} />
    </div>
  );
};
```

- `codeContent` 的取值方式与 mermaid 完全一致，直接复用 [utils.ts](../../../web/src/components/MemoContent/utils.ts) 里的 `extractCodeContent`，不新增解析 children 的逻辑。
- `CalendarMonthGrid`：纯展示 + 交互的网格组件，接受"当前月份、有标记的日期集合、选中日期、月份/选中回调"，内部处理"该月第一天是星期几 → 前置空白格数量"这类日历布局计算（可以手写，不需要额外依赖第三方日历库——纯日期网格布局用 `Date` API 即可推出，逻辑量不大）。
- `CalendarDayDetail`：网格下方的详情区，接受"当前选中分组"，为空则展示提示文案（未选中 / 选中了没有数据的日期，两种空态文案略作区分即可）。
- `CalendarUngroupedSection`：渲染需求里"未分组事项"的固定小区块，位置在网格上方，不受月份切换影响。

### 2. 解析器 `parseCalendarBlock`（新建，纯函数，无 UI 依赖，便于单测）

放在 `web/src/components/MemoContent/calendar/parseCalendarBlock.ts`（或就近放 `CalendarBlock.tsx` 同目录），签名：

```ts
interface CalendarItem {
  text: string;
  checked?: boolean; // undefined = 无 checkbox 的纯文本条目
}
interface CalendarGroup {
  date?: string; // YYYY-MM-DD；undefined 表示"未分组"区块
  items: CalendarItem[];
}

function parseCalendarBlock(raw: string): CalendarGroup[]
```

解析规则（对应需求"语法定义"一节，逐行状态机，无需完整 markdown 解析器）：

1. 按行拆分，逐行用两个正则匹配：
   - 日期行：`/^-\s+(\d{4}-\d{2}-\d{2})\s*$/`（仅日期，无 checkbox、无其余文本）→ 开启新分组，`date` 设为捕获值。
   - 事项行：`/^-\s+(?:\[([ xX])\]\s+)?(.+)$/` → 若第一个捕获组存在则 `checked = 捕获值.toLowerCase() === "x"`，否则 `checked = undefined`（纯文本条目）；文本内容取第二个捕获组。
2. 空行、不匹配上述两种模式的行，直接跳过（不报错、不中断分组，对齐需求"日期分组的自动排序/校验提示"不做智能纠错的原则）。
3. 事项行归入"当前最近一个日期分组"；日期行出现之前遇到的事项行，归入 `date: undefined` 的分组，且该分组固定排在数组最前（对应需求"未分组区块展示在最前面"）。
4. 分组顺序 = 代码块内出现顺序，不做任何排序/去重（对齐需求"不做智能整理"）。

这个解析器不依赖 remark/mdast，是纯字符串处理——因为 fenced code block 内部内容对 markdown 渲染管线来说本来就是不透明文本（这也是为什么 mermaid 能直接把内容丢给 mermaid.js 解析），calendar 代码块内部的"列表"语法只是我们自定义的展示约定，不是真正被 remark 解析成 mdast list 节点。

解析器本身**不感知"网格"这件事**——它只负责把文本变成 `CalendarGroup[]`，网格布局、月份状态、选中状态都是 `CalendarBlock` 组件层面基于这份数据做的纯前端计算，不需要解析器输出格式跟着网格需求变化。这样解析器和渲染布局解耦，以后即便网格样式再调整，也不用碰解析逻辑。

### 2.1 `defaultVisibleMonth`（新建，纯函数）

```ts
function defaultVisibleMonth(datedGroups: CalendarGroup[]): { year: number; month: number } {
  if (datedGroups.length === 0) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  const latest = datedGroups.map((g) => g.date!).sort().at(-1)!; // "YYYY-MM-DD" 字符串排序即字典序=日期序
  const [y, m] = latest.split("-").map(Number);
  return { year: y, month: m - 1 };
}
```

对应需求"网格初始显示月份"规则：有数据取最晚日期所在月，无数据落到当前自然月。

### 3. 接入点：`CodeBlock.tsx`

在现有 mermaid 分支旁新增一个分支（[CodeBlock.tsx:26-35](../../../web/src/components/MemoContent/CodeBlock.tsx) 之后）：

```tsx
if (language === "calendar") {
  return (
    <pre className="relative">
      <CalendarBlock className={cn(className)} {...props}>
        {children}
      </CalendarBlock>
    </pre>
  );
}
```

语言标签大小写不敏感（需求要求），在 `extractLanguage` 取值后统一 `toLowerCase()` 再比较，而不是改 `extractLanguage` 本身的行为（避免影响 mermaid/其他语言判断的既有大小写语义）。

### 4. 事项 checkbox 的交互行为

需求明确"勾选交互不回写文档，跟随现有任务列表项的既有行为"。先确认现有 markdown 任务列表项（普通 `- [ ]`，不在代码块里的）在本项目里是否可点击、是否回写——若现有行为是纯只读展示，`CalendarItem` 的 checkbox 也做成纯展示（`disabled`/非交互），保持一致，不在本功能里单独造一套可回写的任务交互。

## 不需要改动的部分

- **remark 插件层**：不新增、不修改任何 remark 插件。fenced code block 的边界、语言标签识别是 react-markdown 内置能力，calendar 语法的"分组/事项"结构完全在 `CalendarBlock` 组件内部以字符串解析完成。
- **编辑器（MemoEditor）**：不新增工具栏按钮、不新增辅助输入控件，编辑态就是普通文本编辑（对齐需求"不新增编辑器侧辅助 UI"）。
- **后端/存储**：代码块内容是 markdown 正文的一部分，随文档 content 一起保存，不新增字段、不新增接口。
- **Explore 列表 / 文档类型分发**：calendar 代码块可以出现在任何普通文档里，不是独立文档类型，不涉及 doc type 分发或 Explore 过滤逻辑（与 view 文档的技术路线明确不同）。

## 测试计划

- `parseCalendarBlock` 单测（vitest，覆盖需求"语法定义"列出的每条规则）：
  - 基本日期分组 + 混合 checkbox/纯文本事项（对应需求给出的示例文本）。
  - 日期行之前出现的事项 → 归入无日期头的分组。
  - 格式不满足 `YYYY-MM-DD` 的"日期行"（如 `- 2026/07/13`、`- 13号`）→ 不触发分组，按普通事项处理。
  - 空代码块 / 全是空行 → 返回空数组。
  - 空行不影响分组归属。
- `defaultVisibleMonth` 单测：有数据时取最晚日期所在月；多个分组乱序时仍取全局最晚；无数据时取当前自然月（可用 `vi.setSystemTime` 固定"当前时间"避免测试跑在月末/跨年边界抖动）。
- `CalendarBlock` 渲染层：静态检查（tsc）+ 手动在本地 dev 环境粘贴需求里的示例代码块，确认交互符合预期（按 [feedback_no_auto_testing](../../../CLAUDE.md) 的约定，视觉验证由用户自测，此处只列验证项）：
  - 初始打开时，网格默认停在数据里最晚日期所在的月份，且该日期格子有标记。
  - 点击"上一月/下一月"，网格正确切月，月首对齐星期几正确（含跨年，如 12 月→1 月）。
  - 点击有标记的日期格子，下方详情区正确展示当天事项（含 checkbox/纯文本混合）。
  - 点击没有数据的空白日期格子，详情区展示"当天无记录"空态，不报错。
  - 切换月份后，若原选中日期不在新月份内，详情区清空（对应需求"预览态流程"第 5 条）。
  - 未分组事项固定展示在网格上方，且切换月份不影响它。
  - 空 calendar 代码块渲染空态，不报错、不白屏。
  - 窄屏（对齐项目已有的移动端断点）下网格可正常显示，不横向溢出。

## 工作量估算（相对 gallery-view 的量级对比）

相较最初评估的"纯列表"方案，月历网格版本的改动范围扩大：新增网格布局组件、月份导航状态、选中态详情区组件，以及若干日期计算的纯函数。但核心边界没变——**数据源始终只是当前这一个代码块**，不涉及表单、不涉及后端接口、不涉及跨文档查询、不涉及数据库字段变化，全部是前端一个新渲染组件内部的状态和布局。

预计改动：1 个容器组件（`CalendarBlock`）+ 3 个子组件（网格 / 详情区 / 未分组区块）+ 2 个纯函数（解析器、默认月份计算）+ `CodeBlock.tsx` 里 4 行分发代码。相较 [gallery-view](../2026-07-06-gallery-view/requirement.md) 需要的"新文档类型 + 结构化 content + 预置表单 + scope 跨文档查询 + Explore 过滤"，仍然小一个量级，但比最初的"纯列表"方案多出约一倍的组件数量，属于合理的复杂度上升，不建议再进一步扩展（比如格子内塞事项文字、跨文档聚合）。
