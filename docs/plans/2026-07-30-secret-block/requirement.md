# 加密文本块（secret block）

## 需求概述

在文档正文中嵌入一个语言标签为 `toucan-secret` 的 fenced code block，用来存放 MinIO
账号密码、API token、`.env` 片段这类**高敏感文本**。内容由**浏览器端**用用户设定的口令
加密，服务端只保存密文，任何时刻都不持有明文，也不持有口令。

与 [sheets](../2026-07-19-sheets-block/requirement.md)、calendar 等 view block 同一条
渲染路线：走 [CodeBlock.tsx](../../../web/src/components/MemoContent/CodeBlock.tsx) 的语言
分发，不引入新文档类型。

## 关键决策：md 里只放引用，密文单独存表

正文里的块**不含任何密码学材料**，只有一个指针：

````
```toucan-secret
v: 1
id: <secret uid>
```
````

salt / nonce / KDF 参数 / 密文全部存在 `secret_block` 表里，通过 `SecretBlockService`
按 id 取。

这条决策经过一轮反复，最终选它的理由是 **密文可以被覆盖**：

内联密文会进 [memo_history](../../../store/memo_history.go)（每次编辑一份快照），
也会被 [memogit](../../../internal/memogit/push.go) 推进 git 历史。这两处都是只增不减的。
后果是用户换口令重新加密时，**旧口令加密的那份密文永远躺在历史里** —— 旧口令一旦泄露，
历史里那份直接可解，等于换口令这个动作无效。存独立表则可以直接 `UPDATE` 覆盖。

被放弃的两个论点，记录在此以免重复讨论：

- ~~"内联更安全"~~ —— 不成立。md 正文本身也在同一个数据库里，服务端被攻破时两者暴露面
  完全相同。
- ~~"内联不需要逐个功能确认是否泄露"~~ —— 也不成立。明文从不上服务端，密文表只有一个
  接口会读，RAG / memogit / history / 导出都不 join 它，它们看到的只是一段内容为 id 的
  普通代码块。不存在共享路径。

副作用：既然密文不在 md 里，原本计划的"memogit push 时剥离密文"那一步**不需要了**。

## 关键决策：密文记录归属用户，不归属文档

`secret_block` 表**不放 `memo_id`、不设外键、不做级联删除** —— 对照
[memo_share](../../../store/migration/sqlite/LATEST.sql) 用的 `ON DELETE CASCADE`，这里
刻意不这么做。一条密文属于创建它的用户；文档删了它还在，文档被复制成两篇、两个块指向
同一条也属正常。

这一招把"悬挂引用"整类问题消掉了：**永远不自动删除密文记录**。一条记录几百字节，攒几年
也没多少；清理交给后续的手动"孤儿密文"管理页。

剩下两种可观察状态，各用一句提示交代即可：

- id 解析不到 → "此加密块在当前实例中不存在"（跨实例同步文档时会出现）
- 多篇文档指向同一 id → 改一处两处都变，符合直觉，不算 bug

## v1 加密套件

```
ikm      = PBKDF2-SHA256(passphrase, salt, 600000, 256 bit)
encKey   = HKDF-SHA256(ikm, info="toucan-secret/v1/enc") → AES-256-GCM
macKey   = HKDF-SHA256(ikm, info="toucan-secret/v1/mac") → HMAC-SHA256
verifier = HMAC(macKey, aad)
密文      = AES-256-GCM(encKey, nonce, 明文, additionalData = aad)
```

全部走 WebCrypto，**零第三方依赖**。信封里存 `kdf` / `kdf_iterations` / `cipher` 字段，
将来换 Argon2id 时老记录按自己的参数解，不需要数据迁移。

`aad` 是规范化的参数头（版本 + 算法名 + 迭代次数），绑定它防止参数被篡改。**不绑 memo
uid** —— 那会让一条密文只能被一篇文档引用，与"记录归属用户"的决策冲突。

`verifier` 的作用是**区分两类错误**。AES-GCM 认证失败时无法分辨"口令错"和"密文被改"，
两者都只是 auth failure；先用 verifier 校验口令，就能把提示分成：

- verifier 不匹配 → 口令错误
- verifier 匹配但 GCM 失败 → 密文已损坏

用户遇到后者时才知道该去找备份，而不是一直以为自己记错口令。verifier 不降低安全性：
攻击者本来就能用 GCM 解密来试口令，成本由 KDF 决定，不由 verifier 决定。

## 明文的活动范围（第一约束）

**明文永不上服务端，永不进主编辑器 state。**

具体到实现：加密走独立对话框，明文只存在于对话框的局部 state；不触发草稿 autosave、
不写 localStorage、不进任何 memo 保存请求。解密结果只渲染在临时面板，关闭即销毁，
**绝不写回 memo content**。

这一环做错的话，整个功能是**看起来在工作的假功能**，而且不报任何错。

## 公开分享文档中的加密块

文档可经 share token 匿名访问（[acl_config.go](../../../server/router/api/v1/acl_config.go)
的 `GetMemoByShare`）。选定方案：**匿名访问者渲染成"此处有加密内容，需登录"，拿不到密文**。

`SecretBlockService` 全部方法都需要登录，不进 `PublicMethods`；`GetSecretBlock` 只允许
`creator_id == 当前用户`。这样密文不会因为一篇文档被公开分享而进入公网、被离线爆破。

## 接口约束

- `ListSecretBlocks` **只返回元数据**（id / hint / 时间 / 密文长度），不返回密文。
  管理页不需要密文，批量下发等于把爆破素材打包给调用方。密文只能 `GetSecretBlock` 单条取。
- `GetSecretBlock` 响应带 `Cache-Control: no-store`，避免密文落进浏览器磁盘缓存。
- 服务端**只做存取，不碰密码学**。不存在任何"服务端能解密"的接口，包括调试用的。

## 已知局限（需在 UI 上如实告知）

1. **解密后的明文在 DOM 里。** 任何 XSS、任何有权限的浏览器扩展都能读到。这是浏览器内做
   端到端加密的固有天花板，不是实现缺陷。1Password 用独立客户端正是为了绕开这条。
2. **服务端每次都下发前端代码。** 被入侵的服务端可以下发窃取口令的 JS。SRI 之类只能缓解，
   根治不了。用户信任的最终仍然是实例运维者。
3. **口令不可找回。** 忘记即永久丢失，没有任何后门。
4. **导出的 md 脱离本实例即失效** —— 这是"密文不跟着文档跑"的预期代价，不是缺陷。

## 不做

- 口令找回
- 自动 GC 孤儿密文（永不自动删，后续可加手动管理页）
- 把加密块分享给其他用户（需要非对称方案，不在本期）
- memogit 相关改动（密文本来就不在 md 里）
