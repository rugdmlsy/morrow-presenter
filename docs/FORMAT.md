# `.morrowdeck` format

`.morrowdeck` 是 UTF-8 JSON。Version 1 保持可读、可 diff，并允许旧 deck 在 normalize 时自动迁移。

```json
{
  "version": 1,
  "title": "Weekly Update",
  "selectedId": "slide-id",
  "slides": [
    {
      "id": "slide-id",
      "layout": "blank",
      "title": "",
      "body": "",
      "background": "#f7f7f8",
      "notes": "Speaker-only notes",
      "transition": { "type": "fade", "duration": 0.35 },
      "elements": [
        {
          "id": "text-id",
          "type": "text",
          "text": "Architecture",
          "x": 8, "y": 8, "width": 42, "height": 12,
          "rotation": 0, "opacity": 1, "locked": false,
          "fontFamily": "Inter", "fontSize": 32, "fontWeight": 700,
          "italic": false, "underline": false,
          "color": "#202124", "align": "left", "verticalAlign": "top",
          "fill": "transparent", "stroke": "transparent", "strokeWidth": 0,
          "padding": 1.2
        },
        {
          "id": "shape-id",
          "type": "shape",
          "shape": "rounded-rect",
          "text": "Agent",
          "x": 12, "y": 32, "width": 24, "height": 16,
          "rotation": 0, "opacity": 1, "locked": false,
          "fill": "#e8e8e4", "stroke": "#4b4d50", "strokeWidth": 1.5,
          "fontFamily": "Inter", "fontSize": 20, "fontWeight": 400,
          "italic": false, "underline": false,
          "color": "#202124", "align": "center", "verticalAlign": "middle"
        },
        {
          "id": "image-id",
          "type": "image",
          "path": ".morrow-assets/4566b637ae298d756c193d3e.jpg",
          "alt": "Architecture diagram",
          "x": 55, "y": 18, "width": 36, "height": 48,
          "intrinsicWidth": 640, "intrinsicHeight": 480,
          "crop": { "left": 6, "top": 0, "right": 10, "bottom": 0 },
          "rotation": 0, "opacity": 1, "locked": false
        }
      ]
    }
  ]
}
```

## Slide fields

- `layout`: `title-body`, `title`, `section`, `blank`.
- `title`, `body`: 兼容的版式占位层文本。
- `background`: CSS color string；GUI 颜色选择器主要产生 `#rrggbb`。
- `notes`: 演讲者备注，不在普通放映画面中显示。
- `transition.type`: `none` 或 `fade`。
- `transition.duration`: 秒。
- `elements`: 按数组顺序从后到前渲染；后面的 element 位于更高层。

## Element common fields

所有 element 都有：

- `id`: 稳定唯一 ID。
- `type`: `text`, `shape`, `image`。
- `x`, `y`: 对象左上角，单位是 slide 宽/高百分比。
- `width`, `height`: 对象完整 bounding box，相同百分比坐标系。
- `rotation`: 度数。
- `opacity`: `0..1`。
- `locked`: GUI 中锁定后禁止拖动/缩放/旋转。

坐标允许暂时超出 `0..100`，因此对象可以部分位于 slide 外侧。

## Text elements

额外字段：`text`, `fontFamily`, `fontSize`, `fontWeight`, `italic`, `underline`, `color`, `align`, `verticalAlign`, `fill`, `stroke`, `strokeWidth`, `padding`。

## Shape elements

`shape` 支持：`rect`, `rounded-rect`, `ellipse`, `line`, `arrow`。形状还可拥有 `text` 和与 text element 相同的文本样式。

## Image elements

- `path`: 安全相对路径。Presenter 管理的资源位于 `.morrow-assets/`。
- `intrinsicWidth`, `intrinsicHeight`: 原图像素尺寸。
- 图片缩放保持原始宽高比，因此 `height` 会从 `width + intrinsic dimensions` 重新规范化。
- `crop.left/top/right/bottom`: 完整图片框内部的非破坏性遮罩百分比。相对两侧会规范化为至少保留 5% 可见区域。
- 图片文件本身不会因为 crop/resize/rotate 被重编码。

多个 image element 可以引用同一个 content-hash asset；这不会复制文件。

## Assets and export

图片不是 base64 内嵌数据。`element-add-image` 会把已有图片复制到 deck 旁的 `.morrow-assets/`，按 SHA-256 前缀命名去重。支持 PNG/JPEG/GIF/WebP/HEIC/HEIF。

`morrow-presenter export` 和 Mac App 的另存为会复制 `elements[]` 中所有被引用的图片资源。旧的 `slides[].image` 也会在读取时自动迁移成一个 `type=image` element。

## Machine-readable schema

```bash
morrow-presenter schema --json
morrow-presenter capabilities --json
```

推荐通过 CLI 修改，而不是用临时脚本直接写 JSON：CLI 会保持 ID、规范化字段、原子写入文件、检查 asset 路径和 slide/element reference。
