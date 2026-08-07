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

| 域 | 覆盖 | 状态 |
|---|---|---|
| [storage/](storage/) | 数据源、持久化边界、容量与迁移承诺 | 1 篇 |

## 规划中的域

下列是已有功能、但尚未回写需求文档的方向。**先不建目录**，写到第 3 篇再收：

- `attachments/` —— md 附件：pdf 预览、私密文档、文档权限
- `agent-collab/` —— MCP、MCP OAuth、memogit
- `editor/` —— 自定义 Markdown 语法、加密块、sheets、大纲
- `knowledge-base/` —— workspace、目录树、排序、软删除
- `search/` —— RAG 混合检索、FTS

## 文档清单

### storage/

- [sqlite-as-sole-datasource.md](storage/sqlite-as-sole-datasource.md)
  —— 以 SQLite 为唯一数据源：为什么不上 postgres、三驱动的维护成本、
  sqlite 的容量边界与复评触发条件

### 根下平铺（不足 3 篇的能力）

- [cross-reference-repair-on-move-rename.md](cross-reference-repair-on-move-rename.md)
  —— 知识库内文档引用在移动/重命名/删除时的完整性维护（`knowledge-base` 域首篇）
