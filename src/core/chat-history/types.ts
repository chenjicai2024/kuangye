export type ChatConversationType = 'direct' | 'group' | 'unknown'
export type ChatSenderRole = 'self' | 'peer' | 'member' | 'system' | 'unknown'
export type ChatContentKind =
  | 'text'
  | 'image'
  | 'video'
  | 'sticker'
  | 'voice'
  | 'file'
  | 'link'
  | 'location'
  | 'system'
  | 'unknown'

export interface ExtractedChatMessage {
  senderName: string
  senderRole: ChatSenderRole
  contentKind: ChatContentKind
  originalText?: string
  mediaDescription?: string
  descriptionSource?: 'vision_model'
  visibleTime?: string
  confidence?: number
}

export interface ChatSnapshot {
  conversationTitle: string
  conversationType: ChatConversationType
  participants?: string[]
  messages: ExtractedChatMessage[]
}

export interface ChatMessage extends ExtractedChatMessage {
  id: string
  capturedAt: number
  recordSource: 'vision_snapshot' | 'local_reply' | 'legacy_unlabeled'
}

export interface ChatConversation {
  id: string
  projectId?: string
  conversationTitle: string
  conversationType: ChatConversationType
  participants?: string[]
  messages: ChatMessage[]
  firstCapturedAt: number
  lastCapturedAt: number
}

export interface ChatConversationRef {
  id: string
  projectId?: string
  conversationTitle: string
  conversationType: ChatConversationType
}

export interface ChatHistorySummary extends ChatConversationRef {
  messageCount: number
  firstCapturedAt: number
  lastCapturedAt: number
}
