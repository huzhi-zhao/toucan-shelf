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

## 修订（2026-08-02）：一块一口令 → 账号级主口令

原设计每个加密块各设一个口令。那是 yuque 的团队协作场景的形状——一个块给一拨人看，
另一个块给另一拨人看。本项目面向个人与极小团队，没有这种分权需求，一块一口令只是把
成本转嫁给唯一的使用者：一页五个块要输五次口令，跑五遍 600k 次 PBKDF2。

改为**账号级主口令 + 主密钥两层**：

```
主口令  --PBKDF2-SHA256(1_200_000, salt)-->  KEK
MK      = 32 字节随机，生成一次，永不改变
wrapped = AES-256-GCM(KEK, MK)      ← 存 user_setting 的 SECRET_KEY 键
每个块   = HKDF-SHA256(MK, 每块随机 salt) → enc/mac key
```

选两层而不是"同一个口令直接加密每个块"，理由是后者有两处硬伤：

- **改口令要逐块重新加密**，中途失败就是半迁移状态，而这恰恰是最不能出错的操作。
  两层方案改口令只重包 MK 一条记录，一个块都不碰。
- **KDF 成本按块数线性增长**。两层方案一次会话只跑一次，省下来的预算直接反向投入：
  包 MK 用 1.2M 次迭代，而不是原来的 600k。

顺带的收益是块密钥不再受口令熵约束——每块的密钥是 256 位真随机，口令的强度只需要在
包 MK 那一层站得住。**这是本次唯一实质的"口令加强"**，强度条和 12 字符下限只是辅助。

### 兼容与迁移

信封的 `kdf` 字段区分两套：`pbkdf2-sha256`（旧，一块一口令）与 `master-v1`（新）。
这正是当初把算法名逐条存下来的用途，所以**不需要数据库迁移**。旧块继续用自己的口令
打开，打开后提供"改用主口令"按钮，就地覆盖信封——能就地覆盖，同样是因为密文存在独立
表而不在 md 里。

#### 兼容代码是临时的，记得删

上面这条"旧块继续用自己的口令打开"的分支标记为
`LEGACY-COMPAT(secret-block/per-block-passphrase)`，全仓 grep 这个字符串可以找齐所有位置，
主说明在 [SecretBlock.tsx](../../../web/src/components/MemoContent/SecretBlock.tsx) 顶部
`KeyMode` 的注释里。

它存在的唯一理由是库里还有旧块。清空的判据是一条 SQL：

```sql
SELECT COUNT(*) FROM secret_block WHERE kdf = 'pbkdf2-sha256';
```

归零之后就可以删。归零之前删掉，那些行的密文将**永久无法解开**——服务端没有明文，
也没有任何补救手段。

迁移是逐块手动的，且**没有任何进度提示**：躺在没人打开的文档里的旧块不会自己迁移，
UI 上也不会显示"还剩 N 个"。所以这段兼容代码大概率会活得比预期久，读到这里的人
（包括 AI）应当主动提醒一次，而不是默认它已经可以删了。

不要跟着删的是 [secret-crypto.ts](../../../web/src/utils/secret-crypto.ts) 里
`encryptSecret` / `decryptSecret` 的实现本身，以及服务端 `validateSecretEnvelope` 中
`pbkdf2-sha256` 分支对 `user_setting` 那条包主密钥记录的校验——`master-v1` 靠它们包/解包
主密钥，删掉的后果是全体用户的主密钥报废，比留着兼容代码严重得多。

### 会话与锁定

MK 解包后只活在一个模块闭包里（[secret-session.ts](../../../web/src/utils/secret-session.ts)），
**不进 localStorage / sessionStorage**：写进去等于把一次 XSS 升级成对全部密文的永久窃取，
而闭包里的 key 随标签页一起消失。代价是刷新页面要重新输入主口令，这是有意的取舍。
闲置 30 分钟、退出登录、清除 token 三种情况都会自动上锁，且上锁必须真的关闭已展开的块。

### 密码框不用 `type="password"`

Chrome 对密码字段的保存提示无法关闭：`autocomplete="off"` 在密码字段上被设计性忽略，
`autocomplete="new-password"` 更是**主动**招来密码生成器——原实现正是这么写的，所以每次
输入都被追问是否保存。

唯一可靠的解法是不再是密码字段：`type="text"` + CSS `-webkit-text-security: disc`
（见 [MaskedInput](../../../web/src/components/ui/masked-input.tsx)）。Firefox 不实现该属性，
因此组件带一个显示/隐藏切换，让那些用户不必盲打。

登录页的密码框**不改**——那里让密码管理器保存是正经需求。加密块的口令不是站点凭据，
存进密码管理器反而是存错了地方。

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
