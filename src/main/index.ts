import { app, BrowserWindow, globalShortcut, screen, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { checkAndRequestPermissions } from './permission'
import {
  SkillEngineController,
  SkillPauseResult,
  SkillStartResult,
  startSkillServer,
  stopSkillServer
} from './skill-server'
import { ActionChainEngine } from '../core/action-chain/engine'
import { loadProjectWorkspace } from '../core/action-chain/store'
import { formatValidationErrors, validateWorkspaceForRun } from '../core/action-chain/validation'
import { cleanup as cleanupActionChainOverlay } from './action-chain-overlay'
import { getErrorMessage, isRecord } from '../core/error-utils'
import { releasePressedMouseButtons } from '../core/rpa/input-utils'
import * as sessionStore from '../core/work-memory/session-store'
import * as experienceStore from '../core/work-memory/experience-store'
import type { RunSession } from '../core/work-memory/types'
import * as chatHistoryStore from '../core/chat-history/store'
import { getDefaultModelProviderSettings } from '../core/model-provider'
import type {
  AgentDiagnosticContext,
  AgentAssistantPermissions
} from '../core/agent-assistant/types'
import {
  StoreClass,
  DEFAULT_PROVIDER_HUB_URL,
  PROVIDER_HUB_CACHE_KEY,
  EMERGENCY_STOP_SHORTCUT,
  icon,
  type MainContext,
  type CompactModePayload,
  type CompactSession,
  type ProviderHubCache,
  type ProviderHubEntry,
  type ProviderHubManifest,
  normalizeSettings,
  createTrackedVisionConfig,
  normalizeManifestConfigFields,
  fetchJson,
  focusWindowContents,
  bindWindowContentFocus,
  ensureLegacyChatHistoryAssigned,
  compactRunSession,
  truncateDiagnosticText
} from './ipc-context'
import { initDatabase, closeDatabase, runMigrations, ProjectRepository, ExperienceRepository } from '../core/database'
import { readFileSync, existsSync } from 'node:fs'
import { registerSettingsIpc } from './ipc/settings-ipc'
import { registerEngineIpc } from './ipc/engine-ipc'
import { registerProviderIpc } from './ipc/provider-ipc'
import { registerActionChainIpc } from './ipc/action-chain-ipc'
import { registerAgentAssistantIpc } from './ipc/agent-assistant-ipc'
import { registerMemoryIpc } from './ipc/memory-ipc'
import { registerChatHistoryIpc } from './ipc/chat-history-ipc'
import { registerDataIpc, setDataManagerOpener } from './ipc/data-ipc'

// ── settingsStore ──
const settingsStore = new StoreClass<Record<string, unknown>>({
  name: 'settings',
  defaults: {
    locale: 'zh',
    vision: { apiKey: '' },
    modelProvider: getDefaultModelProviderSettings(),
    modelProviderProfiles: { activeProfileId: '', items: [] },
    chatProvider: {
      manifestUrl: '',
      installed: null,
      config: {}
    }
  }
})

// ── 全局可变状态 ──
let actionChainEngine: ActionChainEngine | null = null
let currentSessionId: string | null = null
let currentRunningProjectId: string | null = null
const subWindows = new Map<string, BrowserWindow>()
const actionChainWindowModes = new Map<number, 'run' | 'settings'>()

let compactSession: CompactSession | null = null
let appIsQuitting = false
let emergencyStopShortcutRegistered = false
const activeAgentAssistantRequests = new Map<
  string,
  { controller: AbortController; senderId: number; sessionId: string }
>()

// ── 运行时控制函数 ──

function stopActionChainRuntime(): void {
  if (actionChainEngine) {
    actionChainEngine.stop()
    actionChainEngine = null
  }
  currentRunningProjectId = null
  unregisterEmergencyStopShortcut()
}

function broadcastActionChainLog(message: string): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('action-chain:log', message)
    }
  })
}

function emergencyStopActionChain(): void {
  const wasRunning = actionChainEngine?.getState().running === true

  // 先切断执行循环，再释放鼠标，保证后续节点不会继续获取控制权。
  stopActionChainRuntime()
  releasePressedMouseButtons()
  cleanupActionChainOverlay()

  if (compactSession) {
    void exitCompactMode()
  }

  broadcastActionChainLog(
    wasRunning
      ? `紧急停止：已按下 ${EMERGENCY_STOP_SHORTCUT}，动作链和鼠标操作已彻底停止`
      : `紧急停止：已按下 ${EMERGENCY_STOP_SHORTCUT}，当前没有正在运行的动作链`
  )
}

function registerEmergencyStopShortcut(): void {
  if (emergencyStopShortcutRegistered) return
  const registered = globalShortcut.register(EMERGENCY_STOP_SHORTCUT, emergencyStopActionChain)
  emergencyStopShortcutRegistered = registered
  if (registered) {
    console.log('[安全] 动作链运行期间可按 Esc 全局紧急停止')
  } else {
    console.error('[安全] 无法注册全局紧急停止键：Esc')
  }
}

function unregisterEmergencyStopShortcut(): void {
  if (!emergencyStopShortcutRegistered) return
  globalShortcut.unregister(EMERGENCY_STOP_SHORTCUT)
  emergencyStopShortcutRegistered = false
}

async function exitCompactMode(closeController = true): Promise<void> {
  const session = compactSession
  if (!session || session.exiting) return
  session.exiting = true
  compactSession = null
  stopActionChainRuntime()

  if (closeController && !session.controller.isDestroyed()) {
    session.controller.destroy()
  }

  if (appIsQuitting) return
  const windowsToRestore = session.visibleWindowIds
    .map((id) => BrowserWindow.fromId(id))
    .filter((win): win is BrowserWindow => Boolean(win && !win.isDestroyed()))
  const origin = BrowserWindow.fromId(session.originWindowId)
  const focusTarget =
    origin && !origin.isDestroyed() ? origin : windowsToRestore[windowsToRestore.length - 1]

  // Windows 上 BrowserWindow.show() 会激活窗口。逐个 show 会让主窗口、项目中心和编辑器
  // 连续争抢前台焦点，表现为剧烈闪烁。其他窗口只恢复可见性，最后仅聚焦原编辑器。
  windowsToRestore.forEach((win) => {
    if (win.id !== focusTarget?.id) win.showInactive()
  })
  if (focusTarget) {
    focusWindowContents(focusTarget)
  }
}

async function enterCompactMode(
  origin: BrowserWindow,
  target: CompactModePayload
): Promise<{ success: boolean; error?: string; alreadyActive?: boolean }> {
  if (compactSession && !compactSession.controller.isDestroyed()) {
    focusWindowContents(compactSession.controller)
    return { success: true, alreadyActive: true }
  }

  const display = screen.getDisplayMatching(origin.getBounds())
  const width = 400
  const height = 92
  const margin = 16
  const controller = new BrowserWindow({
    width,
    height,
    minWidth: width,
    maxWidth: width,
    minHeight: height,
    maxHeight: height,
    x: display.workArea.x + display.workArea.width - width - margin,
    y: display.workArea.y + display.workArea.height - height - margin,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  controller.setMinimumSize(width, height)
  controller.setMaximumSize(width, height)
  controller.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  controller.setAlwaysOnTop(true, 'screen-saver')
  controller.on('will-resize', (event) => {
    // Windows 拖到屏幕边缘时可能触发系统贴靠缩放；悬浮控制条必须保持固定尺寸。
    event.preventDefault()
  })
  let restoringFixedSize = false
  controller.on('resize', () => {
    if (restoringFixedSize || controller.isDestroyed()) return
    const bounds = controller.getBounds()
    if (bounds.width === width && bounds.height === height) return
    restoringFixedSize = true
    controller.setBounds({ ...bounds, width, height }, false)
    setImmediate(() => {
      restoringFixedSize = false
    })
  })
  let clampingPosition = false
  controller.on('move', () => {
    if (clampingPosition || controller.isDestroyed()) return
    const bounds = controller.getBounds()
    const workArea = screen.getDisplayMatching(bounds).workArea
    const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - bounds.width)
    const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - bounds.height)
    if (x === bounds.x && y === bounds.y) return
    clampingPosition = true
    controller.setPosition(x, y)
    setImmediate(() => {
      clampingPosition = false
    })
  })

  const visibleWindowIds = BrowserWindow.getAllWindows()
    .filter((win) => win.id !== controller.id && win.isVisible())
    .map((win) => win.id)
  const session: CompactSession = {
    controller,
    target,
    originWindowId: origin.id,
    visibleWindowIds,
    exiting: false
  }
  compactSession = session

  controller.on('closed', () => {
    if (compactSession !== session || session.exiting || appIsQuitting) return
    void exitCompactMode(false)
  })
  controller.webContents.on('did-finish-load', () => {
    if (controller.isDestroyed()) return
    controller.webContents.send('action-chain:compactInit', {
      target,
      state: actionChainEngine?.getState() ?? null
    })
  })

  try {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      await controller.loadURL(
        `${process.env['ELECTRON_RENDERER_URL']}/overlay.html?mode=actionchain-compact-controller`
      )
    } else {
      await controller.loadFile(join(__dirname, '../renderer/overlay.html'), {
        query: { mode: 'actionchain-compact-controller' }
      })
    }
  } catch (error) {
    compactSession = null
    if (!controller.isDestroyed()) controller.destroy()
    return { success: false, error: getErrorMessage(error) }
  }

  visibleWindowIds.forEach((id) => {
    const win = BrowserWindow.fromId(id)
    if (win && !win.isDestroyed()) win.hide()
  })
  controller.show()
  controller.focus()
  controller.webContents.send('action-chain:compactInit', {
    target,
    state: actionChainEngine?.getState() ?? null
  })
  return { success: true }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 360,
    height: 720,
    minWidth: 360,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#0a0b10',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  bindWindowContentFocus(mainWindow)

  mainWindow.on('ready-to-show', () => {
    focusWindowContents(mainWindow)
  })

  mainWindow.on('close', () => {
    cleanupActionChainOverlay()
    subWindows.forEach((win) => {
      if (!win.isDestroyed()) win.close()
    })
  })

  mainWindow.on('closed', () => {
    actionChainWindowModes.delete(mainWindow.id)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createSubWindow(
  kind: string,
  opts: {
    width: number
    height: number
    minWidth: number
    minHeight: number
    windowKind?: string
    query?: Record<string, string>
  }
): void {
  const existing = subWindows.get(kind)
  if (existing && !existing.isDestroyed()) {
    focusWindowContents(existing)
    return
  }

  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    minWidth: opts.minWidth,
    minHeight: opts.minHeight,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#0a0b10',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  bindWindowContentFocus(win)

  subWindows.set(kind, win)

  win.on('ready-to-show', () => focusWindowContents(win))

  win.on('closed', () => {
    subWindows.delete(kind)
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const windowKind = opts.windowKind ?? kind
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(`${process.env['ELECTRON_RENDERER_URL']}`)
    url.searchParams.set('window', windowKind)
    Object.entries(opts.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: windowKind, ...(opts.query ?? {}) }
    })
  }
}

// 打开数据管理窗口
function openDataManagerWindow(projectId: string, projectName: string): void {
  createSubWindow('data-manager', {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    windowKind: 'data-manager',
    query: { projectId, projectName }
  })
}

// 自动迁移旧数据
function autoMigrateData(userDataPath: string): void {
  try {
    // 读取并解析 JSON 文件
    function readJsonFile<T>(filePath: string): T | null {
      try {
        if (!existsSync(filePath)) return null
        const content = readFileSync(filePath, 'utf-8')
        return JSON.parse(content) as T
      } catch {
        return null
      }
    }

    // 迁移项目
    const projectsPath = join(userDataPath, 'action-chain-projects.json')
    const projectsData = readJsonFile<{ projects: Array<{ id: string; name: string; workspace: unknown }> }>(projectsPath)
    if (projectsData?.projects) {
      const projectRepo = new ProjectRepository()
      const now = Date.now()
      for (const p of projectsData.projects) {
        const existing = projectRepo.findById(p.id)
        if (!existing) {
          projectRepo.create({
            id: p.id,
            name: p.name,
            created_at: now,
            updated_at: now,
            workspace: JSON.stringify(p.workspace)
          } as any)
        }
      }
      console.log(`[AutoMigrate] 迁移了 ${projectsData.projects.length} 个项目`)
    }

    // 迁移经验卡片
    const cardsPath = join(userDataPath, 'workmemory', 'cards.json')
    const cardsData = readJsonFile<{ cards: Array<{ id: string; scenario: string; guidance: string; rationale?: string; evidence?: string[]; source?: string; stats?: { used: number; success: number } }> }>(cardsPath)
    if (cardsData?.cards) {
      const experienceRepo = new ExperienceRepository()
      const now = Date.now()
      for (const c of cardsData.cards) {
        const existing = experienceRepo.findById(c.id)
        if (!existing) {
          experienceRepo.create({
            id: c.id,
            scenario: c.scenario,
            guidance: c.guidance,
            rationale: c.rationale,
            evidence: c.evidence ? JSON.stringify(c.evidence) : undefined,
            source: c.source,
            used_count: c.stats?.used ?? 0,
            success_count: c.stats?.success ?? 0,
            enabled: 1,
            created_at: now,
            updated_at: now
          } as any)
        }
      }
      console.log(`[AutoMigrate] 迁移了 ${cardsData.cards.length} 张经验卡片`)
    }
  } catch (error) {
    console.error('[AutoMigrate] 迁移失败:', error)
  }
}

function getCachedProviderHub(): ProviderHubCache | null {
  const cached = settingsStore.get(PROVIDER_HUB_CACHE_KEY)
  if (!isRecord(cached) || !Array.isArray(cached.providers)) return null
  return cached as ProviderHubCache
}

async function fetchProviderHub(url = DEFAULT_PROVIDER_HUB_URL): Promise<ProviderHubCache> {
  const hub = await fetchJson(url)
  if (!isRecord(hub) || !Array.isArray(hub.providers)) {
    throw new Error('Provider hub JSON must contain a providers array')
  }

  const providers = await Promise.all(
    (hub.providers as ProviderHubEntry[])
      .filter((entry) => entry?.enabled !== false && typeof entry?.manifestUrl === 'string')
      .map(async (entry) => {
        const manifestUrl = entry.manifestUrl as string
        const manifest = (await fetchJson(manifestUrl)) as ProviderHubManifest
        const id =
          typeof manifest.id === 'string'
            ? manifest.id
            : typeof entry.id === 'string'
              ? entry.id
              : manifestUrl
        const name = typeof manifest.name === 'string' ? manifest.name : id
        const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
        const capabilities = Array.isArray(manifest.capabilities)
          ? manifest.capabilities.filter((item): item is string => typeof item === 'string')
          : undefined
        const description =
          typeof manifest.description === 'string' ? manifest.description : undefined

        return {
          id,
          name,
          description,
          version,
          manifestUrl,
          capabilities,
          configSchema: {
            fields: normalizeManifestConfigFields(manifest.configSchema)
          }
        }
      })
  )

  const cache = {
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    providers
  }
  settingsStore.set(PROVIDER_HUB_CACHE_KEY, cache)
  return cache
}

async function collectAgentDiagnosticContext(
  projectId: string,
  permissions: AgentAssistantPermissions
): Promise<{
  diagnostics: AgentDiagnosticContext
  workMemoryImages: Array<{ label: string; imageBase64: string }>
}> {
  const diagnostics: AgentDiagnosticContext = {
    collectedAt: Date.now(),
    liveEngineState:
      currentRunningProjectId === projectId ? actionChainEngine?.getState() : undefined,
    visualEvidence: {
      canvasCaptured: false,
      fullScreenCaptured: false,
      workMemoryScreenshotCount: 0,
      projectAssetAvailableCount: 0,
      projectAssetScreenshotCount: 0,
      projectAssetScreenshotLabels: [],
      projectAssetOmittedCount: 0
    }
  }
  const workMemoryImages: Array<{ label: string; imageBase64: string }> = []

  if (permissions.includeWorkMemory) {
    const summaries = await sessionStore.listSessions(projectId, 6)
    const sessions = (
      await Promise.all(
        summaries.slice(0, 4).map((item) => sessionStore.getSession(item.id, projectId))
      )
    )
      .filter((item): item is RunSession => item !== null)
      .map(compactRunSession)
    const cards = (await experienceStore.listCards(projectId))
      .filter((card) => card.enabled)
      .slice(0, 20)
    diagnostics.workMemory = { sessions, cards }

    for (const session of sessions) {
      for (const step of [...session.steps].reverse()) {
        if (!step.screenshotFile || workMemoryImages.length >= 2) continue
        const screenshot = await sessionStore.readScreenshot(
          projectId,
          session.id,
          step.screenshotFile
        )
        if (!screenshot) continue
        workMemoryImages.push({
          label: `运行证据：${session.chainName} / 节点 ${step.nodeId || step.stepIndex + 1}`,
          imageBase64: screenshot.toString('base64')
        })
      }
      if (workMemoryImages.length >= 2) break
    }
    diagnostics.visualEvidence.workMemoryScreenshotCount = workMemoryImages.length
  }

  if (permissions.includeChatHistory) {
    await ensureLegacyChatHistoryAssigned(projectId)
    const summaries = await chatHistoryStore.listConversations(projectId)
    diagnostics.chatHistory = (
      await Promise.all(
        summaries.slice(0, 6).map((item) => chatHistoryStore.getConversation(item.id, projectId))
      )
    )
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .map((conversation) => ({
        ...conversation,
        messages: conversation.messages.slice(-40).map((message) => ({
          ...message,
          originalText: truncateDiagnosticText(message.originalText, 2000),
          mediaDescription: truncateDiagnosticText(message.mediaDescription, 1200)
        }))
      }))
  }

  return { diagnostics, workMemoryImages }
}

// ── app.whenReady ──

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')
  await checkAndRequestPermissions()

  // 初始化数据库
  const db = initDatabase({ basePath: app.getPath('userData') })
  runMigrations(db)

  // 自动迁移旧数据
  autoMigrateData(app.getPath('userData'))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const ctx: MainContext = {
    settingsStore,
    getEngine: () => actionChainEngine,
    setEngine: (engine) => {
      actionChainEngine = engine
    },
    getCurrentSessionId: () => currentSessionId,
    setCurrentSessionId: (id) => {
      currentSessionId = id
    },
    getCurrentRunningProjectId: () => currentRunningProjectId,
    setCurrentRunningProjectId: (id) => {
      currentRunningProjectId = id
    },
    subWindows,
    actionChainWindowModes,
    activeAgentAssistantRequests,
    stopActionChainRuntime,
    registerEmergencyStopShortcut,
    unregisterEmergencyStopShortcut,
    enterCompactMode,
    exitCompactMode,
    createSubWindow,
    getCachedProviderHub,
    fetchProviderHub,
    collectAgentDiagnosticContext
  }

  registerSettingsIpc(ctx)
  registerEngineIpc(ctx)
  registerProviderIpc(ctx)
  registerActionChainIpc(ctx)
  registerAgentAssistantIpc(ctx)
  registerMemoryIpc(ctx)
  registerChatHistoryIpc()
  registerDataIpc()
  setDataManagerOpener(openDataManagerWindow)

  // ── Skill HTTP Server（远程控制接入点） ──
  const skillToken = startSkillServer(skillEngineController)
  console.log(`[Skill Server] auth token: ${skillToken}`)

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  appIsQuitting = true
  unregisterEmergencyStopShortcut()
  stopActionChainRuntime()
  releasePressedMouseButtons()
  cleanupActionChainOverlay()
  if (compactSession && !compactSession.controller.isDestroyed()) {
    compactSession.exiting = true
    compactSession.controller.destroy()
  }
  compactSession = null
  stopSkillServer()
  closeDatabase()
})

// ── Skill Engine Controller（改造为控制 ActionChain） ──

function startActionChainViaSkill(): Promise<SkillStartResult> {
  if (actionChainEngine?.getState()?.running) {
    return Promise.resolve({ ok: false, reason: 'already_running', message: '链已在运行中' })
  }
  try {
    const settings = normalizeSettings(settingsStore.store)
    if (!settings.modelProvider?.apiKey) {
      return Promise.resolve({
        ok: false,
        reason: 'no_vision_key',
        message: '请先填写视觉接口密钥'
      })
    }
    return loadProjectWorkspace().then((loadedProject) => {
      const workspace = loadedProject.workspace
      const validationError = formatValidationErrors(validateWorkspaceForRun(workspace))
      if (validationError) {
        return {
          ok: false,
          reason: 'engine_failed',
          message: `流程检查未通过：${validationError}`
        }
      }

      if (actionChainEngine) {
        actionChainEngine.stop()
      }

      actionChainEngine = new ActionChainEngine({
        onStateChange: (state) => {
          if (state.running) registerEmergencyStopShortcut()
          else unregisterEmergencyStopShortcut()
          BrowserWindow.getAllWindows().forEach((w) => {
            w.webContents.send('action-chain:state', state)
          })
        },
        onLog: (msg) => {
          BrowserWindow.getAllWindows().forEach((w) => {
            w.webContents.send('action-chain:log', msg)
          })
        },
        onStepLog: (log) => {
          BrowserWindow.getAllWindows().forEach((w) => {
            w.webContents.send('action-chain:stepLog', log)
          })
        },
        onRunEnd: () => {
          currentRunningProjectId = null
        }
      })

      currentRunningProjectId = loadedProject.projectId

      actionChainEngine.start(
        workspace,
        createTrackedVisionConfig(settings, 'action-chain-skill'),
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).scaleFactor,
        null,
        loadedProject.projectId
      )

      return { ok: true }
    })
  } catch (error: unknown) {
    return Promise.resolve({
      ok: false,
      reason: 'engine_failed',
      message: getErrorMessage(error)
    })
  }
}

function stopActionChainViaSkill(): Promise<SkillPauseResult> {
  if (!actionChainEngine?.getState()?.running) {
    return Promise.resolve({ ok: false, reason: 'not_running', message: '链未运行' })
  }
  try {
    actionChainEngine.stop()
    actionChainEngine = null
    return Promise.resolve({ ok: true })
  } catch (error: unknown) {
    return Promise.resolve({
      ok: false,
      reason: 'pause_failed',
      message: getErrorMessage(error)
    })
  }
}

const skillEngineController: SkillEngineController = {
  start: startActionChainViaSkill,
  pause: stopActionChainViaSkill,
  isRunning: () => actionChainEngine?.getState()?.running === true
}
