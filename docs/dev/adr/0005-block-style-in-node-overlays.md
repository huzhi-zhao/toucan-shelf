# ADR-0005：块样式落 node_overlays，不写进正文

## 状态

已采纳。

## 背景

[sheets 代码块](../requirements/editor/sheets-block.md) 需要持久化单元格样式、网格视口高度、
当前打开的 sheet 标签这类"渲染状态"，而块的文本内容（CSV）需要保持人类可读、随文档一起 diff。

## 决策

表格的**文本内容**序列化回 markdown 正文；**样式类信息**不进正文，改存进 memo 的
`node_overlays` map（[memo.proto](../../../proto/store/memo.proto) 的通用字段），以块的
`id:` 为 key，value 是渲染器自有格式的不透明 JSON，服务端不解析。`id` 在首次需要持久化样式时
惰性生成，纯数据表格永远不会获得 id。

`node_overlays` 是通用机制（"per-node 补充 JSON"），不是 sheets 专属，未来其他需要挂载
非语义渲染状态的块可以复用同一个字段。

## 理由

样式信息混进正文会污染 diff、拖慢阅读纯文本的场景（比如 memogit 推到 git 之后看 diff）。
分离之后表格源码保持纯 CSV，样式变化不产生正文改动。

## 已知代价

`node_overlays` 在 API 层是整表替换语义（`UpdateMemo` 的 `node_overlays` mask），与前端基于
快照构造增量提交之间存在并发覆盖窗口，详见
[sheets-block.md 的"已知隐患"一节](../requirements/editor/sheets-block.md#已知隐患并发写入下的覆盖丢失)。
当前判定为单人低频场景下可接受，未列入本次范围。
