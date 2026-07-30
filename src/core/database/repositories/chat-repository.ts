// src/core/database/repositories/chat-repository.ts
// 聊天记录 Repository

import { BaseRepository } from './base-repository'

export interface ChatConversation {
  id: string
  project_id?: string
  title: string
  conversation_type: 'direct' | 'group' | 'unknown'
  participants?: string // JSON array
  first_captured_at: number
  last_captured_at: number
}

export interface ChatMessage {
  id: string
  conversation_id: string
  sender_name?: string
  sender_role?: 'self' | 'peer' | 'member' | 'system' | 'unknown'
  content_kind: string
  original_text?: string
  media_description?: string
  visible_time?: string
  record_source?: string
  captured_at: number
}

export class ChatRepository extends BaseRepository<ChatConversation> {
  private messageRepository: MessageRepository

  constructor() {
    super('chat_conversations')
    this.messageRepository = new MessageRepository()
  }

  /**
   * 获取消息 Repository
   */
  get messages(): MessageRepository {
    return this.messageRepository
  }

  /**
   * 查找项目的所有会话
   */
  findByProjectId(projectId: string): ChatConversation[] {
    const stmt = this.db.prepare(
      'SELECT * FROM chat_conversations WHERE project_id = ? ORDER BY last_captured_at DESC'
    )
    return stmt.all(projectId) as ChatConversation[]
  }

  /**
   * 按标题查找会话
   */
  findByTitle(projectId: string, title: string): ChatConversation | null {
    const stmt = this.db.prepare(
      'SELECT * FROM chat_conversations WHERE project_id = ? AND title = ?'
    )
    return stmt.get(projectId, title) as ChatConversation | null
  }

  /**
   * 创建会话
   */
  createConversation(
    projectId: string,
    title: string,
    type: 'direct' | 'group' | 'unknown' = 'unknown',
    participants?: string[]
  ): ChatConversation {
    return this.create({
      project_id: projectId,
      title,
      conversation_type: type,
      participants: participants ? JSON.stringify(participants) : undefined,
      first_captured_at: Date.now(),
      last_captured_at: Date.now()
    } as Omit<ChatConversation, 'id'>)
  }

  /**
   * 获取参与者列表
   */
  getParticipants(id: string): string[] {
    const conversation = this.findById(id)
    if (!conversation?.participants) return []
    try {
      return JSON.parse(conversation.participants)
    } catch {
      return []
    }
  }

  /**
   * 更新最后捕获时间
   */
  updateLastCapturedAt(id: string): ChatConversation | null {
    return this.update(id, { last_captured_at: Date.now() } as Partial<ChatConversation>)
  }

  /**
   * 删除会话及其所有消息
   */
  deleteConversation(id: string): boolean {
    // 先删除消息
    this.messageRepository.deleteByConversationId(id)
    // 再删除会话
    return this.delete(id)
  }
}

class MessageRepository extends BaseRepository<ChatMessage> {
  constructor() {
    super('chat_messages')
  }

  /**
   * 查找会话的所有消息
   */
  findByConversationId(conversationId: string): ChatMessage[] {
    const stmt = this.db.prepare(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY captured_at ASC'
    )
    return stmt.all(conversationId) as ChatMessage[]
  }

  /**
   * 创建消息
   */
  createMessage(
    conversationId: string,
    data: {
      senderName?: string
      senderRole?: 'self' | 'peer' | 'member' | 'system' | 'unknown'
      contentKind: string
      originalText?: string
      mediaDescription?: string
      visibleTime?: string
      recordSource?: string
    }
  ): ChatMessage {
    return this.create({
      conversation_id: conversationId,
      sender_name: data.senderName,
      sender_role: data.senderRole,
      content_kind: data.contentKind,
      original_text: data.originalText,
      media_description: data.mediaDescription,
      visible_time: data.visibleTime,
      record_source: data.recordSource,
      captured_at: Date.now()
    } as Omit<ChatMessage, 'id'>)
  }

  /**
   * 批量创建消息
   */
  createMessages(
    conversationId: string,
    messages: Array<{
      senderName?: string
      senderRole?: 'self' | 'peer' | 'member' | 'system' | 'unknown'
      contentKind: string
      originalText?: string
      mediaDescription?: string
      visibleTime?: string
      recordSource?: string
    }>
  ): ChatMessage[] {
    const results: ChatMessage[] = []
    const insertMany = this.db.transaction(() => {
      for (const msg of messages) {
        results.push(this.createMessage(conversationId, msg))
      }
    })
    insertMany()
    return results
  }

  /**
   * 删除会话的所有消息
   */
  deleteByConversationId(conversationId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?')
    const result = stmt.run(conversationId)
    return result.changes > 0
  }

  /**
   * 搜索消息
   */
  search(query: string, projectId?: string): ChatMessage[] {
    if (projectId) {
      const stmt = this.db.prepare(`
        SELECT cm.* FROM chat_messages cm
        JOIN chat_conversations cc ON cm.conversation_id = cc.id
        WHERE cc.project_id = ? AND (cm.original_text LIKE ? OR cm.media_description LIKE ?)
        ORDER BY cm.captured_at DESC
        LIMIT 100
      `)
      return stmt.all(projectId, `%${query}%`, `%${query}%`) as ChatMessage[]
    }

    const stmt = this.db.prepare(
      'SELECT * FROM chat_messages WHERE original_text LIKE ? OR media_description LIKE ? ORDER BY captured_at DESC LIMIT 100'
    )
    return stmt.all(`%${query}%`, `%${query}%`) as ChatMessage[]
  }
}
