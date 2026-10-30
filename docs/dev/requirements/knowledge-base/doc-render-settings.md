# 文档渲染设置：列表样式、References 排序

2026-10-30。两项都是按文档的展示设置，存在 `DocConfig`（memo payload）里，不放 frontmatter，
理由见 `document-icon.md` 第 3 节的三层划分：改它不产生版本、不更新修改时间、没有 memogit diff。
网页端在文档菜单"文档设置"里改；手机阅读页按设置渲染，暂不提供设置入口。

## 1. 列表样式 `bullet_list_style`

- 枚举：`PLAIN`（普通列表，未设置时也是它）、`CARDS`（卡片按钮）。以后加样式就加枚举值；
  其他 Markdown 元素（标题、引用等）要样式时，在 `DocConfig` 里另加各自的字段，不塞进这个枚举。
- `CARDS`：顶层无序列表渲染成一张圆角卡片，每项一行，像 iOS 设置页：
  - 左边方块：列表项开头的 emoji（从文字里拿掉，放进方块）；没有 emoji 就按文字固定挑一个底色。
  - 列表项里有链接（文档引用或网址）时整行可点，右侧显示 ›；没有链接就只是一行。
  - 嵌套列表、有序列表、任务清单照常显示。
- 客户端不认识的样式值按普通列表渲染；网页端改其他开关时原样写回，不会把新客户端设的值冲掉。
- 两端共用同一个 Markdown 渲染器（`MemoContent/markdown/CardList.tsx`）。

## 2. References 排序 `reference_sort` + `reference_sort_descending`

- 只排子文档；外部链接保持 frontmatter 里的顺序。
- 键：`CREATED` 创建时间、`UPDATED` 更新时间、`TITLE` 标题（数字按大小）、`TYPE` 文档类型
  （Markdown、HTML、PDF、视图），同值再按标题。未设置（默认）保持服务端返回的顺序。
- 倒序是单独的开关，默认为否；未选排序键时倒序不可选。
- 网页端 References 区、手机阅读页的参考列表和面板"参考"标签都按这个顺序。
