# 对外发布（Publish）技术方案

需求见 [../../requirements/20260823-public-blog-publishing.md](../../requirements/20260823-public-blog-publishing.md)。
本篇写怎么落地、被否决的选项及原因、分阶段怎么切风险。上线执行与验收判据见
[../../launch/20260823-public-publishing.md](../../launch/20260823-public-publishing.md)。

门面那一层（外壳、首页编排、主题、皮肤）单独拆了一篇：
[front-end.md](front-end.md)。本篇 §4 末尾对 `.view` 前端查询的判断在那篇里被
修正过，以那篇为准。

## 1. 一句话方案

发布 = 把文档正文过一遍发布管线，产出一份只读快照存进独立的表；对外站点只读
这批快照，任何时候都不查知识库的文档表。站点搜索也只索引这批快照。

## 2. 数据模型：全部新表，`memo` 一个字段都不加

三个理由：一篇文档可以发到多个站点，是多对多，字段放不下；快照是大文本，而
`memo` 是 memogit / MCP / RAG / 列表查询天天在扫的热表；发布状态必须与
`visibility`、`memo_share` 分开存（[roadmap.md](../../roadmap.md) 已记过这一条）。

```
site                          站点（blog 空间）
  id / uid / team_id / name
  domain UNIQUE               自定义域名，未绑定为空
  domain_verified             域名归属校验通过标记
  canonical                   'PLATFORM' | 'DOMAIN'
  status                      'DRAFT' | 'ONLINE' | 'OFFLINE'  站点上线开关
  dashboard_memo_id           指向作为首页的那篇 .view 文档
  theme                       主题配置 JSON
  search_mode                 站点级检索模式（不是用户偏好）

site_publication              一次发布 = 一条快照
  id / uid / site_id / memo_id
  slug                        UNIQUE(site_id, slug)
  UNIQUE(site_id, memo_id)    一篇文档在一个站点里只有一条发布记录
  title / summary
  content                     发布管线的输出（已剔加密块、已重写链接）
  meta                        JSON：对外 tags、OG、canonical 指向等
  source_updated_ts           快照对应的源文档版本，用来算"线上落后了"
  state                       枚举 'PUBLISHED' | 'UNPUBLISHED'（预留 'PENDING'）
  publisher_id / published_ts / updated_ts

site_publication_attachment   这条快照引用了哪些附件
  publication_id / attachment_id
  发布不动附件权限（需求 §9），所以这是一张引用索引而不是授权账本：
  它回答"这个文件要是转回私有，哪些线上页面会坏"

site_publication_link         这条快照里的站内出链
  publication_id / target_memo_id / raw_href
  撤下 B 时反查谁引用了它。与 memo_link 是两回事：那张表记的是活正文的链接

site_chunk                    站点搜索索引，结构照抄 memo_chunk
  id / publication_id / site_id / chunk_index / content
  embedding / embedding_model / embedding_dim
site_chunk_fts                FTS5(content, tokenize='trigram')，rowid = site_chunk.id
```

两个设计点值得单独说：

- **`state` 用枚举而不是 `published` 布尔**，是为了将来放开 member 发布时加
  `PENDING`（待审核）不用改表。成本为零，现在就该这么建。
- **`site_publication_link` 与 `memo_link` 不合并**。`memo_link` 索引的是当前
  正文，快照冻结后两者会分叉；撤下时要查的是"快照里有没有指向我"，不是"现在
  的正文里有没有"。合并会让这两个语义互相污染。

`team_id` 当前只有一个值（第一个注册的 admin 所属团队），但字段现在就留，
理由见需求 §3。

## 3. 发布管线

一次发布 / 更新发布是一个事务，顺序固定：

1. 权限判定 `canPublish(user, site, memo)` —— 当前实现是 `role == ADMIN`。
2. **以发布者本人的权限上下文**读取源文档与它引用到的一切。不用超级用户上下文，
   理由见需求 §4 第 4 条：这是四条预留约束里唯一后补代价大的一条。
3. 解析正文，产出三份清单：站内文档引用、附件引用、加密块。
   - 站内引用按**源文档所属知识库**解析工作区根相对路径；关闭库内渲染那层
     "全树按标题兜底匹配"（会匹配到未发布文档）。
4. 检查（全部按目标站点判）：引用了未发布到本站点的文档 → 整体失败并报明细；
   命中私密附件 → 失败；普通未公开附件 → 列进"读者取不到"清单，**不阻断也不
   放开**，由作者自己去附件那边处理（需求 §9）。
5. 生成快照正文：剔除 `toucan-secret` 块、重写站内链接到 `/<slug>`、重写附件
   链接到站点域名、按白名单挑出对外 frontmatter 与 tags。
6. 首次发布生成 slug（撞则加后缀，过保留字表）；更新发布不重新生成。
7. 写 `site_publication` + 两张附属表。附件权限一个字节都不动。
8. 重建这条快照的 `site_chunk` / `site_chunk_fts`。

撤下是逆过程：`state` 置 `UNPUBLISHED`、删 chunk、反查 `site_publication_link`
列出会产生死链的页面并警告。附件权限不回收——发布没放开过。文档归档等同撤下。

**加密块要守两点**，只做第一点是不够的：快照里不留指针块；`SecretBlockService`
对匿名请求一律拒。正文里本来就没有密文（只有一个 id 指针，密文在 `secret_block`
表），所以剔了块但服务端不拦，对外页面的脚本照样能把密文和 KDF 参数取走。

## 4. 对外读路径

新增一组**匿名可访问、只查 `site_*` 表**的接口，独立于现有 memo API：

- 按 Host 找站点 → `status == ONLINE` 才继续，与实例的 `AllowAnonymous` 解耦
  （那个开关现在等价于"实例配了 InstanceURL"，管的是主应用，不该管站点）。
- `/` → dashboard 的快照（版式）+ 实时查 `site_publication` 得到条目。
- `/<slug>` → 一条快照。`/d/<doc-id>` → 查本站点的发布记录，没有就 404。
- `/search?q=` → 站点搜索。

前端复用现有渲染器加一个**对外模式**，但 `.view` 的数据查询不能复用——
现在 gallery 的 scope 查询是前端 `useScopeMemos` 按当前登录用户查文档表的
（[gallery-view.md](../../requirements/views/gallery-view.md) §5），对外必须换成
上面这组只读发布记录的接口。这是本次工作量被低估最容易发生的地方。

## 5. 搜索

检索算法整套复用 `internal/rag/search.go`（FTS + 向量 RRF 融合、相对分数裁剪、
无 embedding 降级纯 FTS），但它现在是**写死查 `memo_chunk`、候选集由调用方传
`SearchParams.MemoIDs`**。复用需要把"查哪张 chunk 表 / 候选集从哪来"参数化，
属于中等改动，不是接一个函数就完事。

索引在发布事务里同步重建，不进 `memo_index_job` 队列——快照的数据源只在发布
动作时变，不需要追编辑。embedding provider 用实例那份配置。

为什么不复用知识库索引 + 候选集过滤：快照冻结后作者继续改的正文如果留在共用
索引里，匿名读者用关键词能召回这篇文章，"这个词出现在这篇文章里"就漏出去了。
这是过滤条件挡不住的，只能靠索引隔离。

## 6. 放开给 member 的改动量评估

结论：**只要下面四条现在守住，将来放开是"加一张授权表 + 换一个权限判定函数"，
不是重构。**

已在模型里预留：站点与发布记录挂 `team_id`（不挂 admin 账号）；`state` 是枚举
（加 `PENDING` 不改表）；每条快照记 `publisher_id`；快照生成走发布者权限上下文。
第 4 条现在只管快照读取——附件不再由发布动作放开，那条越权面本身就不存在了。

放开时要加的东西：一张"谁能往哪个站点发 / 哪个库的内容能进哪个站点"的授权表，
`canPublish` 从 `role == ADMIN` 改成查这张表；要审核就多一个 `PENDING` 状态和
一个审批入口。都是加表加分支，不动已有数据。

真正会伤筋动骨的只有第 4 条被违反的情况：如果快照生成图省事写成"以管理员身份
读一切"，member 发布时的越权检查没有落点，那时候要把整条管线的读取上下文翻一遍。
所以这条不是"最好这样"，是硬约束。

## 7. 分阶段切风险

每一阶段自身可用、可停在那里不继续。

- **P0 站点与快照**：`site` / `site_publication` 两张表、发布管线的检查与剔除、
  按 Host 的对外只读路由、`/<slug>` 单页渲染。此阶段先不做 dashboard、不做搜索、
  只用平台路径不绑域名。**安全相关的检查全部在 P0 做完**——它们不是后续增强，
  是这块能力能不能上线的前提。
- **P1 撤下与一致性**：撤下 / 归档联动、反向引用警告、编辑器里的"线上落后于
  当前版本"提示与更新发布入口。
- **P2 dashboard 与 feed**：`.view` 新增 feed block、对外数据源接口、
  站点首页路由。
- **P3 站内搜索**：`site_chunk` 两张表、检索层参数化、站点搜索页。
- **P4 域名与 SEO**：自定义域名 + 归属校验 + 证书、canonical / 301、
  sitemap / robots / noindex、撤下页 410。

P0 之前不要先做 P4：域名让站点看起来像回事，但没有 P0 的检查就等于把没过闸的
内容挂到全网。

## 8. 风险登记

| 风险 | 影响 | 怎么处理 |
|---|---|---|
| 跨库汇聚后站内链接解析歧义 | 链到错误的文档 | 按源文档所属库解析，关闭标题兜底匹配（管线第 3 步） |
| 快照生成误用超级用户上下文 | member 放开时无越权检查落点 | 硬约束，P0 就守，code review 重点 |
| `.view` 前端查询被直接复用到对外 | 匿名读者能列到未发布文档 | 对外只走 `site_*` 只读接口，P2 的主要工作量 |
| 附件公开与文章公开被混为一谈 | 一次点击开两道门，作者只看见一道 | 发布不碰附件权限，只列出读者取不到的文件（需求 §9） |
| 主题可定制 | 存储型 XSS | 主题只允许受限的配置项，不允许任意 HTML / JS，与 gallery view 既有约定一致 |
| 匿名流量打到主应用 + SQLite | 慢查询拖垮内部使用 | 快照天然可缓存；先加边缘缓存与限流再放量 |
| 按 Host 自动签证书 | 被人利用刷证书 | 域名归属校验 + 签发限流（P4） |
