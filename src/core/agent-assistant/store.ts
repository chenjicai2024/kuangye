import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  AgentAssistantCheckpoint,
  AgentAssistantCheckpointStatus,
  AgentAssistantMessage,
  AgentAssistantSession,
  AgentEditProposalStatus
} from './types'

interface AgentAssistantStore {
  sessions: AgentAssistantSession[]
}

export interface AgentAssistantFailureDiagnostic {
  projectId: string
  sessionId: string
  requestId: string
  attempt: number
  model: string
  finishReason?: string
  error: string
  rawResponse: string
  createdAt: number
}

const STORE_FILE = 'agent-assistant-history.json'
const DIAGNOSTICS_FILE = 'agent-assistant-diagnostics.json'
const MAX_SESSIONS_PER_PROJECT = 20
const MAX_MESSAGES_PER_SESSION = 200
const MAX_FAILURE_DIAGNOSTICS = 20
const CHECKPOINT_STATUSES = new Set<AgentAssistantCheckpointStatus>([
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])
let mutationQueue: Promise<void> = Promise.resolve()
let writeCounter = 0
let storeCachePromise: Promise<AgentAssistantStore> | null = null

function enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(mutation)
  mutationQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE)
}

function diagnosticsPath(): string {
  return join(app.getPath('userData'), DIAGNOSTICS_FILE)
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeMessage(value: unknown, expirePending: boolean): AgentAssistantMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Partial<AgentAssistantMessage>
  if (
    typeof message.id !== 'string' ||
    (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system') ||
    typeof message.content !== 'string' ||
    typeof message.createdAt !== 'number'
  ) {
    return null
  }
  if (expirePending && message.proposal?.status === 'pending') message.proposal.status = 'expired'
  return message as AgentAssistantMessage
}

function normalizeSession(value: unknown, expirePending: boolean): AgentAssistantSession | null {
  if (!value || typeof value !== 'object') return null
  const session = value as Partial<AgentAssistantSession>
  if (
    typeof session.id !== 'string' ||
    typeof session.projectId !== 'string' ||
    typeof session.title !== 'string' ||
    typeof session.createdAt !== 'number' ||
    typeof session.updatedAt !== 'number'
  ) {
    return null
  }
  const rawCheckpoint = session.checkpoint as Partial<AgentAssistantCheckpoint> | undefined
  const checkpoint =
    rawCheckpoint &&
    typeof rawCheckpoint.requestId === 'string' &&
    typeof rawCheckpoint.request === 'string' &&
    typeof rawCheckpoint.createdAt === 'number' &&
    typeof rawCheckpoint.updatedAt === 'number' &&
    typeof rawCheckpoint.status === 'string' &&
    CHECKPOINT_STATUSES.has(rawCheckpoint.status as AgentAssistantCheckpointStatus) &&
    rawCheckpoint.collaboration &&
    typeof rawCheckpoint.collaboration === 'object'
      ? ({
          ...rawCheckpoint,
          status: rawCheckpoint.status === 'running' ? 'interrupted' : rawCheckpoint.status
        } as AgentAssistantCheckpoint)
      : undefined
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: Array.isArray(session.messages)
      ? session.messages
          .map((message) => normalizeMessage(message, expirePending))
          .filter((item): item is AgentAssistantMessage => !!item)
      : [],
    checkpoint
  }
}

async function readStore(): Promise<AgentAssistantStore> {
  if (storeCachePromise) return storeCachePromise
  storeCachePromise = (async () => {
    try {
      const parsed = JSON.parse(await readFile(storePath(), 'utf-8')) as { sessions?: unknown[] }
      const hadPendingProposal = Array.isArray(parsed.sessions)
        ? parsed.sessions.some((session) =>
            Array.isArray((session as AgentAssistantSession)?.messages)
              ? (session as AgentAssistantSession).messages.some(
                  (message) => message.proposal?.status === 'pending'
                )
              : false
          )
        : false
      const store = {
        sessions: Array.isArray(parsed.sessions)
          ? parsed.sessions
              .map((session) => normalizeSession(session, true))
              .filter((item): item is AgentAssistantSession => !!item)
          : []
      }
      if (hadPendingProposal) await writeStore(store)
      return store
    } catch {
      return { sessions: [] }
    }
  })()
  return storeCachePromise
}

async function writeStore(store: AgentAssistantStore): Promise<void> {
  const path = storePath()
  await mkdir(app.getPath('userData'), { recursive: true })
  writeCounter += 1
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${writeCounter}`
  try {
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), 'utf-8')
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function listAgentAssistantSessions(
  projectId: string
): Promise<AgentAssistantSession[]> {
  const store = await readStore()
  return store.sessions
    .filter((session) => session.projectId === projectId)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((session) => ({ ...session, messages: [] }))
}

export async function loadAgentAssistantSession(
  projectId: string,
  sessionId: string
): Promise<AgentAssistantSession | null> {
  const store = await readStore()
  return (
    store.sessions.find((session) => session.projectId === projectId && session.id === sessionId) ??
    null
  )
}

export async function createAgentAssistantSession(
  projectId: string
): Promise<AgentAssistantSession> {
  return enqueueMutation(async () => {
    const store = await readStore()
    const now = Date.now()
    const session: AgentAssistantSession = {
      id: createId('assistant-session'),
      projectId,
      title: '新对话',
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    store.sessions.unshift(session)
    const projectSessions = store.sessions
      .filter((candidate) => candidate.projectId === projectId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
    const expiredIds = new Set(
      projectSessions.slice(MAX_SESSIONS_PER_PROJECT).map((candidate) => candidate.id)
    )
    store.sessions = store.sessions.filter((candidate) => !expiredIds.has(candidate.id))
    await writeStore(store)
    return session
  })
}

export async function deleteAgentAssistantSession(
  projectId: string,
  sessionId: string
): Promise<boolean> {
  return enqueueMutation(async () => {
    const store = await readStore()
    const before = store.sessions.length
    store.sessions = store.sessions.filter(
      (session) => session.projectId !== projectId || session.id !== sessionId
    )
    if (store.sessions.length === before) return false
    await writeStore(store)
    return true
  })
}

export async function appendAgentAssistantMessage(
  projectId: string,
  sessionId: string,
  message: AgentAssistantMessage
): Promise<AgentAssistantSession> {
  return enqueueMutation(async () => {
    const store = await readStore()
    const session = store.sessions.find(
      (candidate) => candidate.projectId === projectId && candidate.id === sessionId
    )
    if (!session) throw new Error('AI 助手会话不存在或不属于当前智能体')
    session.messages.push(message)
    session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION)
    session.updatedAt = Date.now()
    if (message.role === 'user' && session.title === '新对话') {
      session.title = message.content.replace(/\s+/g, ' ').trim().slice(0, 28) || '新对话'
    }
    await writeStore(store)
    return session
  })
}

export async function saveAgentAssistantCheckpoint(
  projectId: string,
  sessionId: string,
  checkpoint: AgentAssistantCheckpoint
): Promise<void> {
  return enqueueMutation(async () => {
    const store = await readStore()
    const session = store.sessions.find(
      (candidate) => candidate.projectId === projectId && candidate.id === sessionId
    )
    if (!session) throw new Error('AI 助手会话不存在或不属于当前智能体')
    session.checkpoint = checkpoint
    session.updatedAt = Date.now()
    await writeStore(store)
  })
}

export async function updateAgentAssistantCheckpointStatus(
  projectId: string,
  sessionId: string,
  requestId: string,
  status: AgentAssistantCheckpointStatus,
  error?: string
): Promise<void> {
  return enqueueMutation(async () => {
    const store = await readStore()
    const session = store.sessions.find(
      (candidate) => candidate.projectId === projectId && candidate.id === sessionId
    )
    if (!session?.checkpoint || session.checkpoint.requestId !== requestId) return
    session.checkpoint.status = status
    session.checkpoint.updatedAt = Date.now()
    session.checkpoint.error = error
    session.updatedAt = Date.now()
    await writeStore(store)
  })
}

export async function updateAgentProposalStatus(
  projectId: string,
  sessionId: string,
  proposalId: string,
  status: AgentEditProposalStatus
): Promise<boolean> {
  return enqueueMutation(async () => {
    const store = await readStore()
    const session = store.sessions.find(
      (candidate) => candidate.projectId === projectId && candidate.id === sessionId
    )
    if (!session) return false
    const message = session.messages.find((candidate) => candidate.proposal?.id === proposalId)
    if (!message?.proposal) return false
    message.proposal.status = status
    session.updatedAt = Date.now()
    await writeStore(store)
    return true
  })
}

export function createAgentAssistantMessage(
  role: AgentAssistantMessage['role'],
  content: string,
  extra: Pick<AgentAssistantMessage, 'responseType' | 'proposal'> = {}
): AgentAssistantMessage {
  return {
    id: createId('assistant-message'),
    role,
    content,
    createdAt: Date.now(),
    ...extra
  }
}

export async function recordAgentAssistantFailure(
  diagnostic: AgentAssistantFailureDiagnostic
): Promise<void> {
  return enqueueMutation(async () => {
    const path = diagnosticsPath()
    let records: AgentAssistantFailureDiagnostic[] = []
    try {
      const parsed = JSON.parse(await readFile(path, 'utf-8')) as { records?: unknown }
      if (Array.isArray(parsed.records)) {
        records = parsed.records.filter(
          (item): item is AgentAssistantFailureDiagnostic =>
            !!item && typeof item === 'object' && typeof item.createdAt === 'number'
        )
      }
    } catch {
      // 首次写入或旧诊断文件损坏时，从空记录重新开始。
    }
    records.push({
      ...diagnostic,
      rawResponse: diagnostic.rawResponse.slice(0, 20_000)
    })
    records = records.slice(-MAX_FAILURE_DIAGNOSTICS)
    await mkdir(app.getPath('userData'), { recursive: true })
    writeCounter += 1
    const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${writeCounter}`
    try {
      await writeFile(temporaryPath, JSON.stringify({ records }, null, 2), 'utf-8')
      await rename(temporaryPath, path)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  })
}
