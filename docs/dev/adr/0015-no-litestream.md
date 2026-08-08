# 0015. 不引入 Litestream

## Context

[单机本地部署](../standalone-local-deploy.md)需要把 SQLite 数据库持续备份到 S3，
支持"整机丢失后能恢复"。Litestream 是这类需求的常规答案，评估中作为候选方案考察过。

## Decision

**不引入 Litestream，复用现有 `VACUUM INTO` 全量快照方案**，把备份间隔改成可配
（standalone 场景默认 10~15 分钟），并在进程退出时 flush 一次。

## Consequences

- 作为独立进程使用 Litestream，会让部署形态从"一个可执行文件"变成"两个二进制 +
  一个 yml"，与打包成单文件的目标直接冲突，个人用户在自己电脑上部署的体验会崩掉。
- 作为 Go 库嵌入（`benbjohnson/litestream`）技术上可行，但该包 API 从未承诺稳定，
  是给自家 CLI 用的，绑上去是长期维护负担。
- Litestream 的核心价值是秒级 RPO 和 WAL 增量上传。个人笔记库通常只有几十 MB，
  全量传一次只要几秒钟，省下的带宽换不来这份复杂度；而全量单文件快照的恢复逻辑
  简单到不容易出错，符合个人部署场景对"可靠优先于极致 RPO"的取舍。
- 代价是恢复窗口以"备份间隔"为单位，而不是接近实时；这个取舍在决策时被认为可接受。
