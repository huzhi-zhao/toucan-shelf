# 层级模型与文档类型

## 1. 三层结构

```
workspace（知识库 / 项目）
 └── folder_path（斜杠分隔的路径前缀，如 garden/notes）
      └── document（一条 memo）
```

- **workspace** 是顶层容器，每篇文档属于且只属于一个 workspace。等价于语雀的知识库、
  Obsidian 的 vault。代码和 API 里叫 `workspace`，产品 UI 里叫"知识库"，
  历史文案里偶尔叫"项目"——**三者是同一个东西**。
- **folder_path** 只是**路径前缀**，不是需要 join 的行。`garden/notes/todo.md` 是一篇
  `folder_path == "garden/notes"` 的文档。因此：
  - 重命名/移动文件夹 = 对受影响行做一次前缀 `UPDATE`，一个事务完成。
  - **写入一个尚不存在的路径，文件夹就自动出现**，没有"创建文件夹"这一步。
  - 空文件夹（还没有文档）记录在单独的 `workspace_folder` 表里，所以它也能存在于树上。
- **唯一性约束**：`(workspace_id, folder_path, title)` 上有数据库索引。同一文件夹下
  不能有同名文档。**归档的文档仍然占着这个名额**——删掉一篇同名文档后不能立刻用同名新建，
  需要在网页端彻底删除。（文件夹删除不受此影响，判空只数未归档的文档。）

> 本 fork 里**不存在"未归档的散记"**。创建文档一定会解析出 workspace + folder_path；
> API 客户端省略时，服务端回落到调用者的**默认 workspace 根目录**。

## 2. 四种 doc_type

| `doc_type` | 可编辑 | 渲染方式 | 本地文件（memogit） |
|------------|--------|----------|---------------------|
| `MARKDOWN` | ✅ 完整编辑器 | Markdown 渲染器 | `<title>.md`，逐字的 Markdown 正文 |
| `HTML` | ✅ 仅源码 | 沙箱 `<iframe>`（`srcdoc`，禁用 same-origin） | `<title>.html`，原始 HTML 源码 |
| `PDF` | ❌ 只读预览 | pdf.js 查看器 | `<title>.pdf.md`，指向附件字节的**引用桩** |
| `VIEW` | ✅ 表单式 | 画廊渲染器，实时查询 | `<title>.view.json`，纯配置 JSON |

四种类型走**同一套"按 doc_type 派发渲染器"机制**。

几条容易踩的：

- **HTML 文档的内容存在 memo 自己的 `content` 字段里**，不是附件。上传 `.html` 是把
  文本读进新文档，不是挂文件。
- **PDF 文档由上传的文件字节支撑，没有可编辑正文**。本地 `.pdf.md` 是生成物，push 忽略它。
  要读 PDF 内容去 `_attachments/` 找字节（见 `attachments.md`）。
- **VIEW 文档的 content 只是配置**，从不存储渲染后的 HTML，每次打开实时渲染。
  它是组织节点不是内容笔记，因此**被排除在 Explore 信息流之外**。详见 `blocks-and-views.md`。
- **EPUB 不是 doc_type**。`.epub` 是普通附件，通过附件预览页打开阅读器。

## 3. 路径 ↔ 服务器映射（memogit 检出时）

```
<workspace 子目录>/<folder_path>/<title>.<ext>
```

- 服务器对 `(workspace, folder_path, title)` 强制唯一，所以**路径本身就是唯一地址**，
  文件名里不含 ID。
- **重命名/移动文件 = 重命名/移动服务器上的文档**（push 时体现，uid 不变）。
- **title 不带扩展名**。扩展名来自 `doc_type`，只在 memogit 落盘时追加。
  通过 MCP 创建时传 `plan.md` 会得到一篇字面名为 "plan.md" 的文档，
  memogit 再检出成 `plan.md.md`。

## 4. 文档属性 vs 文档设置（别混）

这是一条常被弄错的分界：

| | 存在哪 | 描述什么 | 改动影响 |
|---|--------|---------|---------|
| **frontmatter 属性** | 正文开头的 `---` 块 | 文档**内容语义**：日期、状态、分类、标签 | 会产生 diff / 版本；**会被画廊视图和看板消费** |
| **文档设置** | memo 记录上（`doc_config`） | 文档**怎么渲染**：全宽、是否显示大纲 / 文档树 / 属性面板 | 不改正文、不产生版本、不产生 memogit diff、不重建搜索索引 |
| **阅读偏好** | 浏览器 localStorage | 读者本人的、跨文档的偏好（如紧凑阅读） | 与文档无关 |

所以：用户说"把这篇文档设成不显示大纲"，那是 **⋮ → 文档设置**，不要去改 frontmatter。

### 保留的单选键

两个 key 有系统预设选项，命中时渲染成彩色 chip，写别的值也不会被拒绝，只是没有 chip：

| 属性 | 选项 |
|------|------|
| `status` | `created` / `in-process` / `done` |
| `priority` | `p0` / `p1` / `p2` / `p3` |

## 5. 归档

归档复用 memos 的 `row_status`，是**软删除**：文档移出工作树但从不真正删除，可恢复。
- 本地删文件 → push 归档该文档。
- MCP 的 `state` 字段允许归档——这是 agent 唯一能让文档"看起来消失"的方式，
  但它不销毁任何东西，一键可撤销。
- 归档文档仍占用 `(folder_path, title)` 唯一名额。

## 6. 只同步你自己的文档

memos 的可见性模型允许任何登录用户读别人的 `PROTECTED` / `PUBLIC` 文档。
memogit 的 `clone`/`pull` 因此**刻意只抓 `creator == 你`** 的文档——别人共享的文档
不会灌进本地库（你也 push 不回去）。所以本地看不到某篇文档，可能只是它不是你创建的。
