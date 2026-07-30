import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type {
  ChatConversation,
  ChatConversationRef,
  ChatConversationType,
  ChatHistorySummary,
  ChatMessage,
  ChatSnapshot,
  ExtractedChatMessage
} from './types'

const FILE_NAME = 'chat-history.json'
let writeQueue: Promise<void> = Promise.resolve()

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function conversationId(projectId: string, type: ChatConversationType, title: string): string {
  return `${projectId}:${type}:${normalized(title)}`
}

function legacyConversation(value: Record<string, unknown>): ChatConversation | null {
  const title =
    typeof value.conversationTitle === 'string'
      ? value.conversationTitle
      : typeof value.conversationName === 'string'
        ? value.conversationName
        : ''
  if (!title.trim()) return null
  const type: ChatConversationType =
    value.conversationType === 'direct' || value.conversationType === 'group'
      ? value.conversationType
      : 'unknown'
  const rawMessages = Array.isArray(value.messages) ? value.messages : []
  const messages: ChatMessage[] = rawMessages.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.senderName === 'string' && typeof item.contentKind === 'string') {
      return [item as unknown as ChatMessage]
    }
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!content) return []
    const direction = item.direction
    return [
      {
        id: typeof item.id === 'string' ? item.id : randomUUID(),
        senderName: typeof item.sender === 'string' ? item.sender : '未知发送者',
        senderRole:
          direction === 'outgoing' ? 'self' : direction === 'incoming' ? 'peer' : 'unknown',
        contentKind: 'unknown',
        mediaDescription: content,
        visibleTime: typeof item.timestamp === 'string' ? item.timestamp : undefined,
        capturedAt: typeof item.capturedAt === 'number' ? item.capturedAt : Date.now(),
        recordSource: 'legacy_unlabeled'
      }
    ]
  })
  const now = Date.now()
  return {
    id: typeof value.id === 'string' ? value.id : `${type}:${normalized(title)}`,
    projectId: typeof value.projectId === 'string' ? value.projectId : undefined,
    conversationTitle: title,
    conversationType: type,
    participants: Array.isArray(value.participants)
      ? value.participants.filter((item): item is string => typeof item === 'string')
      : undefined,
    messages,
    firstCapturedAt: typeof value.firstCapturedAt === 'number' ? value.firstCapturedAt : now,
    lastCapturedAt: typeof value.lastCapturedAt === 'number' ? value.lastCapturedAt : now
  }
}

async function readAll(): Promise<ChatConversation[]> {
  try {
    const raw = await readFile(filePath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) =>
        item && typeof item === 'object'
          ? legacyConversation(item as Record<string, unknown>)
          : null
      )
      .filter((item): item is ChatConversation => item !== null)
  } catch {
    return []
  }
}

async function writeAll(items: ChatConversation[]): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(filePath(), JSON.stringify(items, null, 2), 'utf8')
}

function descriptionWords(value: string | undefined): Set<string> {
  const text = normalized(value)
  const result = new Set(text.split(/[\s，。！？、：；,.!?;:]+/).filter(Boolean))
  const cjk = Array.from(text).filter((char) => /[\u3400-\u9fff]/.test(char))
  for (let index = 0; index < cjk.length - 1; index += 1) {
    result.add(`${cjk[index]}${cjk[index + 1]}`)
  }
  return result
}

export function descriptionSimilarity(left: string | undefined, right: string | undefined): number {
  const a = descriptionWords(left)
  const b = descriptionWords(right)
  if (a.size === 0 || b.size === 0) return 0
  let common = 0
  for (const word of Array.from(a)) if (b.has(word)) common += 1
  const tokenScore = common / Math.max(a.size, b.size)
  const leftChars = new Set(Array.from(normalized(left)).filter((char) => !/\s/.test(char)))
  const rightChars = new Set(Array.from(normalized(right)).filter((char) => !/\s/.test(char)))
  let commonChars = 0
  for (const char of Array.from(leftChars)) if (rightChars.has(char)) commonChars += 1
  const charScore = commonChars / Math.max(1, leftChars.size, rightChars.size)
  return Math.max(tokenScore, charScore)
}

export function messagesMatch(stored: ChatMessage, incoming: ExtractedChatMessage): boolean {
  if (
    stored.senderRole !== 'unknown' &&
    incoming.senderRole !== 'unknown' &&
    stored.senderRole !== incoming.senderRole
  )
    return false
  if (
    normalized(stored.senderName) &&
    normalized(incoming.senderName) &&
    normalized(stored.senderName) !== normalized(incoming.senderName)
  ) {
    if (!(stored.senderRole === 'self' && incoming.senderRole === 'self')) return false
  }
  if (stored.contentKind !== incoming.contentKind && stored.recordSource !== 'legacy_unlabeled')
    return false
  if (
    stored.visibleTime &&
    incoming.visibleTime &&
    normalized(stored.visibleTime) !== normalized(incoming.visibleTime)
  )
    return false
  if (incoming.contentKind === 'text') {
    return normalized(stored.originalText) === normalized(incoming.originalText)
  }
  if (stored.visibleTime && incoming.visibleTime) return true
  return descriptionSimilarity(stored.mediaDescription, incoming.mediaDescription) >= 0.5
}

export function mergeSnapshotMessages(
  stored: ChatMessage[],
  incoming: ExtractedChatMessage[],
  capturedAt = Date.now()
): { messages: ChatMessage[]; addedCount: number } {
  const deduped: ExtractedChatMessage[] = []
  for (const message of incoming) {
    if (!deduped.some((existing) => messagesMatch(existing as ChatMessage, message))) {
      deduped.push(message)
    }
  }
  const batch = deduped
  const maxOverlap = Math.min(stored.length, batch.length)
  let overlap = 0
  for (let size = maxOverlap; size > 0; size -= 1) {
    const storedStart = stored.length - size
    if (
      batch
        .slice(0, size)
        .every((message, index) => messagesMatch(stored[storedStart + index], message))
    ) {
      overlap = size
      break
    }
  }
  if (overlap === 0 && batch.length <= stored.length) {
    const recentStart = Math.max(0, stored.length - 100)
    for (let start = recentStart; start <= stored.length - batch.length; start += 1) {
      if (batch.every((message, index) => messagesMatch(stored[start + index], message))) {
        return { messages: stored, addedCount: 0 }
      }
    }
  }
  const additions = batch.slice(overlap).map<ChatMessage>((message) => ({
    ...message,
    id: randomUUID(),
    capturedAt,
    recordSource: 'vision_snapshot'
  }))
  return { messages: [...stored, ...additions], addedCount: additions.length }
}

export async function listConversations(projectId?: string): Promise<ChatHistorySummary[]> {
  return (await readAll())
    .filter((item) => !projectId || item.projectId === projectId)
    .map((item) => ({
      id: item.id,
      projectId: item.projectId,
      conversationTitle: item.conversationTitle,
      conversationType: item.conversationType,
      messageCount: item.messages.length,
      firstCapturedAt: item.firstCapturedAt,
      lastCapturedAt: item.lastCapturedAt
    }))
    .sort((a, b) => b.lastCapturedAt - a.lastCapturedAt)
}

export async function getConversation(
  id: string,
  projectId?: string
): Promise<ChatConversation | null> {
  return (
    (await readAll()).find(
      (item) => item.id === id && (!projectId || item.projectId === projectId)
    ) ?? null
  )
}

export async function appendSnapshot(
  projectId: string,
  snapshot: ChatSnapshot
): Promise<{ conversation: ChatConversation; addedCount: number }> {
  let result!: { conversation: ChatConversation; addedCount: number }
  const mutation = async (): Promise<void> => {
    const all = await readAll()
    const id = conversationId(projectId, snapshot.conversationType, snapshot.conversationTitle)
    const now = Date.now()
    const existing = all.find((item) => item.id === id)
    const conversation: ChatConversation = existing ?? {
      id,
      projectId,
      conversationTitle: snapshot.conversationTitle,
      conversationType: snapshot.conversationType,
      participants: snapshot.participants,
      messages: [],
      firstCapturedAt: now,
      lastCapturedAt: now
    }
    const merged = mergeSnapshotMessages(conversation.messages, snapshot.messages, now)
    conversation.messages = merged.messages
    conversation.participants = snapshot.participants ?? conversation.participants
    conversation.lastCapturedAt = now
    const index = all.findIndex((item) => item.id === id)
    if (index === -1) all.push(conversation)
    else all[index] = conversation
    await writeAll(all)
    result = { conversation, addedCount: merged.addedCount }
  }
  const queued = writeQueue.then(mutation)
  writeQueue = queued.then(
    () => undefined,
    () => undefined
  )
  await queued
  return result
}

export async function appendOutgoingReply(
  projectId: string,
  conversationRef: ChatConversationRef,
  text: string
): Promise<ChatConversation> {
  let result!: ChatConversation
  const mutation = async (): Promise<void> => {
    const all = await readAll()
    const conversation = all.find(
      (item) => item.id === conversationRef.id && item.projectId === projectId
    )
    if (!conversation) throw new Error(`聊天会话不存在：${conversationRef.conversationTitle}`)
    const now = Date.now()
    conversation.messages.push({
      id: randomUUID(),
      senderName: '我',
      senderRole: 'self',
      contentKind: 'text',
      originalText: text.trim(),
      capturedAt: now,
      recordSource: 'local_reply'
    })
    conversation.lastCapturedAt = now
    await writeAll(all)
    result = conversation
  }
  const queued = writeQueue.then(mutation)
  writeQueue = queued.then(
    () => undefined,
    () => undefined
  )
  await queued
  return result
}

export async function deleteConversation(id: string, projectId?: string): Promise<boolean> {
  let deleted = false
  const mutation = async (): Promise<void> => {
    const all = await readAll()
    const next = all.filter(
      (item) => item.id !== id || (projectId !== undefined && item.projectId !== projectId)
    )
    deleted = next.length !== all.length
    if (deleted) await writeAll(next)
  }
  const queued = writeQueue.then(mutation)
  writeQueue = queued.then(
    () => undefined,
    () => undefined
  )
  await queued
  return deleted
}

/**
 * 把项目化之前留下的无归属记录迁入一个明确的智能体。
 * 调用方必须先确认目标智能体确实包含聊天记录节点，避免跨智能体误归属。
 */
export async function adoptLegacyConversations(projectId: string): Promise<number> {
  let adopted = 0
  const mutation = async (): Promise<void> => {
    const all = await readAll()
    const legacyItems = all.filter((item) => !item.projectId)
    if (legacyItems.length === 0) return

    for (const legacy of legacyItems) {
      const nextId = conversationId(projectId, legacy.conversationType, legacy.conversationTitle)
      const existing = all.find((item) => item.projectId === projectId && item.id === nextId)
      if (existing) {
        const knownIds = new Set(existing.messages.map((message) => message.id))
        existing.messages.push(...legacy.messages.filter((message) => !knownIds.has(message.id)))
        existing.messages.sort((left, right) => left.capturedAt - right.capturedAt)
        existing.firstCapturedAt = Math.min(existing.firstCapturedAt, legacy.firstCapturedAt)
        existing.lastCapturedAt = Math.max(existing.lastCapturedAt, legacy.lastCapturedAt)
      } else {
        legacy.projectId = projectId
        legacy.id = nextId
      }
      adopted += 1
    }

    const retained = all.filter(
      (item) => item.projectId || !legacyItems.some((legacy) => legacy === item)
    )
    await writeAll(retained)
  }
  const queued = writeQueue.then(mutation)
  writeQueue = queued.then(
    () => undefined,
    () => undefined
  )
  await queued
  return adopted
}
