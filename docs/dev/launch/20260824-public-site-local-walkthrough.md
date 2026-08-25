# 对外站点：本地跑一遍

[20260824-public-site-front-end.md](20260824-public-site-front-end.md) 那份是验收
清单（"要验什么、看到什么算过"）。这份是**照着敲的操作步骤**，把 P2a / P2b /
P2c / P3 / P4-SEO 五段在本地实例上串一遍。跑完这份，再回那份清单勾条目。

预计 40～60 分钟，其中大半是准备内容（写几篇文章、编排首页）。

## 0. 先知道这一条，不然会白折腾

**开发模式下有两个端口，它们能验的东西不一样：**

| | 谁在服务 | 能验什么 |
|---|---|---|
| `localhost:3001` | vite | **所有页面和交互**（外观、菜单、目录页、搜索框、编辑器） |
| `localhost:8081` | Go | **状态码、响应头、robots/sitemap**（410 / 404 / canonical） |

vite 只把 `/api`、`/file`、`/memos.api.v1` 代理给 Go，`/s/...` 是它自己的 SPA
history fallback——**在 3001 上不管什么 URL 都回 200**。所以第 6 步那些 curl
必须打 8081，打 3001 的话三种情况都是 200，等于没验。

反过来，8081 内嵌的 `server/router/frontend/dist` 只有一个占位 `index.html`，
在 8081 上用浏览器打开站点是**看不到页面的**——那是正常的，不是 bug。要看页面就
去 3001。

## 1. 起实例

先拿一份数据库副本跑，别拿正在用的那个——这一趟要建站点、发文章、撤下文章。

```bash
sqlite3 memos_prod.db ".backup /tmp/memos_local.db"
```

用 `.backup` 而不是 `cp`：`cp` 不会带上 WAL 里还没落盘的部分，而且如果实例正开着，
拷出来的可能是个空文件。拷完先确认一下不是空的：

```bash
sqlite3 /tmp/memos_local.db "SELECT count(*) FROM memo;"
```

```bash
go run ./cmd/memos --port 8081 --dsn /tmp/memos_local.db --instance-url http://localhost:8081
```

`--instance-url` **必须给**：canonical 和 sitemap 的绝对 URL 都是从它算出来的，
不给的话 sitemap 直接 404，第 6 步全部验不了。

另开一个终端：

```bash
cd web && pnpm dev
```

浏览器开 `http://localhost:3001`，用 James 登录。

## 2. 确认迁移跑了

```bash
sqlite3 /tmp/memos_local.db "SELECT id, name, nav, search_mode FROM site;"
```

（这一步要在实例**起来之后**再敲——迁移是服务启动时跑的，服务没连过这个文件的
话，查什么表都是 `no such table`。）

存量站点的 `nav` 应当是 `[]`，`search_mode` 是 `HYBRID`（这一列**现在没人读**，
搜索是子串匹配，没有模式可选，见方案 §5）。

顺手查一次 slug 冲突——`contents` 和 `search` 是这次才进保留名单的，之前发布的
文章不受新校验约束：

```bash
sqlite3 /tmp/memos_local.db "SELECT id, site_id, slug FROM site_publication WHERE slug IN ('contents','search');"
```

查出来东西的话，先在编辑器里把那篇的 slug 改掉，否则它会被目录页/搜索页顶掉。

## 3. 准备内容（这一步花的时间最多，但省不掉）

在**设置 → 站点**（`/setting#site`）建一个站点，`status` 设成 **ONLINE**。
记下 URL 里 `/s/<siteUid>` 那一段，后面全用它。

然后准备这些文档并发布到这个站点：

- **至少 3 篇文章**。少于 3 篇看不出版式问题——卡片墙和 feed 在一条数据下都好看。
- 其中 **1 篇带封面图**、**1 篇不带**。没有封面的卡片必须自己成立。
- **1 篇带 frontmatter**（写上 `status`、`memogit-id` 这类库内字段）。
- **1 篇正文里藏一个独特的词**，比如 `蓝莓松饼`，且这个词**不出现在标题和摘要
  里**。第 5 步搜它。
- **1 篇 `.blogview` 文档**当首页（左侧树上"新建 → 新建站点首页"，不是"新建视图"；
  `.view` 在站点设置的首页下拉里根本不会出现）：里面要同时有 markdown 块、对外卡片墙、对外列表
  三种，否则验不出编排。建好后在站点设置里选成首页。
- **1 篇写好但不发布**的文档，正文里也藏一个独特的词，比如 `薪酬草案`。

导航树在**设置 → 站点 → 导航树**配一棵两层的，其中**故意挂上那篇没发布的**
——这一项是 P2c 最关键的验收点，没有它就没验到东西。顶部菜单里加一项 path 填
`contents`。

## 4. 页面与外观（P2a / P2b / P2c，在 3001 上看）

1. 打开 `http://localhost:3001/s/<siteUid>`、一篇文章页、`/contents`、`/search`、
   再随便编一个不存在的 slug。**四个页面的外壳一致**，404 页也有外壳。
2. 在站点设置里改一份非默认主题 → 四个页面跟着变，**且文章正文也跟着变**。
   正文变了才说明变量映射做对了。
3. 在应用里切换主题 / 深色模式 / 清空 localStorage → **站点外观一点都不变**。
4. 首页应当是编排后的样子（不是平铺 feed）。把某个对外卡片墙的列数填成 `7`
   这种非法值重新发布 → 首页**照常渲染、该字段回落默认**，不是白屏也不是整块
   消失。然后改回来。
5. 打开那篇带 frontmatter 的文章，看页面源码里**没有** `status` / `memogit-id`。
6. 打开 `/contents`：树里那篇**未发布**的文章对应的项**整条不出现**——不是灰掉，
   也不是死链。然后确认不是前端藏的：

   ```bash
   curl -s 'http://localhost:8081/api/v1/public/site?site=sites/<siteUid>' | jq .nav
   ```

   接口返回里也不该有它的标签——标签本身就说明库里有这么一篇。
7. **开着 DevTools 的 Network 看一遍这四个页面**：请求里**不该出现 memo /
   workspace 接口**。这是这次最该盯的一项，看请求不看代码。

## 5. 搜索（P3，在 3001 上看）

1. 顶部搜索入口 → `/search`，搜第 3 步那个只在正文里的词（`蓝莓松饼`）→
   **能搜到**。搜得到才说明搜的是快照正文，不是前端在 feed 上过滤。
2. Network 里确认打的是 `SearchPublicPages`，不是把 feed 拉下来自己过滤。
3. 搜那篇**未发布**文档里的词（`薪酬草案`）→ **没有结果**。
4. 把那篇已发布文章在库内编辑，加一个新词，**不点更新发布** → 搜这个新词
   **没有结果**，且文章页看到的还是旧正文。两条一起才说明快照语义是一致的。
5. 搜索框输入 `%` → **没有结果**，不是列出全站。
6. 搜两个词（一个在文章里、一个不在）→ 没有结果。是收窄不是放宽。

## 6. SEO（P4-SEO，**必须在 8081 上用 curl**）

浏览器上 200 / 410 / 404 长得一模一样，所以这一段只能看状态码。

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/s/<siteUid>/<已发布的slug>
```

期望 `200`。然后在编辑器里**把这篇撤下发布**，再打同一条：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/s/<siteUid>/<刚撤下的slug>
```

期望 `410`——曾经有、现在没了。**这条是这半边的全部意义**：不做的话爬虫看到的
还是 200，文章会一直留在搜索结果里，撤下等于没撤。

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/s/<siteUid>/never-was
```

期望 `404`——从没存在过，不是 410。

再看两个响应头（撤下的和不存在的都应当有 `X-Robots-Tag: noindex`，已发布的
**不应该有**）：

```bash
curl -sI http://localhost:8081/s/<siteUid>/<已发布的slug> | grep -iE '^(link|x-robots-tag):'
```

期望只有一行 `Link: <http://localhost:8081/s/<siteUid>/<slug>>; rel="canonical"`。

sitemap：

```bash
curl -s http://localhost:8081/s/<siteUid>/sitemap.xml
```

里面只有本站点**已发布**的 slug；**不出现**刚撤下的那条，也**不出现**
`/memos/`——那是应用自己的 public memo 列表，混进来就是把库内内容推给了爬虫。

最后确认应用自己那份没被影响：

```bash
curl -s http://localhost:8081/robots.txt
```

应当还是 `Host: http://localhost:8081` 那份。

## 7. 站点下线

把站点 `status` 切成 OFFLINE，然后：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/api/v1/public/site?site=sites/<siteUid>
curl -s http://localhost:8081/s/<siteUid>/sitemap.xml
```

接口应当 404（离线站点与不存在的站点不可区分），sitemap 里不该再有这个站点的
任何 slug。切回 ONLINE 收工。

## 8. 跑完之后

回 [验收清单](20260824-public-site-front-end.md)第四、五节勾条目；有对不上的
直接把**哪一步、敲了什么、看到什么**贴回来。清理：

```bash
rm /tmp/memos_local.db
```
