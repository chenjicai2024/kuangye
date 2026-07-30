// src/core/work-memory/session-store.ts
// 运行会话持久化存储

import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, unlink, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { RunSession, RunStep, SessionIndexEntry } from './types'

const SESSIONS_DIR = 'sessions'
const INDEX_FILE = 'sessions-index.json'
const MAX_SESSIONS_PER_PROJECT = 50
const sessionWriteQueues = new Map<string, Promise<unknown>>()

function enqueueSessionWrite<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionWriteQueues.get(sessionId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  sessionWriteQueues.set(sessionId, next)
  void next.then(
    () => {
      if (sessionWriteQueues.get(sessionId) === next) sessionWriteQueues.delete(sessionId)
    },
    () => {
      if (sessionWriteQueues.get(sessionId) === next) sessionWriteQueues.delete(sessionId)
    }
  )
  return next
}

function getBaseDir(): string {
  return join(app.getPath('userData'), 'workmemory')
}

function getSessionsDir(): string {
  return join(getBaseDir(), SESSIONS_DIR)
}

function getIndexPath(): string {
  return join(getBaseDir(), INDEX_FILE)
}

function sessionFilePath(sessionId: string): string {
  return join(getSessionsDir(), `${sessionId}.json`)
}

async function ensureDir(): Promise<void> {
  await mkdir(getSessionsDir(), { recursive: true })
}

async function readIndex(): Promise<SessionIndexEntry[]> {
  try {
    const data = await readFile(getIndexPath(), 'utf-8')
    return JSON.parse(data) as SessionIndexEntry[]
  } catch {
    return []
  }
}

async function writeIndex(entries: SessionIndexEntry[]): Promise<void> {
  await writeFile(getIndexPath(), JSON.stringify(entries, null, 2), 'utf-8')
}

async function readSessionFile(sessionId: string): Promise<RunSession | null> {
  try {
    const data = await readFile(sessionFilePath(sessionId), 'utf-8')
    return JSON.parse(data) as RunSession
  } catch {
    return null
  }
}

async function writeSessionFile(session: RunSession): Promise<void> {
  await writeFile(sessionFilePath(session.id), JSON.stringify(session, null, 2), 'utf-8')
}

/** 创建新的运行会话 */
export async function startSession(
  projectId: string,
  chainId: string,
  chainName: string,
  chainType: 'actionChain' | 'executionChain',
  totalSteps: number
): Promise<RunSession> {
  await ensureDir()

  const session: RunSession = {
    id: randomUUID(),
    projectId,
    chainId,
    chainName,
    chainType,
    startedAt: Date.now(),
    status: 'running',
    totalSteps,
    completedSteps: 0,
    errorCount: 0,
    steps: []
  }

  await writeSessionFile(session)

  // 更新索引
  const index = await readIndex()
  index.unshift({
    id: session.id,
    projectId: session.projectId,
    chainId: session.chainId,
    chainName: session.chainName,
    chainType: session.chainType,
    startedAt: session.startedAt,
    status: session.status,
    totalSteps: session.totalSteps,
    completedSteps: session.completedSteps,
    errorCount: session.errorCount
  })

  // 每个智能体独立保留最近的运行记录，避免活跃智能体挤掉其他智能体的记忆。
  const projectEntries = index.filter((entry) => entry.projectId === projectId)
  if (projectEntries.length > MAX_SESSIONS_PER_PROJECT) {
    const toRemove = projectEntries.slice(MAX_SESSIONS_PER_PROJECT)
    const removeIds = new Set(toRemove.map((entry) => entry.id))
    for (const entry of toRemove) {
      await unlink(sessionFilePath(entry.id)).catch(() => {})
    }
    const retained = index.filter((entry) => !removeIds.has(entry.id))
    await writeIndex(retained)
    return session
  }

  await writeIndex(index)
  return session
}

/** 记录步骤执行 */
export async function recordStep(sessionId: string, step: RunStep): Promise<void> {
  await enqueueSessionWrite(sessionId, async () => {
    const session = await readSessionFile(sessionId)
    if (!session) return

    session.steps.push(step)

    if ((step.kind ?? 'step') === 'step' && step.status === 'success') {
      session.completedSteps++
    } else if ((step.kind ?? 'step') === 'step' && step.status === 'error') {
      session.errorCount++
    }

    await writeSessionFile(session)
  })
}

/** 把发给 AI 的截图保存到本次会话目录，返回会话内相对文件名。 */
export async function saveScreenshot(sessionId: string, base64: string): Promise<string> {
  await ensureDir()
  const screenshotDir = join(getSessionsDir(), `${sessionId}-screenshots`)
  await mkdir(screenshotDir, { recursive: true })
  const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.png`
  const normalized = base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
  await writeFile(join(screenshotDir, fileName), Buffer.from(normalized, 'base64'))
  return fileName
}

export async function readScreenshot(
  projectId: string,
  sessionId: string,
  fileName: string
): Promise<Buffer | null> {
  if (!/^[a-zA-Z0-9._-]+$/.test(sessionId) || !/^[a-zA-Z0-9._-]+$/.test(fileName)) return null
  const session = await readSessionFile(sessionId)
  if (!session || session.projectId !== projectId) return null
  try {
    return await readFile(join(getSessionsDir(), `${sessionId}-screenshots`, fileName))
  } catch {
    return null
  }
}

/** 结束会话 */
export async function endSession(
  sessionId: string,
  status: 'success' | 'error' | 'stopped'
): Promise<void> {
  await enqueueSessionWrite(sessionId, async () => {
    const session = await readSessionFile(sessionId)
    if (!session) return

    session.endedAt = Date.now()
    session.status = status

    await writeSessionFile(session)

    // 更新索引
    const index = await readIndex()
    const entry = index.find((e) => e.id === sessionId)
    if (entry) {
      entry.endedAt = session.endedAt
      entry.status = status
      entry.completedSteps = session.completedSteps
      entry.errorCount = session.errorCount
      await writeIndex(index)
    }
  })
}

/** 获取会话详情 */
export async function getSession(
  sessionId: string,
  projectId?: string
): Promise<RunSession | null> {
  const session = await readSessionFile(sessionId)
  if (projectId && session?.projectId !== projectId) return null
  return session
}

/** 列出会话 */
export async function listSessions(
  projectId: string,
  limit: number = 50
): Promise<SessionIndexEntry[]> {
  const index = await readIndex()
  const filtered = index.filter((e) => e.projectId === projectId)
  return filtered.slice(0, limit)
}

/** 删除会话 */
export async function deleteSession(projectId: string, sessionId: string): Promise<boolean> {
  const session = await readSessionFile(sessionId)
  if (!session || session.projectId !== projectId) return false
  try {
    await unlink(sessionFilePath(sessionId))
  } catch {
    // 文件不存在忽略
  }

  const index = await readIndex()
  const filtered = index.filter((e) => e.id !== sessionId)
  if (filtered.length < index.length) {
    await writeIndex(filtered)
    return true
  }
  return false
}

/** 清理旧会话 */
export async function cleanupOldSessions(
  projectId: string,
  keepCount: number = MAX_SESSIONS_PER_PROJECT
): Promise<number> {
  const index = await readIndex()
  const projectEntries = index.filter((entry) => entry.projectId === projectId)
  if (projectEntries.length <= keepCount) return 0

  const toRemove = projectEntries.slice(keepCount)
  const removeIds = new Set(toRemove.map((entry) => entry.id))
  for (const entry of toRemove) {
    await unlink(sessionFilePath(entry.id)).catch(() => {})
  }
  await writeIndex(index.filter((entry) => !removeIds.has(entry.id)))
  return toRemove.length
}

/** 删除指定项目的所有会话及其截图目录 */
export async function deleteSessionsByProject(projectId: string): Promise<number> {
  const index = await readIndex()
  const projectEntries = index.filter((entry) => entry.projectId === projectId)
  if (projectEntries.length === 0) return 0

  for (const entry of projectEntries) {
    await unlink(sessionFilePath(entry.id)).catch(() => {})
    // 删除对应的截图目录
    const screenshotDir = join(getSessionsDir(), `${entry.id}-screenshots`)
    await rm(screenshotDir, { recursive: true, force: true }).catch(() => {})
  }

  await writeIndex(index.filter((entry) => entry.projectId !== projectId))
  return projectEntries.length
}
