# memogit sparse checkout：保留目录层级的模式 — 技术方案

## 背景

[memogit-sync.md §3](../requirements/collaboration/memogit-sync.md) 描述的 sparse
checkout 只有一种映射方式：命中的服务端文件夹被**提升成 checkout 根本身**——
`Home/Journal/2024.md` 落地成 `LifeHome/Journal/2024.md` 时，`Home` 这段前缀会被
[`stripSparse`](../../../internal/memogit/naming.go) 去掉，如果映射的是 `Home` 本身，
`Home/Index.md` 落地成 `LifeHome/Index.md`，不保留 `Home/` 这层。

这对"把知识库的一个子域整个搬到独立仓库"的场景是对的，但不适用另一个场景：只想挑一个
子目录检出到本地、同时**保留它相对知识库根的路径**（比如给 AI agent 一个只读的、结构
和线上一致的子树，方便以后原样核对 `folder_path`）。现有实现做不到——`Sparse` 只有
"拉哪些"和"strip 掉映射前缀"两件事绑在一起，没有开关能只做前者。

## 方案：新增 `SparseSubdir` 开关

`WorkspaceConfig` 加一个字段（[config.go:77](../../../internal/memogit/config.go:77)）：

```go
SparseSubdir bool `yaml:"sparse_subdir,omitempty"`
```

`omitempty` + 零值 `false`＝现状不变，老 `config.yaml` 不需要改。

只有两处路径计算函数需要分支（[naming.go:99](../../../internal/memogit/naming.go:99)、
[naming.go:111](../../../internal/memogit/naming.go:111)）：

- `LocalRelPath`：`SparseSubdir` 为真时，直接用服务端 `folder_path` 算本地路径，不再
  strip；为假（默认）时行为不变。
- `ServerFolderPath`：`SparseSubdir` 为真时是恒等函数（本地目录本来就是服务端
  `folder_path`，不用再拼前缀）；为假时行为不变。

`inScope`（决定"这篇文档是否落在这次 checkout 范围内"，[naming.go:86](../../../internal/memogit/naming.go:86)）
完全不用动——它只看 `Sparse` 这个前缀本身，跟"要不要 strip"无关。`pull`/`push`/`status`/
`checkPathCollisions` 全部通过这三个函数间接工作（见
[status.go:142](../../../internal/memogit/status.go:142)、
[push.go:237](../../../internal/memogit/push.go:237)、
[sync.go:242](../../../internal/memogit/sync.go:242)），改完这两个函数其余流程自动跟上，
不需要逐一改调用点。

`Dir` 仍然固定为 `"."`（跟现有 sparse 模式一致）：`--dir` 指向的目录本身就是 checkout
根，`SparseSubdir` 只决定映射的文件夹在这个根下面是"消失"（内容提到根）还是"保留成一层
子目录"，跟根在哪、`.memogit` 放哪没关系。

CLI 侧加一个独立的 bool flag，不复用 `--sparse-checkout` 本身
（[main.go](../../../cmd/memogit/main.go)）：

```bash
memogit clone Life --sparse-checkout Home/Journal --sparse-subdir --dir ./LifeHome
```

## 被否决的选项

**用 `Dir` 承载子目录名，而不是加新字段。** 即 sparse 模式下把 `Dir` 设成映射文件夹的
最后一段（例如 `Journal`），复用非 sparse checkout 本来就有的"内容落在 `<Dir>/` 下面"
的逻辑，不用碰 `LocalRelPath`/`ServerFolderPath`。否决：一是映射路径可能有多段
（`Home/Journal`），`Dir` 只能是一层，语义对不上；二是这样"是否 strip"就要靠猜
`Dir == 最后一段` 来反推，比显式加一个 `SparseSubdir` 布尔值更绕、更容易在改名时出 bug。

**复用 `--sparse-checkout` 传特殊值来选模式**（如允许它接受两段式参数）。否决：
"选哪个文件夹"和"要不要保留层级"是两个独立维度，硬塞进一个 flag 的解析规则里除了省一个
flag 名没有别的好处，还得写自定义的参数格式解析和对应报错。

## 验收判据

- `TestSparseSubdirPathMapping`（[memogit_test.go](../../../internal/memogit/memogit_test.go)）
  覆盖 `LocalRelPath`/`ServerFolderPath` 在 `SparseSubdir=true` 下的行为，以及
  `inScope` 不受影响。
- 手工验证：`memogit clone <kb> --sparse-checkout Journal --sparse-subdir --dir ./X`
  之后 `./X/Journal/...` 存在且 `./X/` 下没有把 `Journal` 的内容提到根；`memogit status`
  / `pull` / `push` 在这套路径下正常工作（走的是同一组函数，理论上不需要额外测试，但
  第一次上线后应该手工跑一遍完整的 clone → 改文件 → push → pull 循环确认）。
- 新建的本地文件（例如 `./X/Journal/New.md`）push 后，服务端文档的 `folder_path`
  应该是 `Journal`，不是 `Journal/Journal` 或空。
