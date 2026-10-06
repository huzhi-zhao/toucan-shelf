# 文档图标

每篇文档可以设一个 emoji 图标，替换掉按文档类型给的默认图标。

## 1. 能力范围

- **设置入口**：文档页（preview/edit）标题栏，标题前面的图标。点开是一个弹层：
  - 一组预置的常用 emoji；
  - 一个输入框，可以输入或粘贴任意系统 emoji（macOS ⌃⌘Space、Windows Win + .）。
    输入的是单个 emoji 就直接生效；输入别的内容，回车后提示"请只输入一个表情"；
  - 已经设过图标时多一个"恢复默认图标"。
- **只支持系统 emoji**：不支持上传图片，也不引入第三方 emoji 库或图标集。
- **所有文档类型都能设**：Markdown / HTML / PDF / VIEW / BLOGVIEW 都一样。
  设了就替换类型默认图标（所以设了之后在树上看不出文档类型），不设还是原来的默认图标。

## 2. 显示位置

原则：**原来哪里显示默认文档图标，设了 emoji 就在那里换成 emoji，本期不新增显示位置**。
唯一的新增是文档页标题栏，因为它就是设置入口。

| 位置 | 组件 |
| --- | --- |
| 文档页标题栏（新增，也是设置入口） | `Notebook/DocIconPicker` |
| 左侧文档树 | `Notebook/FileTreeNode` → `DocTypeIcon` |
| 知识库内搜索结果、Explore 搜索结果 | `LibrarySearchResults`、`ExploreSearchResults` |
| Explore / 列表卡片的标题行 | `MemoView/components/MemoHeader` |
| 文档嵌入（`![[]]`）的标题 | `MemoContent/Embed` |
| gallery view 里的文档块标题 | `GalleryView/GalleryViewRenderer` |
| References 区块的子文档卡片 | `MemoMetadata/Reference/SubDocCard` |
| 列表里的 PDF 文档卡片 | `PdfViewer/PdfDocCard` |

统一走 `components/DocIcon`：有 emoji 显示 emoji，没有就原样显示调用方传进来的默认图标。

## 3. 存储

存在 memo payload 的 `icon` 字段（`MemoPayload.icon`，API 上是 `Memo.icon`，
用 update_mask `icon` 写）。文档树节点（`WorkspaceTreeNode.icon`）和搜索结果
（`SearchHit.icon`）各带一份，免得列表再逐篇查。

不放标题里，也不放 frontmatter：

- **不放标题**：文档之间按标题引用（`[x](/folder/标题)`），emoji 放在标题里会进入
  引用路径、按标题定位和 memogit 文件名。
- **不放 frontmatter**：按文档设置的三层划分（frontmatter = 内容语义 /
  payload 里的 `doc_config` 等 = 应用里的展示 / localStorage = 读者偏好），
  图标属于第二层，和 `doc_config` 放在一起。

所以改图标和改文档设置一样：不产生版本、不更新"最后修改时间"、没有 memogit diff、
不重新向量化。

## 4. 校验

- 前端（`utils/docIcon.ts` `normalizeDocIcon`）：必须是**单个字形**，且是 emoji
  （pictograph、国旗或键帽），不能含字母。
- 服务端（`memo_icon.go` `normalizeMemoIcon`）只做兜底：去首尾空白，空串表示清除；
  ≤ 64 字节、合法 UTF-8、不含空白/控制字符/字母。不在服务端维护一份 Unicode emoji 表。

## 5. 明确不做

- memogit 不同步图标：检出的文件里看不到，推送正文也不会把它冲掉。
- MCP 不能改图标：它属于应用里的展示，不在 agent 可写字段白名单里。
- 不自动把旧文档标题开头的 emoji 迁移成图标，由用户自己设好后再改标题。
