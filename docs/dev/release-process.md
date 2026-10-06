# 发布流程

常青文档，描述 toucan.huzhi.dev 现在怎么从代码变成线上服务。流程变了就原地改写。

## 1. 总览

```
worktree 开分支 → 本地检查 → PR → 合入 main → 判断能否回退 / 备份 → 服务器跑 ./deploy.sh → 验证
```

- **main 就是线上。** 线上永远跑 main 的某个 commit。发布等于两步：合入 main，再在服务器上跑 `deploy.sh`。
- **没有版本号，也没有 tag。** 一次发布用 commit 标识。memogit 的版本也是 commit 日期加短哈希，见 [memogit 分发 §2](requirements/collaboration/memogit-distribution.md#2-版本号)。
- **没有 CI。** `.github/workflows-disabled/` 是上游留下的，整体停用。合并前的本地检查是唯一的门禁。

## 2. 开发到合并

1. **新分支开在 `.worktrees/` 里**，不要在共享的主目录里切分支。
2. **合并前按 `AGENTS.md`「Change Routing」跑对应的检查。** 没有 CI 兜底，没跑就等于没检查。PR 描述里要写跑了什么；跑不了的，写明原因和剩下要跑的命令。
3. **改了 `Dockerfile`、`docker-compose.yml`、`deploy.sh` 或 `.dockerignore`，合并前在本地完整构建一次镜像，再启动容器验证一次。**
   - 仓库里有两份 Dockerfile。线上用的是根目录 `Dockerfile`，`scripts/Dockerfile` 是上游的发布镜像，线上不用。两份改错过一次，见 [memogit 分发 §5.4](requirements/collaboration/memogit-distribution.md#54-分发上线后-memogitversionjson-一直-4042026-10)。
   - 根目录 Dockerfile 用了 BuildKit 语法（`--mount=type=cache`、`--chmod`、`$BUILDPLATFORM`），旧版 builder 构建不了。
4. **用 `gh` 开 PR 时要带 `--repo huzhi-zhao/toucan-shelf`。** origin 是 fork，`gh` 默认会解析到上游 `usememos/memos`。
5. **合并用 merge commit**，和现有历史一致。回滚时 revert 的就是这个合并 commit（§7）。

## 3. 发布前：判断这次能不能直接回退

部署之前先看这次合进来的东西里有没有下面几类。都没有就跳过 §4，直接部署。

| 类型 | 怎么认 | 为什么要小心 |
| --- | --- | --- |
| 数据库迁移 | `store/migration/sqlite/` 下有新文件 | 新服务启动时会自动执行迁移，schema 版本随之升高。旧代码遇到更高的 schema 版本会拒绝启动（`cannot downgrade schema version`），所以回滚只能先恢复数据库 |
| 启动时批量改写数据 | 服务启动时会遍历文档改写内容或索引的任务 | 写坏的数据不会随代码回滚恢复 |
| 下游契约变化 | memogit 的行为、MCP 工具、下游要用的环境变量名、`/memogit/*` 的格式 | 下游仓库或沙箱可能要先改、或者同时改，要想清楚先后顺序 |

有迁移或批量改写的，**部署前必须备份（§4）**。只有下游契约变化的，要先把下游的改动准备好。

## 4. 备份数据库

数据都在 Docker volume `memos_memos-data` 里（可以用 `MEMOS_DATA_VOLUME` 改名），数据库文件是 `memos_prod.db`。

**方式一：设置页「立即备份」**
- 需要已经配置好 S3。
- 用 `VACUUM INTO` 做一致性快照，压缩后传到 S3，不用停服务。
- 只备份数据库，不含附件文件本身。

**方式二：停容器后直接拷贝 volume**
- 不依赖 S3，适合发布前临时留一份。
- 在服务器上的部署 checkout 里执行：

```bash
docker compose stop toucan-shelf
```

```bash
docker run --rm -v memos_memos-data:/data -v "$PWD":/backup alpine sh -c 'cp -a /data/memos_prod.db* /backup/'
```

```bash
docker compose start toucan-shelf
```

- 拷出来的文件不要放进 git。

## 5. 部署

在服务器上的部署 checkout 里执行：

```bash
./deploy.sh
```

`deploy.sh` 依次做这些事：

1. `git fetch` 加 `git reset --hard origin/main`，让 checkout 和 main 完全一致。**服务器 checkout 上的本地改动会被丢掉**，所以不要在服务器上改代码。
2. 导出 `MEMOS_INSTANCE_URL`，默认 `https://toucan.huzhi.dev`。
3. 用当前 commit 算出 `MEMOGIT_VERSION` 并打印出来（`=======> memogit version: ...`）。
4. 执行 `docker compose up -d --build`：在镜像里编前端、服务端和四个平台的 memogit，然后重建容器。

**几点说明：**
- **服务器需要的东西**：git、Docker，以及支持 BuildKit 的 compose v2。不需要 Go 或 Node，编译都在镜像里完成。
- **中断时间**：构建期间旧容器照常服务。构建完重建容器时会短暂中断，新服务先跑完迁移，再开始接请求。
- **只部署 main。** `deploy.sh` 有 `--branch` 参数，但部署别的分支会打破"main 就是线上"，发布出去的 memogit 也会是那个分支编出来的。

## 6. 部署后验证

按顺序做：

1. **看启动日志**：`docker compose logs -f toucan-shelf`。要看到正常启动，没有 migration 报错。
2. **健康检查**：`curl -fsS https://toucan.huzhi.dev/healthz`，应返回 `Service ready.`。
3. **确认线上跑的是哪个 commit**：`curl -fsS https://toucan.huzhi.dev/memogit/version.json`，里面的 `version` 应该等于 `deploy.sh` 打印的 memogit version，也就是 main HEAD 的日期加短哈希。
   - 这是目前从外面确认线上 commit 的唯一办法。服务端自己的版本号（`internal/version`）在部署构建里没有传值，固定是 `dev`。
4. **在网页上登录**，打开一篇文档，确认能正常显示。
5. **按需求文档的人工验收清单逐条验收这次的功能**（如果有清单的话）。

**下游不用手动处理。** 下游仓库的 SessionStart hook 每次会话开始时都会对照 `version.json` 自动换成配套的 memogit。本机的 memogit 用 `memogit self-update` 升级，也可以等下一次 hook。

## 7. 回滚

**没有迁移的发布：**
1. 在 main 上 revert 那个合并 commit：`git revert -m 1 <merge commit>`。
2. 照常走 PR 合入 main。
3. 重新执行 `./deploy.sh`。

不要在服务器上手动部署旧 commit：`deploy.sh` 每次都会重置到 `origin/main`，手动部署的会在下次发布时被覆盖，而且会打破"main 就是线上"。

**有迁移的发布：**
- 旧代码不会在升级过的数据库上启动，必须先把数据库换回备份。
1. 停容器。
2. 把 §4 的备份文件拷回 volume，同时删掉同名的 `-wal`、`-shm` 文件。
3. 在 main 上 revert 并部署，步骤同上。

**备份之后写入的数据会丢失**，所以要尽早判断是否回滚。

**memogit 跟着一起回滚。** 服务端回到旧 commit，发布的 memogit 也回到旧版本。`install.sh` 只比较版本是否相同，所以下游下次会话会自动装回旧版本。

## 8. 已知限制

- **没有 CI。** 门禁全靠合并前的本地检查（§2）。
- **服务端版本号是 `dev`。** 只能用 memogit 的 `version.json` 判断线上跑的是哪个 commit（§6）。
- **没有灰度，也没有零停机。** 单实例 SQLite，同时只能有一个写入方，见 [ADR-0016](adr/0016-no-multi-instance-lease.md)。
