# 0007. memogit 文档身份用文件内标记，不用路径或内容配对

## Context

`memogit push` 需要判断一个本地文件相对于服务端的哪个 memo 是同一份文档，尤其
是在用户/AI 用 `mv` 移动或重命名了文件之后。早期实现按"路径 → uid"的 sidecar
索引反查身份：本地 `mv` 一个文件后，索引还指着旧路径，push 只能理解成"旧文档
消失 + 新文档出现"，于是把旧 memo 归档、新建一个新 uid，版本历史、评论、
reactions、分享链接和所有指向它的引用全部留在被归档的原文档上（详见
[memogit-doc-identity.md](../requirements/collaboration/memogit-doc-identity.md)
§1、§2）。

考察过的事后配对方案：

- **内容哈希配对**——"先改后移"和"先移后改"都会让内容对不上，配对失败。
- **git rename 检测**（如 `--find-renames`）——同样是相似度启发式，改动幅度大
  就失效。

两者本质都是事后猜测。而 memogit 的 sidecar 元数据模型（`.memogit/state/` 只存
机器可读元数据，文件正文只是用户自己的文档 body）意味着 sidecar 无法承载一个
"随文件走"的身份——它天生绑定的是路径，不是文件本身。

## Decision

文档身份写进文件内容，作为一个本地专用的标记：

- MARKDOWN / HTML / PDF 占位文件：文件**末尾**追加一行
  `<!-- memogit-id: memos/<uid> -->`。
- VIEW（`.view.json`）：作为 JSON 顶层对象的**第一个键**
  `"memogit-id": "memos/<uid>",`，跳过可选的 frontmatter 块之后插入。

约束：

- 只追加在文件**末尾**（或 JSON 内部），绝不出现在文件**开头**——第一个 `---`
  块永远保留给用户自己的 Obsidian frontmatter。
- 标记严格本地：push 前必须剥离，服务端 `content` 永远不包含它。
- `StripLocalID(InjectLocalID(x)) == x` 必须逐字节成立，所有哈希/上传路径都要
  先过 `StripLocalID`。

push 时按"文件自带标记优先 → 未跟踪的标记不采信 → 一个 uid 被两个文件认领算
复制、按基线路径判定正主 → 无标记退回路径索引 → 都不匹配算新文档"的顺序解析
身份，解析出的移动走 `MoveMemo`（只改 `folder_path`/`title`，uid 不变）。

## Consequences

- 移动/重命名不再产生一次误判的归档+新建，版本历史、评论、reactions、分享
  链接、被引用关系全部保留在原 uid 上。
- 老检出（没有标记的文件）需要一次性补写：`pull` 结束前跑 `ensureLocalIDs`，
  逐个文件检查标记缺失/错误就重写；这是常驻逻辑而非一次性迁移，用户手滑删掉
  标记也能自愈，代价是每次 pull 多一次小文件读取。
- 标记本身构成一种新的边界情况：手动复制文件会让两份文件带同一个标记，push
  需要显式处理"一个 uid 被两个文件认领"的情况（判定为复制，非基线路径的一份
  按新文档创建）。
- 两个文件互换路径仍会撞上服务端 `(workspace, folder_path, title)` 唯一约束，
  需要分两次 push；这是服务端约束决定的边界，标记方案没有也不需要解决它。
