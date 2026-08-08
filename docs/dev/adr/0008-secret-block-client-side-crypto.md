# ADR-0008：加密块浏览器端加解密，服务端零明文零口令

## 状态

已采纳。

## 背景

[加密文本块](../requirements/editor/secret-block.md) 用来存放高敏感文本（账号密码、API
token）。需要决定加解密发生在哪一端。

## 决策

加解密全部在浏览器端用 WebCrypto 完成。服务端只存取密文（`secret_block` 表），不参与任何
密码学运算，不存在"服务端能解密"的接口，包括调试用的。明文永不上服务端，永不进主编辑器
state；加密走独立对话框，明文只存在于对话框局部 state，不触发草稿 autosave、不写
localStorage、不进任何 memo 保存请求。

## 理由

这是端到端加密方案的基本约束：只要明文经过服务端（哪怕只是转发），服务端被攻破或运维者
本身就构成完整的信任面。私密附件（见
[access-control-and-private-files.md](../requirements/attachments/access-control-and-private-files.md)）
选择了不同的安全等级——服务端持有明文，只是访问受限——两者的措辞和使用场景必须区分开，
不能都叫"加密"。

## 已知局限（必须在 UI 上如实告知）

1. 解密后的明文在 DOM 里，任何 XSS、任何有权限的浏览器扩展都能读到——这是浏览器内做端到端
   加密的固有天花板，不是实现缺陷。
2. 服务端每次都下发前端代码，被入侵的服务端可以下发窃取口令的 JS，SRI 之类只能缓解。
3. 口令不可找回，没有任何后门。

## 影响

- `SecretBlockService` 全部方法都需要登录，不进 `PublicMethods`；`GetSecretBlock` 只允许
  `creator_id == 当前用户`，公开分享文档中的加密块对匿名访问者渲染成"需登录"。
- `ListSecretBlocks` 只返回元数据，不返回密文；`GetSecretBlock` 响应带 `Cache-Control: no-store`。
