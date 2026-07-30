// src/core/database/repositories/base-repository.ts
// Repository 基类，提供通用 CRUD 操作

import { getDatabase } from '../connection'

export interface BaseEntity {
  id: string
}

export class BaseRepository<T extends BaseEntity> {
  protected tableName: string

  constructor(tableName: string) {
    this.tableName = tableName
  }

  protected get db() {
    return getDatabase()
  }

  /**
   * 根据 ID 查找
   */
  findById(id: string): T | null {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`)
    return stmt.get(id) as T | null
  }

  /**
   * 查找所有
   */
  findAll(filter?: Partial<T>): T[] {
    if (!filter || Object.keys(filter).length === 0) {
      const stmt = this.db.prepare(`SELECT * FROM ${this.tableName}`)
      return stmt.all() as T[]
    }

    const conditions = Object.keys(filter)
      .map((key) => `${key} = ?`)
      .join(' AND ')
    const values = Object.values(filter)

    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE ${conditions}`)
    return stmt.all(...values) as T[]
  }

  /**
   * 创建记录
   */
  create(entity: Omit<T, 'id'>): T {
    const id = this.generateId()
    const now = Date.now()

    // 自动添加 created_at 和 updated_at（如果实体没有的话）
    const entityWithTimestamps = {
      ...entity,
      id,
      created_at: (entity as Record<string, unknown>).created_at ?? now,
      updated_at: (entity as Record<string, unknown>).updated_at ?? now
    }

    const columns = Object.keys(entityWithTimestamps)
    const placeholders = columns.map(() => '?').join(', ')
    const values = Object.values(entityWithTimestamps)

    const stmt = this.db.prepare(
      `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`
    )
    stmt.run(...values)

    return this.findById(id) as T
  }

  /**
   * 更新记录
   */
  update(id: string, updates: Partial<T>): T | null {
    const existing = this.findById(id)
    if (!existing) return null

    const now = Date.now()
    const updateWithTimestamp = {
      ...updates,
      updated_at: now
    }

    const setClause = Object.keys(updateWithTimestamp)
      .map((key) => `${key} = ?`)
      .join(', ')
    const values = [...Object.values(updateWithTimestamp), id]

    const stmt = this.db.prepare(`UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`)
    stmt.run(...values)

    return this.findById(id)
  }

  /**
   * 删除记录
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`)
    const result = stmt.run(id)
    return result.changes > 0
  }

  /**
   * 计数
   */
  count(filter?: Partial<T>): number {
    if (!filter || Object.keys(filter).length === 0) {
      const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`)
      const result = stmt.get() as { count: number }
      return result.count
    }

    const conditions = Object.keys(filter)
      .map((key) => `${key} = ?`)
      .join(' AND ')
    const values = Object.values(filter)

    const stmt = this.db.prepare(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${conditions}`
    )
    const result = stmt.get(...values) as { count: number }
    return result.count
  }

  /**
   * 生成 ID
   */
  protected generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
}
