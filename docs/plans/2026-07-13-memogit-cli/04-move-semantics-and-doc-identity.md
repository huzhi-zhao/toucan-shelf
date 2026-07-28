# memogit：文档身份标记与移动语义（2026-07-28）

状态：✅ 已实现并对真实服务端（toucan.huzhi.dev，3 个知识库 / 273 篇文档）实测通过。
关联：[[01-memogit-cli]] §5.2（sidecar 元数据模型，本次做了**有限度的修订**）、
[[03-implementation-notes]] §3.1。

## 1. 起因：一个删不掉的文件夹

线上 MPNP 知识库里有个 `consult` 文件夹，网页上显示是空的，但删除时报"文件夹不为空"。
用户在 memogit 检出目录里把它下面唯一的文档移到了
`research/consultations/2026-07-28_李德鹏_初次咨询-问题清单.md` 并 push 过。

排查下来是**两个独立缺陷叠在一起**：

1. **push 把"移动"实现成了"归档旧的 + 新建一个"**。旧 memo 被归档后 folder_path
   原封不动，仍然留在 `consult` 下。
2. **服务端删除文件夹的判空没有排除已归档文档**，而工作区树是隐藏归档文档的——于是
   文件夹看起来空、实际删不掉。

第 2 点是直接症状，第 1 点才是根因，而且后果远比"删不掉文件夹"严重。

## 2. archive + create 到底丢了什么

新建的 memo 拿到的是全新 uid，以下内容全部留在被归档的旧 memo 上：

| 数据 | 存储位置 | 后果 |
|---|---|---|
| 版本历史 | `memo_history`（按 memo_id） | 新文档历史清零 |
| 备注/评论 | 独立 memo + `memo_relation` COMMENT | 挂在旧 memo 上，新文档看不到 |
| Reactions | `reaction` | 同上 |
| 被引用关系 | 其他文档里的 REFERENCE / `/<ws>/<uid>` 链接 | **全部断链，指向已归档文档** |
| 分享链接 | `memo_share` | 失效 |
| node_overlays、pinned、visibility、created_ts | memo 行本身 | 丢失/重置 |

有意思的不对称：**pull 方向一直是对的**（`relocateMemo` 处理"服务端移动 → 本地跟着
移动"，是真正的原地搬移）。缺陷只在 push 方向。

## 3. 为什么身份必须写进文件

要把 `mv` 认成移动，push 必须能把"消失的旧路径"和"出现的新路径"配成一对。三条路：

| 方案 | 结论 |
|---|---|
| **内容哈希配对** | ❌ 否决。"先改后移"和"先移后改"都会让内容对不上，配对失败 |
| **git rename 检测**（`--find-renames`） | ❌ 否决。同样是相似度启发式，改动大就失效 |
| **身份随文件走（写进文件）** | ✅ 采纳。唯一在任意编辑顺序下都成立的方案 |

前两条本质都是事后猜测。文档身份是客观事实，应该被记录而不是被推断。

## 4. 对 §5.2 sidecar 模型的修订

01 号文档 §5.2 定的是"文件里只有用户的 content，**全部** memogit 元数据进 sidecar"。
本次**只把文档 ID 这一项**移出 sidecar，其余（doc_type、visibility、hash、附件、
relations）仍然只在 `.memogit/state/<ws>.json`。

原始决策的真正约束是"**不要往文件头部塞一个 memogit frontmatter 块**"——因为文件第一个
`---` 块永远属于用户自己的 Obsidian properties。这个约束被完整保留了：标记放在文件
**末尾**（VIEW 放进 JSON 对象内部），头部一个字节都没动。

### 4.1 两种编码

| doc_type | 标记 | 位置 |
|---|---|---|
| `MARKDOWN` / `HTML` / `PDF` | `<!-- memogit-id: memos/<uid> -->` | 文件最后一行 |
| `VIEW` | `"memogit-id": "memos/<uid>",` | JSON 对象第一个键 |

VIEW 单独处理，是因为 `.view.json` 会被 agent 和 linter 当 JSON 解析，尾部挂个 HTML
注释会让它变成非法 JSON。做成顶层键则文件仍然合法，而 gallery 解析器只读
`viewType`/`blocks`，多一个键无害。VIEW 内容允许"可选 frontmatter + JSON"，所以插入
点是跳过 frontmatter 后的第一个 `{`；找不到对象就原样返回（畸形 view 不去动它），
退化成按路径跟踪。

### 4.2 唯一不变式

> **`StripLocalID(InjectLocalID(x)) == x`**，逐字节。

这条一旦破了，每个同步过的文件都会显得"本地已修改"，push 立刻开始伪造冲突。因此：

- **注入只有一个出口**：`FileContent()`。
- **剥离只有一个入口**：`StripLocalID()`，且所有本地文件哈希都走 `localHash()`。
- VIEW 的 JSON 形式连同前导换行和尾随逗号一起匹配删除，保证是插入的精确逆运算。

标记**只存在于本地文件**：push 前剥离，服务端 content 永远不含它。因此网页端重新
序列化 view、或任何服务端行为，都不可能影响标记。

### 4.3 存量检出的补写

老检出的文件没有标记。pull 结束前跑一次 `ensureLocalIDs`：逐个读取被跟踪文件，
标记缺失或指向错误 uid 就重写。因为哈希前会剥离标记，**补写不会被判定为本地修改**。
实测：3 个知识库共 111 个文件被补写，之后 `memogit status` 仍然是 "In sync"。

没有做成一次性的 schema 版本迁移，而是每次 pull 都做——这样用户手滑删掉标记也能自愈。
代价是每次 pull 多 O(n) 次小文件读取，实测可忽略。

## 5. push 的新结构

原来的 push 是"遍历文件 → 认识就更新，不认识就新建"+"遍历基线 → 路径不在就归档"。
现在前面加了一个**身份解析阶段**（`resolveIdentities`，纯函数、无网络、易测）：

```
1. 文件自带的标记优先——这是唯一能在移动中存活的信号
2. 标记指向未跟踪的 memo（从别处复制来的、服务端已归档的）→ 不采信
3. 一个 uid 被两个文件认领 = 复制，不是移动：停在基线路径上的那份是正主，
   其余按新文档创建
4. 没有标记的文件退回 PathIndex（= 改造前的行为，老检出不回归）
5. 都不匹配 → 新文档
```

然后：

| 情况 | 动作 |
|---|---|
| 解析出 uid 且路径与基线不同 | `MoveMemo`（`update_mask=[folder_path, title]`），uid 不变 |
| 移动 + 内容也变了 | 移动和内容更新是**两件独立的事**，都做，顺序无关 |
| 归档阶段 | 按**被认领的 uid** 判断，不再按路径——移动过的文件不会被误判为删除 |

`memogit status` 用同一套解析，新增 `→ 旧路径 → 新路径` 一行，避免"status 说要删除、
push 却做了移动"的口径不一致。

### 5.1 防止服务端静默忽略

旧版本服务端的 `UpdateMemo` 对不认识的 mask 路径是**静默跳过**并返回 200 的。那样
memogit 会把移动记为已完成，下一次 pull 又把文件拖回原处。所以 `moveDoc` 校验返回的
memo 映射到的本地路径是否等于文件当前路径，不等就明确报错。用"映射后的本地路径"而不是
裸字段比较，可以顺带吸收服务端的 `normalizeFolderPath` 和文件名清洗差异。

## 6. 顺带修掉的三个问题

排查和实测过程中撞出来的，都不是本次改造引入的：

### 6.1 服务端：文件夹判空把归档文档也数进去了

`DeleteWorkspaceFolder` 的 `ListMemos` 没传 `RowStatus`，而 `GetWorkspaceTree` 是明确
按归档状态过滤展示的。结果任何曾经删过文档的文件夹都**永远删不掉、却显示为空**。
改成只数 `NORMAL`。文件夹在树里本来就是隐式的（由 memo 的 folder_path 推导），
归档文档日后恢复仍能找回自己的位置。

### 6.2 pull 把服务端保留目录 `.home` 检出到了本地

服务端用 `.home` 存 Home 页配置并对工作区树隐藏它。而 pull 的"收养未跟踪 memo"逻辑
会把它拉下来，写进 `.home/Home.view.json`——但 `listDocFiles` **跳过所有点目录**，
这个文件从落盘那一刻起就是不可见的。于是 push 认为"被跟踪文件不见了"，
**下一次 push 会把用户的 Home 文档归档**。

实测时 English 知识库正好处在这个状态（status 显示 `- .home/Home.view.json` 待归档）。
修法：`inScopeMemos` 统一过滤掉任何会落到点目录下的 memo，让"写得出"和"扫得到"对称。

### 6.3 pull 修路径漂移但不修内容漂移

增量过滤器只看 `updated_ts > last_sync`。一旦某次改动早于水位线（push 推进水位线、
或历史遗留），它对增量过滤器就**永久不可见**了。全量对账本来已经把服务端内容抓在
手里，却只用来修路径漂移。症状是 `status` 一直说"有 2 篇待拉取"，而 `pull` 每次都
报 0 updated，永远收敛不了。

把 `relocateDrifted` 扩成 `reconcileDrifted`：路径漂移和内容漂移一起对账，本地有改动
的照旧不覆盖（内容也变了就走 `.remote` 冲突流程）。实测把 English 卡住的 2 篇拉了下来。

## 7. 实测记录（真实服务端）

在 `/Users/jimmy/Workspace/MemoBase`（MPNP / Wuxia / English）跑的：

| 场景 | 结果 |
|---|---|
| pull 补写标记 | 111 个文件补写；补写后 status 仍 "In sync"（不变式成立） |
| `.view.json` 标记后仍合法 | `json.load` 通过，`memogit-id` 是普通键 |
| 跨文件夹移动 + 改名 | status/push --dry-run 均报 1 move、0 create、0 archive |
| 移动 + 编辑 | 报 1 move + 1 update，两件事分开做 |
| 真实 push 移动 | uid 移动前后一致；服务端 `folderPath`/`title` 确认已更新，state 仍 NORMAL |
| 手动删掉标记 | 退回路径识别，正常同步，打印补写提示 |
| 删除文件 | 仍然正常归档（未回归） |

**实测抓到一个单元测试没覆盖的 bug**：`pushNewDoc` 把新 uid 写进了 state，却没写回
`docs` 切片，导致归档阶段认为它无人认领——文档刚创建就被立刻归档。已修，并补了
`TestNewlyCreatedDocIsClaimed`。这个 bug 只有跑真实 push 才会现形，值得记下来。

## 8. 已知边界

- **两个文件互换路径**（A→B 的位置、B→A 的位置）会撞上服务端
  `(workspace, folder_path, title)` 唯一约束，第一次移动就报错。分两次 push 可绕开。
- **归档不腾出名字**：归档文档仍占用 `(folder_path, title)`，所以删掉某文档后不能
  立刻用同名新建（服务端报 AlreadyExists）。这与 6.1 是同源问题，但修 6.1 只解决了
  文件夹删除，没有改唯一约束本身——改它要考虑归档恢复时的撞名，暂不动。
- **移动会把标题规范化**：本地文件名是清洗过的（`a/b` → `a-b`），移动时按文件名回写
  title，所以带保留字符的标题会在移动后被改成清洗后的形式。这与新建的行为一致。

## 9. 改动清单

```
server/router/api/v1/workspace_service.go  DeleteWorkspaceFolder 判空排除归档（6.1）
internal/memogit/localid.go                新增：标记注入/剥离/解析（4.1、4.2）
internal/memogit/doc.go                    FileContent 成为唯一注入点
internal/memogit/client.go                 新增 MoveMemo
internal/memogit/push.go                   身份解析 + 移动语义 + 归档改按 uid 判断（5）
internal/memogit/pull.go                   ensureLocalIDs 补写（4.3）、reconcileDrifted（6.3）
internal/memogit/sync.go                   localHash、ensureLocalIDs、isHiddenPath（6.2）
internal/memogit/status.go                 复用身份解析，新增 LocalMoved
internal/memogit/{localid,identity,pull}_test.go  新增用例
docs/manual/pumpkin_book_for_llms.md       §1.1 文档身份标记，给 agent 的规则
```
