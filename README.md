# Morrow Presenter

轻量、本地优先、shell-first 的 Mac slides 编辑与放映工具。

## 产品形态

- 原生 macOS App 壳：Swift + AppKit + WebKit，无 Electron/Tauri 运行时。
- 编辑 UI：HTML/CSS/JS，保留快速迭代能力。
- 文稿文件：`.morrowdeck`，本质是 UTF-8 JSON。
- Agent 接口：`morrow-presenter` CLI；所有核心持久操作都可从 shell 完成，不依赖 MCP。

## 安装

```bash
cd morrow-presenter
./scripts/install.sh
```

安装后：

```bash
open -a "Morrow Presenter"
morrow-presenter capabilities --json
```

## GUI 功能

- 标题、标题 + 正文、章节页三种布局
- 本地图片：左/右分栏、背景图、全屏图，支持 `cover` / `contain`
- 图片自动复制到 deck 同目录的 `.morrow-assets/`，使用内容 hash 去重
- 缩略图选择和拖拽排序
- 新增、复制、删除 slide
- 真实 `.morrowdeck` 打开 / 保存 / 另存为
- 已有文件自动保存
- shell 外部修改自动同步到打开的 App
- 原生 macOS 全屏放映
- 放映快捷键：方向键、Space、PageUp/PageDown、Home/End、Esc
- 编辑快捷键：`⌘S` 保存、`⌘⇧S` 另存为、`⌘⇧N` 新增 slide、`⌘D` 复制、`⌘↵` 放映

## Shell / Agent 操作

```bash
morrow-presenter new demo.morrowdeck --title "Demo"
morrow-presenter add demo.morrowdeck --title "Problem" --body "What are we solving?"
morrow-presenter set demo.morrowdeck 1 --layout title --title "Morrow Presenter"
morrow-presenter slides demo.morrowdeck --json
morrow-presenter present demo.morrowdeck
```

完整说明见 `docs/AGENT.md`，文件格式见 `docs/FORMAT.md`。

核心设计约束：以后增加任何会改变文稿或产生持久效果的 GUI 功能，都必须同时提供 shell 等价接口和机器可读输出；MCP 可以作为适配层，但不能成为 agent 操作 Presenter 的前置条件。

### 图片

```bash
morrow-presenter image-set demo.morrowdeck 2 ./diagram.png --placement right --fit contain --alt "Architecture"
morrow-presenter image-update demo.morrowdeck 2 --placement background --fit cover
morrow-presenter image-remove demo.morrowdeck 2
```

Presenter 只使用已有本地图片文件，不负责生成图片。

## 构建

```bash
./scripts/build-app.sh
```

产物：`dist/Morrow Presenter.app`。

当前 MVP 暂不包含图片、动画、Presenter View、多显示器编排、PPTX/PDF 导入导出和云端协作。
