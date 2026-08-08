# ADR-0004：交互块走 CodeBlock 语言分发，不新建 remark 插件 / 文档类型

## 状态

已采纳。

## 背景

项目已有两种"识别约定语法 → 特殊渲染"的机制：

1. **remark 插件改写 AST**（[remark-alert.ts](../../../web/src/utils/remark-plugins/remark-alert.ts)）：
   在 mdast 阶段把 `> [!NOTE]` 的 blockquote 打上 `data-alert` 属性，用于"改写已有 markdown
   结构的语义"。
2. **代码块语言分发**（[CodeBlock.tsx](../../../web/src/components/MemoContent/CodeBlock.tsx)）：
   react-markdown 把 fenced code block 渲染成 `code` 组件时自带 `language-xxx` className，
   `language === "mermaid"` 时换成 `<MermaidBlock>`，不需要新的 remark 插件——fenced code
   block 的边界识别是 remark/react-markdown 内置能力。

新增 [calendar](../requirements/editor/calendar-block.md) 代码块时需要在两条路径间选一条。

## 决策

选第 2 条：新增 `language === "calendar"` 分支 + 一个 `CalendarBlock` 组件，和 mermaid 完全
同构，不动 remark 插件层。之后的 [sheets](../requirements/editor/sheets-block.md)、
[secret block](../requirements/editor/secret-block.md) 沿用同一模式。

## 理由

calendar/sheets/secret 的语法本身就是标准 fenced code block，块内容对 markdown 渲染管线来说
本来就是不透明文本（这也是为什么 mermaid 能直接把内容丢给 mermaid.js 解析）。不引入新文档
类型、不做知识库范围的查询聚合——这类需求解决的是"单篇文档内部、渲染层面"的问题，与
[view 文档](../requirements/views/gallery-view.md) 面向"跨文档聚合"是不同量级的问题域。

## 影响

- 编辑器（MemoEditor）不需要新增专属编辑表单；编辑态是普通文本编辑，只有预览渲染不同。
- 后端/存储不受影响：块内容是 markdown 正文的一部分，随文档 content 一起保存。
- 语言标签大小写不敏感的判断统一在各分支自行 `toLowerCase()`，不改 `extractLanguage` 本身
  的大小写语义，避免影响既有语言判断。
