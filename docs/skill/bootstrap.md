# 在仓库里接入 ToucanShelf 知识库

这份说明写给 AI agent。服务器把它发布在 `<服务器>/memogit/bootstrap.md`，应当在安装 memogit、下载知识库**之前**读。
读完你应该知道：一个仓库怎样接入知识库，每次会话会自动发生什么，出错时怎么处理。

## 1. 这是什么，为什么要这样接

- **ToucanShelf** 是一个层级知识库：知识库 → 文件夹 → 文档。服务器是唯一的数据源。
- **memogit** 是它的本地命令行工具。它把知识库检出成仓库里的 Markdown 文件（默认放在 `kb/`），改完再推回服务器。
- **memogit 由服务器发布**：服务器部署的是哪个版本，就发布同一个版本编出来的 memogit。所以每次都从服务器装，不要在仓库里提交二进制，也不要自己从源码编译。版本不一致会让功能和手册对不上，后果是悄悄漏同步。
- **拉取和推送由 hook 自动完成**，不需要你每次手动执行，以保证"知识库没就绪就不开工"。你负责看懂状态，出问题时告诉用户。
- **不要绕过**：知识库没就绪时，不要改用 MCP、网页或其他途径读写知识库内容。

## 2. 接入一个仓库（一次性）

用户让你"把这个仓库接入 ToucanShelf"时，按下面做。服务器地址以环境变量 `TOUCANSHELF_SERVER` 为准，下文写作 `<服务器>`。

### 2.1 仓库里要有的四样东西

**`memogit.conf.yaml`**（放在仓库根目录），列出要拉哪些知识库。问清用户要哪几个库，`desc` 用一句话写清每个库里有什么、什么时候该去看：

```yaml
knowledge_bases:
  - name: Career              # 服务器上的知识库标题，不区分大小写
    desc: 职业规划、简历与面试准备
  - name: SideProjects
    desc: 个人项目的设计与开发记录
    attachments: false        # 只拉文字，快很多；clone 时固定
    folders:                  # 可选：只检出这些目录（含子目录），不写就是整库
      - CMOP                  #   → kb/SideProjects/CMOP/...
      - Infra/Deploy          #   → kb/SideProjects/Infra/Deploy/...
    # filter: '"work" in tags'  可选：CEL 过滤
    # enabled: false            可选：暂时不拉，不用删掉这一项
# dir: kb                     可选：检出根的位置，默认 kb
```

用户只要某个库里的一部分目录时，用 `folders`：

- 目录名要和服务器上的写法**完全一致，区分大小写**。名字写错不会报错，只会在检出时提示"没匹配到任何文档"。
- 本地路径和服务器一致，只是只拉列出的目录；其余目录不在本地，指向它们的链接在本地打不开。
- 新文档只能建在这些目录里。建在别处，push 会跳过并说明原因。
- 改 `folders` 不用重新检出：下次同步时自动补拉新加的目录、删掉去掉的目录（有没推送的修改的文件会保留）。
- 不要写 `sparse`，这里不支持，会直接报错。

**`.claude/settings.json`**：两个 hook。文件已存在时，把这两项合并进去，不要覆盖别的设置：

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "curl -fsSL \"$TOUCANSHELF_SERVER/memogit/install.sh\" | sh -s -- hook session-start", "timeout": 900 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "memogit hook stop", "timeout": 300 }] }
    ]
  }
}
```

**`.gitignore`**：加一行 `kb/`。检出根里的 `.memogit/config.yaml` 存着 token，绝不能提交。

**根目录 `CLAUDE.md`**（仓库用 `AGENTS.md` 就写在那里）：加下面这段，把 `<服务器>` 换成实际地址。
这段必须写在仓库里，因为服务器连不上时你拉不到这份说明，这时它是唯一的指引：

```markdown
<!-- BEGIN toucanshelf -->
## ToucanShelf 知识库

本仓库通过 memogit 使用 ToucanShelf 知识库，检出在 `kb/`（不进 git）。会话开始时，SessionStart hook 会同步知识库，并输出一段以 `memogit:` 开头的状态。

- 没看到这段状态，说明 hook 没运行或服务器连不上：停下来告诉用户，不要读写 `kb/`，也不要改用 MCP 等其他途径。
- 状态以 ⛔ 或 ⚠ 开头时，照状态里的说明处理。
- 接入和排查说明：<服务器>/memogit/bootstrap.md
<!-- END toucanshelf -->
```

### 2.2 仓库外的配置：你做不到，要逐条告诉用户

| 配置 | 本机 | 云端（claude.ai/code） |
| --- | --- | --- |
| `TOUCANSHELF_SERVER`、`TOUCANSHELF_PAT` | 写进 shell 配置文件（如 `~/.zshrc`） | 环境设置 → Environment variables |
| 网络放行 | 不需要 | 环境设置 → Network access 选 Custom，加上服务器域名，并勾选保留默认列表 |

- `TOUCANSHELF_PAT` 是用户在 ToucanShelf 网页上生成的 Personal Access Token，形如 `memos_pat_...`。**不要让用户把它发给你**，也不要写进任何会提交的文件。
- 桌面 App 启动的进程不一定读得到 `~/.zshrc`。可以让用户在自己的终端里，于仓库根目录跑一次：`curl -fsSL "$TOUCANSHELF_SERVER/memogit/install.sh" | sh -s -- sync`。成功后 token 会存进 `kb/.memogit/config.yaml`，之后不依赖环境变量。
- 你写 `.claude/settings.json` 时可能被权限拦下。这时把上面的完整内容给用户，请用户自己建。

### 2.3 验证

请用户新开一个会话。开头应该出现 `memogit: 知识库就绪`，后面是库清单。

## 3. 每次会话自动发生什么

1. **SessionStart**：`install.sh` 对比本机 memogit 和服务器发布的版本，不一致就下载、校验后替换，然后执行 `memogit hook session-start`。
2. **`hook session-start`**：按 `memogit.conf.yaml` 处理每个库，没检出过的 clone，已有的 pull；然后输出状态，这段状态会自动进入你的上下文。
3. **你工作**：直接改 `kb/` 下的文件。规则见下面第 5 节的手册。
4. **Stop**（每轮结束）：`memogit hook stop` 推送全部改动。有没推上去的，会把明细交给你处理。

## 4. 状态和报错怎么处理

| 你看到的 | 含义 | 你要做的 |
| --- | --- | --- |
| `memogit: 知识库就绪` | 全部库已同步 | 正常工作 |
| `⚠ memogit: 部分知识库未就绪` | 有的库失败 | 告诉用户哪些库失败、原因；只在已同步的库里工作 |
| `⛔ memogit: 知识库未就绪` | 全部失败，或配置有问题 | 停下来告诉用户原因，按下面几行排查 |
| 没有任何 `memogit:` 状态 | hook 没运行：没配 hook、没设 `TOUCANSHELF_SERVER`，或服务器连不上 | 停下来告诉用户，按第 2 节检查 |
| 原因里有 `TOUCANSHELF_SERVER` / `TOUCANSHELF_PAT` | 环境变量没配 | 按 2.2 指导用户配置 |
| 401 / Unauthenticated | token 无效或过期 | 请用户在网页上重新生成 token |
| 403 / Forbidden | 请求被拦截 | 云端：网络白名单没放行服务器域名。响应头里有 `cf-ray`：Cloudflare 拦了机房 IP，需要用户在 Cloudflare 后台放行 |
| 404（`version.json`） | 服务器还没部署 memogit 分发 | 已装过 memogit 的话，会继续用旧版并给出提示；没装过就告诉用户 |
| 库后面写着"只检出了 …" | 这个库配了 `folders`，只有这些目录在本地 | 只在这些目录里读写；要别的目录，请用户加进 `folders` |
| 有 N 篇冲突，见 `*.remote` | 服务器和本地都改了 | 按手册的冲突流程合并：改好本地文件，删掉 `.remote`，下一轮会自动推送 |
| Stop 时报"跳过"某个文件 | 服务器上这篇已归档或删除 | 问用户是恢复服务器上的文档，还是删掉本地文件 |

## 5. 就绪之后

读写知识库之前，先读 `kb/.memogit/skill/SKILL.md`。那是完整的操作手册，包括 Markdown 写法、文档链接、子文档、冲突合并，以及哪些东西不能改。
每次同步都会按当前 memogit 版本重写这份手册，**不要在仓库里另抄一份**。

## 6. 从旧的接入方式迁移

旧的接入方式是：仓库里提交 `bin/memogit-*`，或者现场编译 memogit；用自己写的 `scripts/toucan.py` 读 `conf.yml` 或 `toucan.json`。迁移步骤：

1. 把配置文件改名为仓库根目录的 `memogit.conf.yaml`。字段不用改，JSON 内容也能直接用。`server`、`memogit_source` 可以删掉：服务器地址统一由 `TOUCANSHELF_SERVER` 提供。
2. 把 `.claude/settings.json` 的两个 hook 换成 2.1 里的写法。
3. 删掉 `bin/memogit-*`、`scripts/toucan.py`、`scripts/update-memogit.sh` 这类脚本，以及现场编译的逻辑。
4. 已有的 `kb/` 可以保留。memogit 会按标题认出已检出的库，接着 pull。
5. `CLAUDE.md` 里原来关于同步脚本的说明，换成 2.1 那一段。
