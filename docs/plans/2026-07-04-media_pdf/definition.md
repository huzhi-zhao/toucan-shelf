## 本期需求要点


### 附件管理
关于上传附件的优化：

1. 在首页编辑页面，附件上传的细节优化
   - 当上传附件为 多媒体文件，如图片/视频/音频（广泛认可的多媒体文件后缀）时，文件上传成功后 不是放置在附件区，而是生成引用，插入到光标处，如![cmsj]([https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRQjAX36eOQVSyXHKeYPrOBqOUcaTtjbEf3H8yMya5I5JT7Hy5ZVf-mG5UO&s=10](http://localhost:3001/file/attachments/iBQx9Acu5TG8Y6yqNXPoY3/hq720.jpg?thumbnail=true))；
   - 当文档格式为文本类或其他不被识别为多媒体文件的附件，才放置在附件区
   - 底部工具栏最左的+号按钮点击后，选择media应当不仅支持图片 还支持主流音频/视频格式
   - 如果当前系统没限制媒体文件大小，需求限制媒体文件不能超过10M ； 
   - 当从粘贴板复制受支持的媒体文件 到编辑框，直接将媒体文件上传后生成的站内域名URL `![]()` 媒体文件引用插入文本编辑区的光标处；如果是通过底部工具栏左侧 “+号 -> Media” 插入的方案添加媒体文件后，应挂载在附件区；不被识别为媒体的文件，无论哪种方式插入，都不必询问直接挂附件区
2. 首页预览时， 当前没有支持 查看/展示 附件，期望在预览模式下，在文档最下方 展示多媒体附件，列出非多媒体附件文件名（带跳转url的超链接）
3. 附件管理的重大UI支持： 使MD文档首页预览、explore页面查看文档、copy link跳转doc详情页等md文档查看渲染组件里支持主流音频视频文件
    - 目前好像仅支持图片，期望也支持其他媒体文件，也就是能播入音频、视频
    - 如果播放视频的成本高，可以仅播放mp4和其他更容易实现的视频格式，如果连mp4的播放支持成本也很高，那直接放弃对视频的支持
    - 制定该需求开发计划时， 必须充分调研原项目是否已对媒体文件的渲染有支持，优先复用原逻辑
   
以下是之前关于项目对音视频支持情况的调查结果：
回答:支持,但方式不是通过 markdown 语法,而是通过独立的附件区块。

Markdown 正文本身:MemoContent/markdown/index.ts 里自定义的渲染节点只有 Image(Image.tsx),把 ![...](...) 转成 <img>。没有 Audio/Video 节点,也没有类似 ![video](...) 的自定义语法能在正文里内嵌播放器。
附件区(memo 正文下方独立渲染):mp3/mp4 会被当作附件展示出来,并且是真正可播放的:
视频:VideoPoster.tsx:70 渲染真实 <video> 标签(带封面帧提取逻辑),用在 AttachmentListView.tsx:117 的媒体网格里。
音频:AudioAttachmentItem.tsx:172 渲染真实 <audio> 标签,带自定义进度条/播放速率控制,用在 AudioList(AttachmentListView.tsx:269)里,按 mime type(audio/*、video/*,见 AttachmentIcon.tsx:78-80)分类归入附件列表。
结论: memo 正文的 markdown 渲染器不支持在文字中间内嵌播放音视频;但只要把 mp3/mp4 作为附件上传,memos 会在正文下方单独渲染出可播放的 <audio>/<video> 组件——所以功能上是支持的,只是入口是"附件"而不是"markdown 语法"。

这是另一个之前触发的重复分析任务,结果和我刚才的核实完全一致,做个补充说明就好——不需要再额外调查了。

补充一点细节(与我之前的结论互相印证):

Markdown 用的是 react-markdown + rehype-sanitize,即使你在正文里手写 <audio>/<video> 标签也会被 sanitize 掉(不在 SANITIZE_SCHEMA 白名单里),因为不是自定义组件。
iframe 嵌入反而是被支持的,但仅限硬编码的可信来源白名单(YouTube、Vimeo、Spotify、SoundCloud、Loom、Google Maps、draw.io),见 constants.ts 的 TRUSTED_IFRAME_SRC_PATTERNS。
附件侧多处都有真实播放器,比如 AttachmentCard.tsx:34-39 直接按 mime type 分支渲染 <video controls> / <audio controls>。
结论不变:markdown 正文里写 ![](xxx.mp4) 或裸链接不会变成播放器,只有作为附件上传时才会在附件区渲染出可播放的音视频组件。

  

### S3存储支持 优化

#### 期望实现
如果文件/附件上传的方式为S3，在setting-storage-S3 Compatible 里设置为默认文件存储路径时，

插入媒体文件或附件时，应当使用该链路 
`浏览器上传附件 → Memos Server用持有的签名推送到MinIO   → MinIO返回bucketURI  → Memos生成永久图片URL  → 返回https://memos域名/imageid`

当预览MD，展示图片时
`浏览器 → Memos生成的永久图片URL → Memos Server用持有的签名访问MinIO → 获取图片资源`

#### 项目现状
memos 不会把图片转成 http://memos域名/imageuri 这种形式对外提供，而是直接把 MinIO 生成的预签名 URL 交给浏览器，浏览器会直接连到 MinIO 的地址（比如 http://minio-host:9000/bucket/key?X-Amz-Signature=...），完全绕开 memos 域名。

具体机制：

上传时 attachment_service.go:502-507 调用 s3Client.PresignGetObject 生成一个带签名、有时效性（约5天）的直连 URL，存进数据库的 Reference 字段。
API 返回给前端时，attachment_service.go:428-431 把这个 Reference 原样作为 externalLink 返回。
前端 web/src/utils/attachment.ts:3-9 的逻辑是：只要 externalLink 存在就直接用它当 <img src>，根本不会走 /file/... 这条经过 memos 服务器代理的路径。
server/runner/s3presign/runner.go 有个后台任务每 12 小时检查一次，快过期时（剩 4 天内）重新生成预签名 URL 并更新数据库——但依然是 MinIO 自己的地址，不是 memos 域名。



#### why
这么设计，原因：

域名/网络隔离：MinIO endpoint 常常只在内网/容器网络可达（尤其你现在这种自建场景），浏览器直连会直接挂掉——这正是当前设计的实际缺陷，你之前的直觉是对的。
访问控制统一：所有鉴权都收敛在 memos 自己的会话/权限体系里，不用担心预签名 URL 泄露后被无限次访问（当前预签名 URL 一旦生成，5天内谁拿到链接都能访问，跟 memos 的权限模型完全脱钩）。
可缓存、可加 CDN：走自己的域名意味着可以在前面加 CDN/缓存层，签名直连 URL 因为带时效参数天然不好缓存。
代价：所有下载流量都要经过 memos 服务器中转，增加了服务端带宽/CPU 负担，大文件、高并发场景下这是要权衡的成本。
   - 折中做法是：小文件（图片、文档缩略图）走代理,大文件/视频走预签名直连（当前代码其实已经是这个思路，只是没做区分,是无差别用预签名）。
   - 由于上面已限制文件大小为10M，且这个服务不会有高并发场景， 因此折中做法暂不实现。


### 支持PDF上传和预览

#### 需求明细
- 当前首页 Search Documents 搜索框右侧+号按钮弹出的对话框 把upload file 选项改名为upload doc (这里仅支持上传需要存入db的doc，如html和md文档)
- 搜索框右侧+号按钮弹出的对话框最底部 添加新的upload file按钮，点击后打开文件选择器，目前只支持选择.pdf文档
  - 选中文档后上传到存储位置（由settings-storage决定上传到哪），上传的逻辑和编辑文档中插入附件的逻辑一致，但不同的是上传到指定存储位置后返回的memos域内文件url 会在首页对应的文件夹目录位置生成一条文档，
  - 该文档没有实际的文本内容（可考虑在数据库维护doc信息除了存储URL，还包括文件大小等关键信息），点击文档进入预览/编辑页面时 无法编辑，只能预览，提供pdf预览渲染插件
- 搜索框 下方的文件夹最右侧三个横点的按钮点击后 弹出的对话框 也需要添加upload doc和upload file（添加在new folder选项下方）, 在对就位置点开对话框上传文档时，生成的文档直接挂在该文件夹下
- 注意：除在首页预览需要支持PDF外，还有其他地文也需要处理
  - 在/explore的Main Content doc列表有pdf doc时，由于pdf doc的本质是一个超链接引用 因此在这个doc列表下 不用渲染pdf文档名，只需要除了正常显示卡片标题外，内容给出一此pdf文档的文件信息或其他信息+跳转doc详情按钮（也就是copy -> copy link指向的url）
  - 在doc详情页 也就是copy - copy link指向的页面，同样需要支持pdf文档的渲染

### PDF预览插件

更一致的跨浏览器体验(移动端 Safari 内嵌 PDF 有时体验差、无法控制页数/缩放),可以引入 pdf.js(pdfjs-dist)自己渲染成 canvas,这样能做分页、缩放、暗色模式适配,但会多一个约 1-2MB 的依赖和更多代码(worker 配置、canvas 渲染逻辑)。

制定该PDF预览插件开发计划时， 必须充分调研原项目是否已对PDF文件的渲染有支持，优先复用原逻辑。