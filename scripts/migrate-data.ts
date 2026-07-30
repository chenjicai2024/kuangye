// scripts/migrate-data.ts
// 数据迁移脚本：将现有 JSON 数据导入到 SQLite 数据库

import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// 临时使用 better-sqlite3 直接操作
import Database from 'better-sqlite3'

const userDataPath = join(process.env.APPDATA || '', 'kuangye-desktop-agent')
const dbPath = join(userDataPath, 'kuangye.db')

// 确保目录存在
if (!existsSync(userDataPath)) {
  mkdirSync(userDataPath, { recursive: true })
}

console.log('[Migration] 用户数据路径:', userDataPath)
console.log('[Migration] 数据库路径:', dbPath)

// 打开数据库
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// 读取并解析 JSON 文件
function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) {
      console.log(`[Migration] 文件不存在: ${filePath}`)
      return null
    }
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch (error) {
    console.error(`[Migration] 读取文件失败: ${filePath}`, error)
    return null
  }
}

// 迁移项目数据
function migrateProjects(): void {
  console.log('\n[Migration] === 迁移项目数据 ===')

  const projectsPath = join(userDataPath, 'action-chain-projects.json')
  const data = readJsonFile<{ projects: Array<{ id: string; name: string; workspace: unknown }> }>(
    projectsPath
  )

  if (!data?.projects) {
    console.log('[Migration] 没有找到项目数据')
    return
  }

  console.log(`[Migration] 找到 ${data.projects.length} 个项目`)

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO projects (id, name, created_at, updated_at, workspace)
    VALUES (?, ?, ?, ?, ?)
  `)

  const now = Date.now()
  let count = 0

  for (const project of data.projects) {
    try {
      insertStmt.run(
        project.id,
        project.name,
        now,
        now,
        JSON.stringify(project.workspace)
      )
      count++
      console.log(`[Migration] 迁移项目: ${project.name}`)
    } catch (error) {
      console.error(`[Migration] 迁移项目失败: ${project.name}`, error)
    }
  }

  console.log(`[Migration] 成功迁移 ${count} 个项目`)
}

// 迁移经验卡片
function migrateExperienceCards(): void {
  console.log('\n[Migration] === 迁移经验卡片 ===')

  const cardsPath = join(userDataPath, 'workmemory', 'cards.json')
  const data = readJsonFile<{ cards: Array<{ id: string; scenario: string; guidance: string; rationale?: string; evidence?: string[]; source?: string; stats?: { used: number; success: number } }> }>(
    cardsPath
  )

  if (!data?.cards) {
    console.log('[Migration] 没有找到经验卡片数据')
    return
  }

  console.log(`[Migration] 找到 ${data.cards.length} 张经验卡片`)

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO experience_cards (id, project_id, scenario, guidance, rationale, evidence, source, used_count, success_count, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const now = Date.now()
  let count = 0

  for (const card of data.cards) {
    try {
      insertStmt.run(
        card.id,
        null, // project_id
        card.scenario,
        card.guidance,
        card.rationale,
        card.evidence ? JSON.stringify(card.evidence) : null,
        card.source,
        card.stats?.used ?? 0,
        card.stats?.success ?? 0,
        1, // enabled
        now,
        now
      )
      count++
      console.log(`[Migration] 迁移卡片: ${card.scenario.slice(0, 30)}...`)
    } catch (error) {
      console.error(`[Migration] 迁移卡片失败: ${card.scenario}`, error)
    }
  }

  console.log(`[Migration] 成功迁移 ${count} 张经验卡片`)
}

// 迁移聊天记录
function migrateChatHistory(): void {
  console.log('\n[Migration] === 迁移聊天记录 ===')

  const chatPath = join(userDataPath, 'chat-history.json')
  const data = readJsonFile<Array<{
    id: string
    projectId?: string
    conversationTitle: string
    conversationType: string
    participants?: string[]
    messages: Array<{
      id: string
      senderName: string
      senderRole: string
      contentKind: string
      originalText?: string
      mediaDescription?: string
      visibleTime?: string
      capturedAt: number
    }>
    firstCapturedAt: number
    lastCapturedAt: number
  }>>(chatPath)

  if (!data) {
    console.log('[Migration] 没有找到聊天记录数据')
    return
  }

  console.log(`[Migration] 找到 ${data.length} 个聊天会话`)

  const insertConversationStmt = db.prepare(`
    INSERT OR IGNORE INTO chat_conversations (id, project_id, title, conversation_type, participants, first_captured_at, last_captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const insertMessageStmt = db.prepare(`
    INSERT OR IGNORE INTO chat_messages (id, conversation_id, sender_name, sender_role, content_kind, original_text, media_description, visible_time, record_source, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let conversationCount = 0
  let messageCount = 0

  for (const conversation of data) {
    try {
      // 插入会话
      insertConversationStmt.run(
        conversation.id,
        conversation.projectId,
        conversation.conversationTitle,
        conversation.conversationType,
        conversation.participants ? JSON.stringify(conversation.participants) : null,
        conversation.firstCapturedAt,
        conversation.lastCapturedAt
      )
      conversationCount++

      // 插入消息
      for (const message of conversation.messages) {
        try {
          insertMessageStmt.run(
            message.id,
            conversation.id,
            message.senderName,
            message.senderRole,
            message.contentKind,
            message.originalText,
            message.mediaDescription,
            message.visibleTime,
            'legacy', // record_source
            message.capturedAt
          )
          messageCount++
        } catch (error) {
          console.error(`[Migration] 迁移消息失败: ${message.id}`, error)
        }
      }

      console.log(`[Migration] 迁移会话: ${conversation.conversationTitle} (${conversation.messages.length} 条消息)`)
    } catch (error) {
      console.error(`[Migration] 迁移会话失败: ${conversation.conversationTitle}`, error)
    }
  }

  console.log(`[Migration] 成功迁移 ${conversationCount} 个会话, ${messageCount} 条消息`)
}

// 迁移工作记忆（执行记录）
function migrateWorkMemory(): void {
  console.log('\n[Migration] === 迁移工作记忆 ===')

  const worktracePath = join(userDataPath, 'worktrace')

  if (!existsSync(worktracePath)) {
    console.log('[Migration] 没有找到工作记忆目录')
    return
  }

  try {
    const sessionDirs = readdirSync(worktracePath).filter((dir) => {
      const dirPath = join(worktracePath, dir)
      return (
        require('node:fs').statSync(dirPath).isDirectory() &&
        existsSync(join(dirPath, 'session.json'))
      )
    })

    console.log(`[Migration] 找到 ${sessionDirs.length} 个执行记录`)

    const insertExecutionStmt = db.prepare(`
      INSERT OR IGNORE INTO executions (id, project_id, chain_id, status, started_at, finished_at, variables)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const insertStepStmt = db.prepare(`
      INSERT OR IGNORE INTO execution_steps (id, execution_id, step_index, step_type, status, screenshot_path, reasoning, action_detail, outcome, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let executionCount = 0
    let stepCount = 0

    for (const sessionId of sessionDirs) {
      try {
        const sessionPath = join(worktracePath, sessionId, 'session.json')
        const session = readJsonFile<{
          id: string
          projectId?: string
          chainId?: string
          status: string
          startedAt: number
          finishedAt?: number
          steps?: Array<{
            id: string
            index: number
            type: string
            status: string
            screenshotPath?: string
            reasoning?: string
            action?: unknown
            outcome?: unknown
            durationMs?: number
            createdAt: number
          }>
        }>(sessionPath)

        if (!session) continue

        // 插入执行记录
        insertExecutionStmt.run(
          session.id,
          session.projectId,
          session.chainId,
          session.status,
          session.startedAt,
          session.finishedAt,
          null // variables
        )
        executionCount++

        // 插入步骤
        if (session.steps) {
          for (const step of session.steps) {
            try {
              insertStepStmt.run(
                step.id,
                session.id,
                step.index,
                step.type,
                step.status,
                step.screenshotPath,
                step.reasoning,
                step.action ? JSON.stringify(step.action) : null,
                step.outcome ? JSON.stringify(step.outcome) : null,
                step.durationMs,
                step.createdAt
              )
              stepCount++
            } catch (error) {
              console.error(`[Migration] 迁移步骤失败: ${step.id}`, error)
            }
          }
        }

        console.log(`[Migration] 迁移执行记录: ${session.id} (${session.steps?.length ?? 0} 步骤)`)
      } catch (error) {
        console.error(`[Migration] 迁移执行记录失败: ${sessionId}`, error)
      }
    }

    console.log(`[Migration] 成功迁移 ${executionCount} 个执行记录, ${stepCount} 个步骤`)
  } catch (error) {
    console.error('[Migration] 迁移工作记忆失败:', error)
  }
}

// 主迁移函数
function main(): void {
  console.log('[Migration] 开始数据迁移...')

  // 执行迁移
  migrateProjects()
  migrateExperienceCards()
  migrateChatHistory()
  migrateWorkMemory()

  console.log('\n[Migration] === 迁移完成 ===')

  // 关闭数据库
  db.close()
}

// 如果直接运行此脚本
if (require.main === module) {
  main()
}

export { main as migrateData }
