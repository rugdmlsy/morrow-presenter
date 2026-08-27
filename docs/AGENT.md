# Agent Interface

Morrow Presenter 是 shell-first。Agent 应通过 `morrow-presenter` 修改 `.morrowdeck`，而不是自动点击 GUI。MCP 可以作为适配层，但不是前置条件。

```bash
morrow-presenter capabilities --json
morrow-presenter schema --json
```

`open` 故意非激活，不应抢用户键盘焦点；`present` 是明确的前台放映操作。

## References

Slide 和 element 都支持：

- 1-based position；
- 稳定 UUID；
- 唯一 UUID 前缀（至少 6 个字符）。

编辑器打开“组件标识”后，普通 element 会显示 `#序号 · 类型/名称 · 8位短ID`，版式占位层显示 `@title` / `@body`。8 位短 ID 可直接作为 CLI element ref；`@title` 对应 `set <deck> <slide> --title ...`，`@body` 对应 `set <deck> <slide> --body ...`。多步 mutation 仍优先保存/复用稳定 ID，因为增删和 z-order 会改变 position。

## Slides

```bash
morrow-presenter new talk.morrowdeck --title "Weekly Update"
morrow-presenter add talk.morrowdeck --after 1 --layout blank
morrow-presenter set talk.morrowdeck 1 --layout title --title "Reliable agents"
morrow-presenter duplicate talk.morrowdeck 2
morrow-presenter move talk.morrowdeck 3 --to 2
morrow-presenter delete talk.morrowdeck 3

morrow-presenter slide-style talk.morrowdeck 2 \
  --background '#f7f7f8' --notes 'Explain this' \
  --transition fade --transition-duration 0.3
```

长正文/备注可使用 `--body-file -` / `--notes-file -`。

## Add and inspect objects

```bash
morrow-presenter elements talk.morrowdeck 2 --json
morrow-presenter element-get talk.morrowdeck 2 <id> --json

morrow-presenter element-add-text talk.morrowdeck 2 "Control loss" \
  --x 8 --y 8 --width 40 --height 12 --font-size 30 --font-weight 700

morrow-presenter element-add-shape talk.morrowdeck 2 \
  --shape rounded-rect --text Watchdog --x 12 --y 34 --width 25 --height 17

morrow-presenter element-add-image talk.morrowdeck 2 ./diagram.png \
  --x 55 --y 18 --width 36 --alt Architecture
```

图片会复制到 `.morrow-assets/` 并 content-hash 去重。

## Table

```bash
TABLE=$(morrow-presenter element-add-table talk.morrowdeck 2 \
  --rows 3 --cols 2 \
  --cells-json '[["Metric","Value"],["Pass","24/24"],["Recovery","Local"]]' \
  --json | jq -r '.element.id')

morrow-presenter table-set talk.morrowdeck 2 "$TABLE" 2 2 '33/34'
morrow-presenter table-row-add talk.morrowdeck 2 "$TABLE" --at 3
morrow-presenter table-row-delete talk.morrowdeck 2 "$TABLE" --at 1
morrow-presenter table-col-add talk.morrowdeck 2 "$TABLE"
morrow-presenter table-col-delete talk.morrowdeck 2 "$TABLE" --at 2
morrow-presenter table-resize talk.morrowdeck 2 "$TABLE" --rows 5 --cols 3
```

## Connectors

创建两个对象后：

```bash
morrow-presenter element-add-connector talk.morrowdeck 2 <from-id> <to-id> \
  --from-anchor auto --to-anchor auto \
  --arrow both --dash --stroke '#475569' --stroke-width 2
```

对象端点可选 `auto/top/right/bottom/left/center`。Connector 引用 element UUID，因此移动对象不会要求 agent 重新计算线端点。

## Group / ungroup

```bash
morrow-presenter element-group talk.morrowdeck 2 <id-a> <id-b> <id-c> --json
morrow-presenter element-ungroup talk.morrowdeck 2 <any-member-id>
```

Grouping 写入相同 `groupId`。GUI 可把 group 作为整体选择、移动、等比缩放和旋转；内部 element 的 geometry 仍独立可读。

## Geometry, format, crop

```bash
morrow-presenter element-update talk.morrowdeck 2 <id> --x 42 --y 16
morrow-presenter element-update talk.morrowdeck 2 <id> --scale 1.15 --rotation 8 --opacity 0.9
morrow-presenter element-update talk.morrowdeck 2 <id> \
  --font-family Arial --font-size 26 --font-weight 700 \
  --italic --underline --align center \
  --color '#111111' --fill '#fff4cc' --stroke '#333333' --stroke-width 2

morrow-presenter element-update talk.morrowdeck 2 <image-id> \
  --crop-left 8 --crop-right 12 --crop-top 4
morrow-presenter element-update talk.morrowdeck 2 <image-id> --reset-crop
```

图片 crop 只改 metadata，不修改图片文件。

## Order and alignment

```bash
morrow-presenter element-order talk.morrowdeck 2 <id> --to-front
morrow-presenter element-order talk.morrowdeck 2 <id> --backward
morrow-presenter element-align talk.morrowdeck 2 left <a> <b> <c>
morrow-presenter element-align talk.morrowdeck 2 distribute-h <a> <b> <c>
```

Alignment modes: `left`, `center`, `right`, `top`, `middle`, `bottom`, `distribute-h`, `distribute-v`。

## Themes, grid, snap and guides

```bash
morrow-presenter theme talk.morrowdeck --json
morrow-presenter theme-set talk.morrowdeck blue --apply-all

morrow-presenter view-settings talk.morrowdeck \
  --snap-to-objects --snap-to-grid --show-grid --grid-size 5 \
  --show-guides --show-element-labels --guide-x 25 --guide-x 50 --guide-x 75 --guide-y 50
```

不带 mutation option 的 `view-settings` 用于读取当前配置。

## PPTX / PDF interchange

```bash
morrow-presenter export-pdf talk.morrowdeck talk.pdf --json
morrow-presenter export-pptx talk.morrowdeck talk.pptx --json
morrow-presenter import-pptx input.pptx imported.morrowdeck --json
```

这些命令需要 `uv`，但无需手工建 venv。脚本使用 `uv run --script` 按需下载并缓存：

- PDF: ReportLab + Pillow。
- PPTX export/import: python-pptx + Pillow。

普通编辑命令不加载这些依赖。

PPTX 交换是 best-effort object mapping，不承诺 Microsoft PowerPoint 所有 object 的完全无损 round-trip。复杂对象会优先降级而不是让整份导入失败。

## Validate / copy / open / present

```bash
morrow-presenter validate talk.morrowdeck --json
morrow-presenter export talk.morrowdeck ./handoff/talk.morrowdeck
morrow-presenter open talk.morrowdeck
morrow-presenter present talk.morrowdeck --slide 2
```

`export` 是 Morrow deck copy，并复制所有 asset；不要与 `export-pdf` / `export-pptx` 混淆。

## Compatibility image commands

`image-set`, `image-update`, `image-remove` 仍保留，作用于 slide 第一张 image。新 agent 工作流优先 generic `element-*`。

## GUI / CLI coexistence

`.morrowdeck` 是 source of truth。App 打开文件后监测 modification time；CLI 写入后 GUI 自动 reload。已有路径的 GUI mutation 自动原子保存。

因此 agent 默认：

1. 不启动 GUI，直接编辑文件。
2. 用户需要查看编辑器时才 `open`。
3. 用户明确开始演示时才 `present`。
4. 不依赖 GUI undo history 做 agent rollback。

## Exit codes and discovery

成功 code `0`；无效 deck/ref/asset、转换失败或 launch 失败 code `2`，错误写 stderr。

```bash
morrow-presenter --help
morrow-presenter element-update --help
morrow-presenter capabilities --json
morrow-presenter schema --json
```

## Completion rule for future features

新增持久化 GUI 功能完成定义至少包括：

1. `.morrowdeck` representation；
2. shell-reachable operation；
3. machine-readable output；
4. agent documentation；
5. regression test。
