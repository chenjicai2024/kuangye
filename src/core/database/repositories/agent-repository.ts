// src/core/database/repositories/agent-repository.ts
// AI 助手会话 Repository

import { BaseRepository } from './base-repository'

export interface AgentSession {
  id: string
  project_id?: string
  title?: string
  created_at: number
  updated_at: number
}

export interface AgentMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: number
}

export class AgentRepository extends BaseRepository<AgentSession> {
  private messageRepository: AgentMessageRepository

  constructor() {
    super('agent_sessions')
    this.messageRepository = new AgentMessageRepository()
  }

  /**
   * 获取消息 Repository
   */
  get messages(): AgentMessageRepository {
    return this.messageRepository
  }

  /**
   * 查找项目的所有会话
   */
  findByProjectId(projectId: string): AgentSession[] {
    const stmt = this.db.prepare(
      'SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY updated_at DESC'
    )
    return stmt.all(projectId) as AgentSession[]
  }

  /**
   * 创建会话
   */
  createSession(projectId?: string, title?: string): AgentSession {
    return this.create({
      project_id: projectId,
      title,
      created_at: Date.now(),
      updated_at: Date.now()
    } as Omit<AgentSession, 'id'>)
  }

  /**
   * 更新会话标题
   */
  updateTitle(id: string, title: string): AgentSession | null {
    return this.update(id, { title } as Partial<AgentSession>)
  }

  /**
   * 删除会话及其所有消息
   */
  deleteSession(id: string): boolean {
    // 先删除消息
    this.messageRepository.deleteBySessionId(id)
    // 再删除会话
    return this.delete(id)
  }
}

class AgentMessageRepository extends BaseRepository<AgentMessage> {
  constructor() {
    super('agent_messages')
  }

  /**
   * 查找会话的所有消息
   */
  findBySessionId(sessionId: string): AgentMessage[] {
    const stmt = this.db.prepare(
      'SELECT * FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC'
    )
    return stmt.all(sessionId) as AgentMessage[]
  }

  /**
   * 创建消息
   */
  createMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): AgentMessage {
    return this.create({
      session_id: sessionId,
      role,
      content,
      created_at: Date.now()
    } as Omit<AgentMessage, 'id'>)
  }

  /**
   * 批量创建消息
   */
  createMessages(
    sessionId: string,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): AgentMessage[] {
    const results: AgentMessage[] = []
    const insertMany = this.db.transaction(() => {
      for (const msg of messages) {
        results.push(this.createMessage(sessionId, msg.role, msg.content))
      }
    })
    insertMany()
    return results
  }

  /**
   * 删除会话的所有消息
   */
  deleteBySessionId(sessionId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM agent_messages WHERE session_id = ?')
    const result = stmt.run(sessionId)
    return result.changes > 0
  }

  /**
   * 搜索消息
   */
  search(query: string, projectId?: string): AgentMessage[] {
    if (projectId) {
      const stmt = this.db.prepare(`
        SELECT am.* FROM agent_messages am
        JOIN agent_sessions as ON am.session_id = as.id
        WHERE as.project_id = ? AND am.content LIKE ?
        ORDER BY am.created_at DESC
        LIMIT 100
      `)
      return stmt.all(projectId, `%${query}%`) as AgentMessage[]
    }

    const stmt = this.db.prepare(
      'SELECT * FROM agent_messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT 100'
    )
    return stmt.all(`%${query}%`) as AgentMessage[]
  }
}
