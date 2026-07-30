import { ipcMain } from 'electron'
import { getErrorMessage } from '../../core/error-utils'
import {
  getBuiltinDoubaoInstalledInfo,
  getBuiltinDoubaoManifestForUi,
  getInstalledProviderManifest,
  installProviderFromUrl
} from '../provider-bundle'
import {
  normalizeSettings,
  withSchemaDefaults,
  type MainContext
} from '../ipc-context'

export function registerProviderIpc(ctx: MainContext): void {
  ipcMain.handle('provider:installFromUrl', async (_event, manifestUrl: string) => {
    try {
      const result = await installProviderFromUrl(manifestUrl)
      const current = normalizeSettings(ctx.settingsStore.store)
      ctx.settingsStore.set({
        ...current,
        chatProvider: {
          ...current.chatProvider,
          manifestUrl,
          installed: result.installed,
          config: withSchemaDefaults(result.manifest.configSchema, current.chatProvider.config)
        }
      })

      return {
        success: true,
        installed: result.installed,
        manifest: result.manifest
      }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('provider:getInstalled', async () => {
    const settings = normalizeSettings(ctx.settingsStore.store)

    if (settings.chatProvider.installed) {
      const manifest = await getInstalledProviderManifest(settings.chatProvider.installed)
      return {
        installed: settings.chatProvider.installed,
        manifest,
        isBuiltinDefault: false
      }
    }

    const installed = await getBuiltinDoubaoInstalledInfo()
    const manifest = await getBuiltinDoubaoManifestForUi()
    return {
      installed,
      manifest,
      isBuiltinDefault: true
    }
  })

  ipcMain.handle('providerHub:getCatalog', async () => {
    const cached = ctx.getCachedProviderHub()
    if (cached) return { success: true, catalog: cached }

    try {
      const catalog = await ctx.fetchProviderHub()
      return { success: true, catalog }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message, catalog: null }
    }
  })

  ipcMain.handle('providerHub:update', async () => {
    try {
      const catalog = await ctx.fetchProviderHub()
      return { success: true, catalog }
    } catch (error: unknown) {
      const cached = ctx.getCachedProviderHub()
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message, catalog: cached }
    }
  })
}
