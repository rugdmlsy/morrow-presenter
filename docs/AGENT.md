# Agent Interface

Morrow Presenter 是 shell-first。Agent 应通过 `morrow-presenter` 修改 `.morrowdeck`，而不是自动点击 GUI；MCP 可以作为未来适配层，但不是依赖。

```bash
morrow-presenter capabilities --json
```

`open` 故意采用非激活方式打开编辑器，不应抢用户当前键盘焦点。`present` 是唯一正常情况下应主动进入前台的命令。

## References

Slide ref 可以是 1-based position 或稳定 slide UUID。Element ref 同样可以是 element 的 1-based position 或稳定 element UUID。

进行多步修改时优先使用 UUID，因为增删/排序会改变 position。

## Core slide operations

```bash
morrow-presenter new talk.morrowdeck --title "Weekly Update"
morrow-presenter slides talk.morrowdeck --json
morrow-presenter get talk.morrowdeck 1 --json
morrow-presenter add talk.morrowdeck --after 1 --layout blank
morrow-presenter set talk.morrowdeck 1 --layout title --title "Reliable agents"
morrow-presenter duplicate talk.morrowdeck 2
morrow-presenter move talk.morrowdeck 3 --to 2
morrow-presenter delete talk.morrowdeck 3
```

Slide background、notes 和 transition：

```bash
morrow-presenter slide-style talk.morrowdeck 2 \
  --background '#f7f7f8' \
  --notes 'Explain the failure case first' \
  --transition fade --transition-duration 0.3
```

长正文/备注可用 `--body-file -` / `--notes-file -` 从 stdin 输入。

## Generic object operations

先查看当前对象：

```bash
morrow-presenter elements talk.morrowdeck 2 --json
morrow-presenter element-get talk.morrowdeck 2 <element-id> --json
```

添加文本框：

```bash
morrow-presenter element-add-text talk.morrowdeck 2 "Control loss" \
  --x 8 --y 8 --width 40 --height 12 \
  --font-size 30 --font-weight 700 --color '#202124' --json
```

添加基础形状：

```bash
morrow-presenter element-add-shape talk.morrowdeck 2 \
  --shape rounded-rect --text "Watchdog" \
  --x 12 --y 34 --width 25 --height 17 \
  --fill '#e8e8e4' --stroke '#4b4d50' --stroke-width 1.5 --json
```

支持 `rect`, `rounded-rect`, `ellipse`, `line`, `arrow`。

添加已有本地图片：

```bash
morrow-presenter element-add-image talk.morrowdeck 2 ./diagram.png \
  --x 55 --y 18 --width 36 --alt "Architecture" --json
```

Presenter 会把源文件复制到 `.morrow-assets/` 并 content-hash 去重；不要把任意绝对路径写进 deck。

## Move / resize / rotate / format

```bash
morrow-presenter element-update talk.morrowdeck 2 <id> --x 42 --y 16
morrow-presenter element-update talk.morrowdeck 2 <id> --width 30 --height 14
morrow-presenter element-update talk.morrowdeck 2 <id> --scale 1.15 --rotation 8 --opacity 0.9
```

图片始终等比缩放；对 image 使用 `--height` 时 CLI 会按原比例反推 width。

文本/形状格式：

```bash
morrow-presenter element-update talk.morrowdeck 2 <id> \
  --font-family Arial --font-size 26 --font-weight 700 \
  --italic --underline --align center \
  --color '#111111' --fill '#fff4cc' --stroke '#333333' --stroke-width 2
```

## Non-destructive crop

仅 image element 支持：

```bash
morrow-presenter element-update talk.morrowdeck 2 <image-id> \
  --crop-left 8 --crop-right 12 --crop-top 4
morrow-presenter element-update talk.morrowdeck 2 <image-id> --reset-crop
```

这些命令只改变 mask metadata，不修改图片文件。

## Duplicate / delete / z-order / align

```bash
morrow-presenter element-duplicate talk.morrowdeck 2 <id>
morrow-presenter element-delete talk.morrowdeck 2 <id>

morrow-presenter element-order talk.morrowdeck 2 <id> --to-front
morrow-presenter element-order talk.morrowdeck 2 <id> --backward

morrow-presenter element-align talk.morrowdeck 2 left <id-a> <id-b> <id-c>
morrow-presenter element-align talk.morrowdeck 2 distribute-h <id-a> <id-b> <id-c>
```

Alignment modes: `left`, `center`, `right`, `top`, `middle`, `bottom`, `distribute-h`, `distribute-v`。分布至少需要三个对象。

## Compatibility image commands

历史接口仍可用：

```bash
morrow-presenter image-set ...
morrow-presenter image-update ...
morrow-presenter image-remove ...
```

它们只操作当前 slide 的第一张 image element。新代码优先使用 generic element commands。

## Validate / export / open / present

```bash
morrow-presenter validate talk.morrowdeck --json
morrow-presenter export talk.morrowdeck ./handoff/talk.morrowdeck
morrow-presenter open talk.morrowdeck
morrow-presenter present talk.morrowdeck --slide 2
```

`export` 会复制所有 image elements 引用的 asset。

## GUI/CLI coexistence

`.morrowdeck` 是 source of truth。App 打开文件时会 watch modification time；shell 修改写入后，GUI 自动 reload。如果 GUI 已有路径，编辑会自动原子保存。

因此：

1. 正常 agent 工作流不要启动 GUI。
2. 需要用户查看编辑器时才 `open`。
3. 只有用户要求开始演示时才 `present`。
4. 不要依赖 GUI 中的 undo history 去完成 agent rollback；agent 应直接通过 deck file / CLI 进行确定性修改。

## Discovery

```bash
morrow-presenter capabilities --json
morrow-presenter schema --json
morrow-presenter --help
morrow-presenter element-update --help
```

成功返回 code `0`；非法输入、缺失 asset、无效 ref 或 launch 失败返回 code `2` 并写 stderr。

## Design rule

以后新增任何持久化 GUI 能力，完成定义至少包括：

1. `.morrowdeck` 表达；
2. shell command 或 shell-reachable operation；
3. machine-readable output；
4. agent documentation；
5. regression test。
