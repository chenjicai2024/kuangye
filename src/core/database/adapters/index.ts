// src/core/database/adapters/index.ts
// 双写适配器导出

export {
  saveProject,
  loadProject,
  listProjects,
  deleteProject
} from './project-adapter'

export {
  appendChatSnapshot,
  appendOutgoingMessage,
  listConversations,
  getConversation
} from './chat-adapter'

export {
  createExperienceCard,
  incrementCardUsage,
  setCardEnabled,
  listExperienceCards,
  searchExperienceCards
} from './experience-adapter'
