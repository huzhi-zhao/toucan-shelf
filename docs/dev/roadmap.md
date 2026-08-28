# Roadmap —— 能力阶段

常青文档，原地改写。

**未竟事项已迁出**：所有"还没做"的条目现在集中在仓库根目录的
[TODO.md](../../TODO.md)，那里是本仓库唯一允许写待办的地方。
本篇只保留**能力阶段**——每块能力交付到了什么程度、交付过程中定下的、
读代码之前不容易看出来的结构性事实。

准入判据同 [README §顶层](README.md)：只收**当前系统的可证伪属性**，
不写排期、负责人与状态。

---

## 对外发布（Publish）

单篇文档发布到对外站点。

- 需求：[20260823-public-blog-publishing.md](requirements/20260823-public-blog-publishing.md)
- 门面（外壳、首页编排、主题、皮肤）单独一套：需求
  [public-site-front-end.md](requirements/public-site-front-end.md)、方案
  [design/20260823-public-publishing/front-end.md](design/20260823-public-publishing/front-end.md)、
  上线 [launch/20260824-public-site-front-end.md](launch/20260824-public-site-front-end.md)
- 方案与分阶段切分：[design/20260823-public-publishing/](design/20260823-public-publishing/tech-design.md)
- 上线与验收：[launch/20260823-public-publishing.md](launch/20260823-public-publishing.md)

主体已交付。剩余欠账（自定义域名、CSR 爬虫、`site_chunk` 索引复评）见
[TODO.md](../../TODO.md)。

### 交付过程中定下的结构性事实

这些是读代码之前不容易看出来、且改动时容易踩的约定：

**首页不是站点的一个页面。** 布局文档不能当普通文章发（服务端拒、前端不给入口），
快照存在 site 行上（`site.dashboard_snapshot`）、随站点 profile 内联下发，
在设置里选中或重新保存这篇文档时生成。它**没有 slug**，因此不会像早期实现那样
以 `index` 为标题带着一坨块 JSON 混进文章列表。

**首页文档自成一类文档类型。** 新增 `BLOGVIEW`（本地 `.blogview.json`），从 `.view`
里分了出来——对外块与库内块的集合不相交、两端渲染器互相拒绝，该用哪一套在建文档
那一刻就定了。编辑器共用同一个组件、按类型分叉插入菜单；站点设置的首页下拉只列
`.blogview`，`.view` 被服务端明确拒绝当首页。

**"不渲染"不等于"没发出去"。** 生成首页快照时在**服务端按字段白名单剪块**：
库内 gallery / calendar 的 scope 里写着文件夹路径和 frontmatter 属性规则，
读者端不渲染它们，但不剪就等于发出去了。同理，导航树按已发布集合**在服务端裁剪**——
指向未发布文章的项不下发（不是前端不渲染），底下什么都没有的分组整项消失，
因此既不会出现死链，也不会靠一个标签泄露某篇文档存在。

**封面在发布时定进快照**（`PublicPage.cover_url`），取值顺序为 frontmatter `cover`
→ 正文首图 → 空。同一管线里开始剥掉整块 frontmatter。

**主题白名单在服务端校验后才落库。**

**站内搜索目前是最小实现。** `SearchPublicPages` 在 `site_publication` 上做 `LIKE`
子串匹配（标题 / 摘要 / 快照正文，多词全中，转义 `%` `_`），没有索引表、没有分词、
没有向量。隔离要求由"只查快照表"这一条满足——匿名读者搜不到未发布文档，
也搜不到发布之后新加的正文。

**SEO 治的是 SPA 的 200 问题。** 站点自己的 sitemap / robots（只列本站点已发布
slug）、按 `site.canonical` 下发 `Link: rel="canonical"`、非规范入口 `Disallow`、
撤下页 410 + 从未存在的 slug 404 + 两者 `X-Robots-Tag: noindex`。
没有这些的话，SPA 对任何 URL 都回 200，撤下一篇文章之后爬虫看到的还是 200，
文章会一直留在搜索结果里。

走 fixture 的预览原型（`/blog-preview`）已删。

---

## 已暂停的能力

### 正文 `#tag`

上游 memos 的标签是打在正文里的 `#tag`，由 `server/runner/memopayload` 抽进
`memo.payload.tags`。

本项目是知识库不是 memo 流：文档的分类走 frontmatter 的 `tags:` 属性
（属性面板里看得见、改得动，一处声明而不是散落正文）。**`#tag` 因此暂停**——
现有解析和统计代码保留，但不再作为任何新功能的输入。

对外发布已经先落地了这条：`site_publication` 的 tags 只读 frontmatter，
`#tag` 一个都不进快照（见
[public-publishing/tech-design.md](design/20260823-public-publishing/tech-design.md) 第 5 步）。

清除遗留解析代码的待办见 [TODO.md](../../TODO.md)。
