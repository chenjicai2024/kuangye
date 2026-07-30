# UI 设计规范

> 本规范总结项目中已验证的 UI 模式和踩过的坑，新增模块时严格遵守，避免重复犯错。

---

## 1. 设计 Token

所有颜色、间距、圆角、字体必须使用 CSS 变量（定义在 `index.css :root`），禁止硬编码。

### 颜色

| 用途           | 变量名                 | 值                       |
| -------------- | ---------------------- | ------------------------ |
| 主背景         | `--bg-primary`         | `#0a0b10`                |
| 玻璃背景       | `--bg-glass`           | `rgba(255,255,255,0.03)` |
| 玻璃背景（重） | `--bg-glass-heavy`     | `rgba(255,255,255,0.06)` |
| 输入框背景     | `--bg-glass-input`     | `rgba(0,0,0,0.25)`       |
| 毛玻璃背景     | `--bg-frosted`         | `rgba(14,15,20,0.75)`    |
| 主文字         | `--text-primary`       | `#f0f0f5`                |
| 次文字         | `--text-secondary`     | `#8a8aa0`                |
| 弱文字         | `--text-muted`         | `#4a4a60`                |
| 主色调         | `--accent`             | `#10b981`（绿色）        |
| 主色调 hover   | `--accent-hover`       | `#34d399`                |
| 成功           | `--success`            | `#10b981`                |
| 错误           | `--error`              | `#f87171`                |
| 警告           | `--warning`            | `#fbbf24`                |
| 边框           | `--glass-border`       | `rgba(255,255,255,0.07)` |
| 边框（亮）     | `--glass-border-light` | `rgba(255,255,255,0.12)` |

### 圆角

| 用途                     | 变量名          | 值       |
| ------------------------ | --------------- | -------- |
| 小圆角（按钮、输入框）   | `--radius-sm`   | `8px`    |
| 中圆角（卡片、弹窗）     | `--radius-md`   | `12px`   |
| 大圆角（容器）           | `--radius-lg`   | `16px`   |
| 超大圆角                 | `--radius-xl`   | `24px`   |
| 全圆角（胶囊按钮、标签） | `--radius-full` | `9999px` |

### 字体

| 用途 | 变量名                                      |
| ---- | ------------------------------------------- |
| 正文 | `--font-sans`: Inter, SF Pro Display, ...   |
| 代码 | `--font-mono`: JetBrains Mono, SF Mono, ... |

### 过渡动画

| 用途 | 变量名                | 值                                 |
| ---- | --------------------- | ---------------------------------- |
| 快速 | `--transition-fast`   | `150ms cubic-bezier(0.4,0,0.2,1)`  |
| 正常 | `--transition-normal` | `250ms cubic-bezier(0.4,0,0.2,1)`  |
| 平滑 | `--transition-smooth` | `400ms cubic-bezier(0.16,1,0.3,1)` |

---

## 2. 下拉框 / Select

### 铁律：永远不要用原生 `<select>`

Chromium 原生 `<select>` 在 Windows 上有白底蓝高亮的系统样式，无法通过 CSS 覆盖，会破坏暗色主题。

**必须使用自定义下拉框组件。**

项目中有两个自定义下拉实现：

| 组件           | 文件                    | 适用场景             |
| -------------- | ----------------------- | -------------------- |
| `CustomSelect` | `ActionChainEditor.tsx` | 编辑器内的小尺寸选择 |
| `app-select`   | `App.tsx` + `index.css` | 主界面正式选择器     |

### CustomSelect 规范（ActionChainEditor 内联样式版）

```
触发按钮：
  背景: rgba(255,255,255,0.08)
  边框: 1px solid rgba(255,255,255,0.12)
  圆角: 6px
  字号: 12px
  内边距: 6px 10px
  文字色: #e5e7eb（有选中值）或 #666（无值占位）
  箭头: ▼ 10px #888

下拉面板：
  位置: absolute, top: calc(100% + 4px), left:0 right:0
  z-index: 1000
  背景: #15161d
  边框: 1px solid rgba(255,255,255,0.12)
  圆角: 8px
  阴影: 0 8px 24px rgba(0,0,0,0.4)
  需要 overflow: hidden

选项：
  内边距: 8px 12px
  字号: 12px
  选中色: #10b981（文字）+ rgba(16,185,129,0.12)（背景）
  hover: rgba(255,255,255,0.06)
```

**关键修复记录：**

- 早期 option 背景色不统一，被步骤按钮 z-index 遮挡 → 面板必须 `z-index: 1000`，且不能被 `overflow: hidden` 的父容器裁切
- 点击外部关闭：用 `document.addEventListener('mousedown')` 监听，不在面板内就关闭

### ActionChainEditor 项目下拉框规范

动作链编辑器左侧“项目”选择器不允许使用原生 `<select>`。必须使用自定义按钮 + 绝对定位面板，原因是项目行需要承载行内操作。

```
触发按钮：
  背景: rgba(255,255,255,0.075)
  边框: 1px solid rgba(255,255,255,0.1)
  圆角: 8px
  字号: 13px
  字重: 600
  内边距: 10px 12px
  打开态: box-shadow 0 0 0 1px rgba(16,185,129,0.22)

下拉面板：
  位置: absolute, top: calc(100% + 6px), left:0 right:0
  z-index: 1200
  背景: #111318
  边框: 1px solid rgba(255,255,255,0.1)
  圆角: 8px
  阴影: 0 12px 28px rgba(0,0,0,0.42)
  overflow: hidden

项目行：
  左侧为项目名，右侧为行内操作按钮
  当前项目: 文字 #10b981 + 背景 rgba(16,185,129,0.14)
  普通项目: 文字 #e5e7eb
  行分隔: 1px solid rgba(255,255,255,0.06)
```

项目下拉框的交互规则：

- 每个项目行右侧必须直接提供 `重命名` 和 `删除`，不要再在下拉框外重复放置项目级操作按钮。
- 点击项目名区域切换项目；点击 `重命名` / `删除` 必须 `stopPropagation()`，不能误触项目切换。
- 重命名在当前行内展开输入框，保留 `保存 / 取消`，不要弹出额外弹窗。
- 删除必须打开主题化确认弹窗，不允许使用原生 `confirm()`。
- 下拉框只负责切换应用和已有项目，不再放置创建操作；没有已保存项目时不显示项目分隔线。
- `编辑项目` 固定放在首屏顶部状态条右侧，使用绿色弱强调按钮，进入多项目管理页面。
- 引擎运行或框选向导打开期间，`编辑项目` 按钮保持可见但不可操作，避免并行流程冲突。

### 项目中心与保存反馈

- 主界面的 `编辑项目` 进入独立项目列表，不能直接跳进一个未命名的空编辑器。
- 项目中心必须显示全部项目，并支持连续创建、打开编辑、重命名和主题化确认删除。
- 每个项目卡片显示执行链、动作链、节点、区域数量以及最后保存时间，让用户明确内容属于哪个项目。
- 打开项目使用独立编辑窗口；编辑器左上角提供 `返回项目列表`，返回前必须等待当前项目保存完成。
- 编辑器只显示当前项目名称，不提供重复的手动保存按钮；节点修改仍自动保存，返回项目中心前等待最终保存完成。

### App.tsx 自定义下拉规范（CSS 类版）

使用 `.app-select-*` 系列 class（定义在 `index.css`），要点：

- 触发按钮: `.app-select-trigger`
- 面板: `.app-select-panel`（`z-index: 100`, `position: absolute`）
- 选项: `.app-select-option`（选中态加 `.selected`）
- **打开时父卡片加 `.dropdown-open`**，将卡片 z-index 提升到 80，防止被后续兄弟元素遮挡

---

## 3. 弹窗 / Modal

### StepEditor 弹窗模式

当前项目中的模态弹窗包括 `StepEditor`（步骤编辑）和危险操作确认弹窗（例如删除项目），实现方式必须保持同一深色主题。

```
遮罩层：
  position: fixed
  inset: 0
  background: rgba(0,0,0,0.6)
  backdropFilter: blur(4px)
  display: flex + 居中
  z-index: 2000

弹窗容器：
  background: #1a1b23
  border: 1px solid rgba(255,255,255,0.12)
  border-radius: 12
  padding: 20px
  width: 320px
  maxHeight: 80vh
  overflow: auto
```

**新增弹窗时的规则：**

- z-index 必须 >= 2000（当前最大是 2000）
- 遮罩层点击关闭弹窗
- Esc 键关闭弹窗
- 弹窗宽度固定 320px，不要超过 400px（主窗口宽度有限）
- 内容超长时用 `maxHeight: 80vh` + `overflow: auto` 滚动
- 不要在弹窗内再嵌套弹窗

### 危险确认弹窗规范

删除、清空、覆盖等不可逆操作必须使用主题化确认弹窗，不允许使用浏览器原生 `confirm()` / `alert()`。

```
遮罩层：
  position: fixed
  inset: 0
  z-index: 2000
  background: rgba(0,0,0,0.62)
  backdropFilter: blur(4px)
  display: flex + 居中

弹窗容器：
  width: 320px
  background: #15161d
  border: 1px solid rgba(255,255,255,0.12)
  border-radius: 12px
  box-shadow: 0 18px 50px rgba(0,0,0,0.5)
  padding: 18px

标题：
  字号: 15px
  字重: 700
  颜色: #f8fafc

说明文字：
  字号: 12px
  行高: 1.6
  颜色: #9ca3af

按钮：
  取消: rgba(255,255,255,0.06) 背景 + rgba(255,255,255,0.1) 边框
  危险确认: rgba(239,68,68,0.16) 背景 + rgba(239,68,68,0.35) 边框 + #f87171 文字
```

危险确认弹窗交互规则：

- 文案必须明确写出操作对象名称，例如 `删除“默认项目”`。
- 说明文字必须提示影响范围，例如执行链、动作链、区域配置会被删除。
- 遮罩点击和 Esc 只取消，不执行危险操作。
- 危险按钮文案必须是具体动作，例如 `删除项目`，不要只写 `确定`。

---

## 4. z-index 层级

这是最容易出问题的地方。必须严格遵守以下层级：

```
 1  — 普通内容区域 (.app-content)
 2  — 需要微浮起的卡片 (.target-app-card)
10  — 固定头部/底部 (.app-header, .bottom-bar)
80  — 下拉框打开状态的父卡片 (.dropdown-open)
100 — 下拉面板 (.app-select-panel)
1000 — Toast 提示 (.toast)
2000 — 模态弹窗 (StepEditor 遮罩)
```

**铁律：**

- 新增面板/弹窗的 z-index 不要超过 2000，除非有明确的多层弹窗需求
- `overflow: hidden` 的父容器会裁切子元素的 z-index 提升，下拉面板/弹窗必须跳出这个裁切链
- 使用 `position: fixed` 或 `position: absolute` + 足够的 z-index 确保不被遮挡

---

## 5. 内联样式 vs CSS Class

### 现状

- `App.tsx`、`MemoryWindow.tsx`、`ChatHistoryWindow.tsx` → 使用 CSS class（`index.css`）
- `ActionChainEditor.tsx` → 大量内联样式
- `ActionChainOverlayApp.tsx` → 全部内联样式
- `OverlayApp.tsx` → 使用 `overlay.css`

### 规范

**新增组件时：**

1. 可复用的基础元素（按钮、输入框、卡片）→ 用 `index.css` 中已有的 class
2. 一次性布局 → 可以内联样式
3. 新增的可复用组件 → 写进 `index.css`，不要内联

### 禁止事项

- **禁止在内联样式中硬编码颜色值**（如 `#10b981`），应使用 CSS 变量。ActionChainEditor 中有大量 `rgba(16,185,129,...)` 硬编码，新增时不要再复制这个反模式
- **禁止用 `type="number"` 输入数字后删空时回弹到默认值**。改用 `type="text" inputMode="numeric"` + string 状态，保存时才转数字（已在等待时间输入框修复过）

---

## 6. 表单元素

### 输入框

统一使用 `.form-input` class，或内联时遵循：

```
  背景: rgba(255,255,255,0.08)
  边框: 1px solid rgba(255,255,255,0.12)
  圆角: 6px
  内边距: 6px 10px（小）或 9px 11px（标准）
  文字色: #e5e7eb
  字号: 12-13px
  focus: border-color → accent, box-shadow → 0 0 0 3px rgba(16,185,129,0.1)
```

### 标签

```
  字号: 11px
  颜色: #888 或 var(--text-secondary)
  下边距: 4px
```

### 按钮

优先使用 `.btn` 系列 class：

| Class              | 用途                 |
| ------------------ | -------------------- |
| `.btn-primary`     | 主操作（绿色）       |
| `.btn-secondary`   | 次要操作（灰色玻璃） |
| `.btn-danger`      | 危险操作（红色）     |
| `.btn-text`        | 文字按钮（无边框）   |
| `.btn-text.danger` | 红色文字按钮         |

---

## 7. 面板 / Panel 布局

### 侧边栏 + 主内容区

项目中有两种侧边栏布局：

| 布局     | CSS class         | 宽度       |
| -------- | ----------------- | ---------- |
| 设置页   | `.settings-shell` | 侧栏 190px |
| 工作记忆 | `.memory-shell`   | 侧栏 250px |

**新增侧边栏布局时：**

- 用 `display: grid; grid-template-columns: <sidebar-width> minmax(0, 1fr)`
- 侧边栏加 `-webkit-app-region: drag`（可拖动窗口）
- 侧边栏内的按钮加 `-webkit-app-region: no-drag`

### 顶部状态栏

```
  高度: 56px（含 padding-top: 40px 留给系统标题栏）
  内边距: 14px 20px
  背景: var(--bg-frosted) + backdrop-filter: blur(20px)
  z-index: 10
  border-bottom: 1px solid var(--glass-border)
```

### 底部栏

```
  内边距: 16px 20px, padding-bottom: 20px
  背景: var(--bg-frosted) + backdrop-filter: blur(20px)
  z-index: 10
  border-top: 1px solid var(--glass-border)
```

---

## 8. Overlay（全屏透明层）

Overlay 是独立窗口（`overlay.html`），使用 `overlay.css`，与主窗口样式完全隔离。

### 规范

- 背景: `rgba(10,11,16,0.18)`（半透明暗色）
- 字体: PingFang SC, Microsoft YaHei（不是 Inter）
- 所有元素 `position: absolute`（在全屏 fixed 容器内定位）
- 工具栏使用 `.overlay__header`（胶囊形，`border-radius: 999px`）
- 按钮使用 `.overlay__btn` 系列

### 已有区域预览

用蓝色虚线（`rgba(96,165,250)`）渲染，区别于新框选的绿色实线（`rgba(56,189,248)`）。

---

## 9. 踩坑记录（必读）

### 下拉框被遮挡

**问题：** 步骤类型按钮和下拉面板 z-index 冲突，下拉选项被步骤按钮盖住。
**修复：** 下拉面板 `z-index: 1000`，且父容器不能有 `overflow: hidden`。

### 下拉框打开时被兄弟卡片遮挡

**问题：** 乙app-select-panel 的 z-index 虽然高，但父卡片 `.target-app-card` 默认 z-index 只有 2，被后面的卡片挡住。
**修复：** 打开时给父卡片加 `.dropdown-open` class，z-index 提升到 80。

### 原生 select 白底

**问题：** Windows 上 Chromium 原生 `<select>` 的 option 背景是白色，文字是黑色，无法用 CSS 覆盖。
**修复：** 全部改用自定义下拉组件。

### 数字输入删空回弹

**问题：** `type="number"` 输入框删空后 `Number('')` 为 0，`0 || defaultVal` 导致立即回弹到默认值。
**修复：** 改用 `type="text" inputMode="numeric"`，状态用 `string`，保存时才 `Number()` 转换。

### overflow: hidden 裁切弹出内容

**问题：** 父容器 `overflow: hidden` 会裁切所有子元素，包括 z-index 很高的绝对定位弹窗。
**修复：** 弹出内容（下拉面板、弹窗）的 DOM 必须在 `overflow: hidden` 的容器外面，或者用 `position: fixed` 脱离裁切链。

---

## 10. 新增模块 Checklist

新增任何 UI 模块时，逐项检查：

- [ ] 颜色全部用 CSS 变量，不硬编码
- [ ] 下拉框用 `CustomSelect` 或 `.app-select-*`，不用原生 `<select>`
- [ ] z-index 不超过 2000，且与现有层级不冲突
- [ ] 弹出内容不受父容器 `overflow: hidden` 裁切
- [ ] 输入框用 `type="text" inputMode="numeric"` 处理数字（不用 `type="number"`）
- [ ] 新增的可复用 class 写进 `index.css`，不要内联
- [ ] 按钮用 `.btn` 系列 class
- [ ] 表单标签 11px 灰色
- [ ] 弹窗有遮罩层 + Esc 关闭 + 点击外部关闭
- [ ] 侧边栏有 `-webkit-app-region: drag`
