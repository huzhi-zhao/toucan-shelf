# memogit 同步工作流

memogit 借用 git 词汇但不是 git 网络协议,是"数据库 ↔ 本地文件"的桥,版本历史交给
它替你初始化的本地 git 仓。命令都在检出根目录跑。

| 命令 | 作用 |
|------|------|
| `memogit status` | 只读,列出待 push 的本地改动、待 pull 的远端改动、冲突 |
| `memogit pull` | 拉下服务器变更,和本地对账,做一次 git commit |
| `memogit push` | 推送本地改动;`--dry-run` 只打印计划不发送 |
| `memogit clone [名称]` | 首次检出某 workspace(本地一般已 clone 好) |

## push 的行为(强烈建议先 `push --dry-run` 看计划)

| 情况 | push 做什么 |
|------|------------|
| 新本地文件 | 建 memo(`+`),从路径/扩展名推导 folder_path/title/doc_type,默认可见性 PRIVATE |
| 改了跟踪文件、服务器未变 | 更新内容(`~`) |
| 移动/重命名了跟踪文件 | 就地移动该 memo(`→`),uid 不变,历史/评论/链接全保留 |
| 移动 + 同时改了内容 | 两件事都做(`→` 再 `~`),先后顺序无所谓 |
| 两边都改 | 冲突(`⚠`)—— 保留你的文件,服务器版写到 `<path>.remote` 待合并 |
| 本地删了跟踪文件 | 归档该 memo(`-`,软删除,可恢复) |
| PDF 桩 & 下载的附件 | 忽略(生成物/只读下载) |

## 冲突解决(`.remote` 副本)

pull/push 发现两边都改时,memogit 把服务器版本写成 `<path>.remote`(因为 memos 是
REST 而非 git remote,没法 `git fetch` 出"theirs")。

1. 对比 `foo.md`(你的)与 `foo.md.remote`(服务器的),把 `foo.md` 编成要的合并结果。
2. 删掉 `foo.md.remote`—— 它的消失就是"已解决"的信号。
3. 跑 `memogit push`。只要服务器没再变,会推送合并后的 `foo.md` 并推进基线。

`.remote` 存在期间,push 视该文档为未解决冲突并跳过。

## 归档不腾出名字

归档是软删除,文档仍留在原 folder_path 下占着 `(folder_path, title)` 唯一约束。
同名文档删掉后不能立刻用同名新建,需要在网页端彻底删除。(文件夹删除不受此影响,
判空只数未归档的文档。)

## 已知限制

- 还没实现:附件上传(下载是单向的)、关系写回服务器(v1 只读导出)。
- 只同步你自己的文档:clone/pull 只抓 `creator == 你`,别人共享的 PROTECTED/PUBLIC
  文档不会灌进本地库,也 push 不回去。
