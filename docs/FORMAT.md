# `.morrowdeck` format

`.morrowdeck` 是 UTF-8 JSON。Version 1 保持可读、可 diff；旧 deck 在 normalize 时自动补齐新字段。

```json
{
  "version": 1,
  "title": "Weekly Update",
  "selectedId": "slide-id",
  "theme": {
    "name": "blue",
    "fontFamily": "Inter",
    "titleFontFamily": "Inter",
    "background": "#f5f8ff",
    "text": "#14213d",
    "accent": "#2563eb"
  },
  "view": {
    "snapToObjects": true,
    "snapToGrid": false,
    "showGrid": false,
    "showGuides": true,
    "showElementLabels": false,
    "gridSize": 2.5,
    "guideX": [50],
    "guideY": [50]
  },
  "slides": [
    {
      "id": "slide-id",
      "layout": "blank",
      "title": "",
      "body": "",
      "background": "#f5f8ff",
      "notes": "Speaker-only notes",
      "transition": { "type": "fade", "duration": 0.35 },
      "elements": []
    }
  ]
}
```

## Deck fields

- `version`: 当前 `1`。
- `title`: deck 标题。
- `selectedId`: GUI selection hint，必须指向一个 slide ID。
- `theme`: deck 级默认视觉 token。
- `view`: 编辑器吸附/网格/参考线/组件标识设置。
- `slides`: 非空、按顺序排列。

`theme.name` 目前内置 `default`, `dark`, `warm`, `blue`，但其余字段会独立持久化，因此未来可支持自定义主题。

`view.gridSize`, `guideX`, `guideY` 均使用 slide 百分比坐标。

## Slide fields

- `layout`: `title-body`, `title`, `section`, `blank`。
- `title`, `body`: 兼容的版式占位层文本。
- `background`: CSS color string。
- `notes`: 演讲者备注。
- `transition.type`: `none` / `fade`。
- `transition.duration`: 秒。
- `elements`: 数组顺序也是 z-order；后面的对象位于更高层。

## Component identification overlay

`view.showElementLabels` controls an editor-only identification overlay. When enabled, each element is labeled with its 1-based position, a derived type/name, and the first 8 characters of its stable UUID. Labels are not rendered in thumbnails, presentation mode, PDF, or PPTX exports. The CLI accepts a unique element-ID prefix of 6 or more characters, so the displayed 8-character ID can be used directly by an agent.

## Element common fields

常规 element 共享：

- `id`: 稳定唯一 ID。
- `type`: `text`, `shape`, `image`, `table`, `connector`。
- `x`, `y`, `width`, `height`: slide 百分比坐标系。
- `rotation`: 度数。
- `opacity`: `0..1`。
- `locked`: GUI 中禁止直接变换。
- `groupId`: `null` 或 group UUID。相同非空 `groupId` 表示同一组合；组合不建立嵌套容器，因此内部对象依然保持自身 geometry/z-order。

坐标可以超出 `0..100`，允许对象部分位于 slide 外。

## Text

`type: text` 额外包含 `text`, `fontFamily`, `fontSize`, `fontWeight`, `italic`, `underline`, `color`, `align`, `verticalAlign`, `fill`, `stroke`, `strokeWidth`, `padding`。

## Shape

`shape`: `rect`, `rounded-rect`, `ellipse`, `line`, `arrow`。Shape 可带与 text 相同的文字样式。

## Image

```json
{
  "type": "image",
  "path": ".morrow-assets/hash.jpg",
  "alt": "Architecture",
  "x": 55, "y": 18, "width": 36, "height": 48,
  "intrinsicWidth": 640, "intrinsicHeight": 480,
  "crop": { "left": 6, "top": 0, "right": 10, "bottom": 0 }
}
```

- `path`: deck 内安全相对路径。
- `intrinsicWidth/Height`: 原图像素尺寸。
- `height` 会按 source aspect ratio 从 `width` 规范化。
- `crop.*`: 完整图片框内部的非破坏性遮罩百分比；至少保留 5% 可见区域。
- 编辑 crop/resize/rotate 不修改 asset 字节。

## Table

```json
{
  "type": "table",
  "rows": 3,
  "cols": 2,
  "cells": [["Metric", "Value"], ["Pass", "24/24"], ["Recovery", "Local"]],
  "fill": "#ffffff",
  "headerFill": "#e8e8e4",
  "stroke": "#777777",
  "strokeWidth": 1
}
```

`cells` 始终被规范化为严格 `rows × cols` string matrix。第一行使用 `headerFill`。Table 同样具有 common geometry 和文本样式字段。

## Connector

Connector 不是静态截图线，而是保存端点关系：

```json
{
  "type": "connector",
  "from": { "elementId": "agent-id", "anchor": "auto" },
  "to": { "elementId": "system-id", "anchor": "auto" },
  "arrow": "both",
  "stroke": "#4b4d50",
  "strokeWidth": 2,
  "dash": true
}
```

Endpoint 可以引用对象，也可以是 free point：`{"elementId": null, "anchor":"auto", "x":40, "y":50}`。

Anchors: `auto`, `top`, `right`, `bottom`, `left`, `center`。`arrow`: `none`, `end`, `both`。引用对象移动时 GUI 会实时重新求端点。引用已不存在的 element 在 normalize 时会退化为 free endpoint，而不会留下悬空 ID。

## Assets

图片不是 base64。`element-add-image` 将已有图片复制到 sibling `.morrow-assets/`，使用 SHA-256 前缀文件名去重。支持 PNG/JPEG/GIF/WebP/HEIC/HEIF。

`morrow-presenter export` 和 Mac App Save As 会复制所有引用 asset。旧 `slides[].image` 会自动迁移成一个 `type=image` element。

## Interchange

- `export-pdf`: 将 Morrow model 渲染为真实 PDF。
- `export-pptx`: 将常见 Morrow element 映射成真正的 PowerPoint OOXML objects。
- `import-pptx`: 将常见 PowerPoint shapes/images/tables/text 转成 Morrow objects；图片抽取到 `.morrow-assets/`。

交换脚本通过 PEP 723 + `uv run --script` 声明依赖，不把 virtualenv/vendor 包写入 repo。

复杂 PowerPoint object 的目标是 graceful degradation，不保证完全无损 round-trip。当前图表/SmartArt 等可能变成普通占位 shape；PPTX 中 connector 回导可能变成普通 line。

## Machine-readable schema

```bash
morrow-presenter schema --json
morrow-presenter capabilities --json
```

Agent 应优先通过 CLI 进行 mutation：CLI 会规范化字段、保持 IDs、原子写入、校验引用和 asset 路径。
