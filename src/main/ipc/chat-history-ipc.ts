import { ipcMain } from 'electron'
import * as chatHistoryStore from '../../core/chat-history/store'
import { ensureLegacyChatHistoryAssigned } from '../ipc-context'

export function registerChatHistoryIpc(): void {
  ipcMain.handle('chat-history:listConversations', async (_event, rawProjectId: unknown) => {
    const projectId = typeof rawProjectId === 'string' ? rawProjectId.trim() : ''
    if (!projectId) return []
    await ensureLegacyChatHistoryAssigned(projectId)
    return chatHistoryStore.listConversations(projectId)
  })

  ipcMain.handle(
    'chat-history:getConversation',
    async (_event, payload: { projectId?: string; id?: string }) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
      if (!projectId || !id) return null
      return chatHistoryStore.getConversation(id, projectId)
    }
  )

  ipcMain.handle(
    'chat-history:deleteConversation',
    async (_event, payload: { projectId?: string; id?: string }) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
      if (!projectId || !id) return false
      return chatHistoryStore.deleteConversation(id, projectId)
    }
  )
}
