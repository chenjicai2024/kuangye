import type { ChatConversation, ChatContentKind, ChatMessage } from './types'

const KIND_LABELS: Record<ChatContentKind, string> = {
  text: '文字',
  image: '图片',
  video: '视频',
  sticker: '表情',
  voice: '语音',
  file: '文件',
  link: '链接',
  location: '位置',
  system: '系统消息',
  unknown: '未知内容'
}

function displaySender(message: ChatMessage): string {
  if (message.senderRole === 'self') return '我方'
  if (message.senderRole === 'peer') return '对方'
  return message.senderName || '未知发送者'
}

export function formatChatMessage(message: ChatMessage): string {
  const sender = displaySender(message)
  const time = message.visibleTime ? ` ${message.visibleTime}` : ''
  if (message.recordSource === 'legacy_unlabeled') {
    return `${sender}${time} [旧版未标注消息] ${message.originalText ?? message.mediaDescription ?? ''}`
  }
  if (message.contentKind === 'text') {
    return `${sender}${time}：${message.originalText ?? ''}`
  }
  if (message.contentKind === 'system') {
    return `${sender}${time} [系统消息] ${message.originalText ?? ''}`
  }
  return `${sender}${time} [${KIND_LABELS[message.contentKind]}][AI视觉描述] ${message.mediaDescription ?? '无法确认具体内容'}`
}

export function estimateChatContextTokens(text: string): number {
  let tokens = 0
  for (const char of text) tokens += /[\u3400-\u9fff]/.test(char) ? 1 : 0.25
  return Math.max(1, Math.ceil(tokens))
}

export function buildChatHistoryContext(
  conversation: ChatConversation | undefined,
  tokenBudget = 6000
): string {
  if (!conversation || conversation.messages.length === 0) return ''
  const budget = Math.max(100, Math.floor(tokenBudget))
  const header = `当前会话：${conversation.conversationTitle}\n会话类型：${conversation.conversationType === 'group' ? '群聊' : conversation.conversationType === 'direct' ? '私聊' : '未知'}\n`
  const selected: string[] = []
  let used = estimateChatContextTokens(header)
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    let line = formatChatMessage(conversation.messages[index])
    let cost = estimateChatContextTokens(line)
    if (selected.length === 0 && used + cost > budget) {
      const maxChars = Math.max(20, Math.floor(budget - used - 25))
      line = `${line.slice(0, maxChars)}…[内容已按上下文预算截断]`
      cost = estimateChatContextTokens(line)
      while (used + cost > budget && line.length > 20) {
        line = `${line.slice(0, Math.max(10, line.length - 10))}…`
        cost = estimateChatContextTokens(line)
      }
    }
    if (used + cost > budget) break
    selected.unshift(line)
    used += cost
  }
  return `${header}${selected.join('\n')}`
}
