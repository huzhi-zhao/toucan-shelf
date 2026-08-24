# 对外站点门面的前端方案

需求见 [../../requirements/public-site-front-end.md](../../requirements/public-site-front-end.md)。
发布管线、数据模型与安全边界见同目录的 [tech-design.md](tech-design.md)，
本篇只写门面这一层怎么落地。上线与验收见
[../../launch/20260824-public-site-front-end.md](../../launch/20260824-public-site-front-end.md)。

## 1. 一句话方案

对外做一套**独立的皮肤组件树**（`web/src/components/BlogSite/`），它只吃普通的
视图对象；站点外壳与主题走站点配置，首页编排走 dashboard 那篇 `.view` 的快照，
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
| 导航树 | 同上 | **新增** `nav`：递归的 {label, slug?, children?} |
| 首页块编排 | dashboard 快照的 content | 已有（`dashboard_slug`），前端解析块 JSON |
| 条目 | `ListPublicPages` | 已有；feed / gallery 都走它 |
| 封面 | `ListPublicPages` 的条目 | **新增** `PublicPage.cover_url` |
| 正文 | `GetPublicPage` | 已有 |

三处 proto 改动（`menu` / `nav` / `cover_url`）都是加字段，不动已有语义。

**封面在发布管线里定，写进 `site_publication`**（需求 §8）。取值顺序：白名单
放行的 frontmatter 封面属性 → 正文首图 → 空。渲染时回源文档取图是不行的，
源文档改了图，线上卡片会跟着变，与快照模型冲突。

封面指向的附件照旧进 `site_publication_attachment`，**发布不改它的 access**；
读者取不到的封面进"读者取不到"清单，与正文里的图同一条规则。

## 5. dashboard 的块配置存哪、怎么读

dashboard 是一篇 `.view` 文档，它的 content 是块 JSON。**发布时它照常过管线**，
产出的快照 content 就是这份 JSON（对外块类型不含任何正文，管线的剔除/重写对它
是空操作，但检查照跑：markdown 块里的站内链接同样要求已发布）。

前端拿到快照 content 之后自己解析成 `BlogBlock[]`。解析必须**兜底而不是抛错**：
未知块类型跳过、未知字段回落默认值。首页是站点的门脸，一个字段写错不能让整站白屏。

作者编排用的表单是库内 `.view` 编辑器的一个新分支——**对外块用自己的表单**
（只有 tags / 排序 / 数量 / 列数这几项），不复用 gallery 那张 1300 行的表单。

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

## 9. 分阶段

接在 [tech-design.md](tech-design.md) §7 的 P0～P4 上：

- **P2a 外壳与皮肤**：`BlogSite/` 组件树、站点配置里的菜单与主题白名单、
  对外路由换皮。此阶段先不做首页编排——首页仍是一条平铺的 feed。
  做完这一步站点已经"像回事"，可以停在这里。
- **P2b 首页编排**：`PublicPage.cover_url`、dashboard 块解析、gallery / feed /
  markdown 三种块、编辑器里的对外块表单。
- **P2c 导航树**：站点配置里的树、目录页。
- **P3 搜索页**：接 tech-design §5 的站点索引，替换掉原型里的前端过滤。

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
