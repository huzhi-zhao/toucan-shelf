# 手机端阅读：实施方案

需求见 [../requirements/mobile-reader.md](../requirements/mobile-reader.md)。
本篇回答"怎么落地、分几步、每步怎么验收"。

## 1. 总体结构

```
web/
  index.html            web 端入口（不动）
  mobile.html           手机端入口（新增）
  src/mobile/           手机端全部代码（新增）
    main.tsx            启动：Provider、主题、路由
    mobile.css          样式入口：web 的全局样式 + Konsta 主题
    routes.ts           路由路径与构造函数
    copy.ts             界面文案（同 BlogSite/copy.ts 的做法，一期只有中文）
    pages/              登录、书架、目录、搜索、我的、阅读
    components/         手机端自己的小组件（占位卡片、封面等）
    lib/                纯逻辑：最近阅读、本地偏好、目录层级、滚动恢复、转场
```

- **一份构建，两个入口**。`vite.config.mts` 的 `build.rolldownOptions.input` 同时列
  `index.html` 和 `mobile.html`。`pnpm release` 把两者一起输出到
  `server/router/frontend/dist`，随 Go 二进制发布。发布流程、Dockerfile、`deploy.sh` 都不用改。
- **共用的部分**：
  - 接口客户端和登录续期：`@/connect`、`@/auth-state`
  - 数据：`AuthProvider`、`InstanceProvider`、React Query 的 `queryClient` 和各个 hooks
  - 渲染：`MemoContent`、`DocumentLinkProvider`、`SubDocReferenceProvider`、
    `InlineAttachmentProvider`、`useCrossWorkspaceTrees`
  - 目录排序：`components/Notebook/notebookSort.ts` 的 `sortTree`
  - 主题：`utils/theme.ts` 的 `loadTheme`
- **手机端自己的部分**：页面、布局、导航、组件全部在 `src/mobile/` 下，
  不引用 web 端的页面和布局组件。

## 2. 线上部署（toucan-app.huzhi.dev）

页面和接口都由同一个 Go 后端提供。nginx 只做两件事：转发请求，
以及把页面导航改写到 `mobile.html`。

```nginx
# 静态资源、接口、附件：原样转发
location ~ ^/(assets/|memos\.api\.v1\.|api/|file/) { proxy_pass http://127.0.0.1:5230; ... }
location ~ \.(png|svg|ico|webp|webmanifest|js|css|woff2?)$ { proxy_pass http://127.0.0.1:5230; ... }
# 其余都是手机端的页面导航
location / { rewrite ^ /mobile.html break; proxy_pass http://127.0.0.1:5230; ... }
```

- `proxy_set_header Host $host` 必须保留，后端的 CORS 检查依赖它（需求 §2）。
- 后端把所有 `.html` 入口文件都当作页面返回 `no-cache`（`server/router/frontend/frontend.go`
  的 `shouldServeFrontendHTML`）。之前只认 `/index.html`，`mobile.html` 会被缓存一小时：
  发布之后旧入口还指向已经不存在的旧资源，手机端会白屏。
- 登录失效时，`connect.ts` 会跳转到 `/auth?redirect=…`。手机端把登录页也放在 `/auth`，
  这样跳转逻辑原样可用，不用改。
- 上线需要先走正常发布（合并到 main → `deploy.sh`），再替换服务器上的 nginx 配置。
  现在服务器上的演示站届时会被替换。

## 3. 本地开发

- `pnpm dev:mobile`：设置 `MOBILE_DEV=1` 启动 Vite。一个只在开发时生效的小插件把所有页面导航
  改写到 `/mobile.html`，接口代理和 web 端一样指向 8081。
- `.claude/launch.json` 增加 `mobile` 配置（端口 3002），方便在浏览器面板里用手机尺寸验证。

## 4. 样式与主题

- `mobile.css`：先引入 web 的 `index.css`（Tailwind、主题变量、Markdown 排版变量，
  渲染器依赖这些），再引入 `konsta/react/theme.css`。
- 两者都定义了 `--color-primary`，后引入的 Konsta 生效。所以手机端渲染器里的链接色、
  强调色会跟随 iOS 蓝。这是有意为之。
- 深色模式跟随系统：用 `loadTheme` 切换 web 的深色变量，同时给 `<html>` 加上或去掉
  `dark` class（Konsta 依赖这个 class）。

## 5. 渲染器在手机端的差异

渲染器只维护一份。手机端的差异通过两个注入点实现：

1. **链接跳转**：
   - 阅读页提供 `DocumentLinkProvider`。`resolve` 和 `resolveFrom` 用当前知识库的树
     （`resolveInWorkspace`），`resolveCrossWorkspace` 用 `useCrossWorkspaceTrees`。
   - `navigate` 统一跳到手机端的 `/doc/:uid`。
2. **复杂块占位**（共享代码里唯一的改动）：
   - 新增 `BlockPlaceholderContext`。没有提供这个 Context 时（web 端）行为完全不变。
   - `CodeBlock` 在分发特殊块之前先查这个 Context：语言在占位清单里，就渲染 Context 提供的占位组件。
   - 一期的占位清单：`kanban`、`sheets`、`calendar`、`grid`、加密块（`secret`）。
   - Mermaid、mask、文档嵌入先直接渲染。
   - draw.io 本身就是一张 SVG 图片，直接按图片显示，比需求里写的占位更好，需求同步改掉。
   - VIEW 类型的文档整篇显示占位，在阅读页判断，不进渲染器。

**首屏体积**：`CodeBlock` 静态引入了 `SheetsBlock`（x-data-spreadsheet）等重组件。
先量出手机端入口的实际体积；超过 300 KB（压缩后），就把这些块改成 `React.lazy`。
这个改动同样对 web 端有利。

## 6. 页面要点

| 页面 | 路由 | 数据 | 要点 |
|---|---|---|---|
| 登录 | `/auth` | `authServiceClient.signIn` | 实例关闭密码登录时只显示提示；登录后回到 `redirect` |
| 书架 | `/` | `useWorkspaces(false)` | 封面/列表切换存本机；最近阅读横向滚动 |
| 目录 | `/kb/:uid/*` | `useWorkspaceTree(name, false)` + `sortTree` | 一层一页；URL 里带文件夹路径；返回时恢复滚动位置 |
| 搜索 | `/search` | `ragServiceClient.search({ global })` | 按搜索键才请求；最近搜索存本机 |
| 我的 | `/me` | `useAuth` | 账号、阅读设置说明、退出登录 |
| 阅读 | `/doc/:uid` | `useMemo`、`listMemoComments`（拆出子文档） | 整页滚动；目录和阅读设置用底部弹出层；References；不同文档类型分别处理 |

**演示版里发现、正式版要处理的布局问题**：
- 分组标题和下面的内容贴得太近，甚至重叠：标题和内容之间要留出明确间距。
- 横向滚动的"最近阅读"开启了吸附，第一张卡片会贴到屏幕左边缘：
  要给滚动容器加 `scroll-padding`，让吸附位置和页面左边距对齐。
- 底部 Tab 栏盖住了最后一排内容：页面底部要留出 Tab 栏加安全区的高度，
  Tab 栏要有不透明（或足够模糊）的背景。

## 7. 开发步骤与验收

| 步骤 | 内容 | 验收 |
|---|---|---|
| M1 骨架 | 第二入口、`mobile.css`、Konsta、开发脚本、空白路由 | `pnpm dev:mobile` 能打开；`pnpm build` 输出 `mobile.html` |
| M2 登录 | 登录页、登录守卫、退出 | 连本地后端能登录、刷新后保持登录、退出后回到登录页 |
| M3 书架和目录 | 书架两种视图、最近阅读、逐层目录、滚动恢复 | 排序和 web 端一致；隐藏知识库不出现 |
| M4 搜索 | 全局搜索、高亮、最近搜索 | 按键才发请求；结果可以进入文档 |
| M5 阅读 | 渲染器接入、占位、链接、子文档、目录、阅读设置、文档类型 | 常见 Markdown 正常；占位块显示卡片；文档间链接在手机端内跳转 |
| M6 收尾 | 转场、体积、lint、单测、构建 | `pnpm lint`、`pnpm test`、`pnpm build` 通过；首屏体积达标 |

单测覆盖 `src/mobile/lib/` 下的纯逻辑：最近阅读的增删和上限、目录层级定位、
文件夹路径的编码和解码、占位清单的判断。

## 8. 实施记录（2026-10-17）

M1–M6 已完成，代码在 `feat/mobile-reader` 分支，尚未合并、尚未上线。

**和计划不同、或计划里没写到的地方**：
- **分组标题不用 Konsta 的 `BlockTitle`**：它在后面跟着列表时，会用负的下边距把自己拉近列表，
  前提是列表保留自带的上边距。演示版里的标题重叠就是这么来的。
  手机端统一用 `components/SectionTitle.tsx`（间距固定），列表不设外边距。
- **Tab 栏自己画，不用 Konsta 的 `Tabbar`**：Konsta 的 iOS 26 样式是悬浮胶囊，
  高度 = 安全区 + 16 + 64 + 16，太高；添加到主屏幕后，原来地址栏的位置还会多出一条白边。
  现在是贴底的 49pt 原生高度，下面接安全区，用同一块不透明的模糊背景
  （Konsta 默认是透明渐变，页面文字从 Tab 文字底下穿过，看不清）。
- **书架封面画成精装书**：左侧书脊和折痕、右下露出书页；封面图是居中的正方形图标，宽约封面的一半。
- **返回按钮显示上一页的标题**：进入下一页时通过路由 state 传 `backLabel`；
  从深链接直接打开时，退回到"父文档 / 文件夹 / 知识库"的层级名称。
- **阅读页等目录树加载完再渲染正文**：否则文档间的链接会先按"失效链接"画成红色，再变回蓝色。
  从目录页进入时树已经有缓存，不会多等。
- **`/memos/:uid` 跳转到 `/doc/:uid`**：渲染器给文档链接的 href 是 web 端格式，
  在新标签页打开或者被复制出去时，靠这条路由落到手机端阅读页。
- **正文是否重复标题**：正文第一行就是 `# 标题` 时，页头不再显示大标题（`lib/title.ts`）。
- **字号**：渲染器的字号用的是 rem，只给容器设置 font-size 带不动标题和代码，
  所以改用 `zoom` 整体缩放（`lib/reading.ts`）。

**首屏体积**（`vite build`，gzip -9）：
- 阅读页改成按需加载后，书架、搜索、登录的首屏是 **295 KB**，达标。
- 第一次打开文档时还要加载约 800 KB，主要是渲染器分块（约 560 KB，其中有 x-data-spreadsheet
  和全量的 highlight.js 语言包）、pdf.js（约 95 KB）、KaTeX（约 75 KB）。

**后续事项**：
1. 把 `CodeBlock` 里的看板、表格、日历等特殊块和 `MemoContent` 里的 PdfViewer 改成 `React.lazy`；
   highlight.js 改为只引入核心库加常用语言。这会同时减小 web 端的体积，需要连同 web 端一起回归。
2. 搜索结果的片段（`SearchHit.snippet`）带着 Markdown 符号和 frontmatter，来自服务端，
   需要在服务端生成片段时先去掉标记。
3. 上线：合并到 main → 按 `docs/dev/release-process.md` 发布 → 替换服务器上
   `toucan-app.huzhi.dev` 的 nginx 配置（§2）。现有的演示站会被替换。
4. 真机验证：转场、Safari 侧滑返回、工具栏收起、添加到主屏幕后重新登录。
