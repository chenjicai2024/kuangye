import { screen } from 'electron'
import activeWin from 'active-win'
import type { Window as NativeWindow } from 'node-window-manager'
import { getErrorMessage } from '../error-utils'
import { AppType } from './types'

const IS_WINDOWS = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

// 包装带超时的 activeWin 调用
type ActiveWindow = Awaited<ReturnType<typeof activeWin.getOpenWindows>>[number]
type WindowBounds = { x: number; y: number; width: number; height: number }
type RawWindowBounds = Partial<WindowBounds>

async function getOpenWindowsSafe(): Promise<ActiveWindow[]> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('active-win getOpenWindows timeout')), 5000)
    })

    // 如果系统没有给权限，activeWin在某些版本可能卡死，强制5秒超时
    return await Promise.race([activeWin.getOpenWindows(), timeoutPromise])
  } catch (error: unknown) {
    console.error('[window-utils] getOpenWindowsSafe error or timeout:', getErrorMessage(error))
    return []
  }
}

export function matchWechatType(name: string, appType: AppType): boolean {
  if ((appType as string) === 'whatsapp') {
    return ['‎WhatsApp', '‎WhatsApp.app', '‎WhatsApp.exe', 'WhatsApp'].includes(name)
  }
  const wechatName =
    appType === 'wechat' ? ['微信', '微信.app', 'WeChat'] : ['企业微信', '企业微信.app']
  return wechatName.includes(name)
}

function getWechatWindow(appType: AppType, windows: ActiveWindow[]): ActiveWindow | undefined {
  let appTargetName: string[]
  let windowTitle: string[]

  if ((appType as string) === 'whatsapp') {
    appTargetName = ['‎WhatsApp', '‎WhatsApp.app', '‎WhatsApp.exe', 'WhatsApp']
    windowTitle = ['‎WhatsApp', '‎WhatsApp.app', '‎WhatsApp.exe', 'WhatsApp']
  } else {
    appTargetName =
      appType === 'wechat' ? ['微信', '微信.app', 'WeChat'] : ['企业微信', '企业微信.app']
    windowTitle = appType === 'wechat' ? ['微信', 'Weixin'] : ['企业微信']
  }

  const allWechatWindows = windows.filter((window) => appTargetName.includes(window.owner.name))

  if (allWechatWindows.length > 1) {
    const selected = allWechatWindows.find((window) => windowTitle.includes(window.title))
    return selected
  }
  if (allWechatWindows.length === 1) {
    return allWechatWindows[0]
  }
  return undefined
}

type PlatformWindow = ActiveWindow | NativeWindow

async function getWechatWindowInWin(appType: AppType): Promise<PlatformWindow | null> {
  try {
    const { windowManager } = await import('node-window-manager')
    const activeWechatWindow = windowManager.getActiveWindow()
    if (activeWechatWindow && matchWechatType(activeWechatWindow.getTitle(), appType)) {
      return activeWechatWindow
    }
    const foundWindow = windowManager
      .getWindows()
      ?.find((window) => matchWechatType(window.getTitle(), appType) && window.isVisible())
    return foundWindow || null
  } catch (error: unknown) {
    console.error('[window-utils] getWechatWindowInWin error:', getErrorMessage(error))
    return null
  }
}

async function getWechatWindowInMac(appType: AppType): Promise<PlatformWindow | null> {
  const windows = await getOpenWindowsSafe()
  if (!windows || windows.length === 0) {
    return null
  }
  return getWechatWindow(appType, windows) || null
}

function getWindowBounds(window: PlatformWindow): RawWindowBounds | null {
  if ('getBounds' in window) {
    return window.getBounds()
  }
  return window.bounds
}

function validateWindowBounds(bounds: RawWindowBounds | null): bounds is WindowBounds {
  if (!bounds) return false
  return (
    typeof bounds.x === 'number' &&
    typeof bounds.y === 'number' &&
    typeof bounds.width === 'number' &&
    typeof bounds.height === 'number' &&
    bounds.width >= 100 &&
    bounds.height >= 100
  )
}

export interface WechatWindowInfo {
  wechatWindow: PlatformWindow
  bounds: WindowBounds
  wechatType: AppType
  display: Pick<Electron.Display, 'id' | 'scaleFactor' | 'bounds'>
}

export interface WindowInfo {
  wechatWindow: PlatformWindow
  bounds: WindowBounds
  wechatType: AppType
  scaleFactor: number
  screenshot?: string
}

interface WechatWindowInfoCache {
  result: WechatWindowInfo | null
  timestamp: number
}
const WINDOW_INFO_CACHE_DURATION = 5000 // 5 seconds cache
const wechatWindowInfoCache = new Map<AppType, WechatWindowInfoCache>()
const wechatWindowInfoPendingPromises = new Map<AppType, Promise<WechatWindowInfo | null>>()

export async function getWechatWindowInfo(appType: AppType): Promise<WechatWindowInfo | null> {
  const cached = wechatWindowInfoCache.get(appType)
  const now = Date.now()
  if (cached && now - cached.timestamp < WINDOW_INFO_CACHE_DURATION) {
    return cached.result
  }

  const pendingPromise = wechatWindowInfoPendingPromises.get(appType)
  if (pendingPromise) return pendingPromise

  const queryPromise = (async () => {
    try {
      const wechatWindow = IS_WINDOWS
        ? await getWechatWindowInWin(appType)
        : IS_MAC
          ? await getWechatWindowInMac(appType)
          : null
      if (!wechatWindow) return null

      const bounds = getWindowBounds(wechatWindow)
      if (!validateWindowBounds(bounds)) return null

      const display = screen.getDisplayMatching({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      })

      const result = {
        wechatWindow,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        wechatType: appType,
        display: { id: display.id, scaleFactor: display.scaleFactor, bounds: display.bounds }
      }
      wechatWindowInfoCache.set(appType, { result, timestamp: Date.now() })
      return result
    } catch (e) {
      console.error('getWechatWindowInfo error:', e)
      return null
    } finally {
      wechatWindowInfoPendingPromises.delete(appType)
    }
  })()

  wechatWindowInfoPendingPromises.set(appType, queryPromise)
  return queryPromise
}

export const getWindowInfo = async (appType: AppType = 'wechat'): Promise<WindowInfo | null> => {
  const result = await getWechatWindowInfo(appType)
  if (!result) return null
  return {
    wechatWindow: result.wechatWindow,
    bounds: result.bounds,
    wechatType: result.wechatType,
    scaleFactor: result.display.scaleFactor
  }
}

/**
 * 同步获取窗口信息（从内存缓存读取，不发起系统调用）
 * 前提：measureLayout 时已经调过 getWindowInfo/getWechatWindowInfo，缓存有数据
 */
export function getWindowInfoSync(appType: AppType): {
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
} | null {
  const cached = wechatWindowInfoCache.get(appType)
  if (!cached?.result) return null

  return {
    bounds: cached.result.bounds,
    scaleFactor: cached.result.display?.scaleFactor || 1
  }
}
