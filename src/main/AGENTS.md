# src/main/ — Electron Main Process

Window management, IPC handlers, provider loading, skill HTTP server, overlay wizard coordination.

## STRUCTURE

```
main/
├── index.ts               # Main entry — windows, IPC, engine lifecycle (~2400 lines)
├── skill-server.ts        # HTTP server for external AI agent control (port 12680)
├── action-chain-overlay.ts # Action chain overlay wizard: transparent fullscreen window + IPC
├── provider-bundle.ts     # Provider manifest + bundle.js loading/installation
├── permission.ts          # macOS accessibility/screen-recording permission requests
└── token-usage-store.ts   # Token usage persistence
```

## WHERE TO LOOK

| Task                   | Location                                                                          | Notes                                                         |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Add IPC handler        | `index.ts` → `app.whenReady()` block                                              | Pattern: `ipcMain.handle('channel:action', handler)`          |
| Change window creation | `index.ts` → `createWindow()` / `createSettingsWindow()` / `createMemoryWindow()` | 3 windows, all load same `index.html` with `?window=` param   |
| Engine start logic     | `index.ts` → `startEngineCore()`                                                  | Shared by IPC `engine:start` + Skill Server `/skill/start`    |
| Engine stop logic      | `index.ts` → `stopEngineCore()`                                                   | Shared by IPC `engine:stop` + Skill Server `/skill/pause`     |
| Settings read/write    | `index.ts` → `settingsStore` (electron-store) + `normalizeSettings()`             | Always use `normalizeSettings()` to handle migration          |
| Provider install       | `provider-bundle.ts` → `installProviderFromUrl()`                                 | Downloads manifest + bundle, caches locally                   |
| Skill server endpoints | `skill-server.ts` → `requestHandler()`                                            | POST `/skill/start`, POST `/skill/pause`, GET `/skill/status` |
| Overlay wizard flow    | `action-chain-overlay.ts` → overlay window IPC                                | Transparent fullscreen for region selection                    |
| Push event to renderer | `index.ts` → `notifyEngineStateChanged()` / `notifyCaptureRegionsUpdated()`       | Broadcasts to all BrowserWindows via `webContents.send()`     |

## IPC CHANNELS

| Channel                                                                                                           | Direction       | Purpose                                           |
| ----------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------- |
| `settings:getAll` / `settings:get` / `settings:set`                                                               | Renderer → Main | Read/write app settings                           |
| `settings:open` / `memory:open`                                                                                   | Renderer → Main | Open settings/memory window                       |
| `engine:start` / `engine:stop` / `engine:status` / `engine:updateConfig` / `engine:testConnection`                | Renderer → Main | Engine lifecycle                                  |
| `engine:log` / `engine:state`                                                                                     | Main → Renderer | Push engine logs + state changes                  |
| `capture:openSetupWizard` / `capture:getRegions` / `capture:resetRegions`                                         | Renderer → Main | Box-select wizard + region CRUD                   |
| `capture:regions-updated`                                                                                         | Main → Renderer | Push region changes                               |
| `trace:listSessions` / `trace:getSession` / `trace:getScreenshot`                                                 | Renderer → Main | Work-trace query                                  |
| `trace:step`                                                                                                      | Main → Renderer | Push real-time trace step to memory window        |
| `memory:listCards` / `memory:addCard` / `memory:deleteCard` / `memory:setCardEnabled` / `memory:learnFromSession` | Renderer → Main | Experience card CRUD + LLM learning               |
| `provider:installFromUrl` / `provider:getInstalled`                                                               | Renderer → Main | Provider management                               |
| `providerHub:getCatalog` / `providerHub:update`                                                                   | Renderer → Main | Remote provider hub list                          |
| `overlay-wizard:init` / `overlay-wizard:complete` / `overlay-wizard:cancel`                                       | Main ↔ Overlay  | Wizard lifecycle (uses `wizardId` for IPC safety) |

## CONVENTIONS

- **All IPC in one file**: `index.ts` contains every `ipcMain.handle()` call. No separate IPC module.
- **Engine logic is shared**: `startEngineCore()` / `stopEngineCore()` are plain functions, called by both IPC handlers and `SkillEngineController`.
- **Settings pattern**: Read via `normalizeSettings(settingsStore.store)`, write via `settingsStore.set(next as any)`. The `as any` is a known electron-store typing limitation.
- **Window URL routing**: All 3 windows load `index.html` with `?window=settings|memory` query param. App.tsx reads this and renders different components.
- **Input focus recovery**: editor/subwindows bind BrowserWindow `focus` to `webContents.focus()`; overlay completion must restore the exact caller window, not an arbitrary first window.
- **Skill server**: Runs in-process (not a child process). Uses Node.js `http` module. Port 12680 with 12681 fallback. Only listens on 127.0.0.1.

## NOTES

- `FIXED_ARK_MODEL` and `FIXED_ARK_BASE_URL` are hardcoded constants — not configurable via settings UI
- `skillEngineController` is a plain object implementing `SkillEngineController` interface — delegates to `startEngineCore()` / `stopEngineCore()`
- Overlay wizard uses `wizardId` (timestamp + counter) to prevent stale IPC from a previous wizard session matching a new one
- `coerceAppType()` / `coerceStrategy()` / `coerceRegions()` are defensive parsers for untrusted IPC input
- macOS permissions (`permission.ts`) request accessibility + screen-recording on first launch
