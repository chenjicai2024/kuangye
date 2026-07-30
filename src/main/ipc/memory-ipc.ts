import { ipcMain } from 'electron'
import { isRecord } from '../../core/error-utils'
import * as sessionStore from '../../core/work-memory/session-store'
import * as experienceStore from '../../core/work-memory/experience-store'
import { loadProjectsStore } from '../../core/action-chain/store'
import { ensureLegacyCardsAssigned, type MainContext } from '../ipc-context'

export function registerMemoryIpc(ctx: MainContext): void {
  ipcMain.handle('workmemory:open', async (_event, rawProjectId: unknown) => {
    const projectId = typeof rawProjectId === 'string' ? rawProjectId.trim() : ''
    if (!projectId) return { success: false, error: '请选择一个智能体' }
    const projectsStore = await loadProjectsStore()
    const project = projectsStore.projects.find((item) => item.id === projectId)
    if (!project) return { success: false, error: '智能体不存在' }
    ctx.createSubWindow(`workmemory-${projectId}`, {
      windowKind: 'workmemory',
      width: 900,
      height: 700,
      minWidth: 700,
      minHeight: 500,
      query: { projectId, projectName: project.name }
    })
    return { success: true }
  })

  // ── 工作记忆 IPC ──
  ipcMain.handle('memory:listSessions', async (_event, rawProjectId: unknown) => {
    const projectId = typeof rawProjectId === 'string' ? rawProjectId.trim() : ''
    if (!projectId) return []
    return sessionStore.listSessions(projectId)
  })

  ipcMain.handle(
    'memory:getSession',
    async (_event, payload: { projectId?: string; sessionId?: string }) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
      if (!projectId || !sessionId) return null
      return sessionStore.getSession(sessionId, projectId)
    }
  )

  ipcMain.handle(
    'memory:getScreenshot',
    async (_event, payload: { projectId?: string; sessionId?: string; fileName?: string }) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
      const fileName = typeof payload?.fileName === 'string' ? payload.fileName.trim() : ''
      if (!projectId || !sessionId || !fileName) return null
      const screenshot = await sessionStore.readScreenshot(projectId, sessionId, fileName)
      return screenshot ? `data:image/png;base64,${screenshot.toString('base64')}` : null
    }
  )

  ipcMain.handle(
    'memory:deleteSession',
    async (_event, payload: { projectId?: string; sessionId?: string }) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
      if (!projectId || !sessionId) return false
      return sessionStore.deleteSession(projectId, sessionId)
    }
  )

  ipcMain.handle(
    'memory:cleanupSessions',
    async (_event, payload: { projectId?: string; keepCount?: number }) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      if (!projectId) return 0
      return sessionStore.cleanupOldSessions(projectId, payload.keepCount)
    }
  )

  ipcMain.handle('memory:listCards', async (_event, rawProjectId: unknown) => {
    const projectId = typeof rawProjectId === 'string' ? rawProjectId.trim() : ''
    if (!projectId) return []
    await ensureLegacyCardsAssigned(projectId)
    return experienceStore.listCards(projectId)
  })

  ipcMain.handle('memory:addCard', async (_event, input: unknown) => {
    if (!isRecord(input) || typeof input.projectId !== 'string' || !input.projectId.trim()) {
      return null
    }
    return experienceStore.addCard(input as Parameters<typeof experienceStore.addCard>[0])
  })

  ipcMain.handle(
    'memory:updateCard',
    async (
      _event,
      payload: { projectId?: string; id?: string; patch?: Record<string, unknown> }
    ) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
      if (!projectId || !id) return false
      return experienceStore.updateCard(
        projectId,
        id,
        (payload.patch ?? {}) as Parameters<typeof experienceStore.updateCard>[2]
      )
    }
  )

  ipcMain.handle(
    'memory:deleteCard',
    async (_event, payload: { projectId?: string; id?: string }) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
      if (!projectId || !id) return false
      return experienceStore.deleteCard(projectId, id)
    }
  )

  ipcMain.handle(
    'memory:setCardEnabled',
    async (_event, payload: { projectId?: string; id?: string; enabled?: boolean }) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
      if (!projectId || !id || typeof payload.enabled !== 'boolean') return false
      return experienceStore.setEnabled(projectId, id, payload.enabled)
    }
  )

  ipcMain.handle(
    'memory:extractFromSession',
    async (_event, payload: { projectId?: string; sessionId?: string }) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
      if (!projectId || !sessionId) {
        return { success: false, error: '工作记忆请求缺少智能体信息' }
      }
      // 从会话中提取经验卡片
      const session = await sessionStore.getSession(sessionId, projectId)
      if (!session || session.status !== 'success') {
        return { success: false, error: '会话不存在或未成功完成' }
      }

      // 提取成功的步骤序列
      const successSteps = session.steps.filter((s) => s.status === 'success')
      if (successSteps.length === 0) {
        return { success: false, error: '没有成功的步骤可提取' }
      }

      // 生成当前智能体专属的经验卡片
      const scenario = `执行链 "${session.chainName}" 的成功模式`
      const guidance = successSteps.map((s) => s.message).join(' -> ')

      const card = await experienceStore.addCard({
        projectId,
        source: 'auto_extract',
        scenario,
        guidance,
        rationale: `从会话 ${session.id} 提取，共 ${successSteps.length} 个成功步骤`,
        sourceSessionId: session.id,
        sourceNodeIds: successSteps.map((s) => s.nodeId)
      })

      return { success: true, card }
    }
  )
}
