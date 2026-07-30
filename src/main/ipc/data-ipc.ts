// src/main/ipc/data-ipc.ts
// 数据查询 IPC handlers

import { ipcMain, app } from 'electron'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  ExecutionRepository,
  ExperienceRepository,
  ChatRepository,
  getDatabase
} from '../../core/database'

const executionRepo = new ExecutionRepository()
const experienceRepo = new ExperienceRepository()
const chatRepo = new ChatRepository()

// 打开数据管理窗口的回调（由 main/index.ts 注入）
let openDataManagerWindow: ((projectId: string, projectName: string) => void) | null = null

export function setDataManagerOpener(
  opener: (projectId: string, projectName: string) => void
): void {
  openDataManagerWindow = opener
}

// 读取 JSON 文件
function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

export function registerDataIpc(): void {
  // 打开数据管理窗口
  ipcMain.handle('data:openWindow', async (_event, projectId: string, projectName: string) => {
    try {
      if (openDataManagerWindow) {
        openDataManagerWindow(projectId, projectName)
      }
      return { success: true }
    } catch (error) {
      console.error('[DataIPC] 打开数据管理窗口失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 执行数据迁移
  ipcMain.handle('data:migrate', async () => {
    try {
      const userDataPath = app.getPath('userData')
      const db = getDatabase()

      // 迁移项目
      const projectsPath = join(userDataPath, 'action-chain-projects.json')
      const projectsData = readJsonFile<{ projects: Array<{ id: string; name: string; workspace: unknown }> }>(projectsPath)
      if (projectsData?.projects) {
        const insertProject = db.prepare('INSERT OR IGNORE INTO projects (id, name, created_at, updated_at, workspace) VALUES (?, ?, ?, ?, ?)')
        const now = Date.now()
        for (const p of projectsData.projects) {
          insertProject.run(p.id, p.name, now, now, JSON.stringify(p.workspace))
        }
      }

      // 迁移经验卡片
      const cardsPath = join(userDataPath, 'workmemory', 'cards.json')
      const cardsData = readJsonFile<{ cards: Array<{ id: string; scenario: string; guidance: string; rationale?: string; evidence?: string[]; source?: string; stats?: { used: number; success: number } }> }>(cardsPath)
      if (cardsData?.cards) {
        const insertCard = db.prepare('INSERT OR IGNORE INTO experience_cards (id, project_id, scenario, guidance, rationale, evidence, source, used_count, success_count, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        const now = Date.now()
        for (const c of cardsData.cards) {
          insertCard.run(c.id, null, c.scenario, c.guidance, c.rationale, c.evidence ? JSON.stringify(c.evidence) : null, c.source, c.stats?.used ?? 0, c.stats?.success ?? 0, 1, now, now)
        }
      }

      // 迁移工作记忆（sessions）
      const sessionsPath = join(userDataPath, 'worktrace', 'sessions')
      if (existsSync(sessionsPath)) {
        const sessionDirs = readdirSync(sessionsPath).filter((dir) => {
          const dirPath = join(sessionsPath, dir)
          return existsSync(join(dirPath, 'session.json'))
        })

        const insertExecution = db.prepare('INSERT OR IGNORE INTO executions (id, project_id, chain_id, status, started_at, finished_at, variables) VALUES (?, ?, ?, ?, ?, ?, ?)')
        const insertStep = db.prepare('INSERT OR IGNORE INTO execution_steps (id, execution_id, step_index, step_type, status, screenshot_path, reasoning, action_detail, outcome, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')

        for (const sessionId of sessionDirs) {
          try {
            const session = readJsonFile<{
              sessionId: string
              projectId?: string
              chainId?: string
              status?: string
              startedAt: number
              endedAt?: number
              steps?: Array<{
                stepId: string
                index: number
                type: string
                status: string
                screenshotPath?: string
                reasoning?: string
                action?: unknown
                outcome?: unknown
                durationMs?: number
                ts: number
              }>
            }>(join(sessionsPath, sessionId, 'session.json'))

            if (!session) continue

            const execId = session.sessionId || sessionId
            const status = session.endedAt ? 'completed' : 'running'

            insertExecution.run(
              execId,
              session.projectId || null,
              session.chainId || null,
              status,
              session.startedAt,
              session.endedAt || null,
              null
            )

            if (session.steps) {
              for (const step of session.steps) {
                insertStep.run(
                  step.stepId || `${execId}-${step.index}`,
                  execId,
                  step.index,
                  step.type,
                  step.status,
                  step.screenshotPath || null,
                  step.reasoning || null,
                  step.action ? JSON.stringify(step.action) : null,
                  step.outcome ? JSON.stringify(step.outcome) : null,
                  step.durationMs || null,
                  step.ts
                )
              }
            }
          } catch (error) {
            console.error('[DataMigrate] 迁移 session 失败:', sessionId, error)
          }
        }
      }

      return { success: true }
    } catch (error) {
      console.error('[DataIPC] 数据迁移失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 查询执行记录
  ipcMain.handle('data:listExecutions', async (_event, projectId: string) => {
    try {
      const executions = executionRepo.findByProjectId(projectId)
      return { success: true, executions }
    } catch (error) {
      console.error('[DataIPC] 查询执行记录失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 查询执行步骤
  ipcMain.handle('data:listExecutionSteps', async (_event, executionId: string) => {
    try {
      const steps = executionRepo.steps.findByExecutionId(executionId)
      return { success: true, steps }
    } catch (error) {
      console.error('[DataIPC] 查询执行步骤失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 查询经验卡片
  ipcMain.handle('data:listExperienceCards', async (_event, projectId: string) => {
    try {
      const cards = experienceRepo.findByProjectId(projectId)
      return { success: true, cards }
    } catch (error) {
      console.error('[DataIPC] 查询经验卡片失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 查询聊天会话
  ipcMain.handle('data:listConversations', async (_event, projectId: string) => {
    try {
      const conversations = chatRepo.findByProjectId(projectId)
      return { success: true, conversations }
    } catch (error) {
      console.error('[DataIPC] 查询聊天会话失败:', error)
      return { success: false, error: String(error) }
    }
  })

  // 查询聊天消息
  ipcMain.handle('data:listChatMessages', async (_event, conversationId: string) => {
    try {
      const messages = chatRepo.messages.findByConversationId(conversationId)
      return { success: true, messages }
    } catch (error) {
      console.error('[DataIPC] 查询聊天消息失败:', error)
      return { success: false, error: String(error) }
    }
  })
}
