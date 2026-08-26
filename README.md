# Morrow Presenter MVP

一个仅运行在 Mac 本机的轻量 slides 编辑与放映工具。

## 启动

双击 `start.command`，或执行：

```bash
cd /Users/huayuxue/workspaces/morrow-presenter
python3 -m http.server 4173 --bind 127.0.0.1
```

然后打开 `http://127.0.0.1:4173`。

## MVP 功能

- 三种 slide 布局：标题、标题 + 正文、章节页
- 左侧缩略图选择与拖动排序
- 新增、复制、删除 slide
- 本机 `localStorage` 自动保存
- JSON 导入 / 导出
- 全屏放映
- 放映快捷键：方向键、Space、PageUp/PageDown、Home/End、Esc
- 编辑快捷键：`⌘⇧N` 新增、`⌘D` 复制、`⌘↵` 放映

当前版本不包含图片、动画、多人协作、PPTX 导入导出和云端同步。
