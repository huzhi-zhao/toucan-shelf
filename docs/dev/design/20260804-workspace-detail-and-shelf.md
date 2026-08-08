# 优化需求：知识库详情页 + 书架排序/标题截断

日期：2026-08-04
范围：知识库（workspace）管理入口重构、新增知识库详情页、软删除（隐藏）、书架手动排序、书名截断

> 迁移注记：对应需求见
> [../requirements/knowledge-base/workspace-detail-and-shelf.md](../requirements/knowledge-base/workspace-detail-and-shelf.md)。

---

## 1. 背景与目标

当前知识库的管理动作全部塞在 Notebook 左上角 `WorkspaceSelector`
（[WorkspaceSelector.tsx](../../../web/src/components/Notebook/WorkspaceSelector.tsx)）的齿轮下拉菜单里：
new workspace / rename workspace / delete / open in new tab / change cover / sort by / go to bookshelf。
菜单既是「当前知识库的设置」又是「全局知识库管理」，职责混杂，且 delete 是不可逆的物理删除。

目标：
1. 齿轮菜单瘦身，把知识库级别的管理动作收敛到一个**知识库详情页**。
2. 详情页以书籍样式预览封面，聚合展示信息并提供全部管理功能。
3. 删除改为**可恢复的隐藏（软删除）**，本阶段不提供物理删除。
4. 新增**手动排序下标**，固定书本在书架上的位置，强化肌肉记忆（明确不做拖拽排序）。
5. 书架上过长书名以 `...` 截断。

---

## 2. 需求明细

### 2.1 齿轮菜单改动（Notebook 左上角）

移除：`new workspace`、`rename workspace`、`delete`。

新增：`知识库详情`（View details），点击进入详情页。

保留：`open in new tab`、`change cover`、`sort by`（文档树排序，属于当前知识库的浏览设置）、`go to bookshelf`。

> 说明：`change cover` 在详情页也会提供，两处共用同一批 Dialog 组件
> （[WorkspaceCoverDialogs.tsx](../../../web/src/components/Notebook/WorkspaceCoverDialogs.tsx)），不重复实现。

### 2.2 知识库详情页

形态：**独立页面**，路由 `/shelf/:workspaceUid`（而非弹窗）。理由：内容量大（封面预览 + 统计 + 多个管理动作），
且需要可分享/可刷新的 URL；详情页也可以从书架点击书本的「详情」入口进入。

展示内容：
- 书籍样式封面预览（复用书架 spine/封面渲染，尺寸放大；建议抽出 `BookSpine` 组件供书架与详情页共用）
- 标题、创建时间、更新时间、创建者
- 统计：文档数、文件夹数（可由 `GetWorkspaceTree` 现有接口在前端汇总，不必新增后端字段）
- 当前排序设置、隐藏状态、排序下标

提供操作：
- **Rename**：复用 `PromptDialog` + `UpdateWorkspace(update_mask=["title"])`
- **New workspace**：新建后跳转到新知识库详情页
- **Set cover**：颜色 / 图片，复用现有 Dialog
- **Order 排序**：数字输入框，手动设置下标
- **Delete（隐藏）**：二次确认，文案明确说明「隐藏后可恢复，数据不会丢失」

### 2.3 软删除（隐藏 / 恢复）

- 新增 `hidden`（或 `state`）标记。默认可见。
- 隐藏后：书架默认不展示；Notebook 的知识库下拉不展示；若当前正打开该知识库则跳回书架。
- 恢复入口：书架页提供「显示已隐藏」开关，隐藏的书以半透明/灰度呈现，可「取消隐藏」。
- 物理删除本阶段不提供。现有 `DeleteWorkspace` RPC（要求知识库为空）**保留但前端不再调用**。

### 2.4 Order 手动排序

- 新增 `display_order` 整数字段，默认 0。
- 书架排序规则：`display_order ASC, created_ts ASC`（下标相同时按创建时间兜底，保证稳定）。
- 明确不做拖拽排序；只在详情页用数字输入设置。
- 不要求下标唯一、不要求连续；重复值由兜底规则决定先后。

### 2.5 书架书名截断

- 书脊标题过长时以 `...` 结尾。
- 现状：[Bookshelf.tsx:70](../../../web/src/pages/Bookshelf.tsx) 已用 `line-clamp-1`，理论上会出省略号；
  需先复现确认失效原因（大概率是长英文/无空格串未 `break-all`，或父容器缺 `min-w-0` 导致不收缩）。
- 同时检查 Notebook 顶部 `SelectValue` 的 `truncate` 是否实际生效。

---

## 3. 技术方案

### 3.1 数据层

`workspace` 表新增两列，沿用 `cover_color` 的迁移范式（三套驱动各加一份）：

```
store/migration/{sqlite,postgres,mysql}/0.30/11__workspace_display_order_and_hidden.sql
ALTER TABLE workspace ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspace ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;   -- postgres: BOOLEAN / mysql: TINYINT
```

同步更新三份 `LATEST.sql`。

`store/workspace.go`：`Workspace`、`UpdateWorkspace` 增加 `DisplayOrder`、`Hidden`；`FindWorkspace` 增加
`Hidden *bool` 以支持「只查可见」。
`store/db/*/workspace.go`：`ListWorkspaces` 的 `ORDER BY created_ts ASC` 改为
`ORDER BY display_order ASC, created_ts ASC`；INSERT/SELECT/UPDATE 补列。

### 3.2 API 层

`proto/api/v1/workspace_service.proto` 的 `Workspace` 增加：

```
int32 display_order = 11;
bool hidden = 12;
```

`ListWorkspacesRequest` 增加 `bool show_hidden = 1;`（默认 false，只返回可见）。

`server/router/api/v1/workspace_service.go`：
- `UpdateWorkspace` 的 update_mask 分支增加 `display_order`、`hidden`
- `ListWorkspaces` 按 `show_hidden` 过滤
- `convertWorkspaceFromStore` 补两个字段
- 重新生成 proto（`buf generate` / 项目现有生成脚本），前端 `web/src/types/proto` 随之更新

**注意隐藏的连带影响**：需要排查隐藏的知识库是否应从以下场景中排除——
Explore feed、RAG 搜索（`rag_search`）、MCP `workspace_list_workspaces`、全局搜索、附件浏览。
建议本期策略：**列表类入口一律排除隐藏库；按 UID 直接访问仍可读**（否则恢复流程本身会失效）。

### 3.3 前端

- 新增 `web/src/pages/WorkspaceDetail.tsx`，在 [router/index.tsx](../../../web/src/router/index.tsx) 注册
  `Routes.SHELF + "/:workspaceUid"`。
- 从 [Bookshelf.tsx](../../../web/src/pages/Bookshelf.tsx) 抽出 `BookSpine` 组件（书架卡片 + 详情页大图共用）。
- `WorkspaceSelector` 删除 3 个菜单项与对应的 `PromptDialog` / `useDeleteWorkspace` 使用，新增详情入口。
- `useWorkspaceQueries` 增加 `useHideWorkspace` / `useSetWorkspaceOrder`（都是 `UpdateWorkspace` 的薄封装），
  移除对 `useDeleteWorkspace` 的引用（hook 本身可保留）。
- i18n：新增文案键，至少覆盖 `zh-Hans` 与 `en`。

---

## 4. 成本评估

| 模块 | 内容 | 估时 |
|---|---|---|
| DB 迁移 | 3 驱动 migration + 3 份 LATEST.sql | 0.5h |
| store 层 | 字段、Find/Update、ORDER BY | 0.5h |
| proto + 生成 | 2 字段 + show_hidden + 重新生成 | 0.5h |
| service 层 | update_mask 分支、过滤、convert | 1h |
| 隐藏的连带排查 | Explore / RAG / MCP 等列表入口 | 1h |
| 详情页 | 新页面 + BookSpine 抽取 + 各动作接线 | 3h |
| 书架 | 排序、显示隐藏开关、标题截断 | 1.5h |
| Selector 瘦身 | 菜单改造 | 0.5h |
| i18n + 自测 | | 1h |

合计约 **9.5～10 人时**，可在一个工作日内完成。

---

## 5. 可行性

高。所有改动都落在已有范式上：
- 加列 → 与 `cover_color`、`folders_first`、`storage_slug` 完全同构
- update_mask 新分支 → 现成的 if-else 链
- 新页面 → 路由与 lazy 加载已就绪
- 封面渲染 → 书架已有实现，只需抽组件

没有新的第三方依赖、没有数据结构重构、没有破坏性 schema 变更（两列均有默认值）。

---

## 6. 风险

| 风险 | 等级 | 说明与对策 |
|---|---|---|
| 隐藏语义泄漏 | **中** | 隐藏库若仍出现在 Explore / RAG / MCP 结果中，用户会认为「隐藏没生效」。必须逐个入口排查，见 3.2。 |
| 恢复入口不可达 | 中 | 若书架也一并隐藏且无开关，知识库将永久不可达。必须先实现「显示已隐藏」开关，再开放隐藏功能。 |
| 多驱动迁移不同步 | 中 | sqlite/postgres/mysql 三份必须同时改，漏一个会在切换驱动时炸。布尔列在三种数据库的类型不同。 |
| proto 生成物漂移 | 低 | 需确认生成器版本与仓库现有生成物一致，否则会产生大片无关 diff。 |
| 附件存储不受影响 | 低 | 隐藏不改 `storage_slug`，对象键不受影响；这也是不做物理删除的又一理由。 |
| 排序下标语义模糊 | 低 | 不唯一、不连续。用兜底排序保证稳定，UI 上提示「数字越小越靠前」。 |
| 遗留 DeleteWorkspace | 低 | RPC 保留但前端不再调用；需在 proto 注释里标注「暂不在 UI 暴露」，避免后来者误接。 |

---

## 7. 实施顺序建议

1. DB 迁移 + store 层 + proto + service（后端一次性打通，`go test` 验证）
2. 书架排序 + 标题截断（低风险，先出效果）
3. 详情页（含 BookSpine 抽取）
4. 隐藏功能：**先做书架的「显示已隐藏」开关，再开放隐藏动作**
5. Selector 瘦身（放最后，确保详情页已可用再撤旧入口）
6. 隐藏语义的连带入口排查

---

## 8. 已采用的默认决策（无需确认，如有异议再调整）

- 详情页做成独立路由页面而非弹窗
- 软删除字段命名为 `hidden`（布尔）而非 `state` 枚举，本期只有两态
- `display_order` 允许重复，按 `created_ts` 兜底
- 现有 `DeleteWorkspace` RPC 保留，仅从 UI 移除
- 隐藏库仍可通过 URL 直接访问（否则无法恢复）
