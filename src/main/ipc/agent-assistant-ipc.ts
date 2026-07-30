import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { loadProjectWorkspace } from '../../core/action-chain/store'
import { getErrorMessage } from '../../core/error-utils'
import { AIClient } from '../../core/ai-client'
import {
  appendAgentAssistantMessage,
  createAgentAssistantMessage,
  createAgentAssistantSession,
  deleteAgentAssistantSession,
  listAgentAssistantSessions,
  loadAgentAssistantSession,
  recordAgentAssistantFailure,
  saveAgentAssistantCheckpoint,
  updateAgentAssistantCheckpointStatus,
  updateAgentProposalStatus
} from '../../core/agent-assistant/store'
import {
  isAgentAssistantContinuation,
  orchestrateAgentAssistant
} from '../../core/agent-assistant/orchestrator'
import type {
  AgentAssistantCollaborationContext,
  AgentEditProposalStatus
} from '../../core/agent-assistant/types'
import type { AgentAssistantSendPayload } from '../../core/agent-assistant/types'
import {
  normalizeSettings,
  createTrackedVisionConfig,
  sendAgentAssistantEvent,
  captureAgentAssistantCanvas,
  normalizeAgentAssistantPermissions,
  collectAgentProjectAssetImages,
  captureCurrentDisplayBase64,
  type MainContext
} from '../ipc-context'

export function registerAgentAssistantIpc(ctx: MainContext): void {
  ipcMain.handle('agent-assistant:createSession', async (_event, projectId: string) => {
    if (typeof projectId !== 'string' || !projectId.trim()) {
      return { success: false, error: '缺少智能体 ID' }
    }
    const project = await loadProjectWorkspace(projectId)
    if (project.projectId !== projectId) return { success: false, error: '智能体不存在' }
    return { success: true, session: await createAgentAssistantSession(projectId) }
  })

  ipcMain.handle('agent-assistant:listSessions', async (_event, projectId: string) => {
    if (typeof projectId !== 'string' || !projectId.trim()) return { sessions: [] }
    return { sessions: await listAgentAssistantSessions(projectId) }
  })

  ipcMain.handle(
    'agent-assistant:loadSession',
    async (_event, payload: { projectId?: string; sessionId?: string }) => {
      if (!payload?.projectId || !payload?.sessionId) return { session: null }
      return {
        session: await loadAgentAssistantSession(payload.projectId, payload.sessionId)
      }
    }
  )

  ipcMain.handle(
    'agent-assistant:deleteSession',
    async (_event, payload: { projectId?: string; sessionId?: string }) => {
      if (!payload?.projectId || !payload?.sessionId) return { success: false }
      return {
        success: await deleteAgentAssistantSession(payload.projectId, payload.sessionId)
      }
    }
  )

  ipcMain.handle(
    'agent-assistant:updateProposalStatus',
    async (
      _event,
      payload: {
        projectId?: string
        sessionId?: string
        proposalId?: string
        status?: AgentEditProposalStatus
      }
    ) => {
      if (
        !payload?.projectId ||
        !payload.sessionId ||
        !payload.proposalId ||
        !['pending', 'applied', 'rejected', 'expired'].includes(String(payload.status))
      ) {
        return { success: false }
      }
      return {
        success: await updateAgentProposalStatus(
          payload.projectId,
          payload.sessionId,
          payload.proposalId,
          payload.status!
        )
      }
    }
  )

  ipcMain.handle('agent-assistant:send', async (event, payload: AgentAssistantSendPayload) => {
    const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
    const message = typeof payload?.message === 'string' ? payload.message.trim() : ''
    if (!projectId || !sessionId || !message || payload.context?.projectId !== projectId) {
      return { accepted: false, error: 'AI 助手请求缺少必要信息' }
    }
    const project = await loadProjectWorkspace(projectId)
    if (project.projectId !== projectId) {
      return { accepted: false, error: '当前智能体不存在' }
    }
    if (
      [...ctx.activeAgentAssistantRequests.values()].some(
        (request) => request.senderId === event.sender.id && request.sessionId === sessionId
      )
    ) {
      return { accepted: false, error: '当前会话正在生成回复' }
    }
    const session = await loadAgentAssistantSession(projectId, sessionId)
    if (!session) return { accepted: false, error: 'AI 助手会话不存在' }
    const conversationHistory = [...session.messages]
    const resumeCheckpoint = isAgentAssistantContinuation(message) ? session.checkpoint : undefined

    const requestId = randomUUID()
    const checkpointCreatedAt = Date.now()
    const checkpointRequest = resumeCheckpoint?.request || message
    const initialCollaboration: AgentAssistantCollaborationContext =
      resumeCheckpoint?.collaboration || {
        specialistReports: [],
        revisionRound: 0
      }
    const controller = new AbortController()
    const sender = event.sender
    ctx.activeAgentAssistantRequests.set(requestId, {
      controller,
      senderId: sender.id,
      sessionId
    })
    try {
      await appendAgentAssistantMessage(
        projectId,
        sessionId,
        createAgentAssistantMessage('user', message)
      )
      await saveAgentAssistantCheckpoint(projectId, sessionId, {
        requestId,
        request: checkpointRequest,
        status: 'running',
        collaboration: initialCollaboration,
        createdAt: checkpointCreatedAt,
        updatedAt: checkpointCreatedAt
      })
    } catch (error) {
      ctx.activeAgentAssistantRequests.delete(requestId)
      return { accepted: false, error: `保存 AI 助手会话失败：${getErrorMessage(error)}` }
    }

    setImmediate(() => {
      void (async () => {
        let checkpointFinished = false
        try {
          const permissions = normalizeAgentAssistantPermissions(payload.permissions)
          sendAgentAssistantEvent(sender, {
            type: 'status',
            requestId,
            sessionId,
            stage: 'preparing_context',
            message: '正在读取当前智能体与诊断上下文'
          })
          let canvasImage: string | undefined
          try {
            canvasImage = await captureAgentAssistantCanvas(sender, payload.canvasCaptureRect)
          } catch (error) {
            console.warn(
              '[agent-assistant] 画布截图失败，继续使用结构上下文:',
              getErrorMessage(error)
            )
          }
          const { diagnostics, workMemoryImages } = await ctx.collectAgentDiagnosticContext(
            projectId,
            permissions
          )
          diagnostics.visualEvidence.canvasCaptured = Boolean(canvasImage)

          let projectAssetImages: Array<{ label: string; imageBase64: string }> = []
          if (permissions.includeProjectAssets) {
            const projectAssets = await collectAgentProjectAssetImages(projectId, message, {
              ...payload.context,
              projectName: project.projectName,
              workspace: project.workspace
            })
            projectAssetImages = projectAssets.images
            diagnostics.visualEvidence.projectAssetAvailableCount = projectAssets.availableCount
            diagnostics.visualEvidence.projectAssetScreenshotCount = projectAssetImages.length
            diagnostics.visualEvidence.projectAssetScreenshotLabels = projectAssetImages.map(
              (item) => item.label
            )
            diagnostics.visualEvidence.projectAssetOmittedCount = projectAssets.omittedCount
          }

          let fullScreenImage: string | undefined
          if (permissions.captureFullScreen) {
            try {
              fullScreenImage = await captureCurrentDisplayBase64()
              diagnostics.visualEvidence.fullScreenCaptured = Boolean(fullScreenImage)
            } catch (error) {
              console.warn('[agent-assistant] 当前屏幕截图失败:', getErrorMessage(error))
            }
          }
          if (controller.signal.aborted) return

          const settings = normalizeSettings(ctx.settingsStore.store as Record<string, unknown>)
          if (!settings.modelProvider.apiKey) throw new Error('请先在设置中配置模型供应商 API Key')
          const enrichedContext = { ...payload.context, diagnostics }
          const images: Array<{ label: string; imageBase64: string }> = []
          if (canvasImage) images.push({ label: '当前智能体画布', imageBase64: canvasImage })
          images.push(...projectAssetImages)
          if (fullScreenImage) {
            images.push({ label: '用户显式授权的当前屏幕截图', imageBase64: fullScreenImage })
          }
          images.push(...workMemoryImages)
          const modelConfig = createTrackedVisionConfig(settings, 'agent-assistant')
          const response = await orchestrateAgentAssistant(
            {
              request: message,
              context: enrichedContext,
              history: conversationHistory,
              hasImages: images.length > 0,
              resume: resumeCheckpoint
                ? {
                    request: resumeCheckpoint.request,
                    collaboration: resumeCheckpoint.collaboration
                  }
                : undefined
            },
            {
              callModel: async (modelRequest) => {
                // 每个并行子智能体使用独立客户端，避免共享 finishReason 等瞬时状态。
                const client = new AIClient(modelConfig)
                const text =
                  modelRequest.includeImages && images.length > 0
                    ? await client.callTextWithImages(
                        modelRequest.userPrompt,
                        modelRequest.systemPrompt,
                        images,
                        controller.signal
                      )
                    : await client.callText(
                        modelRequest.userPrompt,
                        modelRequest.systemPrompt,
                        controller.signal
                      )
                return { text, finishReason: client.getLastFinishReason() }
              },
              onStage: (stage, stageMessage) => {
                sendAgentAssistantEvent(sender, {
                  type: 'status',
                  requestId,
                  sessionId,
                  stage,
                  message: stageMessage
                })
              },
              onCheckpoint: async (collaboration) => {
                await saveAgentAssistantCheckpoint(projectId, sessionId, {
                  requestId,
                  request: checkpointRequest,
                  status: 'running',
                  collaboration,
                  createdAt: checkpointCreatedAt,
                  updatedAt: Date.now()
                })
              },
              onFormatFailure: async (failure) => {
                try {
                  await recordAgentAssistantFailure({
                    projectId,
                    sessionId,
                    requestId,
                    attempt: failure.attempt,
                    model: settings.modelProvider.model,
                    finishReason: failure.finishReason,
                    error: `[${failure.actor}] ${getErrorMessage(failure.error)}`,
                    rawResponse: failure.rawResponse,
                    createdAt: Date.now()
                  })
                } catch (diagnosticError) {
                  console.warn(
                    '[agent-assistant] 保存格式失败诊断记录失败:',
                    getErrorMessage(diagnosticError)
                  )
                }
              }
            }
          )
          if (controller.signal.aborted) return

          const assistantMessage = createAgentAssistantMessage('assistant', response.content, {
            responseType: response.type,
            proposal: response.proposal
          })
          await appendAgentAssistantMessage(projectId, sessionId, assistantMessage)
          await updateAgentAssistantCheckpointStatus(projectId, sessionId, requestId, 'completed')
          checkpointFinished = true
          sendAgentAssistantEvent(sender, {
            type: 'status',
            requestId,
            sessionId,
            stage: 'completed',
            message: '回复已完成'
          })
          sendAgentAssistantEvent(sender, {
            type: 'message',
            requestId,
            sessionId,
            message: assistantMessage
          })
        } catch (error) {
          if (!controller.signal.aborted) {
            try {
              await updateAgentAssistantCheckpointStatus(
                projectId,
                sessionId,
                requestId,
                'failed',
                getErrorMessage(error)
              )
            } catch {
              /* checkpoint 写入失败不应阻止清理和通知 */
            }
            checkpointFinished = true
            sendAgentAssistantEvent(sender, {
              type: 'error',
              requestId,
              sessionId,
              error: getErrorMessage(error)
            })
          }
        } finally {
          if (!checkpointFinished) {
            try {
              await updateAgentAssistantCheckpointStatus(
                projectId,
                sessionId,
                requestId,
                controller.signal.aborted ? 'cancelled' : 'interrupted'
              )
            } catch {
              /* checkpoint 写入失败不应阻止清理和通知 */
            }
          }
          ctx.activeAgentAssistantRequests.delete(requestId)
          sendAgentAssistantEvent(sender, { type: 'done', requestId, sessionId })
        }
      })()
    })

    return { accepted: true, requestId }
  })

  ipcMain.handle('agent-assistant:cancel', async (event, payload: { requestId?: string }) => {
    const request = payload?.requestId
      ? ctx.activeAgentAssistantRequests.get(payload.requestId)
      : undefined
    if (!request || request.senderId !== event.sender.id) return { success: false }
    request.controller.abort()
    return { success: true }
  })
}
