# 迁移脚本

一次性把 `AI-Knowledge-Base`（Obsidian + Quartz）迁进 ToucanShelf 的 `AI_Handbook`
workspace。方案见 [../02-migration.md](../02-migration.md)。

只依赖 Python 3 标准库（无 requests）。对拍测试额外需要 `node`。

| 文件 | 作用 |
|---|---|
| `migrate.py` | 主脚本，四个子命令 |
| `slugify_port.py` | 平台标题锚点算法的 Python 复刻 |
| `test_slugify_port.py` | 与 TS 源实现的对拍测试 |

## 目录约定

| 角色 | 路径 |
|---|---|
| 源库（**全程只读**） | `~/Workspace/jimmy-pink/jimmy-zhz.github.io/AI-Knowledge-Base` |
| 工作目录（脚本产物） | `~/Workspace/kb-migration-work` |
| checkout（最终干净库） | `~/Workspace/MemoBase/AI_Handbook` |

工作目录刻意放在 `MemoBase/` **之外**：memogit 的 `listDocFiles` 只跳过 `_attachments/`
和点开头文件，其余一切都当文档处理——127 个 PNG 一旦进了内容树，就会变成 127 篇正文是
二进制乱码的「文档」。图片全程只存在于源库和工作目录里，不进 checkout。

## 前置条件

1. **计划 1 需求 B（S3 附件按 workspace 分目录）必须已部署到目标服务器**，否则这批
   附件会落进旧的公共前缀，迁完还得再搬一次。
2. 目标 workspace `AI_Handbook` 已在 web 端建好。
3. 有 PAT，且 `memogit` 已 login。

## 流程

先跑对拍测试。锚点算错等于全库内链失效，这一步不能省：

```bash
python3 test_slugify_port.py
```

### 第 1 步：只读盘点

```bash
python3 migrate.py plan
```

不发任何写请求。输出迁入/排除清单、附件上传计划、内链解析结果、将被剥壳的 HTML，
完整数据落在 `~/Workspace/kb-migration-work/inventory.json`。**第一次必须以此模式跑完
并人工看过。**

### 第 2 步：建文档骨架，换取 memo uid

```bash
python3 migrate.py stage
```

产出 `kb-migration-work/staged/`，正文里的 `![[...]]` / `[[...]]` **尚未转换**——这是
有意的，必须先有 uid 才能生成正确的 URL。脚本会硬校验内容树里只有 `.md`。

然后人工执行（脚本不代跑 memogit）：

```bash
cd ~/Workspace/MemoBase
memogit clone AI_Handbook          # 若尚未 clone
rsync -a ~/Workspace/kb-migration-work/staged/ ~/Workspace/MemoBase/AI_Handbook/
memogit status && memogit push
```

### 第 3 步：上传附件 + 回写正文

先 dry-run 看一遍，它会做上传大小体检、演算全部改写、但不发写请求：

```bash
python3 migrate.py attach \
  --state ~/Workspace/MemoBase/.memogit/state/AI_Handbook.json \
  --dry-run
python3 migrate.py report        # 看复核报告
diff -r <源库> ~/Workspace/kb-migration-work/final   # 抽查改写结果
```

确认无误后实跑：

```bash
export TOUCAN_SERVER=https://toucan.huzhi.dev
export TOUCAN_TOKEN=<PAT>
python3 migrate.py attach --state ~/Workspace/MemoBase/.memogit/state/AI_Handbook.json
```

**中断了直接重跑。** 幂等有两道保险：本地 `uploads.json` 清单每次上传后立刻落盘；
attachment id 由 `(文档路径, 图片路径)` 哈希决定，即便清单丢了，重复创建也会撞上
`attachment.uid` 的唯一约束而不是产生第二份附件。dry-run 写的是独立的
`uploads.dryrun.json`，不会污染实跑清单。

### 第 4 步：推送最终内容

```bash
rsync -a ~/Workspace/kb-migration-work/final/ ~/Workspace/MemoBase/AI_Handbook/
memogit status     # 应显示全部文档为「已修改」
memogit push
```

### 第 5 步：人工复核

```bash
python3 migrate.py report
```

报告在 `kb-migration-work/report.md`。重点看这几节：

- **锚点匹配不上，已降级**：预期 7 处。这 7 处在 Obsidian 里就已经是死链了（标题后来
  改名/加了章节编号，链接没跟着改），不是迁移搞坏的。
- **内链目标文档找不到**：预期 3 处，其中 `2.x 模型评估与调优` 这个文档根本不存在，
  `深度学习模型分类.canvas` 是不迁移的白板。
- **靠模糊匹配救回的锚点**：预期 2 处，需要抽查确实指对了。
- **源库自带的 `](#anchor)` 指不中**：预期 7 处，**原样迁入不改**，交作者自己处理。
- **被剥壳的 HTML**：预期 4 篇 17 处。
- **重复上传的图片**：预期 7 张。

### 收尾

把该 workspace 的换行设置改成 soft break（手动改）。源库是 CommonMark 语义，而平台默认
`remark-breaks` 把每个换行都变 `<br>`，不改会让所有段落排版变形。

## 设计上几个不能改的点

- **文档先行，附件后挂**。`Attachment` 消息里根本没有 workspace 字段，附件归属哪个
  workspace 完全由 `memo` 反推；未挂载的附件还只有创建者本人能访问。先传图再传文档，
  会让这批文档将来一公开、所有图片对访问者全部 403。
- **一图多引用就传多份**。共享同一个 attachment uid 的话，第二篇文档的图片能否显示
  会诡异地取决于**第一篇**的可见性设置。几十 KB 的重复存储换一个自洽的可见性模型。
- **图片 URL 必须是根相对形式** `/file/attachments/{uid}/{filename}`。渲染器的 sanitize
  schema 把 `src` 协议限制为 https，绝对的 `http://` URL 在本地开发或纯 HTTP 自建部署下
  会被整个剥掉。文件名里的括号必须转义，否则未转义的 `)` 会提前终止 markdown 链接语法。
- **一切替换都先避开保护区**（代码块、行内代码、数学公式、HTML 注释）。源库的 Python
  代码块里有 `[[ '列1','列2' ]]` 这种字面量，不避开就会被当成内链改写掉。
- **锚点只认 `#` 标题**，裸 HTML 的 `<h1 style=...>` 不参与。平台侧其实会给它们赋 id，
  但把「标题」永久绑在一段样式 HTML 上不是想要的形态；迁移后把那些 `<h1>` 改回
  `# 标题`，锚点自然就对了。
- **源库自带的 `](#anchor)` 存量死链只报告、不改**。加 `--fix-anchors` 才会动手。
