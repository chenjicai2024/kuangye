// scripts/migrate-now.ts
// 直接执行数据迁移的脚本

import * as Database from 'better-sqlite3'
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const userDataPath = join(process.env.APPDATA || '', 'kuangye-desktop-agent')
const dbPath = join(userDataPath, 'kuangye.db')

console.log('用户数据路径:', userDataPath)
console.log('数据库路径:', dbPath)

// 确保目录存在
if (!existsSync(userDataPath)) {
  mkdirSync(userDataPath, { recursive: true })
}

// 打开数据库
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// 创建表（如果不存在）
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    config TEXT,
    workspace TEXT
  );

  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    chain_id TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    variables TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS execution_steps (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    step_type TEXT NOT NULL,
    status TEXT NOT NULL,
    screenshot_path TEXT,
    reasoning TEXT,
    action_detail TEXT,
    outcome TEXT,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS experience_cards (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    scenario TEXT NOT NULL,
    guidance TEXT NOT NULL,
    rationale TEXT,
    evidence TEXT,
    source TEXT,
    used_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS db_version (
    version INTEGER PRIMARY KEY
  );
`)

// 读取 JSON 文件
function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) {
      console.log(`文件不存在: ${filePath}`)
      return null
    }
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch (error) {
    console.error(`读取文件失败: ${filePath}`, error)
    return null
  }
}

// 迁移项目
function migrateProjects(): void {
  console.log('\n=== 迁移项目 ===')

  const projectsPath = join(userDataPath, 'action-chain-projects.json')
  const data = readJsonFile<{ projects: Array<{ id: string; name: string; workspace: unknown }> }>(projectsPath)

  if (!data?.projects) {
    console.log('没有找到项目数据')
    return
  }

  console.log(`找到 ${data.projects.length} 个项目`)

  const insertStmt = db.prepare('INSERT OR IGNORE INTO projects (id, name, created_at, updated_at, workspace) VALUES (?, ?, ?, ?, ?)')
  const now = Date.now()
  let count = 0

  for (const project of data.projects) {
    try {
      insertStmt.run(project.id, project.name, now, now, JSON.stringify(project.workspace))
      count++
      console.log(`迁移项目: ${project.name}`)
    } catch (error) {
      console.error(`迁移项目失败: ${project.name}`, error)
    }
  }

  console.log(`成功迁移 ${count} 个项目`)
}

// 迁移经验卡片
function migrateExperienceCards(): void {
  console.log('\n=== 迁移经验卡片 ===')

  const cardsPath = join(userDataPath, 'workmemory', 'cards.json')
  const data = readJsonFile<{ cards: Array<{ id: string; scenario: string; guidance: string; rationale?: string; evidence?: string[]; source?: string; stats?: { used: number; success: number } }> }>(cardsPath)

  if (!data?.cards) {
    console.log('没有找到经验卡片数据')
    return
  }

  console.log(`找到 ${data.cards.length} 张经验卡片`)

  const insertStmt = db.prepare('INSERT OR IGNORE INTO experience_cards (id, project_id, scenario, guidance, rationale, evidence, source, used_count, success_count, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const now = Date.now()
  let count = 0

  for (const card of data.cards) {
    try {
      insertStmt.run(
        card.id,
        null,
        card.scenario,
        card.guidance,
        card.rationale,
        card.evidence ? JSON.stringify(card.evidence) : null,
        card.source,
        card.stats?.used ?? 0,
        card.stats?.success ?? 0,
        1,
        now,
        now
      )
      count++
      console.log(`迁移卡片: ${card.scenario.slice(0, 30)}...`)
    } catch (error) {
      console.error(`迁移卡片失败: ${card.scenario}`, error)
    }
  }

  console.log(`成功迁移 ${count} 张经验卡片`)
}

// 迁移工作记忆
function migrateWorkMemory(): void {
  console.log('\n=== 迁移工作记忆 ===')

  const sessionsPath = join(userDataPath, 'worktrace', 'sessions')
  if (!existsSync(sessionsPath)) {
    console.log('没有找到工作记忆目录')
    return
  }

  try {
    const sessionDirs = readdirSync(sessionsPath).filter((dir) => {
      const dirPath = join(sessionsPath, dir)
      return existsSync(join(dirPath, 'session.json'))
    })

    console.log(`找到 ${sessionDirs.length} 个执行记录`)

    const insertExecution = db.prepare('INSERT OR IGNORE INTO executions (id, project_id, chain_id, status, started_at, finished_at, variables) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const insertStep = db.prepare('INSERT OR IGNORE INTO execution_steps (id, execution_id, step_index, step_type, status, screenshot_path, reasoning, action_detail, outcome, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')

    let executionCount = 0
    let stepCount = 0

    // 获取第一个项目作为默认值
    const firstProject = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined
    const defaultProjectId = firstProject?.id || 'default'

    for (const sessionId of sessionDirs) {
      try {
        const sessionPath = join(sessionsPath, sessionId, 'session.json')
        const session = readJsonFile<{
          sessionId: string
          projectId?: string
          chainId?: string
          status?: string
          startedAt: number
          endedAt?: number
        }>(sessionPath)

        if (!session) continue

        const execId = session.sessionId || sessionId
        const status = session.endedAt ? 'completed' : 'running'

        insertExecution.run(
          execId,
          session.projectId || defaultProjectId,
          session.chainId || null,
          status,
          session.startedAt,
          session.endedAt || null,
          null
        )
        executionCount++
        console.log(`迁移执行记录: ${execId}`)

        // 从 trace.jsonl 读取步骤
        const tracePath = join(sessionsPath, sessionId, 'trace.jsonl')
        let stepCountForSession = 0
        if (existsSync(tracePath)) {
          const traceContent = readFileSync(tracePath, 'utf-8')
          const lines = traceContent.split('\n').filter((line) => line.trim())
          stepCountForSession = lines.length

          for (let i = 0; i < lines.length; i++) {
            try {
              const step = JSON.parse(lines[i]) as {
                stepId?: string
                seq?: number
                ts: number
                actor?: string
                phase?: string
                summary?: string
                action?: unknown
                outcome?: unknown
              }

              insertStep.run(
                step.stepId || `${execId}-${i}`,
                execId,
                step.seq ?? i,
                step.phase || 'unknown',
                step.outcome && typeof step.outcome === 'object' && 'status' in (step.outcome as Record<string, unknown>)
                  ? (step.outcome as { status: string }).status
                  : 'unknown',
                null, // screenshot_path
                step.summary || null,
                step.action ? JSON.stringify(step.action) : null,
                step.outcome ? JSON.stringify(step.outcome) : null,
                step.outcome && typeof step.outcome === 'object' && 'latencyMs' in (step.outcome as Record<string, unknown>)
                  ? (step.outcome as { latencyMs: number }).latencyMs
                  : null,
                step.ts
              )
              stepCount++
            } catch (error) {
              // 跳过解析失败的行
            }
          }
        }

        console.log(`迁移执行记录: ${execId} (${stepCountForSession} 步骤)`)
      } catch (error) {
        console.error(`迁移执行记录失败: ${sessionId}`, error)
      }
    }

    console.log(`成功迁移 ${executionCount} 个执行记录, ${stepCount} 个步骤`)
  } catch (error) {
    console.error('迁移工作记忆失败:', error)
  }
}

// 执行迁移
console.log('开始数据迁移...')

migrateProjects()
migrateExperienceCards()
migrateWorkMemory()

console.log('\n=== 迁移完成 ===')

// 关闭数据库
db.close()
