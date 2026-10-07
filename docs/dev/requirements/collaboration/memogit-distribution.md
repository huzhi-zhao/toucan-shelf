# memogit：分发与版本管理

memogit 不只在本仓库里用。别的仓库在会话开始时安装它，用它把知识库检出到自己的工作目录里。
所以**一个 memogit 二进制是哪份源码编出来的**，直接决定了下游 agent 看到的功能和手册。
这篇讲版本号怎么读、memogit 怎么发布、下游怎么接入，以及版本对不上时踩过的坑。

同步本身怎么工作见 [memogit-sync.md](memogit-sync.md)。文档身份见 [memogit-doc-identity.md](memogit-doc-identity.md)。
这套分发方式的设计取舍见 [design/20261006-memogit-hosted-distribution.md](../../design/20261006-memogit-hosted-distribution.md)。

## 1. 原则：服务器发布和自己配套的 memogit

- 服务器部署的是哪个 commit，就在 `/memogit/` 下发布同一个 commit 编出来的 memogit。
- 下游不在仓库里提交二进制，也不现场编译。每次会话开始，由 hook 从服务器安装或更新。
- 下游要的"最新版"，准确说是"和服务器配套的版本"。所以比较版本只看是否相等，不比新旧。

| 路径 | 内容 |
| --- | --- |
| `/memogit/bootstrap.md` | 给 agent 的前置说明：怎么接入、会发生什么、出错怎么办。源文件是 [docs/skill/bootstrap.md](../../../skill/bootstrap.md) |
| `/memogit/install.sh` | 安装脚本，源文件是 `scripts/memogit-install.sh` |
| `/memogit/version.json` | 版本号，以及每个平台二进制的文件名和 sha256 |
| `/memogit/memogit-{darwin,linux}-{arm64,amd64}` | 二进制 |

这些都是静态文件，不需要登录。服务器只托管 dist 目录，不认识 memogit（`server/router/memogitdist`）。

## 2. 版本号

memogit 没有发版流程，版本就是**构建所用的 commit**：

```
$ memogit -v
memogit 2026.10.05-14c6f2b35
```

- **前半段**：commit 日期（UTC），用来一眼比出新旧。
- **后半段**：commit 短哈希，用来 `git show` 查到底包含什么。
- **`-dirty` 后缀**：构建时工作区有未提交改动，这个二进制的内容在任何 commit 里都查不到。**不得用它部署**。
- **`unknown`**：不在 git 检出里构建，或者用了 `-buildvcs=false`。

版本号不需要人维护。`go build` 在仓库里构建时会自动把 vcs 信息写进二进制，`-v` 直接读它（`cmd/memogit/version.go`），交叉编译同样会写入。
本机跑不了的二进制可以用 `go version -m <二进制> | grep vcs` 查看。

**版本不一致怎么发现**：
- 走 hook 的场景：每次会话开始，`install.sh` 会自动对齐版本。
- 手动使用的场景：`clone`、`pull`、`push`、`status`、`sync` 执行完会对比服务器版本，不一致时在 stderr 提示运行 `memogit self-update`。

## 3. 构建与部署

```bash
./scripts/build-memogit.sh                   # 本机 -> build/memogit
./scripts/build-memogit.sh --linux-amd64     # Linux x86-64 -> build/memogit-linux-amd64
./scripts/build-memogit.sh --dist            # 服务器发布用 -> memogit-dist/
```

- 脚本会先把 `docs/skill/` 同步进内嵌手册，构建完打印版本号。
- 工作区不干净、或者不在 `main` 上时，脚本会给出警告。

**部署规则：**

1. **`--dist` 在宿主机上、`docker build` 之前执行**，和前端一样。Docker 构建上下文里没有 `.git`，在容器里编译就拿不到版本号。Dockerfile 会 `COPY memogit-dist`，忘了构建会直接报错。
2. **只从干净的、最新的 `main` 构建要部署的 dist。** 在功能分支或旧 worktree 里编出来的版本，会缺少之后合进 main 的功能（见 §5.1）。
3. **服务器参数**：`--memogit-dist`（环境变量 `MEMOS_MEMOGIT_DIST`），镜像里默认是 `/usr/local/memos/memogit-dist`。不设就不提供 `/memogit/*`。
4. **本机的 memogit 用 `memogit self-update` 升级**。给 agent 看的手册只在 clone 或 pull 时重写，所以升级后要 pull 一次。走 hook 的下游每次会话都会 pull，不用操心。

## 4. 下游怎么接入

下游仓库只需要：

- 根目录的 `memogit.conf.yaml`；
- `.claude/settings.json` 里的两个 hook；
- `.gitignore` 加一行 `kb/`；
- `CLAUDE.md` 里的一小段说明；
- 环境变量 `TOUCANSHELF_SERVER` 和 `TOUCANSHELF_PAT`。

具体写法、各种报错怎么处理、怎样从旧方式迁移，都写在 [bootstrap.md](../../../skill/bootstrap.md) 里，由 agent 照着做。
不再提供 `memogit init`，也不再需要各仓库自己维护 py 脚本。

| 下游 | 现状（2026-10-06） |
| --- | --- |
| `jimmy-zhz/toucan-base` | 待迁移：仓库里提交了 `bin/memogit-linux-amd64`，用自己的 `scripts/toucan.py` 读 `conf.yml` |
| `huzhi-zhao/huzhi-zhao.github.io` | 待迁移：本机用已装的 memogit，云端现场编译；用自己的 `scripts/toucan.py` 读 `scripts/toucan.json` |
| 本机（Mac） | `/opt/homebrew/bin/memogit`。`/usr/local/bin/memogit` 是 root 所有的早期版本，PATH 里排在后面，平时用不到，但别拿它判断功能 |

两个下游的配置字段和 `memogit.conf.yaml` 相同，改个文件名就能用。

## 5. 版本对不上时踩过的坑

这些问题都发生在本章的分发方式之前，是促成它的原因。

### 5.1 本机二进制缺子文档功能，agent 以为不支持（2026-10）

- **起因**：`/opt/homebrew/bin/memogit` 是 09-29 从 no-attachments 分支的 worktree 编的。子文档的代码和手册 09-20 就已合进 main，但这个二进制里完全没有。
- **后果**：
  - agent 读本地手册没找到子文档写法，以为不支持，改用了普通文件夹。
  - 本机检出漏掉了 5 篇子文档，检出一直不完整，而且没有任何报错。
- **潜在风险**：版本较新的 memogit 支持子文档，本机旧版不支持。新版建的子文档被旧版 pull 下来时，可能被当成名叫 `_sub/<uid>` 的普通文件夹。
- **当时为什么难查**：没有版本号，只能对二进制做字符串搜索（`grep -a subdocs`）才确认。

### 5.2 本机旧版不认新参数，clone 失败（2026-10）

- toucan-base 给两个库设了 `attachments: false`，脚本因此传 `--no-attachments`。
- 本机当时用的是更早的 `/usr/local/bin/memogit`，报 `unknown flag: --no-attachments`，这两个库在本机一直没拉下来。云端用的是仓库里提交的新版二进制，所以同一份配置云端正常、本机失败。

### 5.3 子文档的修改推不上去，且没有明显报错（2026-10）

- **原因**：pull 会额外取子文档，但 push 和 status 判断"服务器上还有哪些文档"时只看 memo 列表，而列表里不含子文档。
- **后果**：
  - push 把每篇子文档都当成"服务器上已删"跳过，只打印一行 `!`，修改永远推不上去。
  - status 把子文档报成待拉取，pull 却说没东西可拉。
- **修复**：PR #40（`fix/memogit-push-subdoc-alive`）已合进 main，抽出了 `withSubDocs`，让三处共用同一个判断。
- **教训**：Stop hook 除了报冲突（`⚠`），还必须报出被跳过的文档（`!`）。现在 `memogit hook stop` 会把两类都交给 agent。

## 6. 下游接入时还要注意

- **按名字找库不区分大小写**：配置里写 `life`，服务器上的标题是 `Life`，memogit 建的目录是 `Life/`。`memogit sync` 已经按这个规则处理。
- **只要一个库的部分目录，用 `folders`，不用 `sparse`**：
  - `sparse` 检出的内容直接放在检出根本身，push 会把同一个根下其他库的文档当成它的新文档推上去，所以 `memogit sync` 遇到 `sparse` 会直接报错。
  - `folders` 让库照常占用自己的子目录，只检出列出的目录（`kb/SideProjects/CMOP/...`），可以写多个，改了下次 sync 自动生效。方案见 [design/20261007-memogit-conf-folders.md](../../design/20261007-memogit-conf-folders.md)。
- **云端连服务器返回 403 Forbidden，通常不是 token 的问题**：
  - token 错误返回的是 401。403 一般是沙箱的网络白名单没放行服务器域名。
  - 也可能是 Cloudflare 拦了机房 IP：响应头里带 `server: cloudflare` / `cf-ray` 就是这种情况。
- **服务端已知问题**：移动文档时，服务端自动改写引用它的其他文档，会顺带把那些文档里的表格压成一行、删掉列表续行缩进。memogit 会把这报成冲突，不会静默覆盖，按冲突流程保留本地版本即可。这是服务端的 bug，用网页移动文档同样会触发，只是网页上没人提醒。
