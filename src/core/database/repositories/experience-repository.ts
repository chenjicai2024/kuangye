// src/core/database/repositories/experience-repository.ts
// 经验卡片 Repository

import { BaseRepository } from './base-repository'

export interface ExperienceCard {
  id: string
  project_id?: string
  scenario: string
  guidance: string
  rationale?: string
  evidence?: string // JSON array of step IDs
  source?: 'agent_summary' | 'human_takeover' | 'manual'
  used_count: number
  success_count: number
  enabled: number // 0 or 1 (SQLite boolean)
  created_at: number
  updated_at: number
}

export class ExperienceRepository extends BaseRepository<ExperienceCard> {
  constructor() {
    super('experience_cards')
  }

  /**
   * 查找项目的所有经验卡片
   */
  findByProjectId(projectId: string): ExperienceCard[] {
    const stmt = this.db.prepare(
      'SELECT * FROM experience_cards WHERE project_id = ? AND enabled = 1 ORDER BY created_at DESC'
    )
    return stmt.all(projectId) as ExperienceCard[]
  }

  /**
   * 查找所有启用的卡片（跨项目）
   */
  findAllEnabled(): ExperienceCard[] {
    const stmt = this.db.prepare('SELECT * FROM experience_cards WHERE enabled = 1')
    return stmt.all() as ExperienceCard[]
  }

  /**
   * 创建经验卡片
   */
  createCard(data: {
    projectId?: string
    scenario: string
    guidance: string
    rationale?: string
    evidence?: string[]
    source?: 'agent_summary' | 'human_takeover' | 'manual'
  }): ExperienceCard {
    return this.create({
      project_id: data.projectId,
      scenario: data.scenario,
      guidance: data.guidance,
      rationale: data.rationale,
      evidence: data.evidence ? JSON.stringify(data.evidence) : undefined,
      source: data.source ?? 'agent_summary',
      used_count: 0,
      success_count: 0,
      enabled: 1
    } as Omit<ExperienceCard, 'id'>)
  }

  /**
   * 获取证据列表
   */
  getEvidence(id: string): string[] {
    const card = this.findById(id)
    if (!card?.evidence) return []
    try {
      return JSON.parse(card.evidence)
    } catch {
      return []
    }
  }

  /**
   * 增加使用次数
   */
  incrementUsed(id: string): ExperienceCard | null {
    const card = this.findById(id)
    if (!card) return null
    return this.update(id, { used_count: card.used_count + 1 } as Partial<ExperienceCard>)
  }

  /**
   * 增加成功次数
   */
  incrementSuccess(id: string): ExperienceCard | null {
    const card = this.findById(id)
    if (!card) return null
    return this.update(id, { success_count: card.success_count + 1 } as Partial<ExperienceCard>)
  }

  /**
   * 启用/禁用卡片
   */
  setEnabled(id: string, enabled: boolean): ExperienceCard | null {
    return this.update(id, { enabled: enabled ? 1 : 0 } as Partial<ExperienceCard>)
  }

  /**
   * 搜索经验卡片
   */
  search(query: string, projectId?: string): ExperienceCard[] {
    if (projectId) {
      const stmt = this.db.prepare(
        'SELECT * FROM experience_cards WHERE project_id = ? AND (scenario LIKE ? OR guidance LIKE ?) AND enabled = 1'
      )
      return stmt.all(projectId, `%${query}%`, `%${query}%`) as ExperienceCard[]
    }

    const stmt = this.db.prepare(
      'SELECT * FROM experience_cards WHERE (scenario LIKE ? OR guidance LIKE ?) AND enabled = 1'
    )
    return stmt.all(`%${query}%`, `%${query}%`) as ExperienceCard[]
  }

  /**
   * 按使用次数排序获取卡片
   */
  findTopUsed(limit: number = 10): ExperienceCard[] {
    const stmt = this.db.prepare(
      'SELECT * FROM experience_cards WHERE enabled = 1 ORDER BY used_count DESC LIMIT ?'
    )
    return stmt.all(limit) as ExperienceCard[]
  }

  /**
   * 按成功率排序获取卡片
   */
  findTopSuccessful(limit: number = 10): ExperienceCard[] {
    const stmt = this.db.prepare(`
      SELECT * FROM experience_cards
      WHERE enabled = 1 AND used_count > 0
      ORDER BY (success_count * 1.0 / used_count) DESC
      LIMIT ?
    `)
    return stmt.all(limit) as ExperienceCard[]
  }
}
