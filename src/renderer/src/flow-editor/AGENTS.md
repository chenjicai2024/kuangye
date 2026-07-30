# src/renderer/src/flow-editor/ — ActionChain 可视化编辑面板

拖拽式 RPA 自动化工作流编辑器。左边步骤面板 → 拖入画布 → 连线 → 右侧属性面板编辑步骤参数。活动画布由 `FlowEditor.tsx` 用 Pointer Events + SVG 单独实现，必须保持单一事件系统。

## STRUCTURE

```
flow-editor/
├── FlowEditor.tsx       主编辑器（左侧步骤面板 + 中间画布 + 右侧项目/区域/链列表）
├── ProjectLibrary.tsx   项目中心（多项目创建、打开、重命名、删除和保存摘要）
├── StepInspector.tsx    主组件（路由 + 公共 Section + 保存）
├── inspector/           StepInspector 拆分后的表单组件
│   ├── shared.ts        纯函数 + 常量 + 类型
│   ├── Section.tsx      标题 + children 容器
│   ├── Field.tsx        标签 + 数字输入框
│   ├── ConditionEditor.tsx  条件编辑器
│   ├── RegionSelector.tsx   区域选择器
│   ├── ConditionSection.tsx 条件 Section
│   ├── ErrorRetrySection.tsx  失败和重试 Section
│   └── forms/           各步骤类型表单（~20 个文件）
├── styles.ts            共享样式常量（inputStyle、buttonStyle 等）
├── flow-geometry.ts     四向端口坐标、最近入口和曲线路径纯函数
├── flow-editor.css      端口交互与连线方向流光（含 reduced-motion）
├── undo-redo.ts         编辑快照栈（pushSnapshot / undo / redo）
└── AGENTS.md            ← 本文件
```

## WHERE TO LOOK

| Task                  | Location                                                                                                                           | 备注                                                     |
| :-------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------- |
| 新增/修改步骤类型     | `src/core/action-chain/types.ts` → `StepType` union + `STEP_TYPE_LABELS`；同步更新 `FlowEditor.tsx` 左侧面板配色 | 步骤数据模型在 core 层，UI 渲染在 FlowEditor            |
| 修改节点属性表单字段  | `StepInspector.tsx`（主组件路由）+ `inspector/forms/` 下对应表单组件 | input/select/textarea 都使用受控状态；ref 仅用于初次聚焦 |
| 修改画布拖拽/连线行为 | `FlowEditor.tsx`                                                                                                                   | 单一自绘画布，Pointer Events 生命周期必须统一清理        |
| 修改项目列表/项目入口 | `ProjectLibrary.tsx` + `FlowEditor.tsx`                                                                                            | 项目中心负责管理，编辑器只编辑一个已选项目               |
| 改触发器/条件系统     | `src/core/action-chain/types.ts`（`TriggerType`、`StepCondition`） + `src/core/action-chain/engine.ts`                             | UI 在 FlowEditor 顶部 select                             |
| 改撤销/重做           | `undo-redo.ts` + `FlowEditor.tsx` → `useUndoRedo`                                                                                  | 每次 `saveWorkspace` 推入快照                            |

## ⚠️ KEY GOTCHA — 画布只能有一套活动事件系统

不要引入 ReactFlow 或任何第三方画布库并挂到自绘画布下面。即使被上层覆盖，它仍会运行 `fitView`、`setCenter`、键盘与焦点逻辑，造成看不见的竞争。节点、边、背景、缩放、平移都由 `FlowEditor.tsx` 的单一画布负责。

## ⚠️ KEY GOTCHA — 节点拖动 / 连线时不能误开属性面板

**属性面板只能在用户主动点击节点（按下并松开，无明显移动）时打开。** 拖动节点、连线拖拽过程中或完成后都不得触发。

### 症状

- 拖动一个节点到新位置松手 → 属性面板跳出来
- 从节点右侧的 `+` 按钮拖一条线到另一个节点 → 源节点或目标节点的属性面板跳出来

### 根因

两个独立的 bug 都会触发属性面板：

1. **节点拖动**：浏览器对"小幅度拖动是否触发 click"的阈值（通常 5-10px）跟 `startVisibleNodeDrag` 用的 2px 阈值不一致。拖动后 `pointerup` 派发的 click 事件触发 `onClick`，把 `setSelectedNodeId` 设了进去
2. **连线**：`startEdgeDrag` 的 `onUp` 末尾曾显式调 `setSelectedNodeId(targetId)`；即便删掉这行，连线释放后 click 也会从 `+` 按钮冒泡到源节点的 `onClick`，把源节点的属性面板弹出来

### 修复模式（FlowEditor.tsx）

用一个 ref 跨 drag/connect 流程抑制后续 click：

```ts
// 在 FlowEditor.tsx 顶部声明
const suppressClickRef = useRef(false)
```

**3 个落点**：

1. **节点拖动开始**（`startVisibleNodeDrag`）：`suppressClickRef.current = false`（重置，准备新的交互）
2. **节点拖动结束**（`onUp` 内 `drag.moved === true` 分支）：`suppressClickRef.current = true`（抑制随后的 click）
3. **连线结束**（`startEdgeDrag` 的 `onUp` 任意分支）：`suppressClickRef.current = true`

**节点 onClick 开头加守卫**：

```tsx
onClick={(e) => {
  if (suppressClickRef.current) return  // ← 关键
  // ... 原选中逻辑
}}
```

### 为什么不用 setTimeout 重置

click 事件在 pointerup 之后同步派发，所以 ref 在同一 task 里被读到，`suppressClickRef.current = true` 一定生效。如果用 setTimeout 重置，反而可能在 50ms 内点了下一个节点把那个 click 也吞了。

"重置" 通过**下一次 pointerdown** 完成 — 即新一次 `startVisibleNodeDrag` / `startEdgeDrag` 调用时设回 false。这样保证只有紧跟着 drag/connect 的那一次 click 被吞，后续真正的点击全部正常工作。

### 排查清单

如果再出现"拖完 / 连完弹属性面板"：

1. 是否新增了别的 drag handler（画布缩放、多选框选等）→ 也要在它们的 onUp 里 `suppressClickRef.current = true`
2. 是否把 onClick 拆出去做成独立组件 → 必须把 `suppressClickRef.current` 检查也带过去
3. 是否在节点 div 上加了 `onMouseDown` / `onMouseUp` 之类并行处理 → 浏览器 click 是从 pointer 事件派生的，mouse 事件链同样会被触发，记得统一检查
4. 是否把节点改成用 React Flow 自带的拖拽（不是自定义的 `startVisibleNodeDrag`）→ React Flow 的 onNodeClick 也要走 `suppressClickRef` 守卫

## ⚠️ KEY GOTCHA — 拖入新节点不要自动开属性面板

**从左侧拖步骤到画布，只创建节点、不选中、不开面板。** 用户必须明确点击节点才打开属性面板。

### 当前实现（FlowEditor.tsx）

`handleAddNode` 末尾**不**调用 `setSelectedNodeId(node.id)`。两个分支都是如此：

```tsx
function handleAddNode(type: StepType, x: number, y: number): void {
  // ... 计算坐标、创建节点 ...
  if (!current) {
    // 创建新链 + 节点的分支
    saveChains([...chains, { ...chain, nodes: [node] }])
    setSelectedChainIdx(chains.length)
    return // ← 故意不调 setSelectedNodeId
  }
  // 已有链 + 新节点的分支
  updateCurrentChain({ nodes: [...current.nodes, node] })
  // ← 故意不调 setSelectedNodeId
}
```

如果以后想给新建节点加"短暂高亮一下提示用户"之类的引导，可以加个一过性动画，但**不要**重新打开 `setSelectedNodeId`。

## ⚠️ KEY GOTCHA — 连线命中区域必须覆盖整条曲线

**点击连线的任何位置（不仅是中点）都应该选中该连线并高亮。** 长线、绕弯的线不能要求用户精确定位到中点。

### 当前实现（FlowEditor.tsx 的 SVG edges）

每个 edge 渲染成**两条同路径 SVG `<path>`**：

```tsx
<React.Fragment key={edge.id}>
  {/* Hit-test：透明加宽，整条曲线都是点击区 */}
  <path
    d={pathD}
    stroke="transparent"
    strokeWidth={20}
    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
    onClick={(e) => {
      e.stopPropagation()
      setSelectedEdgeId(edge.id)
      setSelectedNodeId(null)
    }}
  />
  {/* Visible：用户看到的细线，不参与点击 */}
  <path
    d={pathD}
    stroke={isSelected ? '#fbbf24' : color}
    strokeWidth={isSelected ? 3.5 : 2.5}
    markerEnd={markerId}
    style={{ pointerEvents: 'none', ... }}
  />
</React.Fragment>
```

关键点：

- **SVG 父级 `pointerEvents: 'none'`** 防止 SVG 背景拦点击；子级 hit-test path 显式 `pointerEvents: 'stroke'` 覆盖父级
- **可见 path `pointerEvents: 'none'`** 显式声明，确保它不参与命中检测（避免重复触发）
- **strokeWidth=20** 给 hit-test path，命中区域比可见线宽很多倍
- **节点 div 在 SVG 之后 DOM 渲染**，节点仍能正常截获落在节点上的点击（不会误触发到边的 hit-test）

### 不要重新加回 24×24 中点 div

之前用一个 `position: absolute; left/top = midpoint - 12; width: 24px` 的 div 做中点命中，对长线/绕弯的线极其不友好。已删除。如果以后想给边加 hover 效果，应改在 hit-test path 上加 `onMouseEnter` / `onMouseLeave`，不要倒退用 div 中点方案。

## ⚠️ KEY GOTCHA — 输入焦点与拖拽取消

### 曾出现的症状

- `输入文字`、`截图给AI` 的 textarea 有时能输入，有时鼠标点击也无法稳定聚焦
- 窗口失焦再回来后行为改变
- 拖拽、连线或平移被系统中断后更容易出现

### 根因

根因有三类：

1. ~~底层 ReactFlow 和上层自绘画布同时挂载，隐藏画布的 `fitView/setCenter` 与活动画布争夺焦点。~~（已移除 ReactFlow）
2. 节点拖动、连线、画布平移只处理 `pointerup`。遇到 `pointercancel`、窗口失焦或组件卸载时，全局 `pointermove` 监听残留并继续 `preventDefault()`。
3. **Electron webContents 焦点失同步**（Windows 偶发）：BrowserWindow 获得系统焦点但 Chromium webContents 未同步，textarea 显示光标但键盘事件不进入 renderer。已修复：`main/index.ts` 的 `bindWindowContentFocus` 无条件调用 `webContents.focus()`（不再用 `isFocused()` 守卫），并监听 `show`/`restore` 事件。

### 当前修复（FlowEditor.tsx + StepInspector.tsx）

当前实现：

- 不再挂载旧 ReactFlow，画布背景也由活动层自己绘制。
- 属性面板是画布之外的固定右侧栏，不使用 portal、fixed 浮层或画布坐标定位；选中节点时替换右侧管理面板，关闭后恢复区域/链管理。
- input/select/textarea 使用受控 state，但不自动聚焦；用户点击哪个原生控件，就由 Chromium 原生焦点行为决定。
- 三类拖拽都注册 `pointerup`、`pointercancel`、`window.blur`，并通过 `activeInteractionCleanupRef` 在新交互开始和组件卸载时统一清理；自绘画布已有 window 级监听，不额外使用 Pointer Capture。
- 侧栏收到 pointerdown 时只取消仍在进行的画布交互，不跨进程调用窗口聚焦，也不阻止表单控件的默认 pointerdown。

### 排查清单

如果再次出现"能删不能写"，按顺序检查：

1. 是否引入了 ReactFlow 或其他画布库并挂载在自绘画布下。
2. 新增拖拽是否漏了 `pointercancel`、`blur`、卸载 cleanup。
3. 是否在普通表单控件的事件处理器里调用了 `preventDefault()`；只有变量按钮为了保留 textarea 光标选区可以阻止自身 pointerdown 默认聚焦。
4. 是否增加了延迟定时器反复 `focus()`，在用户点击别的控件后又抢回焦点。
5. **StepInspector 的 `key` 是否包含 `JSON.stringify(step.data)`** -- 如果包含，每次保存后 node data 变化会导致 StepInspector 完全重挂载，textarea 焦点丢失。key 应只用 `node.id`。
6. **节点/连线的 `onPointerDown` 是否调用了 `preventDefault()`** -- 这会干扰 Chromium 内部焦点跟踪。应改用 `onMouseDown={(e) => e.preventDefault()}` 阻止聚焦，不干扰 Pointer Events。
7. electron-builder / Chromium 大版本升级后，重新跑文本输入端到端验证。

## CONVENTIONS

- **焦点管理**：属性侧栏不使用 portal、`autoFocus`、延迟 `focus()` 或每次点击时的 IPC 聚焦；窗口从框选层返回时才允许 main 进程执行一次窗口级恢复。
- **受控输入**：input/select/textarea 全部使用 `value` + `onChange`；textarea 的 ref 只用于变量插入后恢复原有光标选区。
- **节点位置存储**：节点 position 存在 store 里（`workspace.chains[i].nodes[j].position`），不存 React Flow 临时视图。切换链时直接重置 `canvasPan` 和 `zoom` 到默认值
- **连线颜色**：默认 `#38bdf8` 蓝；if_else 真/假分支 `#10b981` 绿 / `#ef4444` 红。`edgeColor(sourceHandle)` 统一映射
- **四向端口**：每个节点上/右/下/左都是通用端口；从哪边开始拖即记录 `sourcePort`，落到目标节点任意位置后按最近边记录 `targetPort`。旧边缺少字段时默认右出左进。
- **条件分支连线**：条件节点内的真/假小按钮只决定下一条出线的 `sourceHandle`，四个方向端口仍保持通用；已创建的条件边可在右侧连线属性中修正真/假。
- **方向提示**：实体连线之上用 `.flow-edge-direction-flow` 渲染低调流光，动画方向必须和 SVG path 的 source → target 一致，并在 `prefers-reduced-motion` 下停用。
- **键盘快捷键**：全局监听绑在 `window` 上，必须先通过 `isInteractiveTarget()` 排除表单、按钮、contenteditable 和整个属性面板。
- **顶部链工具栏**：配置控件和操作按钮必须分成 `.flow-chain-toolbar-config` / `.flow-chain-toolbar-actions` 两组；容器只能使用 `min-height` 并允许整组换行，按钮必须 `white-space: nowrap`，禁止在右侧属性栏打开后把按钮文字压成竖排。

## NOTES

- **Engine IPC**：`action-chain:state` / `action-chain:log` / `action-chain:stepLog` 三个事件由 main 进程主动推送；renderer 端在 `FlowEditor.tsx` useEffect 里 `window.electron?.on(...)` 订阅。卸载时记得清 cleanup
- **持久化**：所有 renderer 保存（包括节点拖动、撤销/重做）都必须经过 `saveWorkspace` 的串行队列；main 端再通过 store 写入项目文件，禁止绕过该入口直接 invoke。
- **项目中心**：主界面“编辑项目”打开项目中心，不直接创建临时项目。项目中心可以连续创建多个项目；打开项目使用独立编辑窗口，避免两个编辑器误写同一个窗口状态。
- **自动保存**：节点编辑不提供重复的手动保存按钮；每次修改仍通过 `saveWorkspace` 串行持久化，返回项目中心前必须等待最终保存完成。
- **撤销/重做**：用户每改一次（节点增删/属性改），`saveWorkspace` 会把 workspace 推入 undo 栈；Ctrl+Z/Ctrl+Y 还原后也必须通过同一保存队列持久化，但不得再次写入历史栈。
- **单一画布**：`canvasSurfaceRef` 是 `position: absolute; inset: 0` 的唯一活动画布，背景、节点定位、连线 hit-test、缩放和平移都在这层做。
- **ActionChain overlay**：点"框选区域"按钮会弹一个**独立 BrowserWindow**（透明全屏），那是 main 进程 `action-chain-overlay.ts` 的事，不在本目录
