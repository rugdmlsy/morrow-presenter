# Morrow Presenter

轻量、本地优先、shell-first 的 macOS slides 编辑与放映工具。目标不是完整复制 Microsoft PowerPoint，而是优先覆盖日常最常用的编辑工作流，同时保持文件简单、可 diff、可由 agent 直接从 shell 操作。

## 产品形态

- 原生 macOS App 壳：Swift + AppKit + WebKit，无 Electron/Tauri 运行时。
- 文稿文件：`.morrowdeck`，UTF-8 JSON。
- 图片资源：deck 旁的 `.morrow-assets/`，内容 hash 去重。
- Agent 接口：`morrow-presenter` CLI；持久化 GUI 能力必须有 shell 等价面，不依赖 MCP。
- `morrow-presenter open` 不抢前台焦点；只有明确的 `present` 会进入前台放映。

## 安装

```bash
cd morrow-presenter
./scripts/install.sh
```

安装后：

```bash
morrow-presenter capabilities --json
open -a "Morrow Presenter"
```

## 已实现的 PowerPoint 常用能力

### Slides

- `标题 + 正文`、`仅标题`、`章节页`、`空白`四种版式。
- 新建、复制、删除、拖拽排序 slide。
- 每页独立背景色。
- 演讲者备注。
- `none` / `fade` 基础切换效果。
- 原生全屏放映；方向键、Space、PageUp/PageDown、Home/End、Esc。

### 对象画布

一个 slide 可以同时包含任意数量的对象：

- 自由文本框。
- 图片（PNG/JPEG/GIF/WebP/HEIC/HEIF）。
- 矩形、圆角矩形、椭圆、直线、箭头。

对象支持：

- 单选，以及 `Shift` / `⌘` 多选。
- 任意位置拖动。
- 四角缩放；图片始终等比，其他对象按住 Shift 等比。
- 旋转。
- 透明度。
- 锁定 / 解锁。
- 复制、剪切、粘贴、删除、`⌘D` 快速复制。
- 置顶、置底、上移一层、下移一层。
- 左/中/右、顶/中/底对齐，以及水平/垂直分布。
- 方向键微调位置；Shift + 方向键较大步长移动。

### 文本与形状格式

- 字体、字号、粗体、斜体、下划线。
- 左/中/右文本对齐。
- 文字颜色。
- 填充色 / 无填充。
- 描边色 / 无描边 / 线宽。
- 双击文本框或形状可直接编辑其中的文字。

### 图片

- 一个 slide 可放多张图片。
- 图片自由定位和等比缩放。
- 非破坏性裁切：只保存 `crop.left/top/right/bottom` 遮罩，不修改原图字节。
- 图片路径、坐标、完整尺寸、原始像素尺寸、旋转、透明度和裁切状态都写入 `.morrowdeck`。
- 另存为 / CLI export 会复制所有引用的图片资源。

Presenter 不负责生成图片。

### 编辑体验

- `⌘Z` / `⇧⌘Z` 撤销重做。
- `⌘C` / `⌘X` / `⌘V` 对象复制剪切粘贴。
- `⌘A` 选择当前页全部对象。
- Delete / Backspace 删除所选对象。
- `⌘S` 保存，`⌘⇧S` 另存为，`⌘↵` 放映。
- shell 在 App 打开期间修改 deck，App 会自动同步刷新。

## Shell / Agent 示例

```bash
morrow-presenter new demo.morrowdeck --title "Demo"
morrow-presenter set demo.morrowdeck 1 --layout blank

morrow-presenter element-add-text demo.morrowdeck 1 "Architecture" \
  --x 8 --y 8 --width 42 --height 12 --font-size 32 --font-weight 700

morrow-presenter element-add-shape demo.morrowdeck 1 \
  --shape rounded-rect --text "Agent" --x 12 --y 32 --width 24 --height 16

morrow-presenter element-add-image demo.morrowdeck 1 ./diagram.png \
  --x 55 --y 18 --width 36 --alt "Architecture diagram"

morrow-presenter elements demo.morrowdeck 1 --json
morrow-presenter element-update demo.morrowdeck 1 <element-id> --rotation 8 --opacity 0.9
morrow-presenter element-align demo.morrowdeck 1 top <id-a> <id-b>
morrow-presenter element-order demo.morrowdeck 1 <id> --to-front

morrow-presenter slide-style demo.morrowdeck 1 \
  --background '#f7f7f8' --notes 'Mention rollback result' --transition fade

morrow-presenter validate demo.morrowdeck --json
morrow-presenter present demo.morrowdeck
```

旧的 `image-set` / `image-update` / `image-remove` 仍保留作为兼容接口，作用于该页第一张图片；新工作流优先使用 `element-add-image` 和 `element-update`。

完整 agent 接口见 `docs/AGENT.md`，格式见 `docs/FORMAT.md`。

## 构建

```bash
./scripts/build-app.sh
```

产物：`dist/Morrow Presenter.app`。

## 仍未覆盖的 PowerPoint 大功能

当前没有实现：PPTX 导入/导出、PDF 导出、表格、图表、SmartArt、视频/音频、复杂动画、母版/主题系统、对象组合、连接符自动吸附、协作、Presenter View、多显示器编排。文件格式已经改成通用 `elements[]`，后续这些能力可以继续在同一对象模型上扩展。
