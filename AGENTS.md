# PROJECT KNOWLEDGE BASE

**Project:** Kuangye 通用视觉智能体底座 v2.0.0

## STRUCTURE（核心目录）

```
src/
├── main/           # Electron 主进程（IPC、窗口、引擎、Skill Server）
├── preload/        # contextBridge IPC wrapper
├── renderer/       # React UI
│   ├── src/        # 主界面（App.tsx, WorkMemoryWindow.tsx）
│   │   └── flow-editor/  # ActionChain 编辑器
│   │       └── inspector/ # 步骤表单组件
│   └── overlay/    # 框选器（透明全屏）
└── core/           # 跨进程业务逻辑（main 和 scripts 共用）
    ├── rpa/        # RPA 工具（截图、输入、窗口、像素检测）
    ├── action-chain/ # 动作链引擎 + 类型
    ├── agent-assistant/ # AI 助手
    ├── work-memory/ # 经验卡片 + 轨迹存储
    ├── chat-history/ # 聊天记录提取（当前仅支持部分 IM）
    └── database/   # 通用数据库模块（SQLite）
```

> 完整项目结构见 README.md

## WHERE TO LOOK（代码导航）

| 任务 | 文件 | 备注 |
|------|------|------|
| 添加 IPC handler | `src/main/index.ts` | 所有 `ipcMain.handle()` 在一个文件 |
| 引擎启停 | `src/main/index.ts` → `startEngineCore()` / `stopEngineCore()` | IPC 和 Skill Server 共用 |
| 添加新 App 支持 | `src/core/rpa/types.ts` → `AppType` union | 当前 7 种类型 |
| 切换 VLM 模型 | `src/main/index.ts` → `FIXED_ARK_MODEL` const | 硬编码 |
| 添加 Provider | `resources/providers/<id>/manifest.json` + `bundle.js` | 见 docs/provider.md |
| 框选器 | `src/main/action-chain-overlay.ts` + `src/renderer/overlay/OverlayApp.tsx` | 独立窗口 |
| Skill HTTP API | `src/main/skill-server.ts` | 12680 端口 |
| 设置持久化 | `src/main/index.ts` → `settingsStore` | 用 `normalizeSettings()` |
| 数据库 | `src/core/database/` | SQLite，通用数据存储 |
| 聊天记录 | `src/core/chat-history/parser.ts` / `store.ts` / `context.ts` | 当前仅支持部分 IM |
| 流程编辑器 | `src/renderer/src/flow-editor/` | **先读 flow-editor/AGENTS.md** |
| 步骤表单 | `src/renderer/src/flow-editor/inspector/forms/` | ~20 个表单组件 |

## CONVENTIONS（开发约定）

- **Prettier**: singleQuote, no semi, printWidth 100
- **TypeScript**: `tsconfig.node.json`（main/preload/core）+ `tsconfig.web.json`（renderer）
- **IPC 模式**: `ipcMain.handle('channel:action', handler)` + `webContents.send('channel:event', data)`
- **注释风格**: 业务逻辑用中文，类型/接口用英文
- **错误处理**: `normalizeSettings()` 防御性解析模式

## ANTI-PATTERNS（避坑）

- **无 CI/CD** — 所有构建手动执行
- **模型硬编码** — `FIXED_ARK_MODEL` 不可通过设置 UI 修改
- **`as any`** — `settingsStore.set(next as any)` 是 electron-store 类型限制
- **特定应用耦合** — 部分代码仍硬编码"微信"等特定应用名称，需在后续版本中清理

## 关键设计模式

- **双捕获策略**: VLM 自动检测（智能感知）vs 框选器（人工指定），适用于任何桌面应用
- **工作记忆**: trace.jsonl + 经验卡片，跨应用、跨场景的通用学习底座
- **Provider 插件**: manifest.json + provider.bundle.js，从 URL 安装
- **Skill Server**: 本机 HTTP 服务，外部 AI Agent 可控制引擎启停

## NOTES（重要提示）

- **Windows 开发**: 必须用 `npm run dev`（自动 chcp 65001），不要直接 electron-vite dev
- **两个 renderer 入口**: index.html（主应用）+ overlay.html（框选器）
- **`src/core/` 是共享层**: 被 main 和 scripts 共用，不依赖 Electron
- **设置迁移**: 读设置必须用 `normalizeSettings()`，写用 `settingsStore.set()`
- **通用性优先**: 任何新功能都必须考虑跨应用场景，避免引入特定应用耦合
