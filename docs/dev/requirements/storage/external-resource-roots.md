# 外部资源根：索引 NAS 上已存在的文件

> 初稿。产品方向已对齐，字段与接口尚未细化，未定项以 `TODO(确认)` 标出。
> 技术方案见 [design/20260827-external-resource-roots.md](../../design/20260827-external-resource-roots.md)。

## 一句话目标

让 ToucanShelf 能**索引并引用** NAS 上已经存在的文件（相册、影音、网盘导出、聊天记录备份），
而不要求用户把它们重新上传一遍。文件的增删移仍然归 NAS 侧的工具（File Browser、群晖
自带的文件管理、Immich 等）管，Toucan 只负责**语义**：浏览、检索、标注、被文档引用。

## 为什么现在做不到

三条已核实的现状，合起来构成了这块能力的全部缺口。

### 1. S3 客户端没有 List

[internal/storage/s3/s3.go](../../../../internal/storage/s3/s3.go) 只有
`UploadObject` / `GetObject` / `GetObjectStream` / `DeleteObject`。bucket 对 Toucan
是一个**只写的下水道**：它只能按自己生成的 key 存取，结构上看不见任何不是它创建的对象。

### 2. 附件从属于文档

[store/attachment.go](../../../../store/attachment.go) 里 `Attachment.MemoID *int32`，
附件因为文档而存在。存储路径模板 `assets/{workspace}/{timestamp}_{uuid}_{filename}`
由 Toucan 生成，命名空间归 Toucan 所有。

### 3. `LOCAL` 存储类型被钉死在 data 目录内

`AttachmentStorageType` 只有 `LOCAL` / `S3` / `EXTERNAL` 三种
（[proto/gen/store/attachment.pb.go](../../../../proto/gen/store/attachment.pb.go)）。
其中 `LOCAL` 在
[fileserver.go](../../../../server/router/fileserver/fileserver.go) 里解析为

```go
filePath = filepath.Join(s.Profile.Data, filePath)
```

它是"Toucan 自己的本地存储后端"，不是"任意本地路径"。`Profile.Data` 同时是一条
安全边界（见下方 §安全）。

---

## 产品边界：引用，而不是接管

这是本篇最重要的一条，定了它，后续绝大多数需求判断可以自动完成。

> **Toucan 不做文件管理器。它只做"从知识库里指得到、搜得到、看得见"。**
> 对外部资源**只读**：不搬、不改、不删。

职责划分：

| 谁 | 负责什么 |
|---|---|
| NAS 侧工具（File Browser 等） | 文件的**生命周期**：放进来、挪走、删掉、备份 |
| ToucanShelf | 文件的**语义**：浏览、检索、标注、与文档关联、AI 描述 |

写入路径完全归 NAS 侧，读取与语义路径归 Toucan，零重叠。

这条边界不是自我限制，是可行性前提：一旦允许写，立刻要面对与 NAS 上其它工具的
双写冲突和外部改动检测，而这两个问题在网络文件系统上都没有好解法（见 §扫描）。

### 可执行的判定线

抽象原则容易被"就加一个小功能"侵蚀，因此给一条具体的线：

> **只要资源浏览页面不出现「移动 / 重命名 / 删除文件」的按钮，它就仍然是元数据层。**

出现了，才是滑向文件管理器。

---

## 能力分层

四层，自下而上。上层依赖下层，因此这也是实施顺序。

| 层 | 内容 | 复用情况 |
|---|---|---|
| L1 数据层 | 外部资源根配置、扫描、独立表、稳定 id | 新建 |
| L2 标注层 | 浏览、搜索、tag、desc、AI 生成 | 检索复用现有 RAG 管线 |
| L3 消费层 | 外部资源作为 view 的数据源 | 复用现有 gallery view |
| L4 引用入口 | 编辑器插入媒体时「从外部资源选择」 | 复用现有插入管线 |

### 为什么 L2 不能砍

曾经的一版判断认为 L2（独立的资源浏览页）是在重建文件管理器、做不过 File Browser，
应当跳过它直接做 L3。这个判断是**错的**，原因有二：

1. 它混淆了**浏览**与**管理**。File Browser 拥有文件的生命周期，它恰恰是那个
   **结构上无法**提供 tag / desc / 语义检索的东西。L2 与它互补，不与它竞争——
   L2 正是上表中 "Toucan 管语义" 那一栏的完整实现。
2. **L3 依赖 L2。** 没有 tag / desc / embedding，一个 view 对着外部资源只能按
   路径和 mtime 过滤，价值接近于零。"回忆录"、"Day of History" 这类用法所需的
   全部信息都由 L2 产出。

### 为什么 L3 用 view 而不是新入口

[gallery view](../views/gallery-view.md) 已经是"从大量条目里捞出该看的那些"的
既有范式：一篇 `.view` 文档只存配置，渲染实时画廊，scope 按文件夹 / 标签 / 属性。

给 scope 增加一种「外部资源根 + 过滤条件」之后：

- 用户心智不变——"建一个视图看我的照片"和"建一个视图看我的文档"是同一个动作。
- view 编辑器、渲染器、封面、排序全部复用。
- 「Day of History」不是新功能，是一个带时间过滤条件的 view。

反过来，为外部资源新开一个平行的顶层导航，需要在产品定位上新写一句话；
而 view 这条路复用的是 README 里已有的那句
"how you connect the core documents out of a large hierarchy"——
只是把 large hierarchy 从文档扩展到资源。

---

## 数据模型：独立表，不复用 attachment

外部资源**不进** `attachment` 表。两条理由，都不是语义洁癖：

- **规模不同。** 一个相册目录动辄数万个文件。这些行混进 `attachment` 会让每一个
  现有附件查询都背上一个过滤条件，且拖累其查询计划。
- **生命周期不同。** `attachment` 的行由 Toucan 创建和销毁；外部资源的存亡完全
  不由 Toucan 控制，它只能被动发现。两者的写入路径、删除语义、错误处理都不一样。

`TODO(确认)`：独立表与 `attachment` 之间是否需要一条关联（例如某个外部资源被
某文档引用后是否落一行关系记录），取决于 L4 的引用方式如何设计。

### 稳定 id 与"移动"

文档引用**必须指向 Toucan 自己发的稳定 id，不能指向路径**。

原因：用户在 File Browser 里挪动一个目录，对扫描器而言是"数千个文件消失 +
数千个文件出现"，若引用锚定路径则全部断裂。

续接方式：扫描时用 `(size, mtime, filename)` 三项全中做启发式匹配来续上原 id，
匹配不上的才算真新增 / 真删除。

这个取舍要明确：启发式会误判，但**误判的代价是"引用断了"，而不是"引用到了错误的
文件"**。三项全中的条件下后者概率极低，而前者是可见、可修复的。

> 这与 [cross-reference-repair-on-move-rename.md](../cross-reference-repair-on-move-rename.md)
> 是同一类问题，但性质更难：那边 Toucan 是改动的发起者，能精确感知；这边它是
> 旁观者，只能靠扫描延迟发现。

### 两条字段级要求

现在定下来，后续免于洗数据：

1. **AI 结果幂等，绑定稳定 id。** 扫描会反复执行，AI 调用是有成本的。只对新增或
   变更的对象计算，已有结果不重算。
2. **人工编辑过的 tag / desc 不得被后续 AI 扫描覆盖。** 需要区分来源
   （AI 生成 / 用户编辑）。用户丢失一次手写描述之后就不会再信任这个功能。

---

## 扫描

### fsnotify 不可用

NAS 挂载几乎都是 NFS / SMB 等网络文件系统，改动发生在 NAS 端，客户端内核收不到
通知，文件系统事件在这类挂载上不可靠。**实时监听方案排除**，不再讨论。

### 因此：手动 + 定时

- 用户手动触发一次全量或增量扫描。
- 定时扫描，间隔保守——数万文件的 stat 遍历不是免费的。
- **增量判定用 `path + mtime + size`，不读文件内容。** 对 TB 级数据做全量 hash
  不可接受。

`TODO(确认)`：默认扫描间隔取值，以及是否需要在扫描进行中向前端反馈进度。

---

## AI 标注

### EXIF 优先于模型推理

对"回忆录 / Day of History"这类用法，**最有价值的元数据是 EXIF，不是 AI**：
拍摄时间与 GPS 是确定性的、无成本的、不会出错的，而"三年前的今天"所需要的
仅仅是一个时间戳。

因此：**EXIF 提取是 P0，AI 描述是 P1。**

图像模型生成的是画面描述（"a man standing on a beach"）而非情境，对检索有帮助，
但不是这块能力成立的前提。

### 复用现有 RAG 管线，不引入第二套向量空间

项目已具备完整的向量检索基础设施：

- [internal/ai/embeddings.go](../../../../internal/ai/embeddings.go) —— 嵌入调用
- [internal/rag/vector.go](../../../../internal/rag/vector.go)、
  [search.go](../../../../internal/rag/search.go) —— 余弦排序与 FTS + 向量混合检索融合
- [internal/rag/worker.go](../../../../internal/rag/worker.go) —— 后台索引 worker
- [store/memo_chunk.go](../../../../store/memo_chunk.go) —— `Embedding []float32`
  以小端 BLOB 落库

因此 AI 描述产出后的检索链路是**现成的**，不需要新建。

选型上有一处分叉，取舍见
[design/20260827-external-resource-roots.md](../../design/20260827-external-resource-roots.md)：
图文共享向量空间（CLIP 一类）能直接支持自然语言搜图，但其向量空间与当前文本
embedding 模型的空间不同，余弦相似度不可混算，混入同一张表会得到无意义的结果。
**首版走「图像 caption → 文本 embedding」**，完全复用现有管线；以图搜图作为
后续增强再评估是否值得引入第二张向量表。

---

## 安全

这是本方案中风险最高的一块。

允许配置任意本地路径，等于打开 `Profile.Data` 这条既有的沙箱边界
（[fileserver.go](../../../../server/router/fileserver/fileserver.go)）。
而这是一个**可能面向公网可访问的服务**，做错的后果是任意文件读取。

必须重新处理：路径规范化、`..` 穿越、符号链接跟随、以及外部资源根之间的隔离。

`TODO(确认)`：外部资源的访问授权如何与现有的 workspace 授权模型对接。现有附件
权限继承自宿主 memo 的 visibility（见
[attachments/access-control-and-private-files.md](../attachments/access-control-and-private-files.md)），
而外部资源没有宿主 memo。候选方案是把一个资源根绑定到一个 workspace，
但尚未论证。**这一项定不下来之前不应开工。**

---

## 部署形态

standalone 与 Docker **共存**，两者本就是同一个二进制的不同分发方式，不存在选择问题。
但对本能力而言两者不对等，差异只在**路径可见性**：

| | 配置代价 | 出错方式 |
|---|---|---|
| standalone | 进程跑在宿主上，挂载点天然可见，填路径即可 | 基本不会错 |
| Docker | 容器内看不见宿主路径，须显式挂载 | 用户在 UI 填的路径与他在 File Browser 中看到的对不上 |

NAS 场景下 Docker 反而是主流（群晖 Container Manager、威联通 Container Station），
因此不能轻视。两条硬约束：

1. **只读挂载，且容器内路径与宿主路径保持一致**，例如
   `-v /mnt/nas/photos:/mnt/nas/photos:ro`。不一致会迫使用户在脑中做路径翻译，
   而他唯一的参照系是 File Browser 显示的宿主路径——这是必然出错的设计。
2. **UI 必须提供「测试该路径」**：填完即可验证能否读取、读到多少个文件、
   头几个是什么。在 Docker 形态下这是配错时唯一的反馈来源，否则用户只会看到
   一个空列表，无从区分路径错误、权限不足还是根本没挂载。

---

## 明确不做

- **不在 Toucan 内移动、重命名、删除外部文件。** 这是产品边界，不是排期问题。
- **不把外部文件搬运进 Toucan 的 bucket 或 data 目录。** 只存指向它的记录。
- **不做 fsnotify 实时监听。** 在网络文件系统上不可靠。
- **不为外部资源新建平行的顶层导航入口。** 消费面走 view（L3）。
- **不做全量内容 hash。** 增量判定用 `path + mtime + size`。

---

## 待确认的开放问题

按阻塞程度排序：

1. **外部资源的权限模型**（§安全）——不解决不能开工。
2. 路径沙箱的具体校验策略（符号链接、穿越、根之间隔离）。
3. 独立表与 `attachment` 是否需要关联记录（取决于 L4）。
4. 规模上限。数万行外部资源会把
   [sqlite-as-sole-datasource.md](sqlite-as-sole-datasource.md) 里的容量边界复评
   条件直接顶到线上，这是**要不要做**的前置判断依据，不是"以后再说"。
5. 默认扫描间隔与进度反馈。

---

## 相关

- [backup.md](backup.md) —— 备份只覆盖数据库，外部资源本就不在 Toucan 的管辖内，
  其保全责任属于 NAS 侧。这一点需要在用户手册中写明，避免误解为"Toucan 会备份我的照片"。
- [sqlite-as-sole-datasource.md](sqlite-as-sole-datasource.md) —— 容量边界。
- [../views/gallery-view.md](../views/gallery-view.md) —— L3 复用的既有范式。
- `internal/motionphoto/` 与 fileserver 中的 motion photo 缓存表明项目已在处理
  Live Photo 类媒体，照片方向对现有代码并不陌生。
