import { ipcMain } from 'electron'
import { isRecord } from '../../core/error-utils'
import { type AppSettings, normalizeSettings, type MainContext } from '../ipc-context'

export function registerSettingsIpc(ctx: MainContext): void {
  // ── Settings 持久化 ──
  ipcMain.handle('settings:getAll', async () => {
    return normalizeSettings(ctx.settingsStore.store)
  })

  ipcMain.handle('settings:get', async (_event, key: string) => {
    const settings = normalizeSettings(ctx.settingsStore.store)
    return { ...settings }[key as keyof AppSettings]
  })

  ipcMain.handle('settings:set', async (_event, data: unknown) => {
    const current = normalizeSettings(ctx.settingsStore.store)
    const patch = isRecord(data) ? data : {}
    const next = normalizeSettings({
      ...current,
      ...patch,
      vision: {
        ...current.vision,
        ...(isRecord(patch.vision) ? patch.vision : {})
      },
      modelProvider: {
        ...current.modelProvider,
        ...(isRecord(patch.modelProvider) ? patch.modelProvider : {})
      },
      modelProviderProfiles: {
        ...current.modelProviderProfiles,
        ...(isRecord(patch.modelProviderProfiles) ? patch.modelProviderProfiles : {}),
        items:
          isRecord(patch.modelProviderProfiles) && Array.isArray(patch.modelProviderProfiles.items)
            ? patch.modelProviderProfiles.items
            : current.modelProviderProfiles.items
      },
      chatProvider: {
        ...current.chatProvider,
        ...(isRecord(patch.chatProvider) ? patch.chatProvider : {}),
        config: {
          ...current.chatProvider.config,
          ...(isRecord(patch.chatProvider) && isRecord(patch.chatProvider.config)
            ? patch.chatProvider.config
            : {})
        }
      }
    })

    ctx.settingsStore.set({ ...next })
    return { success: true }
  })

  ipcMain.handle('settings:open', async (_event, section?: 'projects') => {
    const existing = ctx.subWindows.get('settings')
    ctx.createSubWindow('settings', {
      width: 900,
      height: 720,
      minWidth: 860,
      minHeight: 640,
      query: section ? { section } : undefined
    })
    if (section && existing && !existing.isDestroyed()) {
      existing.webContents.send('settings:navigate', section)
    }
    return { success: true }
  })
}
