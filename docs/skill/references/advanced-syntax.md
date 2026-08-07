# 进阶语法参考

## View 文档(`*.view.json`)

VIEW 是第 4 种 doc_type,`content` 是结构化 JSON 配置(不存储渲染后的 HTML,每次打开
实时渲染)。一个 view 可含多个 gallery block,每块有:

- **scope**(显示哪些文档):
  - `{ "type": "folder" }` —— view 所在文件夹的直接子文档
  - `{ "type": "tag", "tag": "..." }` —— 带某标签的所有文档
  - `{ "type": "property", "filters": {...} }` —— frontmatter 属性等值匹配(AND,仅等值)
- **sort**:`updated_desc|updated_asc|created_desc|created_asc|title_asc`,或 `prop_asc:<key>` / `prop_desc:<key>`
- **cover rule**:`first_image` / `none` / `prop:<key>`
- **card fields**:`__title__` / `__updated__` / `__created__` / `prop:<key>` / `""`
- **badges**:最多 3 个,按属性 `key = value` 过滤给卡片打角标

改这个文件必须保持合法 JSON;scope 里引用的 `prop:xxx` 依赖目标文档的 frontmatter
存在对应 key。改坏了视图会退化(不渲染),不会影响文档本身。

## 看板块(` ```kanban `)

Markdown 文档内部嵌的交互式看板,体是 YAML:

```
```kanban
items:
  - id: t1
    title: Learn Spark
    status: 需求
    priority: high        # highest|high|medium|low|lowest
    due: 2026-07-20
    tags: [BigData]
  - id: t2
    title: Finish AI homework
    status: 开发
    done: true

view:
  type: kanban
  groupBy: status
  descending: false

statusOrder: ['需求', '开发', '测试', '发布']
```
```

- 顶层三键:`items`(卡片)/ `view`(配置)/ `statusOrder`(列的左右顺序)。
- 每张卡片除 `title` 外全可选;无 title 的项被跳过。字段:`id title link status
  priority done order tags due createAt updateAt` + 任意自定义字段(保留,显示在详情面板)。
- **写回契约**:在 app 里拖卡/勾选会重写围栏内的 YAML,YAML 库会规范化格式(缩进、
  引号),注释和键顺序保留,手工对齐不保留。手编 YAML 时别依赖精巧对齐;无 `id`
  的卡片首次编辑会被自动补 `id`。
- 畸形 YAML 或无有效 title → 退化成空状态,不破坏整篇文档。

其他围栏块如 ` ```calendar ` `` ```grid `` 走同一套"按围栏语言派发到专用组件"机制。
遇到不认识的围栏语言,原样保留,别当普通代码块重排。

## 密文块(` ```toucan-secret `)—— 只读,绝不改

```
```toucan-secret
v: 1
id: 7Kq2vX9mNb
hint: MinIO 安装过程
```
```

块里没有机密内容,只有指向服务端密文记录的 id,真正的密文在数据库里用用户口令
在浏览器端加解密。

- **`id` 一个字符都别动**。改掉等于把用户的凭据永久弄丢。
- `hint` 是明文标题,用户让你改标题时可以改,除此之外别动。
- `id` 以 `local-` 开头表示尚未初始化(用户还没设密码),同样原样保留。
- 别试图"解密"或"补全"它,你没有口令,服务端也没有。
- 复制文档时这个块跟着走是正常的,两篇文档指向同一条记录是允许的。
- 用户让你"整理这篇文档"时,这个块不参与任何重排/合并/格式化。

## 行内媒体限制

markdown 管线用 rehype-sanitize,会剥掉手写的 `<audio>`/`<video>` 标签,所以文档里
不会用 `![](clip.mp4)` 这种方式内联音视频——播放器来自附件路径,不是自定义语法。
可信 iframe 嵌入(YouTube/Vimeo/Spotify/SoundCloud/Loom/Google Maps/draw.io)走
白名单,仍支持。

## PDF 文档(`*.pdf.md`)

PDF 由上传的文件字节支撑,本地只有一个引用桩链接到 `_attachments/<uid>/xxx.pdf`。
没有可编辑正文,push 忽略它。要读 PDF 内容去 `_attachments/` 找对应字节。
