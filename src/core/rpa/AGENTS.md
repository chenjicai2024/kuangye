# src/core/rpa/ — RPA Utilities

Low-level desktop automation primitives. All platform-specific code (native modules, window APIs, pixel manipulation) lives here.

## STRUCTURE

```
rpa/
├── types.ts            # AppType, CaptureStrategy, BoxRegions, ScreenRect
├── vision-utils.ts     # VLM layout detection (detectUnreadArea, LayoutCache)
├── screenshot-utils.ts # Window capture + region cropping (Jimp-based)
├── input-utils.ts      # Click / type / paste actions (robotjs-based)
├── window-utils.ts     # Active window detection (active-win, node-window-manager)
├── image-compare.ts    # Pixel diff for chat-area change detection (pixelmatch + pngjs)
├── util.ts             # Shared helpers (sleep, coordinate transforms)
├── index.ts            # Re-export barrel
└── tests/              # VLM parallel test
    └── test-vlm-parallel.ts
```

## WHERE TO LOOK

| Task                       | Location                                                               | Notes                                               |
| -------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| Add target app type        | `types.ts` → `AppType` union + `isWechatLike()`                        | Also update `src/main/index.ts` → `VALID_APP_TYPES` |
| Change VLM prompt          | `vision-utils.ts` → `detectUnreadArea()`                               | Prompt text is inline, not externalized             |
| Fix screenshot capture     | `screenshot-utils.ts` → `captureChatMainArea()`                        | Uses `desktopCapturer` + Jimp crop                  |
| Fix click/type issues      | `input-utils.ts` → `sendReplyByCoordsAction()`                         | robotjs keyboard + mouse, clipboard paste           |
| Fix image diff sensitivity | `image-compare.ts` → `comparePngBuffers()`                             | `threshold` (per-pixel) + `changeThreshold` (ratio) |
| Fix window detection       | `window-utils.ts` → `getWechatWindowInfo()`                            | `active-win` + `node-window-manager`                |

## KEY TYPES

```typescript
// LayoutCache is the central data structure — produced by device.measureLayout()
interface LayoutCache {
  chatEntranceArea: { bbox: BBox; coordinates: [number, number] } | null
  firstContact: { bbox: BBox; coordinates: [number, number] } | null
  searchInputBox: { bbox: BBox; coordinates: [number, number] } | null
  headerArea: { bbox: BBox; coordinates: [number, number] } | null
  chatMainArea: { rect: ScreenRect; coordinates: [number, number]; source: string } | null
  messageInputArea: { rect: ScreenRect; coordinates: [number, number]; source: string } | null
  timestamp: number
  appType: AppType
}
```

Stored in a module-level `Map<AppType, LayoutCache>` — not persisted, rebuilt each session.

## CONVENTIONS

- **Coordinate system**: All screen coordinates are logical pixels (CSS pixels). `scaleFactor` multiplication happens inside `screenshot-utils.ts` when calling `desktopCapturer`.
- **Screenshot flow**: `captureChatMainArea(appType)` → find window → full capture → crop to `LayoutCache.chatMainArea.rect` → return Jimp image
- **Input flow**: `sendReplyByCoordsAction(x, y, text)` → focus input area → clipboard paste → Enter
- **LayoutCache is per-appType**: `getLayoutCache(appType)` / `setLayoutCache(appType, cache)`

## NOTES

- `image-compare.ts` exports `comparePngBuffers()` for overlay wizard pixel diff
- `input-utils.ts` exports `humanLikeMove()` / `humanLikeClick()` for仿人化操作
- Tests in `tests/` are run via `npm run dev:test-*` commands, not a standard test framework
