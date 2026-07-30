// src/core/database/adapters/chat-adapter.ts
// 聊天记录双写适配器

import { ChatRepository } from '../repositories/chat-repository'
import { dualWrite, dualRead, getDualWriteConfig } from '../dual-write'

let _repo: ChatRepository | null = null

function getRepo(): ChatRepository {
  if (!_repo) {
    _repo = new ChatRepository()
  }
  return _repo
}

/**
 * 追加聊天快照（双写）
 */
export async function appendChatSnapshot(
  projectId: string,
  snapshot: {
    conversationTitle: string
    conversationType: string
    participants?: string[]
    messages: Array<{
      senderName: string
      senderRole: string
      contentKind: string
      originalText?: string
      mediaDescription?: string
      visibleTime?: string
    }>
  },
  jsonWriter: () => Promise<{ addedCount: number }>
): Promise<{ addedCount: number }> {
  const config = getDualWriteConfig()

  return dualWrite(
    jsonWriter,
    async () => {
      const repo = getRepo()

      // 查找或创建会话
      let conversation = repo.findByTitle(projectId, snapshot.conversationTitle)
      if (!conversation) {
        conversation = repo.createConversation(
          projectId,
          snapshot.conversationTitle,
          snapshot.conversationType as 'direct' | 'group' | 'unknown',
          snapshot.participants
        )
      }

      // 批量创建消息
      const messages = snapshot.messages.map((msg) => ({
        senderName: msg.senderName,
        senderRole: msg.senderRole as 'self' | 'peer' | 'member' | 'system' | 'unknown',
        contentKind: msg.contentKind,
        originalText: msg.originalText,
        mediaDescription: msg.mediaDescription,
        visibleTime: msg.visibleTime,
        recordSource: 'vision_snapshot' as const
      }))

      repo.messages.createMessages(conversation.id, messages)

      // 更新会话时间
      repo.updateLastCapturedAt(conversation.id)

      return { addedCount: messages.length }
    },
    { enableDatabase: config.enableDatabase }
  )
}

/**
 * 追加发出的消息（双写）
 */
export async function appendOutgoingMessage(
  conversationId: string,
  text: string,
  jsonWriter: () => Promise<void>
): Promise<void> {
  const config = getDualWriteConfig()

  await dualWrite(
    jsonWriter,
    async () => {
      const repo = getRepo()

      repo.messages.createMessage(conversationId, {
        senderName: '我',
        senderRole: 'self',
        contentKind: 'text',
        originalText: text,
        recordSource: 'local_reply'
      })

      repo.updateLastCapturedAt(conversationId)
    },
    { enableDatabase: config.enableDatabase }
  )
}

/**
 * 列出会话
 */
export async function listConversations(
  projectId: string,
  jsonReader: () => Promise<Array<{ id: string; conversationTitle: string }>>
): Promise<Array<{ id: string; conversationTitle: string }>> {
  return dualRead(jsonReader, async () => {
    const repo = getRepo()
    return repo.findByProjectId(projectId).map((c) => ({
      id: c.id,
      conversationTitle: c.title
    }))
  })
}

/**
 * 获取会话详情
 */
export async function getConversation(
  conversationId: string,
  jsonReader: () => Promise<unknown>
): Promise<unknown> {
  return dualRead(jsonReader, async () => {
    const repo = getRepo()
    return repo.findById(conversationId)
  })
}
