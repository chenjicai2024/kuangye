// src/core/work-memory/types.ts
// 工作记忆系统类型定义

import { FlowNode, FlowEdge, TriggerType } from '../action-chain/types'

/** 运行会话 */
export interface RunSession {
  id: string
  projectId: string
  chainId: string
  chainName: string
  chainType: 'actionChain' | 'executionChain'
  startedAt: number
  endedAt?: number
  status: 'running' | 'success' | 'error' | 'stopped'
  totalSteps: number
  completedSteps: number
  errorCount: number
  steps: RunStep[]
}

/** 步骤执行记录 */
export interface RunStep {
  id?: string
  kind?: 'step' | 'ai' | 'action'
  phase?: 'observe' | 'think' | 'act' | 'verify'
  stepIndex: number
  nodeId: string
  stepType: string
  status: 'running' | 'success' | 'skipped' | 'error'
  message: string
  detail?: string
  startedAt: number
  elapsedMs?: number
  variables?: Record<string, unknown>
  screenshotFile?: string
  region?: {
    name: string
    rect: { x: number; y: number; width: number; height: number }
  }
  ai?: {
    prompt: string
    systemPrompt?: string
    outputMode: string
    variableName: string
    rawResponse: string
    parsedResponse?: unknown
    model?: string
  }
  action?: {
    type: string
    policy?: string
    normalizedFrom?: { x: number; y: number; coordinateSpace?: string }
    normalizedTo?: { x: number; y: number; coordinateSpace?: string }
    screenFrom?: [number, number]
    screenTo?: [number, number]
    text?: string
    keyName?: string
    modifiers?: string[]
    reason?: string
  }
}

/** 动作链引擎产生的完整审计事件；截图内容由主进程负责落盘。 */
export interface ActionTraceEvent {
  kind: 'ai' | 'action'
  phase: 'observe' | 'think' | 'act' | 'verify'
  stepIndex: number
  nodeId: string
  stepType: string
  message: string
  detail?: string
  screenshotBase64?: string
  region?: RunStep['region']
  ai?: RunStep['ai']
  action?: RunStep['action']
  variables?: Record<string, unknown>
}

/** 经验卡片 */
export interface ExperienceCard {
  id: string
  projectId: string
  source: 'auto_extract' | 'manual'
  scenario: string
  guidance: string
  rationale?: string
  chainTemplate?: ChainTemplate
  sourceSessionId?: string
  sourceNodeIds?: string[]
  createdAt: number
  usedCount: number
  successCount: number
  enabled: boolean
}

/** 链模板 */
export interface ChainTemplate {
  name: string
  description?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  trigger: TriggerType
  variables?: Record<string, unknown>
}

/** 会话索引条目 */
export interface SessionIndexEntry {
  id: string
  projectId: string
  chainId: string
  chainName: string
  chainType: 'actionChain' | 'executionChain'
  startedAt: number
  endedAt?: number
  status: 'running' | 'success' | 'error' | 'stopped'
  totalSteps: number
  completedSteps: number
  errorCount: number
}

/** 经验卡片列表文件结构 */
export interface CardsFile {
  cards: ExperienceCard[]
}
