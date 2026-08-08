# sheets 代码块（可编辑表格）

## 是什么

语言标签为 `sheets` 的 fenced code block，预览时渲染成一个**可直接编辑的表格网格**
（基于 [x-data-spreadsheet](https://github.com/myliang/x-spreadsheet)），编辑结果自动写回文档。
与 [calendar 代码块](calendar-block.md) 同一条技术路线：只在单篇文档内部、渲染层面做文章，
不引入新文档类型。

## 语法

块内是「`sheet:名称` 分节 + CSV 正文 + 可选 `view:` 配置节」，解析实现见
[parseSheetsBlock.ts](../../../../web/src/components/MemoContent/sheets/parseSheetsBlock.ts)：

```
sheet:Sheet One
a,b,c
1,2,3

sheet:Sheet Two
x,y
4,5

view:
  lock: true
```

- 没有任何 `sheet:` 标记时，整块按单个匿名 sheet 处理。
- `view:` 节是块级配置（缩进的 `key: value`），当前支持 `lock: true|false`（只读）；
  为兼容旧数据，`view:` 节之前裸写的 `lock:` / `height:` 行也会被识别，`height:` 已废弃、
  解析时忽略（网格视口高度不再走正文配置，见下）。
- 每节 CSV 正文用 [papaparse](https://www.papaparse.com/) 解析。

## AI 公式生成

右键菜单支持自然语言 → 公式：前端发起请求，服务端 `GenerateFormula`
（[ai_service.go](../../../../server/router/api/v1/ai_service.go)）生成并校验后返回，
不在前端本地跑推理。

## 数据落点：正文 CSV + node_overlays 样式覆盖

表格的**文本内容**（各 sheet 的 CSV）序列化回 markdown 正文；**样式类信息**（单元格样式、
网格视口高度、当前打开的 sheet 标签）不进正文，改存进 memo 的 `node_overlays` map
（[sheetStyle.ts](../../../../web/src/components/MemoContent/sheets/sheetStyle.ts)），
以块的 `id:` 为 key，value 是渲染器自有格式的不透明 JSON，服务端不解析
（`node_overlays` 是通用机制，不是 sheets 专属，字段定义见
[memo.proto](../../../../proto/store/memo.proto)）。这样表格源码保持人类可读的纯 CSV，
样式又不会污染正文 diff。`id` 在首次需要持久化样式时惰性生成，纯数据表格永远不会获得 id。

## 已知隐患：并发写入下的覆盖丢失

`node_overlays` 在 API 层是**整个 map 替换**语义（`UpdateMemo` 的 `node_overlays` mask，见
[memo_service.go](../../../../server/router/api/v1/memo_service.go)），而前端
[SheetsBlock.tsx](../../../../web/src/components/MemoContent/SheetsBlock.tsx) 的
`commitFromInstance` 是基于自己手里那份 `memo` 快照构造新 map 再整体提交的。由此产生两个
覆盖窗口（提交有 600ms debounce，窗口是真实存在的）：

1. **同一文档内多个 sheets 块互相覆盖 overlay**：A 块和 B 块在同一 debounce 窗口内各自提交，
   后到的那次请求携带的 map 是基于"B 提交前的快照"构造的，会把 A 刚写进去的 overlay 抹掉。
2. **表格提交覆盖正文改动**：`commitFromInstance` 用 `memoRef.current.content` 做
   `writeSheetsBlock` 再整体提交 content。如果用户在同一窗口内于编辑器改了正文其他部分，
   表格这次提交会把那部分改动回滚。

当前是**已知可接受**：单人、低频编辑场景下窗口极窄，且丢失的是样式/最近一次编辑而非整篇文档。

若要根治，方向是把服务端的 `node_overlays` 从整表替换改为 **per-key merge**（只更新 mask 里
指定的那些 key，其余保持不变），正文侧则需要引入 version/etag 之类的乐观并发校验，让基于陈旧
快照的写入失败重试而不是静默覆盖。这两项都超出当前范围，留待多人协作编辑时一并处理。

TODO(确认)：本篇成文时未重新核对 `commitFromInstance` 当前实现是否仍是原设计描述的样子，
只是从旧方案直接誊写；下次改动 SheetsBlock.tsx 时应顺手核实这段是否仍然准确。
