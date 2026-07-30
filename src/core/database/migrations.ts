// src/core/database/migrations.ts
// 数据库迁移 - 创建表结构

import type Database from 'better-sqlite3'

const MIGRATIONS_VERSION = 1

const CREATE_TABLES = `
-- 动作链项目
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  config TEXT,
  workspace TEXT
);

-- 动作链执行记录
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

-- 执行步骤记录（工作记忆）
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

-- 聊天会话
CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  conversation_type TEXT NOT NULL DEFAULT 'unknown',
  participants TEXT,
  first_captured_at INTEGER NOT NULL,
  last_captured_at INTEGER NOT NULL
);

-- 聊天消息
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_name TEXT,
  sender_role TEXT,
  content_kind TEXT NOT NULL,
  original_text TEXT,
  media_description TEXT,
  visible_time TEXT,
  record_source TEXT,
  captured_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

-- 经验卡片
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

-- AI 助手会话
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- AI 助手消息
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);

-- 数据库版本表
CREATE TABLE IF NOT EXISTS db_version (
  version INTEGER PRIMARY KEY
);
`

/**
 * 执行数据库迁移
 */
export function runMigrations(db: Database.Database): void {
  // 检查当前版本
  const currentVersion = getCurrentVersion(db)

  if (currentVersion >= MIGRATIONS_VERSION) {
    console.log(`[Migration] 数据库已是最新版本 (v${currentVersion})`)
    return
  }

  console.log(`[Migration] 从 v${currentVersion} 迁移到 v${MIGRATIONS_VERSION}`)

  // 使用事务执行迁移
  db.transaction(() => {
    // 创建所有表
    db.exec(CREATE_TABLES)

    // 更新版本号
    if (currentVersion === 0) {
      db.prepare('INSERT INTO db_version (version) VALUES (?)').run(MIGRATIONS_VERSION)
    } else {
      db.prepare('UPDATE db_version SET version = ?').run(MIGRATIONS_VERSION)
    }
  })()

  console.log(`[Migration] 迁移完成`)
}

/**
 * 获取当前数据库版本
 */
function getCurrentVersion(db: Database.Database): number {
  try {
    const result = db.prepare('SELECT version FROM db_version LIMIT 1').get() as
      | { version: number }
      | undefined
    return result?.version ?? 0
  } catch {
    return 0
  }
}
