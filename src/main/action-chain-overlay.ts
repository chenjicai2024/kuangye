// src/main/action-chain-overlay.ts
// 动作链自由框选的主进程协调层。
//
// 与现有 overlay-window.ts 完全独立，不复用其逻辑。
// 用户可以在屏幕上任意拖拽画矩形区域并命名，不限数量。
//
// 坐标系：screen 模式使用逻辑像素绝对坐标；window 模式使用相对窗口锚点的逻辑偏移。

import { BrowserWindow, screen, ipcMain, globalShortcut, type Display } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import activeWin from 'active-win'
import type { ScreenRect } from '../core/rpa/types'
import type { WindowAnchor } from '../core/action-chain/types'
import { nativeWindowBoundsToDip, resolveWindowAnchorBounds } from '../core/rpa/window-anchor-utils'
import { captureScreenRegion } from '../core/rpa/screenshot-utils'
import {
  saveActionChainRegionTemplate,
  saveActionChainWindowCapture
} from '../core/action-chain/assets'

export interface NamedRectResult {
  name: string
  rect: ScreenRect
  coordinateMode?: 'screen' | 'window'
  windowAnchorId?: string
  templateImagePath?: string
  templateScaleFactor?: number
}

export interface ViewRegionData {
  name: string
  regions: NamedRectResult[]
}

interface OverlayFlatRegion {
  name: string
  x: number
  y: number
  width: number
  height: number
  coordinateMode?: 'screen' | 'window'
  windowAnchorId?: string
  templateImagePath?: string
  templateScaleFactor?: number
}

interface OverlayViewRegionData {
  name: string
  regions: Array<NamedRectResult | OverlayFlatRegion>
}

export interface ActionChainOverlayResult {
  ok: boolean
  reason?: 'cancelled' | 'closed' | 'error'
  views?: ViewRegionData[]
  windowAnchors?: WindowAnchor[]
}

interface CapturedWindow {
  id: number
  title: string
  ownerName: string
  ownerPath?: string
  processId: number
  bounds: ScreenRect
  capturedImagePath?: string
  capturedImageScaleFactor?: number
}

interface WindowCaptureResult {
  ok: boolean
  window?: CapturedWindow
  error?: string
}

export interface ActionChainOverlayOptions {
  apiKey?: string
  model?: string
  baseURL?: string
  projectName?: string
  projectId?: string
  views?: ViewRegionData[]
  windowAnchors?: WindowAnchor[]
  // 向后兼容
  existingRegions?: NamedRectResult[]
}

interface ActiveOverlay {
  id: string
  window: BrowserWindow
  captureToolbar: BrowserWindow | null
  returnWindow: BrowserWindow | null
  resolve: (result: ActionChainOverlayResult) => void
  finished: boolean
  display: Display
  options: ActionChainOverlayOptions
  hiddenWindows: BrowserWindow[]
  windowCaptureActive: boolean
  windowCaptureCandidate: CapturedWindow | null
  windowCapturePoller: NodeJS.Timeout | null
  windowCapturePollBusy: boolean
  completing: boolean
}

let active: ActiveOverlay | null = null
let listenersBound = false
let nextId = 1
const WINDOW_CAPTURE_POLL_INTERVAL_MS = 180

function restoreWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
}

function showWindowInactive(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isVisible()) return
  win.showInactive()
}

function focusWindowContents(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  restoreWindow(win)
  if (!win.isFocused()) win.focus()
  if (!win.webContents.isDestroyed() && !win.webContents.isFocused()) {
    win.webContents.focus()
  }
}

function releaseActiveOverlay(session: ActiveOverlay): void {
  // 先清除 active，避免 destroy() 触发 closed 后再次进入收尾流程。
  if (active?.id === session.id) {
    active = null
  }

  try {
    stopWindowCapture(session)
    globalShortcut.unregister('Control')
    globalShortcut.unregister('Escape')
  } catch {
    /* ignore */
  }

  // alwaysOnTop 遮罩必须先同步销毁，再恢复业务窗口，避免遮罩继续抢焦点。
  try {
    if (!session.window.isDestroyed()) {
      session.window.destroy()
    }
  } catch {
    /* ignore */
  }

  const returnWindowId = session.returnWindow?.isDestroyed()
    ? null
    : (session.returnWindow?.id ?? null)

  // 其他窗口仅后台显示，不触发 focus；最后只聚焦真正发起框选的窗口。
  for (const win of session.hiddenWindows) {
    if (win.id === returnWindowId) continue
    try {
      showWindowInactive(win)
    } catch {
      /* ignore */
    }
  }

  if (session.returnWindow && !session.returnWindow.isDestroyed()) {
    try {
      focusWindowContents(session.returnWindow)
    } catch {
      /* ignore */
    }
  }
}

function finishActiveOverlay(result: ActionChainOverlayResult): void {
  const session = active
  if (!session || session.finished) return
  session.finished = true
  releaseActiveOverlay(session)
  // 必须在遮罩销毁、全部窗口恢复、调用窗口重新聚焦之后再唤醒 IPC 调用方。
  session.resolve(result)
}

function genId(): string {
  return `ac-overlay-${Date.now()}-${nextId++}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function pickDisplay(): Display {
  const cursor = screen.getCursorScreenPoint()
  return screen.getDisplayNearestPoint(cursor)
}

async function getForegroundWindow(): Promise<CapturedWindow | null> {
  const foreground = await activeWin({
    accessibilityPermission: false,
    screenRecordingPermission: false
  })
  if (!foreground || foreground.owner.processId === process.pid) return null
  if (!foreground.bounds || foreground.bounds.width <= 100 || foreground.bounds.height <= 100) {
    return null
  }

  const bounds = nativeWindowBoundsToDip(foreground.bounds)

  return {
    id: foreground.id,
    title: foreground.title || foreground.owner.name || '未命名窗口',
    ownerName: foreground.owner.name || '',
    ownerPath: foreground.owner.path || undefined,
    processId: foreground.owner.processId,
    bounds
  }
}

function sameCapturedWindow(left: CapturedWindow | null, right: CapturedWindow): boolean {
  if (!left) return false
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.bounds.x === right.bounds.x &&
    left.bounds.y === right.bounds.y &&
    left.bounds.width === right.bounds.width &&
    left.bounds.height === right.bounds.height
  )
}

function sendWindowCaptureCandidate(session: ActiveOverlay): void {
  const payload = { window: session.windowCaptureCandidate ?? undefined }
  if (!session.window.isDestroyed()) {
    session.window.webContents.send('action-chain-overlay:windowCaptureCandidate', payload)
  }
  if (session.captureToolbar && !session.captureToolbar.isDestroyed()) {
    session.captureToolbar.webContents.send('action-chain-capture-toolbar:candidate', payload)
  }
}

function destroyCaptureToolbar(session: ActiveOverlay): void {
  const toolbar = session.captureToolbar
  session.captureToolbar = null
  if (!toolbar || toolbar.isDestroyed()) return
  toolbar.destroy()
}

function stopWindowCapture(session: ActiveOverlay): void {
  if (session.windowCapturePoller) {
    clearInterval(session.windowCapturePoller)
    session.windowCapturePoller = null
  }
  session.windowCapturePollBusy = false
  session.windowCaptureActive = false
  session.windowCaptureCandidate = null
  globalShortcut.unregister('Escape')
  destroyCaptureToolbar(session)
  if (!session.window.isDestroyed()) {
    session.window.setIgnoreMouseEvents(false)
  }
}

function finishWindowCapture(session: ActiveOverlay, result: WindowCaptureResult): void {
  stopWindowCapture(session)
  if (session.window.isDestroyed()) return
  restoreWindow(session.window)
  session.window.focus()
  session.window.webContents.send('action-chain-overlay:windowCaptured', result)
}

async function saveCapturedWindowImage(
  session: ActiveOverlay,
  candidate: CapturedWindow
): Promise<CapturedWindow> {
  const projectId = session.options.projectId
  if (!projectId) return candidate

  if (!session.window.isDestroyed()) session.window.hide()
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
  const capture = await captureScreenRegion(candidate.bounds)
  if (!capture.success || !capture.nativeImage) {
    throw new Error(capture.error || '无法截取主窗口标准图片')
  }
  const capturedImagePath = await saveActionChainWindowCapture(
    projectId,
    capture.nativeImage.toPNG()
  )
  return {
    ...candidate,
    capturedImagePath,
    capturedImageScaleFactor: capture.display?.scaleFactor ?? 1
  }
}

async function pollWindowCaptureCandidate(sessionId: string): Promise<void> {
  const session = active
  if (
    !session ||
    session.id !== sessionId ||
    !session.windowCaptureActive ||
    session.windowCapturePollBusy
  ) {
    return
  }
  session.windowCapturePollBusy = true
  try {
    const candidate = await getForegroundWindow()
    if (active?.id !== sessionId || !session.windowCaptureActive) return
    if (candidate && !sameCapturedWindow(session.windowCaptureCandidate, candidate)) {
      session.windowCaptureCandidate = candidate
      sendWindowCaptureCandidate(session)
    }
  } catch (err: unknown) {
    if (active?.id !== sessionId || !session.windowCaptureActive) return
    finishWindowCapture(session, {
      ok: false,
      error: `窗口捕获失败：${errorMessage(err)}`
    })
  } finally {
    if (active?.id === sessionId) {
      session.windowCapturePollBusy = false
    }
  }
}

function createCaptureToolbar(session: ActiveOverlay): BrowserWindow {
  // 捕获控制条与自由框选顶部工具栏完全重合；技术上独立成窗口，
  // 才能在全屏视觉层鼠标穿透时继续接收“确认 / 重选 / 取消”点击。
  const width = session.display.bounds.width
  const height = 56
  const toolbar = new BrowserWindow({
    x: session.display.bounds.x,
    y: session.display.bounds.y,
    width,
    height,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  toolbar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  toolbar.setAlwaysOnTop(true, 'screen-saver')
  toolbar.once('ready-to-show', () => {
    if (!toolbar.isDestroyed()) toolbar.showInactive()
  })
  toolbar.on('closed', () => {
    if (session.captureToolbar !== toolbar) return
    session.captureToolbar = null
    if (active?.id === session.id && session.windowCaptureActive) {
      finishWindowCapture(session, { ok: false, error: '已取消窗口捕获' })
    }
  })
  toolbar.webContents.once('did-finish-load', () => {
    if (toolbar.isDestroyed()) return
    sendCaptureToolbarState(session)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    toolbar.loadURL(
      `${process.env['ELECTRON_RENDERER_URL']}/overlay.html?mode=actionchain-capture-toolbar`
    )
  } else {
    toolbar.loadFile(join(__dirname, '../renderer/overlay.html'), {
      query: { mode: 'actionchain-capture-toolbar' }
    })
  }
  return toolbar
}

function sendCaptureToolbarState(session: ActiveOverlay): void {
  const toolbar = session.captureToolbar
  if (!toolbar || toolbar.isDestroyed()) return
  toolbar.webContents.send('action-chain-capture-toolbar:init', { id: session.id })
  toolbar.webContents.send('action-chain-capture-toolbar:candidate', {
    window: session.windowCaptureCandidate ?? undefined
  })
}

function bindIpcOnce(): void {
  if (listenersBound) return
  listenersBound = true

  ipcMain.on(
    'action-chain-overlay:complete',
    (
      _event,
      payload: {
        id: string
        views?: OverlayViewRegionData[]
        windowAnchors?: WindowAnchor[]
        regions?: Array<NamedRectResult | OverlayFlatRegion>
      }
    ) => {
      if (!active || active.id !== payload.id) return
      const session = active
      if (session.completing) return
      session.completing = true
      const windowAnchors = payload.windowAnchors ?? []
      // 兼容：overlay 可能返回 views 或旧格式 regions
      const views = payload.views
        ? payload.views.map(normalizeOverlayView)
        : payload.regions
          ? [
              {
                name: '默认视图',
                regions: payload.regions
                  .map(normalizeOverlayRegion)
                  .filter(Boolean) as NamedRectResult[]
              }
            ]
          : []

      void captureMissingRegionTemplates(session, views, windowAnchors)
        .catch((error: unknown) => {
          console.error('[action-chain-overlay] 保存区域模板失败:', errorMessage(error))
          return views
        })
        .then((capturedViews) => {
          finishActiveOverlay({ ok: true, views: capturedViews, windowAnchors })
        })
    }
  )

  ipcMain.on('action-chain-overlay:cancel', (_event, payload: { id: string }) => {
    if (!active || active.id !== payload.id) return
    finishActiveOverlay({ ok: false, reason: 'cancelled' })
  })

  ipcMain.on('action-chain-overlay:startWindowCapture', (_event, payload: { id: string }) => {
    const session = active
    if (!session || session.id !== payload.id || session.windowCaptureActive) return

    globalShortcut.unregister('Escape')
    session.windowCaptureActive = true
    session.windowCaptureCandidate = null
    session.window.setIgnoreMouseEvents(true)
    session.window.blur()

    try {
      session.captureToolbar = createCaptureToolbar(session)
    } catch (err: unknown) {
      finishWindowCapture(session, {
        ok: false,
        error: `无法打开窗口捕获控制条：${errorMessage(err)}`
      })
      return
    }

    // Esc 只是备用取消方式；即使注册失败，控制条上的“取消”仍可完整操作。
    try {
      globalShortcut.register('Escape', () => {
        if (!active || active.id !== session.id || !active.windowCaptureActive) return
        finishWindowCapture(active, { ok: false, error: '已取消窗口捕获' })
      })
    } catch {
      /* ignore */
    }

    sendWindowCaptureCandidate(session)
    void pollWindowCaptureCandidate(session.id)
    session.windowCapturePoller = setInterval(
      () => void pollWindowCaptureCandidate(session.id),
      WINDOW_CAPTURE_POLL_INTERVAL_MS
    )
  })

  ipcMain.on('action-chain-capture-toolbar:confirm', (_event, payload: { id: string }) => {
    const session = active
    if (!session || session.id !== payload.id || !session.windowCaptureActive) return
    const candidate = session.windowCaptureCandidate
    if (!candidate) return
    stopWindowCapture(session)
    void saveCapturedWindowImage(session, candidate)
      .then((capturedWindow) => {
        if (active?.id !== session.id || session.finished) return
        finishWindowCapture(session, { ok: true, window: capturedWindow })
      })
      .catch((error: unknown) => {
        if (active?.id !== session.id || session.finished) return
        finishWindowCapture(session, {
          ok: false,
          error: `保存主窗口截图失败：${errorMessage(error)}`
        })
      })
  })

  ipcMain.on('action-chain-capture-toolbar:ready', (event) => {
    const session = active
    if (
      !session ||
      !session.windowCaptureActive ||
      !session.captureToolbar ||
      session.captureToolbar.isDestroyed() ||
      session.captureToolbar.webContents.id !== event.sender.id
    ) {
      return
    }
    sendCaptureToolbarState(session)
  })

  ipcMain.on('action-chain-capture-toolbar:retry', (_event, payload: { id: string }) => {
    const session = active
    if (!session || session.id !== payload.id || !session.windowCaptureActive) return
    session.windowCaptureCandidate = null
    sendWindowCaptureCandidate(session)
  })

  ipcMain.on('action-chain-capture-toolbar:cancel', (_event, payload: { id: string }) => {
    const session = active
    if (!session || session.id !== payload.id || !session.windowCaptureActive) return
    finishWindowCapture(session, { ok: false, error: '已取消窗口捕获' })
  })

  ipcMain.on(
    'action-chain-overlay:toggleMousePassthrough',
    (_event, payload: { id: string; passthrough: boolean }) => {
      if (!active || active.id !== payload.id) return
      try {
        if (payload.passthrough) {
          // 进入桌面模式：窗口保持全屏，设置鼠标穿透
          active.window.setIgnoreMouseEvents(true)
          // 注册全局 Ctrl+K 快捷键用于恢复（不重复注册）
          if (!globalShortcut.isRegistered('CommandOrControl+K')) {
            globalShortcut.register('CommandOrControl+K', () => {
              globalShortcut.unregister('CommandOrControl+K')
              try {
                if (active && !active.finished && !active.window.isDestroyed()) {
                  active.window.setIgnoreMouseEvents(false)
                  active.window.restore()
                  active.window.focus()
                  active.window.webContents.send('action-chain-overlay:restored')
                }
              } catch {
                /* ignore */
              }
            })
          }
        } else {
          // 退出桌面模式
          globalShortcut.unregister('CommandOrControl+K')
          try {
            if (!active.window.isDestroyed()) {
              active.window.setIgnoreMouseEvents(false)
              active.window.restore()
              active.window.focus()
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        // 窗口可能已关闭
      }
    }
  )
}

function normalizeOverlayView(view: OverlayViewRegionData): ViewRegionData {
  return {
    name: view.name,
    regions: view.regions.map(normalizeOverlayRegion).filter(Boolean) as NamedRectResult[]
  }
}

function normalizeOverlayRegion(
  region: NamedRectResult | OverlayFlatRegion
): NamedRectResult | null {
  if ('rect' in region && region.rect) {
    return region
  }
  const flat = region as OverlayFlatRegion
  if (
    !flat.name ||
    !Number.isFinite(flat.x) ||
    !Number.isFinite(flat.y) ||
    !Number.isFinite(flat.width) ||
    !Number.isFinite(flat.height) ||
    flat.width <= 0 ||
    flat.height <= 0
  ) {
    return null
  }
  return {
    name: flat.name,
    coordinateMode: flat.coordinateMode === 'window' ? 'window' : 'screen',
    windowAnchorId:
      flat.coordinateMode === 'window' && flat.windowAnchorId ? flat.windowAnchorId : undefined,
    templateImagePath: flat.templateImagePath,
    templateScaleFactor: flat.templateScaleFactor,
    rect: {
      x: Math.round(flat.x),
      y: Math.round(flat.y),
      width: Math.round(flat.width),
      height: Math.round(flat.height)
    }
  }
}

function absoluteRectForTemplate(
  region: NamedRectResult,
  windowAnchors: WindowAnchor[]
): ScreenRect {
  if (region.coordinateMode === 'window' && region.windowAnchorId) {
    const anchor = windowAnchors.find((item) => item.id === region.windowAnchorId)
    if (anchor) {
      return {
        x: anchor.capturedBounds.x + region.rect.x,
        y: anchor.capturedBounds.y + region.rect.y,
        width: region.rect.width,
        height: region.rect.height
      }
    }
  }
  return region.rect
}

async function captureMissingRegionTemplates(
  session: ActiveOverlay,
  views: ViewRegionData[],
  windowAnchors: WindowAnchor[]
): Promise<ViewRegionData[]> {
  const projectId = session.options.projectId
  if (!projectId) return views

  if (!session.window.isDestroyed()) session.window.hide()
  if (session.captureToolbar && !session.captureToolbar.isDestroyed()) {
    session.captureToolbar.hide()
  }
  // 等一帧让桌面合成器移除透明框选层，避免把边框一起保存进模板。
  await new Promise<void>((resolve) => setTimeout(resolve, 80))

  const capturedViews: ViewRegionData[] = []
  for (const view of views) {
    const capturedRegions: NamedRectResult[] = []
    for (const region of view.regions) {
      if (region.templateImagePath) {
        capturedRegions.push(region)
        continue
      }
      const capture = await captureScreenRegion(absoluteRectForTemplate(region, windowAnchors))
      if (!capture.success || !capture.nativeImage) {
        capturedRegions.push(region)
        continue
      }
      const templateImagePath = await saveActionChainRegionTemplate(
        projectId,
        capture.nativeImage.toPNG()
      )
      capturedRegions.push({
        ...region,
        templateImagePath,
        templateScaleFactor: capture.display?.scaleFactor ?? 1
      })
    }
    capturedViews.push({ ...view, regions: capturedRegions })
  }
  return capturedViews
}

export function cleanup(): void {
  finishActiveOverlay({ ok: false, reason: 'closed' })
}

export function runActionChainOverlay(
  options: ActionChainOverlayOptions = {},
  returnWindow: BrowserWindow | null = null
): Promise<ActionChainOverlayResult> {
  return new Promise((resolve) => {
    if (active) {
      resolve({ ok: false, reason: 'error' })
      return
    }

    bindIpcOnce()
    const display = pickDisplay()
    const id = genId()

    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true
      }
    })

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setAlwaysOnTop(true, 'screen-saver')

    // 临时隐藏其他窗口，让用户看清桌面。hide/showInactive 不触发最小化动画和焦点争抢。
    const hiddenWindows: BrowserWindow[] = []
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.id !== win.id && !w.isDestroyed() && w.isVisible()) {
        hiddenWindows.push(w)
        w.hide()
      }
    }

    active = {
      id,
      window: win,
      captureToolbar: null,
      returnWindow,
      resolve,
      finished: false,
      display,
      options,
      hiddenWindows,
      windowCaptureActive: false,
      windowCaptureCandidate: null,
      windowCapturePoller: null,
      windowCapturePollBusy: false,
      completing: false
    }

    win.on('restore', () => {
      win.webContents.send('action-chain-overlay:restored')
    })

    win.on('closed', () => {
      if (active && active.id === id && !active.finished) {
        finishActiveOverlay({ ok: false, reason: 'closed' })
      }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html?mode=actionchain`)
    } else {
      win.loadFile(join(__dirname, '../renderer/overlay.html'), { query: { mode: 'actionchain' } })
    }

    // 窗口准备好后发送初始化数据；did-finish-load 为主路径，
    // action-chain-overlay:ready 为渲染进程 React 挂载后的回退——确保 init 不会因为
    // did-finish-load 早于 React mount 而丢失。
    let initSent = false
    const sendInit = async (): Promise<void> => {
      if (win.isDestroyed() || initSent) return
      initSent = true
      const contentOriginAbs = win.getContentBounds()
      const windowAnchors = await Promise.all(
        (options.windowAnchors ?? []).map(async (anchor) => ({
          ...anchor,
          capturedBounds:
            (await resolveWindowAnchorBounds(anchor).catch(() => null)) ?? anchor.capturedBounds
        }))
      )
      if (win.isDestroyed()) return
      // 区域保持其持久化坐标语义；renderer 根据坐标模式和窗口锚点负责显示换算。
      const views = options.views?.map((v) => ({
        name: v.name,
        regions: v.regions.map((r) => ({
          name: r.name,
          x: r.rect.x,
          y: r.rect.y,
          width: r.rect.width,
          height: r.rect.height,
          coordinateMode: r.coordinateMode ?? 'screen',
          windowAnchorId: r.windowAnchorId,
          templateImagePath: r.templateImagePath,
          templateScaleFactor: r.templateScaleFactor
        }))
      }))
      // 向后兼容：旧格式 existingRegions
      const existingRegions = options.existingRegions?.map((r) => ({
        name: r.name,
        x: r.rect.x,
        y: r.rect.y,
        width: r.rect.width,
        height: r.rect.height,
        coordinateMode: r.coordinateMode ?? 'screen',
        windowAnchorId: r.windowAnchorId,
        templateImagePath: r.templateImagePath,
        templateScaleFactor: r.templateScaleFactor
      }))
      win.webContents.send('action-chain-overlay:init', {
        id,
        display: {
          id: display.id,
          bounds: display.bounds,
          scaleFactor: display.scaleFactor
        },
        contentOriginAbs: { x: contentOriginAbs.x, y: contentOriginAbs.y },
        windowAnchors,
        views,
        existingRegions
      })
    }
    win.webContents.once('did-finish-load', () => void sendInit())
    ipcMain.once('action-chain-overlay:ready', () => void sendInit())
  })
}
