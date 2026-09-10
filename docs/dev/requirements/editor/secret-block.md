# 加密文本块（secret block）

## 是什么

语言标签为 `toucan-secret` 的 fenced code block，用来在文档正文里存放 MinIO 账号密码、
API token、`.env` 片段这类**高敏感文本**。内容由**浏览器端**加密，服务端只保存密文，
任何时刻都不持有明文，也不持有口令。与 [sheets](sheets-block.md)、[calendar](calendar-block.md)
同一条渲染路线：走 [CodeBlock.tsx](../../../../web/src/components/MemoContent/CodeBlock.tsx)
的语言分发，不引入新文档类型。

## 密文单独存表，正文只放引用

正文里的块**不含任何密码学材料**，只有一个指针：

````
```toucan-secret
v: 1
id: <secret uid>
```
````

salt / nonce / KDF 参数 / 密文全部存在 `secret_block` 表里，通过 `SecretBlockService`
（[secret_block_service.proto](../../../../proto/api/v1/secret_block_service.proto)）按 id 取。

理由是**密文需要能被覆盖**：内联密文会进 [memo_history](../../../../store/memo_history.go)
（每次编辑一份快照）、也会被 memogit 推进 git 历史，两处都只增不减——旧口令加密的那份会永远
躺在历史里，换口令等于没换。独立表可以直接 `UPDATE` 覆盖。

`secret_block` 表**不放 `memo_id`、不设外键、不做级联删除**——密文记录归属用户，不归属文档。
文档删了它还在，两个块指向同一条也正常。永不自动删除；清理是后续的手动"孤儿密文"管理页
（未实现）。

可观察的边界状态：id 解析不到 → "此加密块在当前实例中不存在"；多篇文档指向同一 id → 改一处
两处都变，符合直觉。

## 账号级主口令 + 主密钥两层

```
主口令  --PBKDF2-SHA256(1_200_000, salt)-->  KEK
MK      = 32 字节随机，生成一次，永不改变
wrapped = AES-256-GCM(KEK, MK)      ← 存 user_setting 的 SECRET_KEY 键
每个块   = HKDF-SHA256(MK, 每块随机 salt) → enc/mac key
```

选两层而不是"同一个口令直接加密每个块"：改口令只重包 MK 一条记录，一个块都不碰；
KDF 成本一次会话只跑一次（包 MK 用 1.2M 次迭代），块密钥不再受口令熵约束
（每块密钥是 256 位真随机）。

### 旧格式：一块一口令，已于 2026-09-10 清理完毕

2026-08-02 之前每个加密块各有一个独立口令（信封 `kdf = "pbkdf2-sha256"`）。之后改成上面这套
账号级主口令方案（`kdf = "master-v1"`）。旧块没有做数据库迁移，靠信封里的 `kdf` 字段区分两套，
旧块继续用自己的口令打开、打开后点"改用主口令"就地覆盖信封——迁移是逐块手动的，没有批量入口
也没有进度提示，因此那条兼容分支在仓库里活了一个多月。

2026-09-10 在生产库上确认判据归零（`SELECT kdf, COUNT(*) FROM secret_block GROUP BY kdf` 只剩
`master-v1`），随后删除了整条兼容路径：前端的 legacy KeyMode 分支、per-block 口令轮换与
"改用主口令"迁移入口、只服务旧流程的文案键，以及服务端对旧套件的接受。

**现在 `pbkdf2-sha256` 仍然存在，但只剩一个职责**：包 `user_setting` 里那条主密钥记录。服务端
因此把校验按调用点拆成两个函数——`validateSecretBlockEnvelope` 只收 `master-v1`，
`validateWrappedMasterKeyEnvelope` 只收 `pbkdf2-sha256`，共用的形状检查留在
`validateSecretEnvelopeShape` 里。这比原来"两套都收"更严：一个块再也不可能被降级写回旧套件。
[secret-crypto.ts](../../../../web/src/utils/secret-crypto.ts) 的
`encryptSecret`/`decryptSecret` 同理保留，它们是包/解包主密钥的实现，删掉等于所有人的主密钥报废。

前端读到一条 `pbkdf2-sha256` 的块信封时不再回退去要口令，而是直接报"不支持的加密套件"——现在
这种记录只可能是损坏或来自更新的版本，不是一种可回退的模式。

### 会话与锁定

MK 解包后只活在一个模块闭包里（[secret-session.ts](../../../../web/src/utils/secret-session.ts)），
**不进 localStorage / sessionStorage**：写进去等于把一次 XSS 升级成对全部密文的永久窃取，闭包里
的 key 随标签页一起消失，代价是刷新页面要重新输入主口令。闲置 30 分钟、退出登录、清除 token
三种情况都会自动上锁，且上锁必须真的关闭已展开的块。

### 密码框不用 `type="password"`

Chrome 对密码字段的保存提示无法关闭。解法是 `type="text"` + CSS `-webkit-text-security: disc`
（见 [MaskedInput](../../../../web/src/components/ui/masked-input.tsx)），Firefox 不实现该属性，
组件带显示/隐藏切换。登录页的密码框不改——那里让密码管理器保存是正经需求。

## v1 加密套件

```
ikm      = PBKDF2-SHA256(passphrase, salt, 600000, 256 bit)
encKey   = HKDF-SHA256(ikm, info="toucan-secret/v1/enc") → AES-256-GCM
macKey   = HKDF-SHA256(ikm, info="toucan-secret/v1/mac") → HMAC-SHA256
verifier = HMAC(macKey, aad)
密文      = AES-256-GCM(encKey, nonce, 明文, additionalData = aad)
```

全部走 WebCrypto，零第三方依赖。信封里存 `kdf`/`kdf_iterations`/`cipher` 字段，换算法时老记录
按自己的参数解，不需要数据迁移。`aad` 绑定版本+算法名+迭代次数防篡改，不绑 memo uid（一条密文
可被多篇文档引用）。

`verifier` 用来区分"口令错"与"密文被改"——AES-GCM 认证失败时两者都只是 auth failure，先校验
verifier 能把提示分开：verifier 不匹配 → 口令错误；verifier 匹配但 GCM 失败 → 密文已损坏。
不降低安全性，攻击者本来就能用 GCM 解密试口令，成本由 KDF 决定。

## 明文的活动范围（第一约束）

**明文永不上服务端，永不进主编辑器 state。** 加密走独立对话框，明文只存在于对话框的局部
state；不触发草稿 autosave、不写 localStorage、不进任何 memo 保存请求。解密结果只渲染在临时
面板，关闭即销毁，**绝不写回 memo content**。这一环做错的话，整个功能是"看起来在工作的假功能"，
且不报任何错——改动这块代码后必须逐条走查这几条。

## 公开分享文档中的加密块

文档可经 share token 匿名访问（`GetMemoByShare`，见
[acl_config.go](../../../../server/router/api/v1/acl_config.go)）。匿名访问者渲染成
"此处有加密内容，需登录"，拿不到密文：`SecretBlockService` 全部方法都需要登录，不进
`PublicMethods`；`GetSecretBlock` 只允许 `creator_id == 当前用户`。

## 接口约束

- `ListSecretBlocks` 只返回元数据（id / hint / 时间 / 密文长度），不返回密文；密文只能
  `GetSecretBlock` 单条取。
- `GetSecretBlock` 响应带 `Cache-Control: no-store`，避免密文落进浏览器磁盘缓存。
- 服务端只做存取，不碰密码学，不存在任何"服务端能解密"的接口。

## 已知局限（需在 UI 上如实告知）

1. 解密后的明文在 DOM 里，任何 XSS、任何有权限的浏览器扩展都能读到——这是浏览器内做端到端
   加密的固有天花板。
2. 服务端每次都下发前端代码，被入侵的服务端可以下发窃取口令的 JS。
3. 口令不可找回，忘记即永久丢失，没有任何后门。
4. 导出的 md 脱离本实例即失效——密文不跟着文档跑，是预期代价。

## 不做

- 口令找回。
- 自动 GC 孤儿密文（永不自动删，后续可加手动管理页）。
- 把加密块分享给其他用户（需要非对称方案）。
- memogit 相关改动（密文本来就不在 md 里）。
