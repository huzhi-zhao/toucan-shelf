# requirements/ —— 要做什么

常青文档。每篇回答"这块能力要做成什么样、依据是什么"，随系统演进**原地改写**，
不留 v1/v2 痕迹。方案怎么落地属于 [../design/](../design/)，选型取舍属于
[../adr/](../adr/)。

## 建域规则

- **域按用户能感知的能力切**，不按代码包切。
- **准入是"已经有 ≥3 篇"**：只有一两篇的能力就平铺在本目录根下，
  够 3 篇再收进域目录。不预建空目录。
- 一篇只属于一个域。跨域的（比如 memogit 既是 agent 协作又碰存储）
  按**它主要回答谁的问题**归域，另一域在正文里链过去。

## 现有域

| 域 | 覆盖 | 篇数 |
|---|---|---|
| [knowledge-base/](knowledge-base/) | 层级目录、workspace、知识库详情页与书架、文档版本历史 | 3（另有 1 篇同域文档暂平铺根下，见下） |
| [views/](views/) | html/pdf/view 三类渲染型文档、gallery view | 2 |
| [editor/](editor/) | calendar 块、sheets 块、secret 加密块、受限内联样式渲染 | 4 |
| [attachments/](attachments/) | 上传与媒体内联、访问控制与私密附件 | 2 |
| [collaboration/](collaboration/) | memogit 同步、memogit 文档身份、MCP 协作写作、团队成员与知识库授权 | 4 |
| [storage/](storage/) | 数据源、持久化边界、容量与迁移承诺、全站备份 | 2 |

## 规划中的域

- `search/` —— RAG 混合检索、FTS。目前唯一一篇（[rag-search.md](../rag-search.md)）
  未满 3 篇准入线，平铺在 `docs/dev/` 顶层而非 `requirements/` 下。

## 文档清单

### knowledge-base/

- [hierarchy-and-workspaces.md](knowledge-base/hierarchy-and-workspaces.md)
  —— 层级目录与 workspace 的组织方式
- [workspace-detail-and-shelf.md](knowledge-base/workspace-detail-and-shelf.md)
  —— 知识库详情页与书架
- [document-versioning.md](knowledge-base/document-versioning.md)
  —— 文档版本历史

### views/

- [gallery-view.md](views/gallery-view.md) —— gallery 视图布局与配置
- [render-only-doc-types.md](views/render-only-doc-types.md)
  —— html/pdf/view 三类渲染型文档

### editor/

- [calendar-block.md](editor/calendar-block.md) —— calendar 交互块
- [sheets-block.md](editor/sheets-block.md) —— sheets 交互块
- [secret-block.md](editor/secret-block.md) —— 加密块
- [inline-style-rendering.md](editor/inline-style-rendering.md) —— 受限内联 style 渲染

### attachments/

- [upload-and-inline-media.md](attachments/upload-and-inline-media.md)
  —— 上传与媒体内联
- [access-control-and-private-files.md](attachments/access-control-and-private-files.md)
  —— 访问控制与私密附件

### collaboration/

- [memogit-sync.md](collaboration/memogit-sync.md) —— memogit 同步
- [memogit-doc-identity.md](collaboration/memogit-doc-identity.md)
  —— memogit 文档身份与移动语义
- [mcp-authoring.md](collaboration/mcp-authoring.md) —— MCP 协作写作
- [workspace-member-access.md](collaboration/workspace-member-access.md)
  —— 团队成员与知识库授权

### storage/

- [sqlite-as-sole-datasource.md](storage/sqlite-as-sole-datasource.md)
  —— 以 SQLite 为唯一数据源：为什么不上 postgres、三驱动的维护成本、
  sqlite 的容量边界与复评触发条件
- [backup.md](storage/backup.md) —— 全站 SQLite 数据库备份

### 根下平铺（同域文档不足 3 篇或跨域，暂不收进目录）

- [cross-reference-repair-on-move-rename.md](cross-reference-repair-on-move-rename.md)
  —— 知识库内文档引用在移动/重命名/删除时的完整性维护（`knowledge-base` 域相关）
