# ADR-0002：私密附件复用账号主口令，不引入第二把

## 状态

已决策（设计阶段，功能尚未实现）。见
[access-control-and-private-files.md](../requirements/attachments/access-control-and-private-files.md) B 部分。

## 背景

[私密附件](../requirements/attachments/access-control-and-private-files.md) 需要在文档
可见性之上再加一道口令闸门。[加密块](../requirements/editor/secret-block.md) 已经有一套
账号级主口令 + 主密钥（MK）机制。是否复用需要决策。

## 决策

复用加密块已有的账号主口令，不再单设附件口令。服务端要能验口令，但服务端不知道口令也不知道
MK——解法是客户端出示 MK 的持有证明：

```
verifier = HMAC-SHA256(MK, "toucan-attach/unlock/v1")   ← 存 user_setting，服务端可见
```

服务端只比对 verifier，永远看不到口令，也拿不到 MK（verifier 是单向的）。

## 被放弃的方案

- **服务端直接存口令的 PBKDF2 哈希**：等于给主口令开第二个校验入口，且和加密块的 KDF
  参数是两套，改口令要同步两处，漏一处就是"改了口令旧的还能开"。
- **不验口令，只按创建者放行**：退化成"私密 = 仅自己可见"，不需要口令概念。口令的全部价值
  在于把会话态和解锁态分开——偷到 session 不等于拿到文件。

## 理由

用户已经有一把主口令（如果用过加密块），再来一把是纯粹的成本转嫁：同一篇文档里加密块和
私密附件要输两次、跑两遍百万级 KDF。

## 已知边界

verifier 是 `HMAC(MK, 固定串)`，拿到它无法反推 MK，但拿到数据库的人本来就同时拿到了 MK
的包装信封（1.2M 次 PBKDF2），爆破成本由后者决定，verifier 不额外降低强度。
