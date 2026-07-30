// src/core/database/repositories/project-repository.ts
// 动作链项目 Repository

import { BaseRepository } from './base-repository'

export interface Project {
  id: string
  name: string
  created_at: number
  updated_at: number
  config?: string // JSON: 区域、窗口锚点等配置
  workspace?: string // JSON: 动作链数据
}

export class ProjectRepository extends BaseRepository<Project> {
  constructor() {
    super('projects')
  }

  /**
   * 查找所有项目（按更新时间倒序）
   */
  findAllProjects(): Project[] {
    const stmt = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    return stmt.all() as Project[]
  }

  /**
   * 创建项目
   */
  createProject(name: string, config?: Record<string, unknown>): Project {
    return this.create({
      name,
      config: config ? JSON.stringify(config) : undefined,
      workspace: undefined
    } as Omit<Project, 'id'>)
  }

  /**
   * 更新项目配置
   */
  updateConfig(id: string, config: Record<string, unknown>): Project | null {
    return this.update(id, { config: JSON.stringify(config) } as Partial<Project>)
  }

  /**
   * 更新工作区
   */
  updateWorkspace(id: string, workspace: Record<string, unknown>): Project | null {
    return this.update(id, { workspace: JSON.stringify(workspace) } as Partial<Project>)
  }

  /**
   * 获取项目配置（解析 JSON）
   */
  getConfig(id: string): Record<string, unknown> | null {
    const project = this.findById(id)
    if (!project?.config) return null
    try {
      return JSON.parse(project.config)
    } catch {
      return null
    }
  }

  /**
   * 获取工作区（解析 JSON）
   */
  getWorkspace(id: string): Record<string, unknown> | null {
    const project = this.findById(id)
    if (!project?.workspace) return null
    try {
      return JSON.parse(project.workspace)
    } catch {
      return null
    }
  }

  /**
   * 搜索项目
   */
  search(query: string): Project[] {
    const stmt = this.db.prepare(
      'SELECT * FROM projects WHERE name LIKE ? ORDER BY updated_at DESC'
    )
    return stmt.all(`%${query}%`) as Project[]
  }
}
