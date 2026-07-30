// src/core/database/index.ts
// 通用数据库模块导出

export { initDatabase, getDatabase, closeDatabase, getDatabaseConfig } from './connection'
export type { DatabaseConfig } from './connection'
export { runMigrations } from './migrations'

// Repository 导出
export { BaseRepository } from './repositories/base-repository'
export { ProjectRepository } from './repositories/project-repository'
export type { Project } from './repositories/project-repository'
export { ExecutionRepository } from './repositories/execution-repository'
export type { Execution, ExecutionStep } from './repositories/execution-repository'
export { ChatRepository } from './repositories/chat-repository'
export type { ChatConversation, ChatMessage } from './repositories/chat-repository'
export { ExperienceRepository } from './repositories/experience-repository'
export type { ExperienceCard } from './repositories/experience-repository'
export { AgentRepository } from './repositories/agent-repository'
export type { AgentSession, AgentMessage } from './repositories/agent-repository'

// 双写模式管理
export {
  getDualWriteConfig,
  setDualWriteConfig,
  resetDualWriteConfig
} from './dual-write'
export type { DualWriteConfig } from './dual-write'

// 双写适配器
export * from './adapters'
