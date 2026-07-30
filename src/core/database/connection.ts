// src/core/database/connection.ts
// SQLite 数据库连接管理

import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export interface DatabaseConfig {
  basePath: string // userData 路径
  fileName?: string // 数据库文件名，默认 'kuangye.db'
}

let _db: Database.Database | null = null
let _config: DatabaseConfig | null = null

/**
 * 初始化数据库连接
 * 应用启动时调用一次
 */
export function initDatabase(config: DatabaseConfig): Database.Database {
  if (_db) {
    console.warn('[Database] 已经初始化，忽略重复调用')
    return _db
  }

  _config = config
  const dbPath = join(config.basePath, config.fileName || 'kuangye.db')

  // 确保目录存在
  mkdirSync(config.basePath, { recursive: true })

  // 创建数据库连接
  _db = new Database(dbPath)

  // 启用 WAL 模式（提高并发性能）
  _db.pragma('journal_mode = WAL')

  // 启用外键约束
  _db.pragma('foreign_keys = ON')

  console.log(`[Database] 已连接: ${dbPath}`)

  return _db
}

/**
 * 获取数据库连接
 */
export function getDatabase(): Database.Database {
  if (!_db) {
    throw new Error('[Database] 未初始化，请先调用 initDatabase()')
  }
  return _db
}

/**
 * 关闭数据库连接
 * 应用退出时调用
 */
export function closeDatabase(): void {
  if (_db) {
    _db.close()
    _db = null
    console.log('[Database] 已关闭')
  }
}

/**
 * 获取数据库配置
 */
export function getDatabaseConfig(): DatabaseConfig | null {
  return _config
}
