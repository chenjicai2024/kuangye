import type {
  ChatContentKind,
  ChatConversationType,
  ChatSenderRole,
  ChatSnapshot,
  ExtractedChatMessage
} from './types'

const CONVERSATION_TYPES = new Set<ChatConversationType>(['direct', 'group', 'unknown'])
const SENDER_ROLES = new Set<ChatSenderRole>(['self', 'peer', 'member', 'system', 'unknown'])
const CONTENT_KINDS = new Set<ChatContentKind>([
  'text',
  'image',
  'video',
  'sticker',
  'voice',
  'file',
  'link',
  'location',
  'system',
  'unknown'
])

function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T): T {
  return typeof value === 'string' && values.has(value as T) ? (value as T) : fallback
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result || undefined
}

function parseMessage(value: unknown): ExtractedChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const contentKind = enumValue(item.contentKind, CONTENT_KINDS, 'unknown')
  const originalText = optionalString(item.originalText)
  const mediaDescription = optionalString(item.mediaDescription)
  if (contentKind === 'text' && !originalText) return null
  if (contentKind === 'system' && !originalText) return null
  if (contentKind !== 'text' && contentKind !== 'system' && !mediaDescription) return null
  const textual = contentKind === 'text' || contentKind === 'system'
  return {
    senderName: optionalString(item.senderName) ?? '未知发送者',
    senderRole: enumValue(item.senderRole, SENDER_ROLES, 'unknown'),
    contentKind,
    originalText: textual ? originalText : undefined,
    mediaDescription: textual ? undefined : mediaDescription,
    descriptionSource: !textual && mediaDescription ? 'vision_model' : undefined,
    visibleTime: optionalString(item.visibleTime),
    confidence:
      typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.max(0, Math.min(1, item.confidence))
        : undefined
  }
}

export function parseChatSnapshotResponse(raw: string): ChatSnapshot | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed: unknown = JSON.parse(match[0])
    if (!parsed || typeof parsed !== 'object') return null
    const value = parsed as Record<string, unknown>
    const conversation =
      value.conversation && typeof value.conversation === 'object'
        ? (value.conversation as Record<string, unknown>)
        : value
    const conversationTitle =
      optionalString(conversation.title) ?? optionalString(value.conversationTitle)
    if (!conversationTitle) return null
    const messages = (Array.isArray(value.messages) ? value.messages : [])
      .map(parseMessage)
      .filter((message): message is ExtractedChatMessage => message !== null)
    if (messages.length === 0) return null
    const participants = Array.isArray(conversation.participants)
      ? conversation.participants
          .map(optionalString)
          .filter((item): item is string => Boolean(item))
      : undefined
    return {
      conversationTitle,
      conversationType: enumValue(conversation.type, CONVERSATION_TYPES, 'unknown'),
      participants: participants?.length ? participants : undefined,
      messages
    }
  } catch {
    return null
  }
}
