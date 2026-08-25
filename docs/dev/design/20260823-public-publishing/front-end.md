# 对外站点门面的前端方案

需求见 [../../requirements/public-site-front-end.md](../../requirements/public-site-front-end.md)。
发布管线、数据模型与安全边界见同目录的 [tech-design.md](tech-design.md)，
本篇只写门面这一层怎么落地。上线与验收见
[../../launch/20260824-public-site-front-end.md](../../launch/20260824-public-site-front-end.md)。

## 1. 一句话方案

对外做一套**独立的皮肤组件树**（`web/src/components/BlogSite/`），它只吃普通的
视图对象；站点外壳与主题走站点配置，首页编排走 dashboard 那篇 `.blogview` 的快照，
两者都通过 `PublicSiteService` 一次性给到前端。

## 2. 被推翻的第一版设想：把库内渲染器拆成"数据源 + 皮肤"

最初的判断是：`GalleryViewRenderer` 同时干了查数据和排版，把它拆成三层
（配置 schema / 可注入的数据源 / 可替换的皮肤），库内注入 `useScopeMemos`，
对外注入发布记录查询，同一个组件出两套皮肤。

**做完前端原型之后这条改掉了。** 原因不是拆不动，是拆了不划算：

- **对外块的配置项本身就和库内不一样。** 库内 `GalleryScope` 的 `folder` /
  `property` 两种规则在对外侧没有语义（快照没有目录、没有 frontmatter 属性），
  对外只剩 tags。共享一个 schema 就意味着一半字段在对外分支永远走不到，
  而这种"在这个模式下这个字段无效"的分支是最容易出安全事故的形状。
- **两边的排版目标是相反的**（需求 §5）：库内求密度，对外求留白与明确的阅读
  入口。硬共用会退化成一堆互相打架的密度参数。
- 真正值钱的复用是 `types.ts` 里那套**解析 + 兜底**的写法（未知字段回落默认值、
  旧结构迁移），这是可以照着写的约定，不是必须共用的代码。

所以最终形态是：**两套渲染，共用一个 `MemoContent`。** 对外那套自己定义块类型、
自己定义视图对象，代码上与库内没有依赖关系——这也顺带保证了对外组件树里不可能
出现一个调用文档表的 hook。

## 3. 分层与目录

```text
web/src/components/BlogSite/
  blog.css            皮肤的全部 token 与组件类，作用域限定在 .blog-skin
  types.ts            视图对象（BlogPost / BlogNavNode / BlogBlock）+ 块选取
  BlogShell.tsx       外壳：顶部菜单、搜索入口、页脚
  BlogBlocks.tsx      首页编排：按块数组从上到下渲染
  BlogGallery.tsx     gallery 块：宽卡片墙
  BlogFeed.tsx        feed 块：左栏主题筛选 + 纵向条目
  BlogCatalog.tsx     导航树页：左栏树 + 右栏列表
  BlogArticle.tsx     单页：站点排版 + MemoContent
  BlogSearch.tsx      站点搜索页
```

**组件收的是普通对象，不是 `Memo` 也不是 `PublicPage`。** 这一条是刻意的：
皮肤不知道数据从哪来，所以同一套组件能渲染真实站点、预览、或者一份 fixture；
接真实数据时写的是一个 `PublicPage → BlogPost` 的转换函数，不是改组件。

## 4. 数据契约：谁给什么

| 东西 | 从哪来 | 要新增什么 |
|---|---|---|
| 站点名、说明、主题 | `GetPublicSiteProfile` | 已有 `theme`（JSON 字符串），需定白名单键 |
| 顶部菜单 | 同上 | `menu`：有序的 {label, path}（P2a 已加，存在 `site.menu`） |
| 导航树 | 同上 | `nav`：递归的 {label, slug?, children?}（P2c 已加） |
| 首页块编排 | site 行上的 `dashboard_snapshot` | `PublicSiteProfile.dashboard_content` 内联下发，前端解析块 JSON（P2b 已落地） |
| 条目 | `ListPublicPages` | 已有；feed / gallery 都走它 |
| 封面 | `ListPublicPages` 的条目 | `PublicPage.cover_url`（P2b 已加） |
| 正文 | `GetPublicPage` | 已有 |

三处 proto 改动（`menu` / `nav` / `cover_url`）都是加字段，不动已有语义。

**封面在发布管线里定，写进 `site_publication`**（需求 §8）。取值顺序：白名单
放行的 frontmatter 封面属性 → 正文首图 → 空。渲染时回源文档取图是不行的，
源文档改了图，线上卡片会跟着变，与快照模型冲突。

落地时补了一条：读 `cover` 的同时**整块 frontmatter 不进快照**。frontmatter 装的是
库内语义（status、order、memogit-id），它本来就不在"可以离开知识库"的白名单上；
以前它只是碰巧没人渲染，现在管线明确把它剥掉。封面值支持
`attachments/{uid}`、`/file/attachments/…` 两种写法和绝对 URL，认不出来的写法
（比如只写个文件名）当作没配，回落正文首图——管线不猜。

封面指向的附件照旧进 `site_publication_attachment`，**发布不改它的 access**；
读者取不到的封面进"读者取不到"清单，与正文里的图同一条规则。

## 5. dashboard 的块配置存哪、怎么读

dashboard 是一篇 `.blogview` 文档，它的 content 是块 JSON。**它不是站点的一个页面**：
没有 slug，不出现在文章列表和目录里，也没有 publication 行。它的快照存在 site 行上
（`site.dashboard_snapshot`），随 `GetPublicSiteProfile` 内联下发。理由很实在——
把首页当成一篇普通文章发出去，它就会以 `index` 为标题、以块 JSON 为正文出现在
"最新"列表里，而这正是早期实现踩过的坑。

快照在**作者在站点设置里选中/重新保存这篇文档时**生成：`.blogview` 既然不走发布，
那就没有别的时机能冻结它；重新保存同一篇 = 首页版本的"更新发布"。生成时正文部分
（markdown 块）逐块过一遍发布管线，站内链接、附件 href 的规则与普通文章完全一致。

`PublishMemo` 直接拒绝两种布局文档，前端也不给它们发布入口——一篇文档不该有两种发法。

### 5a0. 为什么首页是自己的文档类型（`.blogview`），不是 `.view` 的一种用法

对外块和库内块的集合是**不相交**的，而且两端的渲染器都已经拒绝对方：读者端只认
`public_gallery` / `public_feed`（库内块的 folder / property 规则在快照里没有意义），
库内渲染器遇到对外块只能画占位。既然"该用哪一套"在建文档的那一刻就定了、而不是由
它后来被用在哪决定，那它就是**类型**而不是模式。

不用"这篇是不是某站点的首页"来动态收菜单，是因为首页总是先写好、后指定：那样你写的
时候没有对外块可插，指定之后菜单又会悄悄变样。

于是 `DocType` 多一个 `BLOGVIEW`，本地扩展名 `.blogview.json`：

- 编辑器按类型分叉插入菜单——`.view` 给 gallery / calendar / markdown / 文档引用，
  `.blogview` 给 markdown / 对外卡片墙 / 对外列表。附件上传两边都留（首页的 markdown
  块也要放图）。
- 站点设置里的首页下拉**只列 `.blogview`**，服务端 `resolveDashboard` 也只收它。
- 文件树图标、Explore 的 feed 排除、"不能当文章发"这些结构性判断两种类型一视同仁
  （`web/src/utils/docType.ts` 的 `isLayoutDoc`、服务端的 `isLayoutDocType`）。
- memogit 的身份标记本来就注在 JSON 里，所以 `.view.json` → `.blogview.json` 的改名
  是一次 move，不是删+建。

服务端的剪块（下一节）**照剪不误**：`.blogview` 编辑器虽然给不出库内块，但这个文件
是可以手改的、也会经 memogit 进来。

### 5a. 为什么在服务端剪块

一份布局文档里对外块和库内块**可能**躺在一起（编辑器不会这么写，但手改和 memogit
会），而库内块的配置会把库的形状写进去：
gallery 的 scope 里是文件夹路径和 frontmatter 属性规则，calendar 里是新建文档
落到哪个文件夹。读者端渲染器不认这些类型、不会画它们——但**"不渲染"不等于
"没发出去"**，快照是原样进响应体的，于是一个页面上什么都看不见，响应体里却带着
整个库的目录结构。

所以剪在服务端、剪在生成快照的那一刻（`internal/publish/viewblocks.go`），
和导航树裁剪同一个理由。而且是**字段白名单，不只是块类型白名单**：以后给对外块
加字段，这段代码是看不见的，看不见就必须等于"不出去"。剪掉几块会回报给作者，
免得他排的 gallery 悄无声息地不见了。

前端拿到快照 content 之后自己解析成 `BlogBlock[]`（`BlogSite/blocks.ts`）。解析必须
**兜底而不是抛错**：未知块类型跳过、未知字段回落默认值。首页是站点的门脸，一个字段
写错不能让整站白屏。整篇解析不出块时回落成平铺 feed——首页坏了，站点还有页面。

存储上对外块是**自己的类型**（`public_gallery` / `public_feed`），与库内的
`gallery` / `calendar` 并列躺在同一份块 JSON 里，`markdown` 块两边共用（但指向另一篇
文档的 `docName` markdown 块在对外侧丢弃：那篇文档不在这次快照里）。两边各自解析各自
认识的类型，互相跳过——对外侧因此不可能执行一条库内的 folder / property 规则。库内
渲染器遇到对外块时画一条占位说明而不是真渲染：拿活文档去画对外首页，会让作者看到一个
含未发布页面的首页，正是快照模型要消掉的那种误会。

作者编排用的表单与库内 `.view` 编辑器**共用一个组件**（`GalleryViewForm`），靠
`variant` 分叉插入菜单——**对外块用自己的表单**（只有 tags / 排序 / 数量 / 列数
这几项），不复用 gallery 那张 1300 行的表单。共用组件、分叉菜单，是"代码层面复用能力、
界面上不混在一起"的落点。

对外块筛选用的 tag，来源是文档 frontmatter 的 `tags:` 列表，不是正文里的 `#tag`。
作者在属性面板里改一处、发布时快照一次，站点侧就只按快照里的 tags 筛；正文 `#tag`
是上游 memo 流的东西，本项目里已暂停（见 [roadmap](../../roadmap.md)），不进这条链路。

**首页不再要求带 feed 块**（历史上要求过）。当初的理由是快照模型：首页版式在保存那一刻
冻结，只有 markdown 和 gallery 的首页就是一张固定的画，之后发的每一篇都只能靠 URL 到达。
现在顶部导航有 Latest 和 Archive，两者都列出全部已发布页面、都不读首页版式，"新文章无处
可去"这件事已经不成立，限制就没有理由继续存在。新建 `.blogview` 仍预置一个 Latest feed，
但那是默认值，不是约束。

没有设首页的站点，站点根就是一个 Latest feed（全部已发布页面 + tag 筛选），
和首页里那个 feed 块是同一个组件。

## 5a2. 归档页：为什么它不是首页 feed 的另一个入口

首页 feed 回答不了"这个站点发过什么"。它是作者的门面：按 tag 圈定、被 limit 截断、
随首页版式一起冻结。把「全部文章」做成跳到首页 feed，等于让"全部"随作者改门面而变。
所以 `/archive` 是独立页面，只有一个职责——把发过的东西按年份全列出来，不受首页影响。

分页用「加载更多」而不是页码：`ListPublicPages` 的 `page_token` 是 opaque cursor，
翻不出 `?page=7` 这种可寻址 URL。爬虫点不动这个按钮，但**站点的可抓取性本来就不靠它**
——`sitemap.xml` 直接列出每一篇的 slug，归档页只是自己也进一条。（真正的 CSR 债是
爬虫拿不到任何页面的正文，要 SSR 或发布期预渲染才解，见 P4。）

tag 筛选在**已加载**的条目上做，不传给服务端：`ListPublicPages` 的 tag 过滤发生在
分页 limit **之后**，带 tag 的请求可能返回空页却仍带 cursor。这是个已知的服务端缺陷，
归档页绕开它而不是踩上去。

默认菜单是 `Home ""` / `Latest /latest` / `Archive /archive` / `Search /search`。
第一项叫 Home 不叫 Latest——站点根是作者编排出来的版式，不一定是"最新"列表，用 Latest
命名等于承诺了一件它不保证的事。正因为如此，`/latest` 需要单独一页：一旦作者摆了首页
`.view`，"最近发了什么"就没有页面回答了。它和归档也不是一回事——`/latest` 是最新的一屏，
归档是按年份分组的全部。

`latest` 与 `archive` 一起进了保留 slug，并在站点设置里各有一个开关（`SiteChromeEditor`）。
开关改的就是 menu 这份作者数据本身：关掉＝把那一项从 menu 里删掉，打开＝插回 Home 之后、
作者自己加的项之前。没有另开字段，因为菜单只该有一个真相。Archive 是"看全部"在 blog 世界里的通用叫法（Ghost / Hugo / Jekyll 的
主题都这么叫），也是首页替代不了的那一页。

**菜单是作者数据，改默认值不会动已有站点**：老站点还是存着自己的 menu，要在站点设置里
自己加 `archive` 那一条。

## 5a. 署名：站点配置，不是发布者账号

页面上的署名取自 `site.author_name`，留空时回落到站点显示名。它**不是**登录名：登录名是
凭据的一半，而且在多人协作时署名会跟着"谁点了发布"变，那不是读者要被告知的事。
发布者依然记在 `site_publication.publisher_id`，只出现在作者侧的 `Publication.publisher`，
不跨到 `PublicSiteService`。

回落在服务端 `GetPublicSiteProfile` 里算完再下发（`PublicSiteProfile.author_name`），
这样首页 / 目录 / 文章 / 搜索 / 归档五个读者面不会各算各的。

## 5b. 导航树：为什么在服务端裁剪

树是**作者手写的**，存在 `site.nav`（嵌套 JSON），与菜单同一类东西：它要在
目录页上渲染，而目录页不读 dashboard 文档。校验也与菜单同一套——每一项要么指向
本站点的一个 slug，要么只是个分组，绝对 URL 与 `javascript:` 一律拒。

裁剪放在**服务端**（`GetPublicSiteProfile`）而不是前端，理由是两条不同的：

1. 指向未发布文章的项如果原样下发，前端要么画成死链，要么自己去比对已发布列表
   ——后者等于把"哪些没发布"这件事送到读者手上。
2. **只留一个标签也是泄露。** 一项写着「薪酬制度」却点不动，本身就说明库里有这么
   一篇。所以规则是：slug 不在已发布集合里就把 slug 抹掉，抹掉后底下也没有幸存的
   子项，整项不下发。

作者侧相反：编辑器保留他写的全部条目，因为先搭树后发文是正常顺序。两边看到的树
不一样，这是刻意的。

目录页路径 `contents` 进了 `reservedSlugs`，与 `search` / `d` 同列，否则一篇文章
的 slug 能顶掉站点自己的目录页。

## 6. 主题怎么落地

皮肤的全部取值走 CSS 自定义属性，作用域限定在 `.blog-skin`：

```text
--blog-bg / --blog-surface / --blog-ink / --blog-ink-soft / --blog-ink-muted
--blog-hairline / --blog-accent / --blog-accent-soft
--blog-font-display / --blog-font-body
--blog-cover-radius / --blog-shell-max / --blog-gutter / --blog-prose-max
```

站点的 `theme` JSON 是这批键的一个**白名单子集**，服务端校验后原样下发，前端
写成内联的 `style` 变量。**不允许任意 CSS**（需求 §6）——白名单在服务端校验，
不在前端，否则改一下请求就绕过去了。

P2a 落定的键名就是上面那批去掉 `--blog-` 前缀（`bg` / `ink-soft` / `font-body`
/ `prose-max` ……），前端写回去时补上前缀。服务端除了校验键在不在白名单里，
还按键的类型校验值的形状：颜色只收 hex 或 `rgb()/hsl()` 这四个函数、长度只收
"数字 + 单位"（不收 `calc()` / `clamp()`，需要它们的默认值本来就写在样式表里）、
字体栈不收括号，所以 `url(…)` 根本进不来。见 `server/router/api/v1/site_theme.go`。

菜单同理要校验：每一项的 path 只能是本站点内的一个 slug 或空（首页），
绝对 URL 与 `javascript:` 都会被拒——否则站点自己的导航就成了外链列表或一段脚本。

正文那块有一个额外动作：`MemoContent` 是按应用主题变量写的，所以 `.blog-skin`
上要把 `--foreground` / `--background` / `--border` 这些**重新映射到站点 token**。
这是"复用渲染器"必须付的成本，也是它带来的好处的另一面——映射一次，往后编辑器
新增的所有块都自动跟着站点主题走。

**对外页面不调用应用的主题初始化**（那套从 localStorage 读、往 `:root` 注入
`<style>`）。站点长什么样不该由读者本地存了什么决定。

## 7. 界面语言：写死英文

对外组件的文案**不接应用的 i18n**（那套按登录用户偏好切，对外没有登录用户），
也不做站点级语言配置——需求 §9 定了只支持英文。

落法：所有对外文案集中在 `BlogSite/copy.ts` 一处，组件从那里取常量，不从
`useTranslate` 取。集中放而不是散在各组件里，是为了将来真要放开多语言时，
换的是这一个文件而不是翻一遍组件。

字体栈的取值基准按西文定。原型里显示字体用了系统里常见的几何无衬线（mac 上落到
Avenir Next），中文靠字体栈兜底。**要不要自托管一个西文显示字体是一个未决项**，
它影响首屏和离线可用性，留到主题白名单定稿时一起决定。

## 8. SEO 与渲染方式（记一笔欠账）

对外页面现在是主应用 SPA 里的一组 lazy 路由，纯客户端渲染。要做需求那篇 §10 的
SEO（sitemap、canonical、OG、撤下页 410），至少要服务端能吐出正确的 meta。

三条路，按代价排：

1. **保持 CSR，服务端只为对外路由注入 meta 和 sitemap。** 最省，但爬虫拿到的
   正文是空的，对"团队对外文档站"这个场景是实打实的打折。
2. **对外路由服务端渲染。** SEO 最好，但要在 Go 端引入一套 JS 渲染，是本项目
   目前没有的形态。
3. **发布时生成静态 HTML 快照，对外路由直接吐。** 与快照模型天然契合（内容本来
   就只在发布时变），但要处理 feed 的实时性——首页的条目是活的（需求 §4）。

**当前选 1**，把 2 和 3 留到 P4。之所以现在就写下来，是因为第 3 条一旦要做，
影响的是"皮肤住在哪"——皮肤越晚搬家越贵。

**第 1 条已经落了（P4 的 SEO 那半）**，实现在 `server/router/frontend`：SPA 对
所有路由吐的是同一个 shell，所以服务端唯一能对爬虫说的话就是**状态码和响应头**。
落了这几条：

- 站点自己的 `sitemap.xml` 和 `robots.txt`（只列本站点已发布 slug，绝不掺
  应用自己那份 public memo 列表）。
- `Link: <...>; rel="canonical"`，按 `site.canonical` 在平台路径和自定义域名之间
  选一个；非规范的那个入口的 `robots.txt` 直接 `Disallow: /`。
- **撤下的文章返回 410、从没存在过的 slug 返回 404**，两者都加
  `X-Robots-Tag: noindex`。这条是这半边最要紧的：SPA 对任何 URL 都回 200，
  撤下一篇文章之后爬虫看到的仍然是"200 + 一个客户端渲染的找不到"，文章会一直
  留在搜索结果里——撤下等于没撤。
- 非 ONLINE 的站点在这里**根本解析不出来**，所以它的域名上拿到的是应用自己的
  robots/sitemap，跟"这个站点不存在"一致。

正文仍然是空的（爬虫拿不到内容），欠账没还，只是不再有"撤下了还被索引"这种
硬伤。第 2 / 3 条留在原地。

## 9. 分阶段

接在 [tech-design.md](tech-design.md) §7 的 P0～P4 上：

- **P2a 外壳与皮肤**（已完成）：`BlogSite/` 组件树、站点配置里的菜单与主题白名单、
  对外路由换皮。此阶段先不做首页编排——首页仍是一条平铺的 feed。
  做完这一步站点已经"像回事"，可以停在这里。
- **P2b 首页编排**（已完成）：`PublicPage.cover_url`、dashboard 块解析、gallery /
  feed / markdown 三种块、编辑器里的对外块表单。
- **P2c 导航树**（已完成）：站点配置里的树（`site.nav`）、`/contents` 目录页、
  服务端按已发布集合裁剪。
- **P3 搜索页**（已完成）：`/search` 路由接上 `BlogSearch.tsx`，匹配走服务端的
  `SearchPublicPages`（tech-design §5 的 LIKE 子串版），原型里的前端过滤已删。
  查询放在 URL 的 `?q=` 上，输入防抖 250ms。**不做前端过滤**是硬要求：feed 只有
  一页、且不带正文，在它上面过滤等于只搜最新几条的标题。

P2a 之前不要先做 P2b：没有外壳的块编排是没有容器的内容。

## 10. 风险登记

| 风险 | 影响 | 怎么处理 |
|---|---|---|
| 对外块的表单/查询被从库内直接搬过来 | 匿名读者能列到未发布文档 | 对外组件树不依赖任何库内查询 hook；code review 看 import |
| 主题白名单只在前端校验 | 存储型 XSS | 白名单在服务端校验后才落库 |
| dashboard 块 JSON 解析抛错 | 站点首页白屏 | 解析全程兜底：未知块跳过、未知字段回落默认 |
| 封面回源文档取图 | 线上卡片跟着源文档变，破坏快照语义 | 封面在发布时定并存进快照 |
| 界面文案接了应用 i18n | 英文站点冒出中文按钮 | 文案集中在 `copy.ts`，不用 `useTranslate` |
| CSR 导致爬虫拿不到正文 | 对外文档站场景打折 | 已知欠账，见 §8，P4 复评 |
