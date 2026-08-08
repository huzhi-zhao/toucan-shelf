# Gallery View

`VIEW` 文档类型（见
[render-only-doc-types.md](render-only-doc-types.md)）的具体形态之一：
以类似 Notion Gallery View 的相册卡片形式，实时展示知识库中某个范围内的
子文档。文档 content 只存一份结构化配置，不存任何渲染产物。

## 1. 定位与边界

- **配置驱动渲染**：content 只是数据，相册卡片是前端在打开文档时，实时
  查询 scope 内的当前数据、用固定的组件渲染出来的——不做离线生成、不持久化
  渲染结果。子文档标题变更、封面替换、新增/删除，下次打开自动反映。
- **不引入独立的 "index.xxx" 物理文件概念**：VIEW 文档的归属关系直接挂在
  知识库现有的目录/文档层级上，是文档树里的一个普通节点。
- **不做"提交时生成最终 HTML 并持久化"**：content 里不允许出现渲染产物或
  用户手写的任意 HTML 片段，避免数据陈旧、缓存失效、存储型 XSS 三个问题。
- **不引入 schema 驱动表单引擎**：配置表单是预先设计好的固定 React 组件，
  不是运行时可变的 schema。
- **不出现在 Explore feed**：VIEW 是组织节点，不是内容型笔记，排除规则见
  [render-only-doc-types.md](render-only-doc-types.md#3-explore-feed-排除)。

## 2. 内容格式

content = 可选的 YAML frontmatter（无 `---` 分隔符的内部文本）+ 一段 JSON
配置（`web/src/components/GalleryView/types.ts`）：

```ts
interface GalleryViewConfig {
  viewType: "gallery";
  blocks: ViewBlock[];       // 异构，从上到下顺序渲染，用分割线分隔
  frontmatter?: string;      // 让 VIEW 文档自己也能有 frontmatter 属性
}
```

`viewType` 当前是字面量 `"gallery"`，没有跨类型的分发/注册机制；
`blocks` 是异构联合类型，实际承担了"新增视图形态"的扩展点（而不是新增
`viewType`）：

- **`GalleryBlock`**（相册）：`scope` + `sort` + `cover` + `cardFields` +
  最多 3 条 `badges` 规则。
- **`CalendarLayoutBlock`**（日历布局）：同样按 `scope` 实时扫描文档，按
  `dateProperty`（frontmatter 属性，缺省回退 `date` 属性，再缺省回退创建
  时间）把命中的文档铺到月历网格上；不持久化"日期格→文档"的映射。
- **`MarkdownBlock`**（说明文本）：走既有 markdown 渲染管线，内联文本或
  引用另一篇文档（只读展示，编辑仍在被引用文档里做）。

一份 VIEW 文档可以同时容纳多个相册/日历/文字块，不是"一个 view 文档只能
是一种样式"。

> 与早期方案的差异：最初设想"简介只是相册上方固定单槽位的 markdown 文本"，
> 实现落地为通用的 `MarkdownBlock`，可以出现在 `blocks` 数组任意位置、
> 可多个，而不只是顶部一段说明。

## 3. Scope（展示范围）

`GalleryScope` 是两层结构：多个 `GalleryGroup`（每组内部 `match: "all" |
"any"`）之间再用一个顶层 `match` 组合，例如
`match:"any"` 的 `[{match:"all", rules:[A,B]}, {match:"all", rules:[C]}]`
表示 `(A AND B) OR C`。

规则种类（`GalleryRule`）：
- `folder`：匹配某文件夹下的文档（缺省为该 VIEW 文档自身所在文件夹），
  默认包含子文件夹，可用 `includeSubfolders: false` 关闭。
- `tag`：匹配带有指定 tag 的文档。
- `property`：匹配 frontmatter 属性 `key` 等于 `value` 的文档（列表型属性
  命中任一元素即算匹配）。

`scope.workspaces` 控制跨知识库范围：省略表示只扫描该 VIEW 文档自身所在的
知识库（普通 VIEW 文档唯一会存的值）；`["*"]`（`ALL_WORKSPACES` 哨兵值）
表示当前用户可见的所有知识库；这个字段目前只在 Home 文档的编辑器里暴露，
普通知识库内的 VIEW 文档不提供跨库选项。

## 4. 卡片渲染规则

- `sort`：内置枚举（`updated_desc`/`updated_asc`/`created_desc`/
  `created_asc`/`title_asc`）或按 frontmatter 属性排序
  （`prop_asc:<key>` / `prop_desc:<key>`，缺属性的文档排到末尾）。
- `cover`：`first_image`（取文档首个图片附件或首个内联图片）、`none`
  （不显示封面）、或 `prop:<key>`（取 frontmatter 属性值作为图片来源，
  `attachments/...` 资源名会被解析为附件，否则当作 URL 直接用）。
- `cardFields`：卡片主/副两行文字，内置 token
  （`__title__`/`__updated__`/`__created__`）或 `prop:<key>`，空字符串表示
  该行不显示。
- `badges`：最多 3 条角标规则，按 `propertyKey == propertyValue` 匹配，
  第一条命中的规则生效。`kind: "tag"` 是左上角旗标样式且会让卡片整体
  灰度/降低不透明度（用于"已完成"类角标）；`"ribbon"` 是左上角折叠飘带；
  `"corner"` 是右上角对角飘带。

## 5. 编辑与预览

- 渲染：`web/src/components/GalleryView/GalleryViewRenderer.tsx`，按 doc
  type 分发（与 html/pdf 同一套分发机制，见
  [render-only-doc-types.md](render-only-doc-types.md)）。
- 编辑：`web/src/components/GalleryView/GalleryViewForm.tsx`，预置固定
  表单组件（非 schema 动态生成），编辑态与预览态共享同一份 content，
  重新进入编辑态时表单根据已存 JSON 回填。
- 查询执行：`useScopeMemos` hook + `fields.ts` 的 `matchesScope`/
  `propertyMap` 等辅助函数。

## 6. Explore 列表过滤

VIEW 类型文档统一在 `web/src/hooks/useMemoFilters.ts` 的
`FEED_EXCLUDED_DOC_TYPES` 里排除，与 html/pdf 是否出现在 feed 的判断在
同一处维护，不设两套并行逻辑，详见
[render-only-doc-types.md](render-only-doc-types.md#3-explore-feed-排除)。

## 7. 后续可迭代方向（不在当前范围）

- 若简介"单一 markdown 块"在实际使用中不够，`MarkdownBlock` 已比最初设想
  的"固定单槽位"更灵活，暂无进一步升级需要。
- 若配置复杂度继续增长，可评估从"预置组件硬编码"升级到
  `react-hook-form + zod`（与现有前端栈更贴合，优先于引入 Formily 等
  schema 驱动表单引擎）。
