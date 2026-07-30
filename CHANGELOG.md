# 变更日志 (CHANGELOG)

> 本文档记录项目从 SightFlow 迁移到 Kuangye 品牌的所有改动。
> 所有改动在一次工作会话中完成。

---

## 1. 品牌重命名（sightflow → kuangye）

将代码、配置、文档、目录名中所有 `sightflow` 标识替换为 `kuangye`。

### 1.1 标识对应关系

| 原值                                     | 新值                       |
| ---------------------------------------- | -------------------------- |
| `SightFlow`（品牌名）                    | `Kuangye`                  |
| `sightflow`（小写，路径/URL/包名）       | `kuangye`                  |
| `SIGHTFLOW`（大写，环境变量）            | `KUANGYE`                  |
| `sightflow-desktop-agent`（包名）        | `kuangye-desktop-agent`    |
| `com.sightflow.desktop`（appId）         | `com.kuangye.desktop`      |
| `sightflow.dev`（域名/URL）              | `kuangye.dev`              |
| `sightflow-dev`（GitHub org / author）   | `kuangye-dev`              |
| `builder@sightflow.dev`（邮箱）          | `builder@kuangye.dev`      |
| `SIGHTFLOW_PROVIDER_HUB_URL`（环境变量） | `KUANGYE_PROVIDER_HUB_URL` |
| `skills/sightflow-agent/`（目录）        | `skills/kuangye-agent/`    |

### 1.2 修改的文件（18 个）

- `package.json` — name / description / author / homepage
- `package-lock.json` — 包名同步
- `electron-builder.yml` — appId / productName / executableName
- `README.md` / `README.zh-CN.md` — 全部徽章、链接、文案
- `AGENTS.md` — 项目知识库
- `docs/provider.md` / `docs/provider.en.md`
- `docs/plan/learn-work-memory-plan.md`
- `.agents/user-profile.md`
- `skills/kuangye-agent/SKILL.md`
- `src/main/index.ts` — Provider Hub URL + env var 名
- `src/core/local-provider.ts` — 调试目录路径
- `src/renderer/index.html` / `src/renderer/overlay.html` — `<title>`
- `src/renderer/src/i18n.ts` — `'app.title'`
- `src/renderer/src/App.tsx` — logo `alt` 文本
- `src/renderer/src/MemoryWindow.tsx` — logo `alt` 文本
- `NOTICE` — 无扩展名文件，初始脚本遗漏，已手动修复

### 1.3 目录重命名

- `skills/sightflow-agent/` → `skills/kuangye-agent/`

### 1.4 后续影响

- `kuangye.dev` 域名暂未注册，远端 Provider Hub 列表加载会失败，但不影响内置 Doubao Provider 使用。
- 外部 URL（GitHub 仓库、邮箱）当前指向不存在的地址，待用户注册对应资源后即可生效。

---

## 2. 应用图标替换

### 2.1 设计新的 K Logo

用 Node.js + pngjs 脚本生成几何 "K" 图标，深色背景 + 亮绿色粗笔画。

- 颜色：背景 `#0a0b10`（与 app 主题一致）+ 前景 `#10b981`（emerald-500）
- 形状：圆角方形 + 粗笔画 "K"（左竖 + 上下两条斜线）
- 笔触粗细：14%（占图标尺寸），边距：18%，圆角半径：22%

### 2.2 新增图标文件

| 文件                                 | 尺寸            | 用途                           |
| ------------------------------------ | --------------- | ------------------------------ |
| `resources/icon.png`                 | 256×256         | Electron 窗口图标 / 任务栏图标 |
| `build/icon.png`                     | 512×512         | Linux 打包图标                 |
| `build/icon-16.png` ~ `icon-128.png` | 16/32/48/64/128 | 多分辨率备用                   |

### 2.3 新增脚本

- `scripts/generate-logo.js` — 图标生成脚本，可重复运行重新生成所有尺寸

---

## 3. 修复 Windows 图标显示 Bug

### 3.1 问题

原 SightFlow 代码在创建 `BrowserWindow` 时仅在 `process.platform === 'linux'` 时才设置 `icon`：

```typescript
// 原代码（错误）
...(process.platform === 'linux' ? { icon } : {}),
```

导致 Windows 和 macOS 用户在窗口标题栏和任务栏看不到应用图标。

### 3.2 修复

将三处 `BrowserWindow` 创建（主窗口、设置窗口、工作记忆窗口）都改为无条件设置 `icon`：

```typescript
// 修复后
icon,
```

修改文件：`src/main/index.ts`（第 177、219、265 行）

---

## 4. UI 清理（移除旧 Logo）

### 4.1 移除的内容

- 主窗口顶部 `<header className="app-header">` 块（含旧 logo 图片）
- 设置窗口侧栏品牌区的 logo `<img>`
- 工作记忆窗口侧栏品牌区的 logo `<img>`
- 两处 `import logoUrl from './assets/logo.png'`

### 4.2 修改的文件

- `src/renderer/src/App.tsx`
- `src/renderer/src/MemoryWindow.tsx`

---

## 5. 工具与脚本

### 5.1 新增 `启动.bat`

项目根目录双击启动脚本，自动设置 UTF-8 编码后调用 `npm start`：

```bat
@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
npm start
```

### 5.2 新增 `scripts/generate-logo.js`

自动生成所有尺寸的 K Logo PNG 文件。

---

## 6. 设计探索资源

### 6.1 `design-preview.html`

一个独立的 HTML 页面，展示 8 种不同的主窗口样式供挑选：

1. 极简白（纯白 + 细灰边线，无阴影）
2. 柔和灰（浅灰底 + 白卡片 + 柔和阴影）
3. 硬边线（边线主导 + 无阴影）
4. 卡片分层（强阴影 + 深度感）
5. 终端风（等宽字体 + 黑绿配色）
6. 玻璃拟态（半透明 + 模糊）
7. 紧凑信息（Linear 风格，高密度）
8. 商务正式（配色克制，专业感）

### 6.2 UI 重设计尝试（已撤销）

- 用户最初选择"风格 1（极简白）"
- 重写 `src/renderer/src/index.css` 为浅色商务主题
- 修改 `src/renderer/src/App.tsx` 中 2 处硬编码颜色
- **用户实际不喜欢新样式，已全部还原为原深色玻璃拟态主题**

---

## 7. 知识库初始化

调用 `/init-deep` 命令生成层次化 AGENTS.md：

| 文件                       | 内容                                                  |
| -------------------------- | ----------------------------------------------------- |
| `./AGENTS.md`              | 项目概览、目录结构、WHERE TO LOOK、约定、反模式、命令 |
| `./src/core/AGENTS.md`     | RuntimeHost→ChannelSession→DesktopDevice 三层架构     |
| `./src/core/rpa/AGENTS.md` | LayoutCache、VLM 检测、截图/输入/红点检测流水线       |
| `./src/main/AGENTS.md`     | 完整 IPC 通道清单、引擎启停、窗口路由                 |

---

## 8. 数据清理

清空工作记忆历史数据目录 `C:\Users\jicai\AppData\Roaming\kuangye-desktop-agent\worktrace\`：

- 删除 5 个 session 目录，共 22 个文件，725.32 KB
- 包含 `sessions/<sessionId>/session.json` + `trace.jsonl` + `screenshots/*.png`

---

## 9. 验证

- ✅ `npm run typecheck` — TypeScript 类型检查通过
- ✅ `npm run build` — Vite 构建通过
- ✅ `npm start` — Electron 启动正常，K Logo 正确显示在窗口和任务栏

---

## 10. 待后续处理

- [ ] 注册 `kuangye.dev` 域名，让 Provider Hub 列表能正常加载
- [ ] 替换 `kuangye-agent` skill 内部所有外部 URL
- [ ] 考虑是否需要更新 README 截图（界面有少量样式调整）
- [ ] `build/icon.ico` / `build/icon.icns` 文件未生成（仅 Windows/macOS 打包时使用，可选）

---

## 11. 文件清单

### 新增（14 个文件）

- `AGENTS.md`
- `src/core/AGENTS.md`
- `src/core/rpa/AGENTS.md`
- `src/main/AGENTS.md`
- `设计预览.html`
- `启动.bat`
- `scripts/generate-logo.js`
- `build/icon-16.png` / `icon-32.png` / `icon-48.png` / `icon-64.png` / `icon-128.png`
- `CHANGELOG.md`（本文件）

### 重命名（1 个）

- `skills/sightflow-agent/` → `skills/kuangye-agent/`

### 修改（18 个文件 + 2 个图标）

详见上文第 1.2 节和第 2.2 节。

---

## v1.1.0 — 聊天记忆版 (2026-07-05)

### 新功能

- **聊天记录独立窗口**：从工作记忆窗口拆出，作为独立入口，与「工作记忆」「设置」三栏并列
- **聊天记忆开关**：药丸式滑动开关，控制全局聊天记录采集，默认开启
- **聊天记录序列对齐去重**：用大模型返回的有序对话序列与已有记录尾部对齐，只追加新增部分；对方连发相同内容不误判

### Bug 修复

- **未读检测反复失败**：点击聊天入口后联系人列表位移导致缓存坐标失效，原需失败 3 次才重置；改为失败 1 次即清缓存重新 VLM 定位
- **聊天记录不保存**：`chatHistory.enabled` 默认 false 且无 UI 开关，导致功能永不触发；改为默认 true
- **会话名显示「未命名」**：store 创建会话时未存 displayName；改为从 key 解析会话标题
- **settings:set 浅合并丢字段**：chatHistory 未做深合并，改 enabled 会丢 retentionDays 等字段；补上深合并

### UI 优化

- 聊天记忆开关：药丸式滑动 toggle，开启绿色、关闭灰色
- 移除消息面板多余返回按钮（桌面同屏布局不需要）
- 聊天记录窗口底部新增第三个入口按钮（聊天气泡图标）

---

## v1.2.0 — 动作链编辑器 (2026-07-05)

### 新功能

- **动作链编辑器**：在主程序内新增"动作链"模式，与微信自动回复模式并列切换
  - 用户可自由框选 0-N 个屏幕区域并命名
  - 支持 6 种步骤类型：等待像素变化、检测红点、点击、截图给 AI、输入文字、等待
  - 支持变量系统：AI 返回结果可存入变量，后续步骤的文字模板可引用
  - 支持触发条件：像素变化、红点检测、手动启动、默认兜底链
- **自由框选向导**：独立的透明全屏框选页面，与现有微信 3 区域框选向导并存
  - 任意数量区域拖拽绘制
  - 绘制后立即命名，可修改、可删除
- **执行引擎**：`ActionChainEngine` 独立事件循环，轮询触发条件并执行动作链
- **持久化**：工作区配置（区域 + 动作链）保存到本地 JSON，程序重启后可恢复

### 修改的现有文件

| 文件                            | 改动                                                  |
| ------------------------------- | ----------------------------------------------------- |
| `src/core/rpa/input-utils.ts`   | 导出 `humanLikeMove` 供动作链引擎调用（1 行）         |
| `src/renderer/overlay/main.tsx` | 通过 `?mode=actionchain` 路由到新的自由框选组件       |
| `src/renderer/src/App.tsx`      | 新增 `mode` 状态，底部/顶部入口切换，窗口尺寸动态调整 |
| `src/main/index.ts`             | 新增 7 个 `action-chain:*` IPC handler + 引擎实例管理 |

### 新增文件

| 文件                                             | 功能                                                   |
| ------------------------------------------------ | ------------------------------------------------------ |
| `src/core/action-chain/types.ts`                 | Region / ActionStep / ActionChain / Workspace 数据模型 |
| `src/core/action-chain/engine.ts`                | 动作链执行引擎                                         |
| `src/core/action-chain/store.ts`                 | 工作区 JSON 持久化                                     |
| `src/renderer/overlay/ActionChainOverlayApp.tsx` | 自由框选 UI                                            |
| `src/main/action-chain-overlay.ts`               | 自由框选主进程协调层                                   |
| `src/renderer/src/ActionChainEditor.tsx`         | 动作链编辑器 UI                                        |

### UI 优化

- 动作链入口从底部栏移到顶部状态栏右侧，底部栏恢复简洁
- 动作链编辑器中使用自定义下拉组件替代原生 `select`，避免系统白边和遮挡问题

### 验证

- ✅ `npm run typecheck` 通过
- ✅ 已推送到 `git@github.com:chenjicai2024/kuangye-agent.git`

---

### 待后续实现

- 自由框选向导启动时自动检测目标窗口，并在向导中高亮窗口边框（帮助用户参考，且坐标可跟随窗口移动）

---
