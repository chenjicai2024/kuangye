// src/core/database/repositories/execution-repository.ts
// 动作链执行记录 Repository

import { BaseRepository } from './base-repository'

export interface Execution {
  id: string
  project_id: string
  chain_id?: string
  status: 'running' | 'completed' | 'failed'
  started_at: number
  finished_at?: number
  variables?: string // JSON: 运行时变量
}

export interface ExecutionStep {
  id: string
  execution_id: string
  step_index: number
  step_type: string
  status: string
  screenshot_path?: string
  reasoning?: string
  action_detail?: string // JSON
  outcome?: string // JSON
  duration_ms?: number
  created_at: number
}

export class ExecutionRepository extends BaseRepository<Execution> {
  private stepRepository: StepRepository

  constructor() {
    super('executions')
    this.stepRepository = new StepRepository()
  }

  /**
   * 获取步骤 Repository
   */
  get steps(): StepRepository {
    return this.stepRepository
  }

  /**
   * 查找项目的执行记录
   */
  findByProjectId(projectId: string): Execution[] {
    const stmt = this.db.prepare(
      'SELECT * FROM executions WHERE project_id = ? ORDER BY started_at DESC'
    )
    return stmt.all(projectId) as Execution[]
  }

  /**
   * 查找正在运行的执行
   */
  findRunning(): Execution[] {
    const stmt = this.db.prepare("SELECT * FROM executions WHERE status = 'running'")
    return stmt.all() as Execution[]
  }

  /**
   * 创建执行记录
   */
  createExecution(projectId: string, chainId?: string): Execution {
    return this.create({
      project_id: projectId,
      chain_id: chainId,
      status: 'running',
      started_at: Date.now()
    } as Omit<Execution, 'id'>)
  }

  /**
   * 完成执行
   */
  complete(id: string, variables?: Record<string, unknown>): Execution | null {
    return this.update(id, {
      status: 'completed',
      finished_at: Date.now(),
      variables: variables ? JSON.stringify(variables) : undefined
    } as Partial<Execution>)
  }

  /**
   * 标记执行失败
   */
  fail(id: string, variables?: Record<string, unknown>): Execution | null {
    return this.update(id, {
      status: 'failed',
      finished_at: Date.now(),
      variables: variables ? JSON.stringify(variables) : undefined
    } as Partial<Execution>)
  }

  /**
   * 创建执行记录（指定 id，关联工作记忆会话）。
   * 直接插入以避开 BaseRepository 自动追加 created_at/updated_at——executions 表无此两列。
   */
  createExecutionWithId(id: string, projectId: string, chainId?: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO executions (id, project_id, chain_id, status, started_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, projectId, chainId ?? null, 'running', Date.now())
  }

  /**
   * 结束执行记录
   */
  finishExecution(
    id: string,
    status: 'completed' | 'failed',
    variables?: Record<string, unknown>
  ): void {
    this.db
      .prepare('UPDATE executions SET status = ?, finished_at = ?, variables = ? WHERE id = ?')
      .run(status, Date.now(), variables ? JSON.stringify(variables) : null, id)
  }

  /**
   * 记录步骤（直接插入 execution_steps，避开 BaseRepository 自动追加 updated_at）
   */
  recordStep(
    executionId: string,
    step: {
      stepIndex: number
      stepType: string
      status: string
      message?: string
      detail?: string
      durationMs?: number
      screenshotPath?: string
      action?: unknown
      outcome?: unknown
    }
  ): void {
    const id = `${executionId}-${step.stepIndex}-${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare(
        'INSERT INTO execution_steps (id, execution_id, step_index, step_type, status, screenshot_path, reasoning, action_detail, outcome, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        executionId,
        step.stepIndex,
        step.stepType,
        step.status,
        step.screenshotPath ?? null,
        step.message ?? null,
        step.action != null ? JSON.stringify(step.action) : null,
        step.outcome != null ? JSON.stringify(step.outcome) : null,
        step.durationMs ?? null,
        Date.now()
      )
  }

  /**
   * 获取执行的运行时变量
   */
  getVariables(id: string): Record<string, unknown> | null {
    const execution = this.findById(id)
    if (!execution?.variables) return null
    try {
      return JSON.parse(execution.variables)
    } catch {
      return null
    }
  }
}

class StepRepository extends BaseRepository<ExecutionStep> {
  constructor() {
    super('execution_steps')
  }

  /**
   * 查找执行的所有步骤
   */
  findByExecutionId(executionId: string): ExecutionStep[] {
    const stmt = this.db.prepare(
      'SELECT * FROM execution_steps WHERE execution_id = ? ORDER BY step_index ASC'
    )
    return stmt.all(executionId) as ExecutionStep[]
  }

  /**
   * 创建步骤记录
   */
  createStep(
    executionId: string,
    stepIndex: number,
    stepType: string,
    data?: {
      status?: string
      screenshotPath?: string
      reasoning?: string
      actionDetail?: Record<string, unknown>
      outcome?: Record<string, unknown>
      durationMs?: number
    }
  ): ExecutionStep {
    return this.create({
      execution_id: executionId,
      step_index: stepIndex,
      step_type: stepType,
      status: data?.status ?? 'pending',
      screenshot_path: data?.screenshotPath,
      reasoning: data?.reasoning,
      action_detail: data?.actionDetail ? JSON.stringify(data.actionDetail) : undefined,
      outcome: data?.outcome ? JSON.stringify(data.outcome) : undefined,
      duration_ms: data?.durationMs
    } as Omit<ExecutionStep, 'id'>)
  }

  /**
   * 更新步骤状态
   */
  updateStep(
    id: string,
    updates: {
      status?: string
      outcome?: Record<string, unknown>
      durationMs?: number
    }
  ): ExecutionStep | null {
    return this.update(id, {
      status: updates.status,
      outcome: updates.outcome ? JSON.stringify(updates.outcome) : undefined,
      duration_ms: updates.durationMs
    } as Partial<ExecutionStep>)
  }

  /**
   * 删除执行的所有步骤
   */
  deleteByExecutionId(executionId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM execution_steps WHERE execution_id = ?')
    const result = stmt.run(executionId)
    return result.changes > 0
  }
}
