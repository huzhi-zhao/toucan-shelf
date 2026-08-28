# 宣传海报的画布源文件

对外宣传海报的 artboard 源文件。**这里只放源文件**——生成出来的画布页面
（约 2.5MB，含内嵌编辑器）和从 `web/public/` 复制过来的 logo 都在 `.gitignore` 里。

| 文件 | 是什么 |
|---|---|
| `Main.dc.html` | 主稿，1920×1080 宽屏海报 |
| `DirectionB.dc.html` | 备选方向（低保真）：纸感索引，米白 + 衬线 + 编号列表 |
| `DirectionC.dc.html` | 备选方向（低保真）：三栏 app 界面占主体，功能缩成底部 caption |
| `canvas.json` | 画布布局：三块 artboard 的位置与两条批注 |

## 重新生成

logo 是从 `web/public/logo.svg` 复制进来的，先补上：

```bash
cd .poster && cp ../web/public/logo.svg .
```

然后用 Claude Code 的 `design` skill 重新 seed（`seed-canvas.mjs` 随 skill 分发，
路径每次会话可能不同，以当次 skill 给出的 base directory 为准）：

```bash
node "<skill base>/seed-canvas.mjs" \
  --template "<skill base>/payload.template.html" \
  --out toucanshelf-poster.html \
  --title "ToucanShelf Poster" \
  --artboard Main.dc.html \
  --artboard DirectionB.dc.html \
  --artboard DirectionC.dc.html \
  --image logo.svg \
  --canvas canvas.json
```

## 内容口径

海报上的功能描述**只写可证伪的事实**，不用"强大""高效"这类形容词。改文案时守住两条：

- **NAS 外部资源根尚未实现**，必须带 `PLANNED` 标记。它是海报上唯一还不存在的能力，
  混进已实现的功能里说就是虚假宣传。需求见
  [`docs/dev/requirements/storage/external-resource-roots.md`](../docs/dev/requirements/storage/external-resource-roots.md)。
- 文案目前是英文，与 `README.md` 的对外口径一致（面向 GitHub 受众）。
  若出中文版，字重与字距需要另调，不能直译。

品牌色取自 logo：深蓝 `#1F3BAB`、金黄 `#F7B511` / `#FDCC3E`、赭石 `#A5583F` / `#BD5D41`、
暗蓝 `#0F1C41`。金色是唯一重音色，只用在顶部横条、编号、标题末词和 `PLANNED` 标签。
