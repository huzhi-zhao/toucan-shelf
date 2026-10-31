# 用户待办：什么事推到 app、怎么推、怎么收尾

知识库里**不再用 TODO.md 或 `- [ ]` 清单记用户要做的事**（2026-10-31 起）。用户本人要做的事，
经用户同意后建成 app 计划里的**待办**，带 🤖 标记；用户在手机上完成、取消、改期，你负责把结果同步回来源文档。

本节只写通用契约。用户在某个仓库里定的个人细则（比如哪类事项一律算重要），以那个仓库的说明为准。

## 1. 什么事该推（三条都满足才提议）

1. **只能用户本人去做**：要本人到场、签字、付款、打电话、做决定。你自己能做的不推，直接做；
   你自己要盯着的事（核对、跟进、过几天再查），记在你自己的地方，不推给用户。
2. **一条是一件用户认得出的结果**："续签护照"，不是"打开网站""填第 3 页"。子步骤留在来源文档里。
3. **必要**：不做会有实际后果，不是锦上添花。启动日多远都可以提议，远期的 `date` 填启动日。

**重要**（`important`）的通用定义：后果**不可逆或代价很高**，比如身份/合法性、重大金钱损失这一类。拿不准就不标。

**不该推的**：研究结论、下一步建议、你自己的核对与跟进、已有用户待办的子步骤。

## 2. 怎么推

1. **先问，攒成一批问**：列出准备推的几条（标题、日期、为什么），问用户"要推到 app 待办吗？"。
   用户同意了才建，没同意的一条都不建。不要在知识库里写给用户看的 TODO.md 或 checkbox 清单代替。
2. **先查重**：建之前看一眼还没完成的待办（`memogit todo list` / `GET /api/v1/planner/openTodos`），
   用户自己建过的同一件事不再建。
3. **字段**：
   - `title`：一句动作，不带理由和日期。
   - `date`：该动手的那天（远期也一样）；截止日不是 date，写在 note 里。
   - `note`：截止日、理由、来源（知识库里的路径）。**备注支持基础 Markdown**（段落、列表、加粗、链接），
     内容多于一行时用 Markdown 分段或列表，app 里会按格式显示。
   - `memos`：关联来源文档（`memos/<uid>`）。
   - `important`：按上面的定义。
4. **记 id**：建完把返回的 `name`（`planner/todos/<id>`）记在来源文档的那个条目上：
   `（YYYY-MM-DD 已推 app 待办 planner/todos/<id>）`，以后按它查状态。

## 3. 收尾：把结果同步回来源文档

- **状态只由用户在 app 里管**，你不完成、不取消、不改期、不删除用户的待办。
- 定期（比如每次会话开始）查一次变化：`memogit todo changes --since <上次的时间>` /
  `GET /api/v1/planner/todos?updatedSince=<RFC 3339>`。返回的是那之后新建或改过的待办（**含已完成、已取消**）
  和删除的待办；把结果写回来源条目（完成了、取消及原因、改到哪天、备注里的新信息）。
  返回里的下一次起点（`nextSince` / `nextUpdatedSince`）存起来下次用；边界那一秒会重复返回，按 `name` 去重。
- 单条查：`memogit todo get <id>` / `GET /api/v1/planner/todos/{id}`。**删除的待办查不到（404）**，
  只会在"变化"里以 `deletedTodos` 出现一次。

状态枚举：`ACTIVE`（未完成）、`DONE`（完成）、`CANCELLED`（取消，`cancelReason` 有原因）。
完成和取消有 `closeTime`；改过期的有 `originalDate` 和 `postponeCount`。

## 4. 两条通道

### memogit 检出（推荐）

用检出自带的令牌，不用另配：

```bash
memogit todo list                                   # 未完成的待办（查重）
memogit todo add "续签护照" --date 2027-03-01 --important \
  --note "截止 2027-05-31。来源：Life/证件/护照.md" --doc Life/证件/护照.md
                                                    # 输出 planner/todos/<id>；--doc 可重复
memogit todo get <id>
memogit todo changes --since 2026-10-31T00:00:00Z   # 最后一行是下次的 --since
```

每个子命令都可以加 `--json` 拿完整记录。`--doc` 给的是检出里的文件路径，文件必须已经 push 过（带 `memogit-id`）。

### REST（有个人访问令牌时）

`Authorization: Bearer <PAT>`：

- 建：`POST /api/v1/planner/todos?localDate=<今天 YYYY-MM-DD>`，body 是 Todo（`title`、`date`、`note`、`important`、`memos`）。
- 查重：`GET /api/v1/planner/openTodos`。
- 单条：`GET /api/v1/planner/todos/{id}`。
- 变化：`GET /api/v1/planner/todos?updatedSince=<RFC 3339>`。

### 只有 MCP

MCP 通道对计划**只读**，不能建待办。需要推时，把整理好的条目（标题、日期、备注）给用户，请用户自己在 app 里建，
或者换到 memogit 检出里推。
