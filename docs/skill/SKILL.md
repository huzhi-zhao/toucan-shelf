---
description: 在 toucan shelf知识库中读取、编辑、移动、创作 markdown 文档(memogit检出本地目录或MCP在线协同创作)时,需遵守toucanShelf特殊语法：如frontmatter/callout/kanban/view/密文块等非标准语法
---

# toucan shelf 操作手册(核心)

toucan shelf 是 memos 的 fork:一条 memo = 一篇文档,挂在某 workspace 的
folder_path 下。你在本地看到的目录是 `memogit clone` 把服务器数据投影成的文件。

**核心心智模型**:文件是内容的唯一载体,但绝大部分元数据(doc_type、可见性、
同步哈希、关系)存在 `.memogit/sync-state.json`,不在文件内。

深入某个主题时按需读取 `references/` 下对应文件,不要假设自己已知道全部细节。

---

## 1. 文档身份标记(最容易踩的坑)

每篇文档末尾有一行:

```
<!-- memogit-id: memos/<uid> -->
```

(`.view.json` 则是顶层 `"memogit-id"` 键)

- **移动/重命名**:直接 `mv`,标记在文件里自然跟着走。**别用"复制内容到新文件+删旧文件"**——那样等于服务器上删除旧文档、新建一个空白文档,历史/评论/链接全部丢失。
- **新建文档**:不要自己编 ID,留空,push 后 memogit 自动写入。
- **绝不要删除/修改这一行**,也别在文件顶部加"memogit 头部"——第一个 `---` 块永远属于用户的 Obsidian frontmatter。

## 2. 可以改 / 不能改

| 对象 | 能不能改 |
|------|---------|
| `*.md` 正文、`*.html` | ✅ 主要工作面 |
| `*.view.json` | ✅ 但需保持合法 JSON,细节见 references/advanced-syntax.md |
| `*.pdf.md` | ❌ 生成的引用桩,push 会忽略 |
| `_attachments/**` | ❌ 只读下载,push 从不上传附件 |
| 文件路径/文件名 | ✅ = 移动/重命名文档,直接 `mv` |
| 末尾 `memogit-id` 行 | ❌ 见上 |
| `.memogit/**` | ❌ 同步状态账本,不要手改 |

**删除本地文件 = 归档服务器文档**(软删除,可恢复),不是硬删,但要清楚这个副作用。

## 3. 常见非标准语法

- **Frontmatter**:文件开头的 `---` 块,只认扁平字段(text/list/number/checkbox/date/datetime)。**不支持嵌套 YAML**,嵌套会被静默忽略,不报错。
- **Callout**:`> [!WARNING] 文本`,类型不区分大小写,支持 `[!TIP(💡)]` 自定义图标。块与块之间需要空行。
- **背景着色 `==text==`**:**不要主动写**。这是读者在 app 内选中文字生成的标记,不是作者写在源码里的东西。写死在正文会污染纯文本、干扰 diff,读者也无法一键取消。遇到已有的原样保留即可,要强调用加粗或 callout 代替。
- **内联图片引用 `![]()`**:不要改写,即使看起来"链接坏了"。改写会让 memogit 误判成本地编辑,制造假冲突。

## 4. 标题不要放标点

标题会被 slugify 成锚点 ID,供大纲跳转、评论定位使用。slugify 只保留字母/数字/空格,
标点会被剥掉。**只靠标点区分的标题会撞成同一个 slug**,纯标点标题则拿不到 ID。
批量改标题时把标点移出标题,别让锚点因为一次"润色"漂移。

## 5. 高亮和评论不在文件里

app 内的高亮/下划线/评论是独立的子 memo,**不写进 `.md` 正文,memogit 也不导出它们**。
所以文件看起来"干净"不代表没人标注过。**重写一段被标记的文字会静默摘掉该标记的高亮**
(文本锚点靠上下文定位,原文改了就找不回)。大规模改写正文前留意这个风险。

## 6. 需要更多细节时

- 处理 kanban 块、view.json 视图配置、密文块(`toucan-secret`)→ 读 `references/advanced-syntax.md`
- 执行 memogit push/pull、处理冲突(`.remote` 文件)→ 读 `references/sync-workflow.md`
- 遇到连接错误、clone 结果异常 → 读 `references/troubleshooting.md`
