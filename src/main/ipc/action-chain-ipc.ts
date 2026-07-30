import { BrowserWindow, ipcMain, shell, dialog, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { randomUUID } from 'node:crypto'
import {
  icon,
  normalizeSettings,
  createTrackedVisionConfig,
  focusWindowContents,
  bindWindowContentFocus,
  type CompactModePayload,
  type MainContext
} from '../ipc-context'
import { ActionChainEngine, type ActionChainRunTarget } from '../../core/action-chain/engine'
import {
  loadWorkspace,
  saveWorkspace,
  loadProjectWorkspace,
  loadProjectsStore,
  createProject,
  renameProject,
  deleteProject,
  selectProject,
  updateProjectWorkspace
} from '../../core/action-chain/store'
import { type WindowAnchor, type Workspace } from '../../core/action-chain/types'
import { formatValidationErrors, validateWorkspaceForRun } from '../../core/action-chain/validation'
import {
  exportProjectToTemplate,
  importTemplateToProject,
  writeTemplateFile,
  readTemplateFile
} from '../../core/action-chain/template-pack'
import { runActionChainOverlay } from '../action-chain-overlay'
import { getErrorMessage } from '../../core/error-utils'
import { detectTaskbarRegion } from '../../core/rpa/screenshot-utils'
import * as sessionStore from '../../core/work-memory/session-store'
import type { ActionTraceEvent, RunStep } from '../../core/work-memory/types'
import { ExecutionRepository } from '../../core/database'

const executionRepo = new ExecutionRepository()

export function registerActionChainIpc(ctx: MainContext): void {
  // ── 动作链编辑器 ──

  ipcMain.handle('action-chain:open', async (_event, projectId?: string) => {
    const kind = projectId ? `actionchain-${projectId}` : 'actionchain-projects'
    const existing = ctx.subWindows.get(kind)
    if (existing && !existing.isDestroyed()) {
      focusWindowContents(existing)
      return { success: true }
    }
    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 900,
      minHeight: 600,
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
    ctx.subWindows.set(kind, win)
    win.on('ready-to-show', () => focusWindowContents(win))
    win.on('closed', () => {
      ctx.subWindows.delete(kind)
      BrowserWindow.getAllWindows().forEach((w) => {
        w.webContents.send('action-chain:editorClosed')
      })
    })
    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })
    const query: Record<string, string> = { window: 'actionchain' }
    if (projectId) {
      query.projectId = projectId
    } else {
      query.projects = '1'
    }
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const url = new URL(`${process.env['ELECTRON_RENDERER_URL']}`)
      url.searchParams.set('window', 'actionchain')
      if (projectId) url.searchParams.set('projectId', projectId)
      else url.searchParams.set('projects', '1')
      win.loadURL(url.toString())
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { query })
    }
    return { success: true }
  })

  ipcMain.handle(
    'action-chain:resize',
    async (
      event,
      size: { width: number; height: number; minWidth?: number; minHeight?: number }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
      if (win) {
        win.setMinimumSize(
          size.minWidth ?? Math.min(size.width, 360),
          size.minHeight ?? Math.min(size.height, 720)
        )
        win.setSize(size.width, size.height)
        win.center()
      }
      return { success: true }
    }
  )

  ipcMain.handle('action-chain:setWindowMode', async (event, mode: 'run' | 'settings') => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false }
    ctx.actionChainWindowModes.set(win.id, mode === 'settings' ? 'settings' : 'run')
    return { success: true }
  })

  ipcMain.handle(
    'action-chain:openOverlay',
    async (
      event,
      payload?: {
        projectId?: string
        projectName?: string
        windowAnchors?: WindowAnchor[]
        views?: Array<{
          name: string
          regions: Array<{
            name: string
            rect: { x: number; y: number; width: number; height: number }
            coordinateMode?: 'screen' | 'window'
            windowAnchorId?: string
            templateImagePath?: string
            templateScaleFactor?: number
          }>
        }>
        existingRegions?: Array<{
          name: string
          rect: { x: number; y: number; width: number; height: number }
          coordinateMode?: 'screen' | 'window'
          windowAnchorId?: string
          templateImagePath?: string
          templateScaleFactor?: number
        }>
      }
    ) => {
      const settings = normalizeSettings(ctx.settingsStore.store as Record<string, unknown>)
      const callerWindow =
        BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()

      const result = await runActionChainOverlay(
        {
          apiKey: settings.modelProvider.apiKey || undefined,
          model: settings.modelProvider.model,
          baseURL: settings.modelProvider.baseURL,
          projectId: payload?.projectId,
          projectName: payload?.projectName,
          windowAnchors: payload?.windowAnchors,
          views: payload?.views,
          existingRegions: payload?.existingRegions
        },
        callerWindow
      )

      if (result.ok && result.views) {
        return {
          ok: true,
          windowAnchors: result.windowAnchors ?? [],
          views: result.views.map((v) => ({
            name: v.name,
            regions: v.regions.map((r) => ({
              name: r.name,
              rect: r.rect,
              coordinateMode: r.coordinateMode ?? 'screen',
              windowAnchorId: r.windowAnchorId,
              templateImagePath: r.templateImagePath,
              templateScaleFactor: r.templateScaleFactor
            }))
          }))
        }
      }
      return { ok: false }
    }
  )

  ipcMain.handle('action-chain:listProjects', async () => {
    const store = await loadProjectsStore()
    return { projects: store.projects, lastSelectedProjectId: store.lastSelectedProjectId }
  })

  ipcMain.handle('action-chain:createProject', async (_event, name: string) => {
    const project = await createProject(typeof name === 'string' ? name : '未命名项目')
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('action-chain:projectsChanged'))
    return { success: true, project }
  })

  ipcMain.handle(
    'action-chain:renameProject',
    async (_event, { id, name }: { id: string; name: string }) => {
      const project = await renameProject(id, name)
      return { success: !!project, project }
    }
  )

  ipcMain.handle('action-chain:deleteProject', async (_event, id: string) => {
    const ok = await deleteProject(id)
    if (ok) {
      const projectWindow = ctx.subWindows.get(`actionchain-${id}`)
      if (projectWindow && !projectWindow.isDestroyed()) projectWindow.close()
      const memoryWindow = ctx.subWindows.get(`workmemory-${id}`)
      if (memoryWindow && !memoryWindow.isDestroyed()) memoryWindow.close()
      BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('action-chain:projectsChanged'))
    }
    return { success: ok }
  })

  ipcMain.handle('action-chain:selectProject', async (_event, id: string) => {
    const ok = await selectProject(id)
    return { success: ok }
  })

  // 导出模板：弹出保存对话框，将项目定义 + 截图打包为 JSON
  ipcMain.handle('template:export', async (_event, projectId: string) => {
    const store = await loadProjectsStore()
    const project = store.projects.find((p) => p.id === projectId)
    if (!project) return { success: false, error: '找不到智能体' }

    const template = await exportProjectToTemplate(project)
    const defaultName = `${project.name}.template.json`
    const result = await dialog.showSaveDialog({
      title: '导出智能体模板',
      defaultPath: defaultName,
      filters: [{ name: '智能体模板', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    await writeTemplateFile(result.filePath, template)
    return { success: true }
  })

  // 导入模板：弹出打开对话框，读取 JSON，截图存本地，覆盖目标项目 workspace
  ipcMain.handle(
    'template:import',
    async (_event, { projectId }: { projectId: string }) => {
      const store = await loadProjectsStore()
      const project = store.projects.find((p) => p.id === projectId)
      if (!project) return { success: false, error: '找不到智能体' }

      const result = await dialog.showOpenDialog({
        title: '导入智能体模板',
        properties: ['openFile'],
        filters: [{ name: '智能体模板', extensions: ['json'] }]
      })
      if (result.canceled || result.filePaths.length === 0)
        return { success: false, canceled: true }

      try {
        const template = await readTemplateFile(result.filePaths[0])
        const workspace = await importTemplateToProject(projectId, template)
        const updated = await updateProjectWorkspace(projectId, workspace)
        return { success: true, project: updated }
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('action-chain:getProjectChains', async (_event, projectId: string) => {
    const store = await loadProjectsStore()
    const project = store.projects.find((p) => p.id === projectId)
    if (!project) return { chains: [] }
    const chains: Array<{
      id: string
      name: string
      kind: 'actionChain' | 'executionChain'
      nodes: number
    }> = [
      ...(project.workspace.chains ?? []).map((c) => ({
        id: c.id ?? '',
        name: c.name,
        kind: 'actionChain' as const,
        nodes: c.nodes?.length ?? 0
      })),
      ...(project.workspace.executionChains ?? []).map((c) => ({
        id: c.id ?? '',
        name: c.name,
        kind: 'executionChain' as const,
        nodes: c.nodes?.length ?? 0
      }))
    ]
    return { chains }
  })

  ipcMain.handle('action-chain:loadProjectWorkspace', async (_event, projectId?: string) => {
    return loadProjectWorkspace(projectId)
  })

  ipcMain.handle('action-chain:load', async () => {
    return loadWorkspace()
  })

  ipcMain.handle(
    'action-chain:save',
    async (_event, payload: { projectId?: string; workspace: Workspace }) => {
      if (!payload?.projectId) {
        console.error('[action-chain:save] 缺少 projectId，拒绝保存')
        return { success: false, error: 'missing projectId' }
      }
      const project = await saveWorkspace(payload.workspace, payload.projectId)
      if (!project) {
        return { success: false, error: 'project not found' }
      }
      return { success: true }
    }
  )

  ipcMain.handle('action-chain:enterCompactMode', async (event, payload?: CompactModePayload) => {
    const origin = BrowserWindow.fromWebContents(event.sender)
    const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
    const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : ''
    const chainName = typeof payload?.chainName === 'string' ? payload.chainName.trim() : ''
    const targetType = payload?.targetType
    if (
      !origin ||
      !projectId ||
      !targetId ||
      !chainName ||
      (targetType !== 'executionChain' && targetType !== 'actionChain')
    ) {
      return { success: false, error: '悬浮运行目标无效' }
    }
    return ctx.enterCompactMode(origin, { projectId, targetId, targetType, chainName })
  })

  ipcMain.handle('action-chain:exitCompactMode', async () => {
    await ctx.exitCompactMode()
    return { success: true }
  })

  ipcMain.handle('action-chain:detectTaskbar', async () => {
    return detectTaskbarRegion()
  })

  ipcMain.handle(
    'action-chain:editRegion',
    async (
      _event,
      payload: {
        projectId?: string
        projectName?: string
        windowAnchors?: WindowAnchor[]
        regionName: string
        regionRect: { x: number; y: number; width: number; height: number }
      }
    ) => {
      const settings = normalizeSettings(ctx.settingsStore.store as Record<string, unknown>)
      const callerWindow =
        BrowserWindow.fromWebContents(_event.sender) ?? BrowserWindow.getFocusedWindow()

      const result = await runActionChainOverlay(
        {
          apiKey: settings.modelProvider.apiKey || undefined,
          model: settings.modelProvider.model,
          baseURL: settings.modelProvider.baseURL,
          projectId: payload.projectId,
          projectName: payload.projectName,
          windowAnchors: payload.windowAnchors,
          views: [
            {
              name: '编辑区域',
              regions: [
                {
                  name: payload.regionName,
                  rect: payload.regionRect,
                  coordinateMode: 'screen'
                }
              ]
            }
          ]
        },
        callerWindow
      )

      if (result.ok && result.views) {
        const editedRegion = result.views[0]?.regions.find(
          (r) => r.name === payload.regionName
        )
        if (editedRegion) {
          return { ok: true, rect: editedRegion.rect }
        }
      }
      return { ok: false }
    }
  )

  ipcMain.handle('action-chain:start', async (_event, target?: ActionChainRunTarget) => {
    const settings = normalizeSettings(ctx.settingsStore.store as Record<string, unknown>)
    if (!settings.modelProvider?.apiKey) {
      return { success: false, error: '缺少视觉 API Key' }
    }
    const requestedProjectId =
      typeof target?.projectId === 'string' && target.projectId.trim()
        ? target.projectId.trim()
        : undefined
    const loadedProject = await loadProjectWorkspace(requestedProjectId)
    if (requestedProjectId && loadedProject.projectId !== requestedProjectId) {
      return { success: false, error: '指定项目不存在' }
    }
    const workspace = loadedProject.workspace
    const allChains = [...(workspace.executionChains ?? []), ...(workspace.chains ?? [])]
    if (allChains.length === 0) {
      return { success: false, error: '没有可执行的链' }
    }
    const runTarget =
      target &&
      (target.targetType === 'executionChain' || target.targetType === 'actionChain') &&
      typeof target.targetId === 'string' &&
      target.targetId.trim()
        ? target
        : null
    if (runTarget) {
      const targetChains =
        runTarget.targetType === 'executionChain'
          ? (workspace.executionChains ?? [])
          : (workspace.chains ?? [])
      if (!targetChains.some((chain) => chain.id === runTarget.targetId)) {
        return { success: false, error: '指定链不存在' }
      }
    }
    const validationIssues = validateWorkspaceForRun(workspace, runTarget)
    const validationError = formatValidationErrors(validationIssues)
    if (validationError) {
      return { success: false, error: `流程检查未通过：${validationError}` }
    }

    const existingEngine = ctx.getEngine()
    if (existingEngine) {
      existingEngine.stop()
    }

    // 必须先创建会话再启动引擎，避免最前面的步骤日志丢失。
    const chainId = runTarget?.targetId || 'default'
    const chain = allChains.find((c) => c.id === chainId)
    const chainName = chain?.name || '默认链'
    const chainType = runTarget?.targetType || 'actionChain'
    const totalSteps = chain?.nodes?.length || 0
    const session = await sessionStore.startSession(
      loadedProject.projectId,
      chainId,
      chainName,
      chainType,
      totalSteps
    )
    ctx.setCurrentSessionId(session.id)
    ctx.setCurrentRunningProjectId(loadedProject.projectId)

    try {
      executionRepo.createExecutionWithId(session.id, loadedProject.projectId, chainId)
    } catch (err) {
      console.error('[DB] 创建执行记录失败:', getErrorMessage(err))
    }

    const recordTraceEvent = async (event: ActionTraceEvent): Promise<void> => {
      const sessionId = ctx.getCurrentSessionId()
      if (!sessionId) return
      let screenshotFile: string | undefined
      if (event.screenshotBase64) {
        screenshotFile = await sessionStore.saveScreenshot(sessionId, event.screenshotBase64)
      }
      const step: RunStep = {
        id: randomUUID(),
        kind: event.kind,
        phase: event.phase,
        stepIndex: event.stepIndex,
        nodeId: event.nodeId,
        stepType: event.stepType,
        status: 'success',
        message: event.message,
        detail: event.detail,
        startedAt: Date.now(),
        variables: event.variables,
        screenshotFile,
        region: event.region,
        ai: event.ai,
        action: event.action
      }
      await sessionStore.recordStep(sessionId, step)
    }

    const engine = new ActionChainEngine({
      onStateChange: (state) => {
        if (state.running) ctx.registerEmergencyStopShortcut()
        else ctx.unregisterEmergencyStopShortcut()
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
        // 记录到工作记忆
        const sessionId = ctx.getCurrentSessionId()
        if (sessionId) {
          void sessionStore.recordStep(sessionId, {
            id: randomUUID(),
            kind: 'step',
            phase: log.status === 'running' ? 'observe' : 'verify',
            stepIndex: log.stepIndex,
            nodeId: log.nodeId || '',
            stepType: log.stepType,
            status: log.status,
            message: log.message,
            detail: log.detail,
            startedAt: Date.now(),
            elapsedMs: log.elapsedMs
          })
          if (log.status !== 'running') {
            try {
              executionRepo.recordStep(sessionId, {
                stepIndex: log.stepIndex,
                stepType: log.stepType,
                status: log.status,
                message: log.message,
                detail: log.detail,
                durationMs: log.elapsedMs
              })
            } catch (err) {
              console.error('[DB] 记录步骤失败:', getErrorMessage(err))
            }
          }
        }
      },
      onTrace: recordTraceEvent,
      onRunEnd: async (status) => {
        const sessionId = ctx.getCurrentSessionId()
        ctx.setCurrentRunningProjectId(null)
        if (!sessionId) return
        try {
          executionRepo.finishExecution(
            sessionId,
            status === 'success' ? 'completed' : 'failed'
          )
        } catch (err) {
          console.error('[DB] 结束执行记录失败:', getErrorMessage(err))
        }
        ctx.setCurrentSessionId(null)
        await sessionStore.endSession(sessionId, status)
      }
    })

    ctx.setEngine(engine)

    engine.start(
      workspace,
      createTrackedVisionConfig(settings, 'action-chain'),
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).scaleFactor,
      runTarget,
      loadedProject.projectId
    )

    return { success: true }
  })

  ipcMain.handle('action-chain:stop', async () => {
    ctx.stopActionChainRuntime()
    return { success: true }
  })
}
