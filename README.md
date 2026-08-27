# Morrow Presenter

轻量、本地优先、shell-first 的 macOS slides 编辑与放映工具。目标是覆盖 PowerPoint 日常高频工作流，同时让文稿保持简单、可 diff、可由 agent 直接从 shell 修改。

## 产品形态

- 原生 macOS App：Swift + AppKit + WebKit，无 Electron/Tauri runtime。
- 文稿：`.morrowdeck` UTF-8 JSON。
- 图片：deck 旁的 `.morrow-assets/`，按内容 hash 去重。
- Agent：`morrow-presenter` CLI；持久化 GUI 功能必须有 shell 等价面，不依赖 MCP。
- `morrow-presenter open` 不抢前台焦点；只有明确的 `present` 会进入前台放映。
- PDF/PPTX 交换功能通过 `uv` 按需安装/缓存 Python 依赖；普通编辑命令不加载这些依赖。

## 安装

```bash
cd morrow-presenter
./scripts/install.sh
morrow-presenter capabilities --json
```

## 已实现的 PowerPoint 常用能力

### Slides

- `标题 + 正文`、`仅标题`、`章节页`、`空白`四种版式模板；模板只负责创建/重排文本框，不使用独立占位渲染层。
- 新建、复制、删除、拖拽排序。
- 每页背景色、演讲者备注。
- `none` / `fade` 基础切换效果。
- 原生全屏放映；方向键、Space、PageUp/PageDown、Home/End、Esc。

### 自由对象画布

同一页可放任意数量的：

- 文本框；标题/正文也都是普通文本框，只通过 `role: title/body` 标记语义。
- 图片（PNG/JPEG/GIF/WebP/HEIC/HEIF）。
- 矩形、圆角矩形、椭圆、直线、箭头。
- 表格。
- 自动连接符。

编辑支持：

- 单选、`Shift` / `⌘` 多选、框选。
- 任意拖动、方向键微调。
- 四角缩放；图片始终等比；多对象/组合整体等比缩放。
- 单对象和多对象/组合旋转。
- 透明度、锁定。
- `⌘C / ⌘X / ⌘V`、`⌘D`、Delete。
- 置顶 / 置底 / 上下移动一层。
- 左/中/右、顶/中/底对齐；水平/垂直分布。
- `⌘G` 组合，`⇧⌘G` 取消组合。

### 组件标识

工具栏“组件标识”开关会在编辑画布上显示浅色标识。普通对象显示 `#序号 · 类型/名称 · 8位短ID`；带标题/正文语义的普通文本框额外显示 `@title` / `@body`。标识只出现在编辑器，不进入缩略图、放映、PDF 或 PPTX。CLI 支持至少 6 位的唯一 UUID 前缀，并可直接用 `@title` / `@body` 作为 element ref；例如 `element-update ... @title --x 12 --width 70`。`set --title` / `set --body` 只是修改这两个 role 文本框的便捷别名。

### 吸附、网格和参考线

- 对象边缘/中心吸附。
- 可选网格显示 + 网格吸附。
- 中心参考线，文件格式也支持自定义多条 `guideX/guideY`。
- 这些编辑器设置保存在 deck 的 `view` 中，CLI 可修改。

### 文本、形状和表格

- 字体、字号、粗体、斜体、下划线、颜色、文本对齐。
- 填充、无填充、描边、线宽。
- 双击文本框/形状直接编辑文字；标题/正文文本框同样支持拖动、四角 resize、旋转、层级、对齐和组合。
- 表格单元格双击编辑。
- 表格增删行列；CLI 还支持指定单元格和指定位置增删行列。

### 连接符

- 选择两个对象后可创建自动连接符。
- 端点跟随对象移动/组合变换。
- 自动选择上下左右连接方向，也支持文件/CLI 显式 anchor。
- 单箭头、双箭头、无线头；实线/虚线；颜色和线宽。

### 图片

- 多图、自由定位、等比缩放和旋转。
- 非破坏性裁切：只保存 `crop.left/top/right/bottom`，不改源图片字节。
- 另存为和 deck export 会复制所有引用 asset。

Presenter 不负责生成图片。

### 主题

内置 `default` / `dark` / `warm` / `blue` 主题。主题保存 deck 级默认字体、标题字体、背景、文字色和 accent；GUI 可一键应用到整份文稿，CLI 也可操作。

### PowerPoint / PDF 交换

真实文件交换，而不是截图伪装：

```bash
morrow-presenter export-pdf talk.morrowdeck talk.pdf
morrow-presenter export-pptx talk.morrowdeck talk.pptx
morrow-presenter import-pptx existing.pptx imported.morrowdeck
```

Mac App 顶栏可直接导出 PDF/PPTX；“打开”也可直接选择 `.pptx`，再保存为 `.morrowdeck`。

`export-pdf` 使用 ReportLab/Pillow，`export-pptx` 和 `import-pptx` 使用 python-pptx/Pillow，均由 `uv run --script` 按需解析依赖。首次执行可能需要下载依赖，之后使用 uv cache。

目前 PPTX 重点覆盖文本框、基础形状、图片及裁切、表格、位置/尺寸、备注以及常见连接线。PowerPoint 中无法直接映射的复杂对象会尽量降级成普通占位 shape，而不是导致整份文件导入失败。SmartArt、图表等高级对象目前不是可编辑的原生 Morrow element；PPTX 中的动态 connector 回导时可能降级成普通 line。

## Shell / Agent 示例

```bash
morrow-presenter new demo.morrowdeck --title "Demo"
morrow-presenter set demo.morrowdeck 1 --layout blank

A=$(morrow-presenter element-add-shape demo.morrowdeck 1 \
  --shape rounded-rect --text Agent --x 10 --y 20 --json | jq -r '.element.id')
B=$(morrow-presenter element-add-shape demo.morrowdeck 1 \
  --shape ellipse --text System --x 65 --y 20 --json | jq -r '.element.id')

morrow-presenter element-group demo.morrowdeck 1 "$A" "$B"
morrow-presenter element-add-connector demo.morrowdeck 1 "$A" "$B" --arrow both --dash
morrow-presenter element-add-table demo.morrowdeck 1 --rows 3 --cols 2 \
  --cells-json '[["Metric","Value"],["Pass","24/24"],["Recovery","Local"]]'

morrow-presenter theme-set demo.morrowdeck blue --apply-all
morrow-presenter view-settings demo.morrowdeck --snap-to-grid --show-grid --grid-size 5
morrow-presenter validate demo.morrowdeck --json
morrow-presenter export-pptx demo.morrowdeck demo.pptx
```

完整 agent 接口见 `docs/AGENT.md`，格式见 `docs/FORMAT.md`。

## 构建

```bash
./scripts/build-app.sh
```

产物：`dist/Morrow Presenter.app`。

## 仍未覆盖的大功能

当前主要缺口是：原生可编辑图表、SmartArt、视频/音频、复杂进入/退出/路径动画、完整母版/版式编辑器、评论/协作、Presenter View、多显示器编排，以及对所有 PowerPoint 特性的无损 round-trip。当前 `elements[] + theme + view` 格式已经为这些能力留出继续扩展空间。
