import { AIClient } from '../ai-client'
import { ScreenRect } from '../rpa/types'
import type { ActionTraceEvent } from '../work-memory/types'
import {
  ActionStep,
  AIAction,
  AIActionPlan,
  AIPoint,
  EngineState,
  FlowEdge,
  Region,
  StepCondition,
  StepContext,
  StepLog,
  WindowAnchor,
  Workspace
} from './types'

/** 节点运行时表示：FlowNode 的运行时子集。 */
export type RunnableNode = {
  id: string
  data: ActionStep
  legacyStepIndex?: number
  label?: string
}

export interface EngineCallbacks {
  onStateChange: (state: EngineState) => void
  onLog: (message: string) => void
  onStepLog: (log: StepLog) => void
  onTrace?: (event: ActionTraceEvent) => void | Promise<void>
  onRunEnd?: (status: 'success' | 'error' | 'stopped') => void | Promise<void>
}

/** 节点被刹车（abort）时抛出的异常，用于中断长步骤。 */
export class NodeAbortedError extends Error {
  constructor(nodeId: string) {
    super(`节点 ${nodeId} 已被刹车`)
    this.name = 'NodeAbortedError'
  }
}

/** 步骤执行超时异常。 */
export class StepExecutionTimeoutError extends Error {
  constructor(stepType: string, timeoutMs: number) {
    super(`步骤 ${stepType} 执行超时 (${timeoutMs}ms)`)
    this.name = 'StepExecutionTimeoutError'
  }
}

/** 计算矩形中心点。 */
export function rectCenter(rect: ScreenRect): [number, number] {
  return [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)]
}

/**
 * Step handler 需要的引擎 API。
 * ActionChainEngine 实现此接口，handler 函数通过它访问引擎状态和方法。
 */
export interface EngineApi {
  // ── 状态属性 ──
  callbacks: EngineCallbacks
  workspace: Workspace | null
  aiClient: AIClient | null
  state: EngineState
  currentNodeId: string
  model: string
  projectId: string
  scaleFactor: number
  baselines: Map<string, Buffer>
  windowResolutionWarnings: Set<string>
  windowBoundsCache: Map<string, ScreenRect>
  uiRegionCache: Map<string, Region>
  activeNodeControllers: Map<string, AbortController>

  // ── 生命周期 ──
  sleep(ms: number, signal?: AbortSignal): Promise<void>

  // ── 坐标方法 ──
  dipPointToInput(x: number, y: number): [number, number]
  normalizedToScreen(point: AIPoint, region: ScreenRect): [number, number]
  scaleFactorForRect(rect: ScreenRect): number
  expandAndClipRect(rect: ScreenRect, padding: number): ScreenRect

  // ── 区域解析 ──
  resolveRegion(name: string | undefined, ctx: StepContext): Promise<Region | null>
  resolveConfiguredRegion(region: Region): Promise<Region | null>
  resolveAndCacheWindowAnchor(
    anchor: WindowAnchor,
    forceRefresh?: boolean
  ): Promise<ScreenRect | null>
  resolveUiSearchRect(
    step: ActionStep,
    configuredTarget: Region,
    expectedTarget: Region,
    ctx: StepContext,
    logLabel: string
  ): Promise<ScreenRect>

  // ── 模板与变量 ──
  resolveTemplate(template: string, variables: Record<string, unknown>): string
  resolveVariablePath(path: string, variables: Record<string, unknown>): unknown

  // ── AI 执行 ──
  runAiWithProgress<T>(
    label: string,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T>
  validateActionInRegion(action: AIAction): boolean
  filterSafeActions(
    plan: AIActionPlan,
    region: ScreenRect | undefined,
    maxActions: number
  ): AIAction[]

  // ── 像素检测 ──
  checkPixelChange(region: Region, changeThreshold?: number): Promise<{ hasChanged: boolean; diffPercentage: number }>

  // ── 流程控制 ──
  executeStep(step: ActionStep, ctx: StepContext, signal?: AbortSignal): Promise<void>
  evaluateCondition(condition: StepCondition, variables: Record<string, unknown>): boolean
  formatConditionForLog(condition: StepCondition): string
  buildNodeMap(nodes: RunnableNode[]): Map<string, RunnableNode>
  findEntryNode(
    nodes: { id: string }[],
    edges: { source: string; target: string }[]
  ): RunnableNode | null
  getNextNode(
    currentNodeId: string,
    edges: FlowEdge[],
    ctx: StepContext,
    nodeMap: Map<string, RunnableNode>,
    currentStep?: ActionStep
  ): RunnableNode | null
  consumeJumpTarget(
    ctx: StepContext,
    nodes: RunnableNode[],
    nodeMap: Map<string, RunnableNode>
  ): RunnableNode | null
}

/** Step handler 函数签名。 */
export type StepHandler = (
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
) => Promise<void>
