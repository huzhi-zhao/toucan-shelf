# memogit 由服务器托管分发

需求背景见 [memogit-distribution.md](../requirements/collaboration/memogit-distribution.md)：现在有两个下游仓库各自复制 memogit。
toucan-base 往仓库里提交二进制，huzhi-zhao.github.io 在云端沙箱里现场编译。
两边还各写了一份拉库用的 py 脚本，已经开始分叉。这次版本对不上，就是这样一路漏下去的。

**目标**：下游仓库只维护一份 `memogit.conf.yaml`，再配两个环境变量（`TOUCANSHELF_SERVER`、`TOUCANSHELF_PAT`）。
其余全部从 ToucanShelf 服务器获取：给 agent 的说明、和服务器配套的 memogit、拉知识库的逻辑。

## 一、决策

### 1. 服务器就是发布源，不走 GitHub Releases

服务器部署的是哪个 commit，就发布同一个 commit 编出来的 memogit。下游要的"最新版"，准确说是"和服务器配套的版本"。

不用 GitHub Releases，有三个原因：

- 仓库的 CI 是关着的（`.github/workflows-disabled/`）。
- Release 的 commit 和部署的 commit 很可能不一致。
- 云端沙箱本来就必须放行服务器域名，从服务器下载不用再放行别的域名。

### 2. 服务器只托管一个静态目录，不认识 memogit

发布内容是构建时生成的一个目录（下文叫 dist），里面有二进制、`version.json`、`bootstrap.md`、`install.sh`。
服务器只做一件事：把这个目录挂在 `/memogit/` 下，当作静态文件提供。它不引用 `internal/memogit` 的任何代码，也不解析里面的内容。

这样不违反子域边界（[subdomain-boundaries.md](../subdomain-boundaries.md)）：核心没有"认识"外围，只是多托管了一个目录。
没配置 dist 目录的实例，`/memogit/*` 一律返回 404，其他功能不受影响。

### 3. 比较版本只看相等，不比新旧

版本号格式是 `2026.10.06-<9位哈希>`（见 `cmd/memogit/version.go`）。memogit 只判断"和服务器的是否相同"，不判断谁新谁旧。
本机版本比服务器新（比如开发中的构建），同样算不匹配，但只提示，不强制。

### 4. 各仓库自己写的 hook 胶水收进 memogit

两个 py 脚本做的事（读配置、clone 没有的库、pull 已有的库、输出给 agent 看的库清单、推送并报告冲突和跳过）全部做成 memogit 的命令：
`memogit sync`、`memogit hook session-start`、`memogit hook stop`。

- 逻辑跟着二进制的版本走，修一处，所有下游一起生效。
- 云端沙箱不再需要装 python 和 PyYAML。
- Claude Code hook 的约定（退出码、stdout 和 stderr 分别给谁看）也收在 memogit 里，下游不用自己处理。

### 5. `bootstrap.md` 是下游接入和排错的唯一说明

- **怎么写**：源文件在 `docs/skill/bootstrap.md`，和 agent 手册放在一起；构建时复制进 dist。
- **写什么**：知识库是什么、为什么不能绕开；接入一个仓库要放哪些文件，每个都给出模板；每次会话 hook 自动做什么；各种报错怎么判断、怎么处理。
- **谁来接入**：agent 照着做。有些步骤 agent 做不了（配环境变量、配云端网络白名单、写 `.claude/settings.json` 被权限拦下），就逐条告诉用户怎么做。
- **不做 `memogit init`**：接入步骤用文档描述就够了，少一个命令，也少一份要维护的代码。

### 6. 配置文件沿用下游已有的格式

两个下游的配置是同一套字段：toucan-base 用 YAML 写的 `conf.yml`，github.io 用 JSON 写的 `scripts/toucan.json`。
这套字段从上游看也合适，`desc` 尤其有用，所以不重新设计，只做三处调整：

| 字段 | 处理 | 原因 |
| --- | --- | --- |
| `knowledge_bases[].name / desc / attachments / filter / enabled` | **保留，含义不变** | 正好对应 `memogit clone` 的参数；`desc` 用来在会话开始时告诉 agent 每个库里有什么 |
| `knowledge_bases[].sparse` | **保留字段，但 `sync` 报错拒绝** | sparse 检出的内容直接放在检出根本身，push 会把同一个根下其他库的文档当成它的新文档推上去（`listDocFiles` 从检出根往下全扫）。两个下游都没实际用过 |
| 顶层 `dir` | **新增**，可选，默认 `kb` | 检出根的位置，以前是写死在脚本里的 |
| 顶层 `server` | **降为后备**：只在没设 `TOUCANSHELF_SERVER` 时使用 | 服务器地址统一由环境变量提供；保留它，迁移时不用改 |
| `memogit_source`（github.io 独有） | **去掉**，读到时提示一次后忽略 | 现场编译被服务器分发取代 |

文件名统一为仓库根目录的 `memogit.conf.yaml`。YAML 兼容 JSON，所以 github.io 的配置内容不用改，只要改文件名。

```yaml
# memogit.conf.yaml
dir: kb                     # 可选，默认 kb；记得加进 .gitignore
knowledge_bases:
  - name: Career            # 服务器上的知识库标题，不区分大小写
    desc: 职业规划、简历与面试准备
  - name: SideProjects
    desc: 个人项目的设计与开发记录
    attachments: false      # 只拉文字；在 clone 时固定
  - name: Home
    filter: '"work" in tags'  # 可选：CEL 过滤
    enabled: false          # 暂时跳过，不用删掉这一项
```

## 二、服务器提供的内容

全部是 `/memogit/` 下的静态文件，**不需要登录**。代码本来就是开源的，而且安装发生在有 token 之前。

| 路径 | 内容 |
| --- | --- |
| `/memogit/bootstrap.md` | 给 agent 的前置说明，应该最先读 |
| `/memogit/install.sh` | 安装脚本 |
| `/memogit/version.json` | 版本号，以及每个平台二进制的文件名和 sha256 |
| `/memogit/memogit-{os}-{arch}` | 二进制：`darwin-arm64`、`darwin-amd64`、`linux-amd64`、`linux-arm64` |

```json
{
  "version": "2026.10.06-19d42e494",
  "files": {
    "linux-amd64": { "name": "memogit-linux-amd64", "sha256": "…" }
  }
}
```

## 三、构建与部署

```bash
./scripts/build-memogit.sh --dist     # -> memogit-dist/（四个平台 + version.json + bootstrap.md + install.sh）
```

- **dist 在宿主机上构建**：做法和前端一样（Dockerfile 里那句 "Please build frontend first"）。原因是宿主机有 `.git`，`go build` 会自动把版本号写进二进制；Docker 构建上下文里没有 `.git`。
- **`memogit-dist/` 要加进 `.gitignore`**。
- **Dockerfile**：`COPY memogit-dist /usr/local/memos/memogit-dist`。没先构建 dist 时，`COPY` 会直接失败，正好起到提醒作用。
- **服务器参数**：新增 `--memogit-dist`（环境变量 `MEMOS_MEMOGIT_DIST`），Docker 镜像里默认指向上面那个路径。不设就不提供 `/memogit/*`。
- **镜像体积**：四个平台的二进制都去掉了调试信息，未压缩合计大约 70MB。

> **2026-10-06 修订**：上面几条只落在了 `scripts/Dockerfile`，线上部署用的根目录 `Dockerfile` 没改，导致 `/memogit/*` 404。
> 现在根目录 `Dockerfile` 在镜像里构建 dist，版本号由 `deploy.sh` 以 `MEMOGIT_VERSION` 传入。
> 现行规则以[需求文档 §3](../requirements/collaboration/memogit-distribution.md#3-构建与部署) 为准。

## 四、memogit 这边要加的功能

### 1. 环境变量

服务器地址和 token 依次从下面几处读，先找到哪个用哪个：

- 服务器地址：`TOUCANSHELF_SERVER` → `MEMOGIT_SERVER` → 检出根里的 `config.yaml` → `memogit.conf.yaml` 的 `server`
- token：`TOUCANSHELF_PAT` → `MEMOGIT_TOKEN` → 检出根里的 `config.yaml`

第一次 clone 时会把它们写进 `<dir>/.memogit/config.yaml`，之后不设环境变量也能用。

### 2. 从仓库根目录也能找到检出根

现在的 `FindRoot` 只会往上找 `.memogit/`。新增一条后备规则：往上找到 `memogit.conf.yaml` 时，检出根就是它所在目录下的 `dir`。
这样在下游仓库根目录直接跑 `memogit status`、`pull`、`push`，都能用。

### 3. `memogit sync`

- 读 `memogit.conf.yaml`，跳过 `enabled: false` 的项。
- 没 clone 过的库就 clone，带上 `attachments`、`filter` 对应的参数；已经有的就 pull。按标题匹配，不区分大小写。遇到 `sparse` 直接报错（原因见决策 6）。
- 最后输出库清单，每行一个库：`kb/<目录>/ — <name>：<desc>（ok / 失败原因）`。
- 有任何一个库失败，退出码就不为 0。

### 4. `memogit hook session-start` / `memogit hook stop`

这两个是给 Claude Code hook 调用的命令，hook 的约定都封装在这里：

- **`session-start`**：执行 sync，再把给 agent 看的上下文打到 stdout（这部分会自动进入会话上下文）。**退出码始终为 0**。
  - 成功时：第一行打印固定标记 `memogit: 知识库就绪`，接着是库清单，最后提示去读 `kb/.memogit/skill/SKILL.md`。
  - 失败时：第一行打印 `⛔ memogit: 知识库未就绪`，接着是原因，以及 bootstrap.md 的地址和"停下来告诉用户，不要绕过"。
- **`stop`**：推送全部库。
  - 有冲突（`⚠`）或有文档被跳过（`!`）时，把明细写到 stderr，并以退出码 2 结束，让 agent 看到并处理。
  - 如果 hook 的输入里 `stop_hook_active` 为 true（说明已经拦过一次），就只提示、不再拦，防止死循环。
  - 都正常时不输出任何内容。

### 5. 版本提示和 `memogit self-update`

- **版本提示**：clone、pull、push、sync 执行完后，顺带请求 `{server}/memogit/version.json`。和自己的版本不一致时，在 stderr 打印一行：`memogit: 服务器配套版本是 X，当前是 Y，运行 memogit self-update`。
  - 请求失败或返回 404（旧服务器）时，什么都不说。
  - 自己的版本是 `unknown` 时也不说。
- **`memogit self-update`**：按 `runtime.GOOS`/`GOARCH` 下载对应文件，校验 sha256；先写到同一目录下的临时文件，再用 rename 替换 `os.Executable()` 指向的文件（会先解析符号链接）。

### 6. `install.sh`

- **用法**：`curl -fsSL "$TOUCANSHELF_SERVER/memogit/install.sh" | sh -s -- [安装后要执行的 memogit 参数]`
- **流程**：
  1. 用 `uname` 识别平台，拉取 `version.json`。
  2. 已安装的 `memogit -v` 和服务器一致，就跳过下载。
  3. 不一致就下载，校验 sha256 后安装。
- **装到哪**：已安装的 memogit 所在目录（可写的话），否则 `/usr/local/bin`（可写的话），否则 `~/.local/bin`。
- **装完之后**：用刚装好的那个文件的绝对路径执行后面的参数，不依赖 PATH。
- **拿不到 `version.json` 时**（服务器还没部署 dist、网络被拦）：本机已经装过 memogit 的话，在 stderr 提示一句，然后继续用已装的版本执行，不因为分发不可用而拒绝同步。
- **出错时**：后面的参数以 `hook` 开头时，在 stdout 打印 `⛔ memogit: 知识库未就绪` 和失败原因，附上 bootstrap.md 的地址，退出码为 0，让 agent 看到；否则退出码为 1。
- **装到的目录不在 PATH 最前面时**：在 stderr 警告。否则 Stop hook 用 PATH 找到的可能是另一个旧版本。

## 五、下游仓库要放的文件

这部分由 `bootstrap.md` 指导 agent 生成，这里只列清单：

| 文件 | 内容 |
| --- | --- |
| `memogit.conf.yaml` | 要拉哪些库 |
| `.claude/settings.json` | SessionStart：`curl -fsSL "$TOUCANSHELF_SERVER/memogit/install.sh" \| sh -s -- hook session-start`；Stop：`memogit hook stop` |
| `.gitignore` | 加一行 `kb/`（里面的 config.yaml 存着 token） |
| 根目录 `CLAUDE.md` 或 `AGENTS.md` | 一小段：知识库在 `kb/`；会话开始时没看到 `memogit: 知识库就绪` 这一行，就说明没就绪，停下来告诉用户；附上 bootstrap.md 的地址 |

**为什么 `CLAUDE.md` 那段必须写在仓库里**：服务器连不上时，`curl` 什么都拿不到，管道后面的 `sh` 收到空输入，正常结束，agent 什么输出都看不到。
这时只能靠"没看到就绪标记就是没就绪"这条写在仓库里的规则兜底。

**仓库外**：本机和云端都要配 `TOUCANSHELF_SERVER`、`TOUCANSHELF_PAT`；云端环境的网络白名单要放行服务器域名。

## 六、分期

| 期 | 内容 | 验收 |
| --- | --- | --- |
| 1 | `-v`（已完成）；`--dist` 构建；服务器的 `--memogit-dist` 静态托管；Dockerfile；`self-update`；版本提示；环境变量 | `go test ./internal/memogit/... ./server/...`；本机起一个服务器，`curl /memogit/version.json` 能拿到内容；`self-update` 能把一个旧版本换成新版本 |
| 2 | `memogit.conf.yaml`；FindRoot 后备规则；`sync`；`hook session-start` / `hook stop`；`install.sh` | 单元测试覆盖配置解析、按标题匹配、hook 的输出和退出码；用一个临时仓库对本机服务器跑通全流程 |
| 3 | 写 `docs/skill/bootstrap.md`；更新 memogit 手册和 [memogit-distribution.md](../requirements/collaboration/memogit-distribution.md) | 文档本身 |
| 4 | 迁移 toucan-base、huzhi-zhao.github.io（在这两个仓库里分别做） | 两边开新会话，都能看到就绪标记 |

服务器那边要先部署带 dist 的新版本，第 4 期才能开始。

**进度（2026-10-06）**：第 1 到 3 期已在分支 `feat/memogit-hosted-distribution` 完成，并在本机做了端到端验证。验证用的是一个带 `--memogit-dist` 的临时实例和一个临时下游仓库，覆盖了以下场景：
- `curl | sh -s -- hook session-start` 从零安装，然后输出状态；
- 配置里的库名大小写和服务器不一致；
- 不存在的库报"部分未就绪"；
- Stop hook 推送新文档；
- 冲突时退出码为 2，第二次只提示、不再拦截；
- 删掉 `.remote` 后能推上去；
- `self-update` 校验后替换；
- 版本不一致时给出提示；
- 服务器连不上时输出"未就绪"。

## 七、不做

- **GitHub Releases**：理由见决策 1。以后要给外部用户发版时再考虑。
- **Windows**：没有下游在用。
- **`memogit init`**：理由见决策 5。
- **后台自动升级**：本机只提示，用户自己执行 `self-update`。hook 这条路径每次会话开始都会经过 `install.sh`，本身就会对齐版本。
