# memogit —— 本地文件通道

memogit 借用 git 的词汇（`clone` / `pull` / `push` / `status`），但**不是 git 网络协议**，
而是"数据库 ↔ 本地文件"的桥。版本历史交给它替你初始化的**本地 git 仓**（无 remote）。
命令都在检出根目录跑（子目录也行，它会向上找 `.memogit/`）。

---

## 1. 检出目录长什么样

```
my-kb/                        ← 检出根（只放元数据）
├── .memogit/
│   ├── config.yaml           ← 服务器 URL、token、已 clone 的 workspace（chmod 600，git 忽略）
│   ├── state/<workspace>.json ← 每个知识库一份同步基线（ID ↔ 路径、哈希、可见性、附件…）
│   └── toucanshelf-guide.md  ← 给代理看的手册（clone/pull 时写入）
├── .git/                     ← 真实本地 git 仓，快照用
├── .gitignore                ← 忽略 config.yaml（含 token）与 *.remote
├── AGENTS.md / CLAUDE.md / .cursor/rules/   ← 代理入口简报
└── Default/                  ← 内容树，子目录名 = workspace 标题
    ├── AGENTS.md / CLAUDE.md ← 同一份简报（在库内启动的代理会读到）
    ├── garden/notes/todo.md
    ├── page.html
    ├── papers/attention.pdf.md
    ├── dashboards/all.view.json
    └── _attachments/<附件 uid>/attention.pdf
```

- **一个检出根可以放多个知识库**，各占一个子目录，各有自己的 state 文件，
  共用一份凭据和一个 git 仓（一条提交历史横跨全部）。
- **子目录名在 clone 时固定**，服务器上重命名 workspace 不会改它（改了会移动全部文件、
  破坏 git 历史）。绑定靠的是 workspace **id** 不是标题。
- `AGENTS.md` / `CLAUDE.md` / `.cursor/` 是 memogit 生成的，**不是知识库文档**，
  push 会跳过。要写自己的项目规则，写在 `<!-- BEGIN memogit -->` 块**外面**——
  块外的内容在重新生成时会保留。
- **稀疏检出**：`clone <库> --sparse-checkout <文件夹> --dir <目录>` 只映射一个文件夹，
  且**本地把该前缀剥掉**（服务器 `Home/Journal/2024.md` → 本地 `Journal/2024.md`），
  push 时自动补回前缀。这种检出是独立根，`.memogit/` 在它自己里面。

## 2. 文档身份标记（最容易踩的坑）

| doc_type | 标记形式 | 位置 |
|----------|---------|------|
| `MARKDOWN` / `HTML` / `PDF` | `<!-- memogit-id: memos/<uid> -->` | 文件**最后一行** |
| `VIEW` | `"memogit-id": "memos/<uid>",` | JSON 对象的**第一个键**（文件仍是合法 JSON） |

**为什么存在**：一篇文档下面挂着版本历史、评论/批注、reactions、分享链接，还可能被
其他文档引用——这些全绑在 memo uid 上，**不在文件里**。如果 push 靠"路径"认文档，
你 `mv` 一下就会被理解成"旧文档没了 + 新文档出现"：旧文档连同全部历史被归档，
新文档从零开始，指向它的链接全断。有了身份标记，`mv` 就是服务器上的一次**真正移动**。

规则：

- **移动/重命名**：直接 `mv`（或 `git mv`）。标记在文件里，自然跟着走。
  **别做"复制内容到新文件 + 删旧文件"。**
- **编辑**：正常改正文，别碰这一行。**改内容和移动可以同时做**，顺序无所谓。
- **新建文档**：**不要**自己编 ID，留空即可，push 创建后 memogit 自己写进去。
- **复制文档**：副本会带着原文档的 ID。memogit 会认出"留在原位那份是正主"，
  副本按新文档创建——但更稳妥的做法是复制后**手动删掉副本里那一行**。
- **不小心删了标记**：不会丢数据。push 退回按路径识别并打印提示，跑一次 `pull` 就补回来。
- **绝不要在文件顶部加 memogit 头部**——第一个 `---` 块永远属于用户的 frontmatter。

> 标记**只存在于本地文件**：push 时会被剥掉，服务器正文永远不含它；
> 它也不参与"文件是否被修改"的判断，所以补写标记不会被当成一次编辑。

## 3. 命令

| 命令 | 作用 |
|------|------|
| `memogit status [库名]` | **只读**。列出待 push 的本地改动、待 pull 的远端改动、冲突，外加本地 git 工作区的未提交条目数 |
| `memogit pull [库名]` | 拉下服务器变更，与本地对账，做一次 git commit，并下载新增/变化的附件 |
| `memogit push [库名]` | 推送本地改动；**`--dry-run` 只打印计划不发送** |
| `memogit clone [库名]` | 首次检出某 workspace（本地一般已 clone 好） |
| `memogit workspaces`（别名 `ws`） | 列出账号下的知识库及本地检出状态 |
| `memogit agents` | 只重写代理简报文件，不联网 |

不带库名时对检出里的**每个**知识库依次执行。

### push 的行为（建议先 `push --dry-run` 看计划）

| 情况 | push 做什么 |
|------|------------|
| 新本地文件 | 建 memo（`+`），从路径/扩展名推导 folder_path/title/doc_type，可见性默认 **PRIVATE** |
| 改了跟踪文件、服务器未变 | 更新内容（`~`，`update_mask=[content]`） |
| **移动/重命名了跟踪文件** | **就地移动**该 memo（`→`），uid 不变，历史/评论/链接全保留 |
| 移动 + 同时改了内容 | 两件事都做（`→` 再 `~`），先后顺序无所谓 |
| **两边都改** | **冲突**（`⚠`）——保留你的文件，服务器版写到 `<path>.remote` 待合并 |
| 本地删了跟踪文件 | **归档**该 memo（`-`，软删除，可恢复，绝不硬删） |
| PDF 桩 & 下载的附件 | 忽略（生成物 / 只读下载） |
| `AGENTS.md` / `CLAUDE.md` | 跳过——**除非**该路径本来就是一篇已跟踪的文档（老知识库里可能真有一篇叫 AGENTS 的文档，那篇照常同步） |

覆盖前 push 会**重读服务器副本**，若它自上次同步后也变了，该文件转为冲突，
两边都不被覆盖。成功后更新基线并做一次 git commit。

### pull 的行为

| 情况 | pull 做什么 |
|------|------------|
| 服务器新增 | 写入文件（`+`） |
| 服务器改了、本地没改 | 覆盖文件（`~`），folder/title 变了就顺带移动 |
| **两边都改** | **冲突**（`⚠`），同上写 `.remote` |
| 本地文件被删 | 跳过（`!`），留给将来的 push 解决 |
| 服务器删除/归档 | 删除本地文件（`-`）及其附件；**若本地有未推送的编辑则保留**并报告 |

## 4. 冲突解决（`.remote` 副本）

memos 是 REST 不是 git remote，`git fetch` 拿不出 "theirs"，所以 memogit 把
**服务器版本**物化成 `<path>.remote` 放在你文件旁边（这些副本被 git 忽略）。

1. 对比 `foo.md`（你的）与 `foo.md.remote`（服务器的），把 **`foo.md`** 编成要的合并结果。
2. **删掉 `foo.md.remote`** —— 它的消失就是"已解决"的信号。
3. 跑 `memogit push`。只要服务器没再变，就推送合并后的 `foo.md` 并推进基线；
   若服务器又变了，会写一份新的 `.remote`，再合并一次。

**`.remote` 存在期间，push 视该文档为未解决冲突并跳过。**

## 5. 实操建议

1. **搜索**：普通 `grep` / ripgrep 完全可用，这就是检出到本地的意义。
   frontmatter 属性、标签、callout 类型都能直接文本匹配。
2. **改正文**：像改普通 Markdown 一样改，但守住定制语法（见 `markdown-syntax.md`、
   `blocks-and-views.md`）和能改/不能改的边界。
3. **移动/重命名**：直接改路径 = 移动服务器文档，历史/评论/分享链接/引用关系全跟着走。
   注意 `(folder_path, title)` 唯一性，别撞名（归档文档也占名额，见
   `hierarchy-and-doc-types.md` §1）。副作用：被移动文档正文里的相对链接会被固化成
   库根相对形式（`document-links.md` §5），服务端自己做，别手工模拟。
4. **frontmatter 改动有涟漪**：改了某文档的 `status`/`tags`/自定义属性，
   可能改变消费它的画廊视图或看板分组。跨文档改属性前扫一眼有没有 `.view.json` 在用。
5. **收尾三步**：改完 → `memogit status` → `push --dry-run` → `push`。
   冲突走 `.remote` 合并。

## 6. 已知限制

- **附件上传未实现**（下载是单向的）。需要加/换附件请让用户在 app 里做。
- **关系写回未实现**（v1 只读导出）。
- **只同步你自己的文档——但管理员例外**：普通用户的 clone/pull 只抓 `creator == 你`，
  别人共享的 PROTECTED / PUBLIC 文档不会进本地库，也 push 不回去。**管理员账号的 token
  不按作者过滤**：服务器按 workspace 角色而不是作者判写权限，管理员能改库里任何文档，
  所以管理员 checkout 覆盖整个 workspace，包括别人（或用户自己另一个账号、某个 agent 的
  token）建的文档。本地找不到某篇文档，可能只是它不是当前 token 创建的——先确认这个
  token 是不是管理员。

## 7. 排障速查

**`connection refused`** —— `--server` 指向了**前端**端口。memogit 必须打**后端**端口
（开发环境常见：Vite 前端 3001，memos 后端 8081）。

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -i memos
```

找到后端端口后重新 `memogit login --server … --token …`（会覆盖 `.memogit/config.yaml`）。
先确认连通性：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/api/v1/workspaces \
  -H "Authorization: Bearer memos_pat_xxxxxxxx"     # 期望 200
```

**`Cloned 0 memos`** —— workspace 解析成功但没匹配到文档。可能文档还没归到该 workspace，
或用的是 2026-07-16 之前的旧二进制（creator 过滤有 bug，需从源码重建）。

**检出里没有 `AGENTS.md` / `CLAUDE.md`** —— 检出早于这个特性，或被删了。
在检出根跑 `memogit agents`（不联网）。若某个目录仍是空的，看命令输出：
memogit 拒绝覆盖属于你自己文档的路径，并会说明。
