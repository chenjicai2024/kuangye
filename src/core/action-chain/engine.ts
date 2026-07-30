import { AIClient } from '../ai-client'
import { AIClientConfig } from '../ai-client'
import { screen } from 'electron'
import { captureScreenRegion, calculateRedDotPercentage } from '../rpa/screenshot-utils'
import { comparePngBuffers } from '../rpa/image-compare'
import { ScreenRect } from '../rpa/types'
import { resolveWindowAnchorBounds } from '../rpa/window-anchor-utils'
import {
  ActionChain,
  ActionStep,
  AIActionPlan,
  EngineState,
  ExecutionChain,
  FlowEdge,
  isCompoundCondition,
  Region,
  StepCondition,
  StepContext,
  WindowAnchor,
  Workspace
} from './types'
import { AIPoint, AIAction } from './types'
import { RisingEdgeTriggerGate } from './trigger-gate'
import { selectWeightedBranch } from './random-branch'
import { aiPointToRegionDip, isAIActionPointInBounds } from './ai-action-coordinates'
import {
  EngineApi,
  EngineCallbacks,
  NodeAbortedError,
  StepExecutionTimeoutError,
  RunnableNode
} from './engine-api'
import { STEP_HANDLER_REGISTRY } from './steps'

const ENGINE_START_DELAY_MS = 10_000

type ChainTargetType = 'executionChain' | 'actionChain'

export interface ActionChainRunTarget {
  targetType: ChainTargetType
  targetId: string
  projectId?: string
}

type RunnableChain = (ActionChain | ExecutionChain) & { id?: string }

interface RunnableChainRef {
  type: ChainTargetType
  chain: RunnableChain
}

export class ActionChainEngine implements EngineApi {
  workspace: Workspace | null = null
  aiClient: AIClient | null = null
  state: EngineState = {
    running: false,
    currentChain: null,
    currentStep: 0,
    errors: [],
    variables: {}
  }
  callbacks: EngineCallbacks
  private timer: ReturnType<typeof setTimeout> | null = null
  baselines = new Map<string, Buffer>()
  scaleFactor = 1
  private failureCounts = new Map<string, number>()
  private completedSingleChains = new Set<string>()
  private target: ActionChainRunTarget | null = null
  windowResolutionWarnings = new Set<string>()
  windowBoundsCache = new Map<string, ScreenRect>()
  private windowResolutionPromises = new Map<string, Promise<ScreenRect | null>>()
  uiRegionCache = new Map<string, Region>()
  private triggerGate = new RisingEdgeTriggerGate()
  currentNodeId = ''
  model = ''
  projectId = ''
  /** 活跃节点表：nodeId -> AbortController。用于"后续节点开始往下传时刹车前面所有节点"。 */
  activeNodeControllers = new Map<string, AbortController>()

  constructor(callbacks: EngineCallbacks) {
    this.callbacks = callbacks
  }

  start(
    workspace: Workspace,
    aiConfig: AIClientConfig,
    scaleFactor = 1,
    target: ActionChainRunTarget | null = null,
    projectId = ''
  ): void {
    this.workspace = workspace
    this.aiClient = new AIClient(aiConfig)
    this.model = aiConfig.model
    this.scaleFactor = scaleFactor
    this.target = target
    this.projectId = projectId || target?.projectId || ''
    this.state = {
      running: true,
      runMode: target ? 'single' : 'global',
      targetChainType: target?.targetType,
      targetChainId: target?.targetId,
      currentChain: null,
      currentChainType: undefined,
      currentStep: 0,
      errors: [],
      variables: {}
    }
    this.baselines.clear()
    this.failureCounts.clear()
    this.completedSingleChains.clear()
    this.windowResolutionWarnings.clear()
    this.windowBoundsCache.clear()
    this.windowResolutionPromises.clear()
    this.uiRegionCache.clear()
    this.triggerGate.reset()
    this.completedSingleChains.clear()
    this.activeNodeControllers.clear()
    this.callbacks.onStateChange(this.state)
    this.callbacks.onLog(target ? '单链启动准备已完成' : '链监听启动准备已完成')
    this.callbacks.onLog(
      '安全提示：动作链将在 10 秒后开始执行，届时可能接管鼠标和键盘；缓冲期间或运行中均可按 Esc 全局紧急停止'
    )
    this.scheduleLoop(ENGINE_START_DELAY_MS)
  }

  stop(status: 'success' | 'error' | 'stopped' = 'stopped'): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.target = null
    this.abortAllNodes()
    this.windowBoundsCache.clear()
    this.windowResolutionPromises.clear()
    this.uiRegionCache.clear()
    this.triggerGate.reset()
    this.updateState({
      running: false,
      currentChain: null,
      currentChainType: undefined,
      currentStep: 0
    })
    this.callbacks.onLog('动作链引擎已停止')
    void this.callbacks.onRunEnd?.(status)
  }

  getState(): EngineState {
    return { ...this.state }
  }

  /**
   * 不可变更新 state：创建新对象再 push 给 renderer。
   * 严禁原地 mutate `this.state.X = ...` 后调 onStateChange，
   * 否则 renderer 端 setEngineState 收到同一引用，Object.is 比对通过就不重渲染，
   * 按钮/状态指示会卡在旧值（之前 run → stop 后再运行按钮死掉就是这个原因）。
   */
  private updateState(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch }
    this.callbacks.onStateChange(this.state)
  }

  /**
   * 为节点创建并注册刹车控制器，返回其 signal。
   * 长步骤通过检查 signal.aborted 或传入 AI 调用来实现可中断。
   */
  private registerNode(nodeId: string): AbortSignal {
    const controller = new AbortController()
    this.activeNodeControllers.set(nodeId, controller)
    return controller.signal
  }

  /**
   * 节点完成、准备往下传结果时调用：刹车除自己以外的所有活跃节点。
   * 串行流程中表里通常只有自己，等于空操作。
   */
  private abortOtherNodes(keepNodeId: string): void {
    for (const [nodeId, controller] of this.activeNodeControllers) {
      if (nodeId !== keepNodeId) {
        controller.abort()
        this.activeNodeControllers.delete(nodeId)
      }
    }
  }

  /** 停止引擎时刹车所有活跃节点。 */
  private abortAllNodes(): void {
    for (const [, controller] of this.activeNodeControllers) {
      controller.abort()
    }
    this.activeNodeControllers.clear()
  }

  /** 从活跃表中移除已完成的节点。 */
  private unregisterNode(nodeId: string): void {
    this.activeNodeControllers.delete(nodeId)
  }

  private scheduleLoop(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.loop()
    }, delayMs)
  }

  private async loop(): Promise<void> {
    if (!this.state.running || !this.workspace || !this.aiClient) return

    try {
      if (this.target) {
        const target = this.findTargetChain()
        if (!target) {
          this.callbacks.onLog(`指定链不存在: ${this.target.targetType}/${this.target.targetId}`)
          this.stop('error')
          return
        }

        if (this.isTriggerListeningChain(target.chain)) {
          const triggered = await this.checkTrigger(target.chain)
          if (triggered) {
            await this.executeChain(target.chain, target.type)
            if (this.state.running) this.scheduleLoop(500)
            return
          }
          if (this.state.running) this.scheduleLoop(1000)
          return
        }

        await this.executeChain(target.chain, target.type)
        if (target.chain.trigger === 'default') {
          if (this.state.running) this.scheduleLoop(1000)
        } else {
          this.stop('success')
        }
        return
      }

      const enabledChains = this.getRunnableChains()
      const triggeredChains = enabledChains.filter(({ chain }) =>
        this.isTriggerListeningChain(chain)
      )

      for (const item of triggeredChains) {
        const triggered = await this.checkTrigger(item.chain)
        if (triggered) {
          await this.executeChain(item.chain, item.type)
          if (this.state.running) this.scheduleLoop(500)
          return
        }
      }

      const singleChains = enabledChains.filter(({ chain }) => chain.trigger === 'manual')
      for (const item of singleChains) {
        const key = item.chain.id ?? item.chain.name
        if (this.completedSingleChains.has(key)) continue
        this.completedSingleChains.add(key)
        await this.executeChain(item.chain, item.type)
        if (!this.state.running) return
      }

      const loopChains = enabledChains.filter(({ chain }) => chain.trigger === 'default')
      for (const item of loopChains) {
        await this.executeChain(item.chain, item.type)
        if (!this.state.running) return
      }

      if (triggeredChains.length === 0 && loopChains.length === 0) {
        this.stop('success')
        return
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.state.errors.push(msg)
      this.callbacks.onLog(`引擎异常: ${msg}`)
    }

    if (this.state.running) this.scheduleLoop(1000)
  }

  private getRunnableChains(): RunnableChainRef[] {
    if (!this.workspace) return []
    return (this.workspace.executionChains ?? [])
      .map(
        (chain): RunnableChainRef => ({
          type: 'executionChain',
          chain
        })
      )
      .filter(({ chain }) => chain.enabled === true)
  }

  private findTargetChain(): RunnableChainRef | null {
    if (!this.workspace || !this.target) return null
    if (this.target.targetType === 'executionChain') {
      const chain = (this.workspace.executionChains ?? []).find(
        (c) => c.id === this.target!.targetId
      )
      return chain ? { type: 'executionChain', chain } : null
    }
    const chain = (this.workspace.chains ?? []).find((c) => c.id === this.target!.targetId)
    return chain ? { type: 'actionChain', chain } : null
  }

  private isTriggerListeningChain(chain: RunnableChain): boolean {
    return chain.trigger === 'red_dot' || chain.trigger === 'pixel_change'
  }

  private async checkTrigger(chain: RunnableChain): Promise<boolean> {
    if (!chain.triggerRegion) return false
    const configuredRegion = this.workspace!.views.flatMap((v) => v.regions).find(
      (r) => r.name === chain.triggerRegion
    )
    if (!configuredRegion) {
      this.callbacks.onLog(`触发区域 "${chain.triggerRegion}" 未找到`)
      return false
    }
    const region =
      this.uiRegionCache.get(configuredRegion.name) ??
      (await this.resolveConfiguredRegion(configuredRegion))
    if (!region) return false

    const detected =
      chain.trigger === 'pixel_change'
        ? (await this.checkPixelChange(region)).hasChanged
        : chain.trigger === 'red_dot'
          ? await this.checkRedDot(region)
          : false
    const triggerKey = `${chain.id ?? chain.name}:${chain.trigger}:${region.name}`
    // 事件按“出现一次”触发，而不是状态持续期间每轮都触发。
    return this.triggerGate.shouldTrigger(triggerKey, detected)
  }

  async checkPixelChange(region: Region, changeThreshold = 0.5): Promise<{ hasChanged: boolean; diffPercentage: number }> {
    const result = await captureScreenRegion(region.rect)
    if (!result.success || !result.nativeImage) return { hasChanged: false, diffPercentage: 0 }

    const current = result.nativeImage.toPNG()
    const baseline = this.baselines.get(region.name)

    if (!baseline) {
      this.baselines.set(region.name, current)
      return { hasChanged: false, diffPercentage: 0 }
    }

    const diff = comparePngBuffers(baseline, current, { threshold: 0.1, changeThreshold })

    // 每次比较后都推进基线，避免一次变化让整条链无限重复触发。
    this.baselines.set(region.name, current)
    if (diff.hasChanged) {
      this.callbacks.onLog(
        `区域 "${region.name}" 检测到像素变化 (${diff.diffPercentage.toFixed(1)}%)`
      )
    }
    return { hasChanged: diff.hasChanged, diffPercentage: diff.diffPercentage }
  }

  private async checkRedDot(region: Region): Promise<boolean> {
    const result = await captureScreenRegion(region.rect)
    if (!result.success || !result.screenshotBase64) return false

    const percentage = await calculateRedDotPercentage(result.screenshotBase64)
    if (percentage === null) return false

    const hasRed = percentage > 0.5
    if (hasRed) {
      this.callbacks.onLog(`区域 "${region.name}" 检测到红点 (${percentage.toFixed(1)}%)`)
    }
    return hasRed
  }

  private getChainTypeLabel(chainType: ChainTargetType): string {
    return chainType === 'executionChain' ? '执行链' : '动作链'
  }

  private async executeChain(chain: RunnableChain, chainType: ChainTargetType): Promise<void> {
    this.updateState({
      currentChain: chain.name,
      currentChainType: chainType,
      currentStep: 0
    })
    this.callbacks.onLog(`开始执行：${chain.name}（${this.getChainTypeLabel(chainType)}）`)

    const ctx: StepContext = {
      regions: this.workspace!.views.flatMap((view) => view.regions),
      variables: {}
    }

    const nodes = chain.nodes ?? []
    const edges = chain.edges ?? []
    const nodeMap = this.buildNodeMap(nodes)

    let currentNode = this.findEntryNode(nodes, edges)
    let stepIndex = 0

    while (currentNode && this.state.running) {
      this.updateState({ currentStep: stepIndex })

      const step = currentNode.data
      this.currentNodeId = currentNode.id
      if (
        step.type !== 'if_else' &&
        step.condition &&
        !this.evaluateCondition(step.condition, ctx.variables)
      ) {
        this.callbacks.onStepLog({
          chainType,
          chainName: chain.name,
          nodeId: currentNode.id,
          stepIndex,
          stepType: step.type,
          status: 'skipped',
          message: '条件不满足'
        })
        currentNode = this.getNextNode(currentNode.id, edges, ctx, nodeMap)
        stepIndex++
        continue
      }

      const startTime = Date.now()
      this.callbacks.onStepLog({
        chainType,
        chainName: chain.name,
        nodeId: currentNode.id,
        stepIndex,
        stepType: step.type,
        status: 'running',
        message: `执行步骤 ${stepIndex + 1}`
      })

      // 并行节点：启动所有出线分支，根据汇聚模式等待
      if (step.type === 'parallel') {
        const signal = this.registerNode(currentNode.id)
        try {
          const convergeResult = await this.executeParallel(
            currentNode,
            chain,
            chainType,
            edges,
            ctx,
            nodeMap,
            stepIndex,
            signal
          )
          this.callbacks.onStepLog({
            chainType,
            chainName: chain.name,
            nodeId: currentNode.id,
            stepIndex,
            stepType: step.type,
            status: 'success',
            message: '并行执行完成',
            elapsedMs: Date.now() - startTime
          })
          this.updateState({ variables: { ...ctx.variables } })
          this.unregisterNode(currentNode.id)
          // 跳到汇聚点之后继续
          if (convergeResult?.nextNodeId) {
            currentNode = nodeMap.get(convergeResult.nextNodeId) ?? null
            stepIndex++
            continue
          }
          currentNode = null
          stepIndex++
          continue
        } catch (error) {
          this.unregisterNode(currentNode!.id)
          throw error
        }
      }

      const signal = this.registerNode(currentNode.id)
      try {
        await this.executeStepWithRetry(step, ctx, signal)
        this.callbacks.onStepLog({
          chainType,
          chainName: chain.name,
          nodeId: currentNode.id,
          stepIndex,
          stepType: step.type,
          status: 'success',
          message: `步骤 ${stepIndex + 1} 完成`,
          elapsedMs: Date.now() - startTime
        })
        this.updateState({ variables: { ...ctx.variables } })
        // 节点完成、准备往下传：刹车其他还在跑的活跃节点（串行下为空操作）
        this.abortOtherNodes(currentNode.id)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        // 被刹车的节点不算失败，直接结束当前分支
        if (error instanceof NodeAbortedError) {
          this.callbacks.onStepLog({
            chainType,
            chainName: chain.name,
            nodeId: currentNode.id,
            stepIndex,
            stepType: step.type,
            status: 'skipped',
            message: '节点已被刹车',
            elapsedMs: Date.now() - startTime
          })
          this.unregisterNode(currentNode.id)
          return
        }
        this.callbacks.onStepLog({
          chainType,
          chainName: chain.name,
          nodeId: currentNode.id,
          stepIndex,
          stepType: step.type,
          status: 'error',
          message: msg,
          elapsedMs: Date.now() - startTime
        })

        const failureKey = `${chainType}:${chain.id ?? chain.name}:${currentNode.id}`
        const currentCount = (this.failureCounts.get(failureKey) ?? 0) + 1
        this.failureCounts.set(failureKey, currentCount)
        this.callbacks.onLog(`节点 ${currentNode.id} 累计失败 ${currentCount} 次`)

        const exceededMaxFailures =
          step.maxFailures !== undefined && step.maxFailures > 0 && currentCount >= step.maxFailures

        if (exceededMaxFailures) {
          this.callbacks.onLog(`节点 ${currentNode.id} 失败次数已达上限 (${step.maxFailures})`)
          this.stop('error')
          return
        }

        if (step.onError === 'stop') {
          this.callbacks.onLog('引擎因步骤失败停止')
          this.stop('error')
          return
        }

        if (step.onError === 'jump') {
          const jumpNode = this.resolveJumpTarget(step.errorJumpStep, undefined, nodes, nodeMap)
          if (jumpNode) {
            this.callbacks.onLog(`跳转到节点 ${jumpNode.id}`)
            currentNode = jumpNode
            stepIndex++
            continue
          }
          this.callbacks.onLog('跳转失败：目标步骤不存在')
          this.stop('error')
          return
        }
      }

      this.unregisterNode(currentNode.id)
      const jumpNode = this.consumeJumpTarget(ctx, nodes, nodeMap)
      currentNode = jumpNode ?? this.getNextNode(currentNode.id, edges, ctx, nodeMap, step)
      stepIndex++
    }

    this.updateState({
      currentChain: null,
      currentChainType: undefined,
      currentStep: 0
    })
  }

  buildNodeMap(nodes: RunnableNode[]): Map<string, RunnableNode> {
    return new Map(nodes.map((node) => [node.id, node]))
  }

  findEntryNode(
    nodes: { id: string }[],
    edges: { source: string; target: string }[]
  ): RunnableNode | null {
    if (nodes.length === 0) return null
    const targetIds = new Set(edges.map((e) => e.target))
    const entry = nodes.find((n) => !targetIds.has(n.id))
    return (entry ?? nodes[0]) as RunnableNode | null
  }

  getNextNode(
    currentNodeId: string,
    edges: {
      id: string
      source: string
      target: string
      sourceHandle?: string
      probabilityWeight?: number
    }[],
    ctx: StepContext,
    nodeMap: Map<string, RunnableNode>,
    currentStep?: ActionStep
  ): RunnableNode | null {
    const outEdges = edges.filter((e) => e.source === currentNodeId)
    if (outEdges.length === 0) return null

    // if_else 根据条件选择分支
    if (currentStep?.type === 'if_else' && currentStep.condition) {
      const result = this.evaluateCondition(currentStep.condition, ctx.variables)
      const handle = result ? 'true' : 'false'
      const branchEdge = outEdges.find((e) => e.sourceHandle === handle)
      if (branchEdge) return nodeMap.get(branchEdge.target) ?? null
      this.callbacks.onLog(`条件分支 ${handle} 没有连线，当前分支结束`)
      return null
    }

    if (currentStep?.type === 'random_branch') {
      const selection = selectWeightedBranch(outEdges)
      if (!selection) {
        this.callbacks.onLog('随机分支没有可用路线，当前分支结束')
        return null
      }
      this.callbacks.onLog(
        `随机分支选择路线 ${selection.index + 1}：权重 ${selection.weight}/${selection.totalWeight}（${(selection.probability * 100).toFixed(1)}%）`
      )
      return nodeMap.get(selection.branch.target) ?? null
    }

    // 循环计数器：未达上限走"继续"口，达到上限走"退出"口
    if (currentStep?.type === 'loop_counter') {
      const maxCount = currentStep.params?.loopMaxCount
      if (maxCount && maxCount > 0) {
        const counterKey = `__loop_counter_${currentNodeId}`
        const count = (ctx.variables[counterKey] as number) ?? 0
        if (count >= maxCount) {
          const exitEdge = outEdges.find((e) => e.sourceHandle === 'exit')
          if (exitEdge) return nodeMap.get(exitEdge.target) ?? null
          this.callbacks.onLog('循环计数器达到上限，退出口未连线，当前分支结束')
          return null
        }
      }
      // 未达上限：走"继续"口
      const continueEdge = outEdges.find((e) => e.sourceHandle === 'continue')
      if (continueEdge) return nodeMap.get(continueEdge.target) ?? null
    }

    // 走第一条出边
    const edge = outEdges.find((e) => e.sourceHandle === undefined) ?? outEdges[0]
    return nodeMap.get(edge.target) ?? null
  }

  private resolveJumpTarget(
    legacyStepIndex: number | undefined,
    nodeId: string | undefined,
    nodes: RunnableNode[],
    nodeMap: Map<string, RunnableNode>
  ): RunnableNode | null {
    if (nodeId) return nodeMap.get(nodeId) ?? null
    if (legacyStepIndex === undefined) return null
    return (
      nodes.find((node) => node.legacyStepIndex === legacyStepIndex) ??
      nodes[legacyStepIndex] ??
      null
    )
  }

  consumeJumpTarget(
    ctx: StepContext,
    nodes: RunnableNode[],
    nodeMap: Map<string, RunnableNode>
  ): RunnableNode | null {
    if (ctx.jumpTarget === undefined && !ctx.jumpTargetNodeId) return null
    const jumpNode = this.resolveJumpTarget(ctx.jumpTarget, ctx.jumpTargetNodeId, nodes, nodeMap)
    delete ctx.jumpTarget
    delete ctx.jumpTargetNodeId
    if (!jumpNode) {
      this.callbacks.onLog('跳转失败：目标节点不存在')
    }
    return jumpNode
  }

  async executeStep(step: ActionStep, ctx: StepContext, signal?: AbortSignal): Promise<void> {
    const handler = STEP_HANDLER_REGISTRY[step.type]
    if (!handler) throw new Error(`未知步骤类型: ${step.type}`)
    await handler(this, step, ctx, signal)
  }

  async runAiWithProgress<T>(
    label: string,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const startedAt = Date.now()
    this.callbacks.onLog(`${label}：请求已提交AI（${this.model}），正在等待返回`)
    const progressTimer = setInterval(() => {
      if (!this.state.running) return
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
      this.callbacks.onLog(`${label}：AI仍在处理中，已等待 ${elapsedSeconds} 秒`)
    }, 10_000)

    const effectiveSignal = signal ?? new AbortController().signal
    try {
      return await operation(effectiveSignal)
    } finally {
      clearInterval(progressTimer)
    }
  }

  private async executeStepWithTimeout(
    step: ActionStep,
    ctx: StepContext,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.executeStep(step, ctx, signal),
        new Promise<void>((_, reject) => {
          timer = setTimeout(
            () => reject(new StepExecutionTimeoutError(step.type, timeoutMs)),
            timeoutMs
          )
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async executeStepWithRetry(
    step: ActionStep,
    ctx: StepContext,
    signal?: AbortSignal
  ): Promise<void> {
    const retries = step.retryCount ?? 0
    const delay = step.retryDelayMs ?? 1000

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const handlesOwnTimeout =
          step.type === 'detect_pixel_change' || step.type === 'wait_red_dot'
        if (step.timeoutMs && step.timeoutMs > 0 && !handlesOwnTimeout) {
          await this.executeStepWithTimeout(step, ctx, step.timeoutMs, signal)
        } else {
          await this.executeStep(step, ctx, signal)
        }
        return
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        // 节点被刹车时不重试，直接抛出
        if (error instanceof NodeAbortedError) throw error
        // 当前桌面输入和部分 AI 请求不能可靠取消。超时后禁止自动重试，避免旧任务与重试并发执行。
        if (error instanceof StepExecutionTimeoutError) throw error
        if (attempt < retries) {
          this.callbacks.onLog(`步骤重试 ${attempt + 1}/${retries}: ${msg}`)
          await this.sleep(delay, signal)
        } else {
          throw error
        }
      }
    }
  }

  /**
   * 找到从 parallel 节点出发，沿出线可达的最近 parallel_process 节点。
   */
  private findConvergeNode(
    parallelNodeId: string,
    edges: FlowEdge[],
    nodeMap: Map<string, RunnableNode>
  ): RunnableNode | null {
    const visited = new Set<string>()
    const queue: string[] = []
    for (const e of edges) {
      if (e.source === parallelNodeId) queue.push(e.target)
    }
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      const node = nodeMap.get(nodeId)
      if (!node) continue
      if (node.data.type === 'parallel_process') return node
      for (const e of edges) {
        if (e.source === nodeId) queue.push(e.target)
      }
    }
    return null
  }

  /**
   * 并行节点执行：收集所有出线分支，同时启动，根据汇聚模式等待。
   * 竞争模式：第一个到达汇聚点的分支胜出，其余被刹车。
   * 采集模式：等待所有分支到达汇聚点。
   */
  private async executeParallel(
    parallelNode: RunnableNode,
    chain: RunnableChain,
    chainType: ChainTargetType,
    edges: FlowEdge[],
    ctx: StepContext,
    nodeMap: Map<string, RunnableNode>,
    _stepIndex: number,
    _signal: AbortSignal
  ): Promise<{ nextNodeId: string | null } | null> {
    const outEdges = edges.filter((e) => e.source === parallelNode.id)
    if (outEdges.length === 0) {
      this.callbacks.onLog('并行节点没有出线分支')
      return { nextNodeId: null }
    }

    // 找到汇聚点
    const convergeNode = this.findConvergeNode(parallelNode.id, edges, nodeMap)
    if (!convergeNode) {
      this.callbacks.onLog('并行节点未找到后续的并行处理节点，按顺序执行')
      // 没有汇聚点，退化成普通节点
      return { nextNodeId: null }
    }

    const mode = convergeNode.data.params?.parallelMode ?? 'gather'
    const convergeNodeId = convergeNode.id
    const branchStarts = outEdges
      .map((e) => nodeMap.get(e.target))
      .filter((n): n is RunnableNode => n !== undefined)

    this.callbacks.onLog(
      `并行节点启动 ${branchStarts.length} 条分支，模式：${mode === 'race' ? '竞争' : '采集'}`
    )

    // 为每条分支创建独立的 signal
    const branchControllers = branchStarts.map(() => new AbortController())

    const branchPromises = branchStarts.map((startNode, i) =>
      this.executeBranchToConverge(
        startNode,
        convergeNodeId,
        chain,
        chainType,
        edges,
        ctx,
        nodeMap,
        branchControllers[i].signal
      ).catch((err) => {
        if (err instanceof NodeAbortedError) return
        throw err
      })
    )

    if (mode === 'race') {
      // 竞争模式：给每个分支加索引标记，race 后知道是谁赢了
      const indexedPromises = branchPromises.map((p, i) => p.then(() => i))
      const winnerIndex = await Promise.race(indexedPromises)
      // 记录胜出分支信息到变量，供后续条件判断使用
      const winnerNode = branchStarts[winnerIndex]
      ctx.variables['parallel_winner'] = winnerIndex
      ctx.variables['parallel_winner_label'] = winnerNode?.label ?? winnerNode?.id ?? ''
      this.callbacks.onLog(
        `竞争模式：分支 ${winnerIndex}（${ctx.variables['parallel_winner_label']}）胜出，其余分支已停止`
      )
      // 刹车其他还在跑的分支
      for (let i = 0; i < branchControllers.length; i++) {
        if (i !== winnerIndex && !branchControllers[i].signal.aborted) {
          branchControllers[i].abort()
        }
      }
    } else {
      // 采集模式：等所有分支完成
      await Promise.allSettled(branchPromises)
      this.callbacks.onLog('采集模式：所有分支已完成')
    }

    // 找到汇聚点之后的下一个节点
    const afterConverge = edges.filter(
      (e) => e.source === convergeNodeId && e.sourceHandle === undefined
    )
    const nextNodeId = afterConverge[0]?.target ?? null
    return { nextNodeId }
  }

  /**
   * 执行单条分支，从 startNode 到 convergeNodeId（不含）。
   * 遇到并行处理节点时停止，表示该分支已到达汇聚点。
   */
  private async executeBranchToConverge(
    startNode: RunnableNode,
    convergeNodeId: string,
    chain: RunnableChain,
    chainType: ChainTargetType,
    edges: FlowEdge[],
    ctx: StepContext,
    nodeMap: Map<string, RunnableNode>,
    signal: AbortSignal
  ): Promise<void> {
    let currentNode: RunnableNode | null = startNode
    let branchStepIndex = 0

    while (currentNode && this.state.running && !signal.aborted) {
      // 到达汇聚点，停止
      if (currentNode.id === convergeNodeId) return
      // 遇到另一个并行节点，不递归（暂不支持嵌套并行）
      if (currentNode.data.type === 'parallel') {
        this.callbacks.onLog(`分支遇到嵌套并行节点 ${currentNode.id}，暂不支持，跳过`)
        return
      }

      const step = currentNode.data
      this.currentNodeId = currentNode.id

      if (
        step.type !== 'if_else' &&
        step.condition &&
        !this.evaluateCondition(step.condition, ctx.variables)
      ) {
        currentNode = this.getNextNode(currentNode.id, edges, ctx, nodeMap)
        branchStepIndex++
        continue
      }

      const branchSignal = this.registerNode(currentNode.id)
      // 合并分支 signal 和节点 signal
      const combinedController = new AbortController()
      const onBranchAbort = (): void => combinedController.abort()
      signal.addEventListener('abort', onBranchAbort, { once: true })
      if (branchSignal.aborted) combinedController.abort()
      else branchSignal.addEventListener('abort', onBranchAbort, { once: true })

      try {
        await this.executeStepWithRetry(step, ctx, combinedController.signal)
        this.updateState({ variables: { ...ctx.variables } })
      } catch (error) {
        if (error instanceof NodeAbortedError) {
          this.unregisterNode(currentNode.id)
          signal.removeEventListener('abort', onBranchAbort)
          return
        }
        this.callbacks.onStepLog({
          chainType,
          chainName: chain.name,
          nodeId: currentNode.id,
          stepIndex: branchStepIndex,
          stepType: step.type,
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      }

      this.unregisterNode(currentNode.id)
      signal.removeEventListener('abort', onBranchAbort)
      const jumpNode = this.consumeJumpTarget(ctx, Array.from(nodeMap.values()), nodeMap)
      currentNode = jumpNode ?? this.getNextNode(currentNode.id, edges, ctx, nodeMap, step)
      branchStepIndex++
    }
  }

  evaluateCondition(condition: StepCondition, variables: Record<string, unknown>): boolean {
    if (isCompoundCondition(condition)) {
      const results = condition.conditions.map((c) => this.evaluateSingleCondition(c, variables))
      return condition.logic === 'and' ? results.every(Boolean) : results.some(Boolean)
    }
    return this.evaluateSingleCondition(condition, variables)
  }

  private evaluateSingleCondition(
    cond: { variable: string; operator: string; value: string },
    vars: Record<string, unknown>
  ): boolean {
    const actual = vars[cond.variable]
    if (actual === undefined) return false
    switch (cond.operator) {
      case 'equals':
        return String(actual) === cond.value
      case 'not_equals':
        return String(actual) !== cond.value
      case 'contains':
        return String(actual).includes(cond.value)
      case 'is_true':
        return actual === true
      case 'is_false':
        return actual === false
      case 'greater_than':
        return Number(actual) > Number(cond.value)
      case 'less_than':
        return Number(actual) < Number(cond.value)
      default:
        return true
    }
  }

  formatConditionForLog(condition: StepCondition): string {
    if (isCompoundCondition(condition)) {
      const logic = condition.logic === 'and' ? ' AND ' : ' OR '
      return condition.conditions
        .map((c) => {
          if (c.operator === 'is_true' || c.operator === 'is_false')
            return `${c.variable} ${c.operator}`
          return `${c.variable} ${c.operator} "${c.value}"`
        })
        .join(logic)
    }
    if (condition.operator === 'is_true' || condition.operator === 'is_false')
      return `${condition.variable} ${condition.operator}`
    return `${condition.variable} ${condition.operator} "${condition.value}"`
  }

  scaleFactorForRect(rect: ScreenRect): number {
    try {
      return screen.getDisplayMatching(rect).scaleFactor || this.scaleFactor
    } catch {
      return this.scaleFactor
    }
  }

  dipPointToInput(x: number, y: number): [number, number] {
    if (process.platform === 'win32') {
      const point = screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) })
      return [Math.round(point.x), Math.round(point.y)]
    }
    return [Math.round(x * this.scaleFactor), Math.round(y * this.scaleFactor)]
  }

  async resolveUiSearchRect(
    step: ActionStep,
    configuredTarget: Region,
    expectedTarget: Region,
    ctx: StepContext,
    logLabel: string
  ): Promise<ScreenRect> {
    const searchScope =
      step.params?.uiSearchScope ?? (step.params?.uiSearchRegion ? 'region' : 'nearby')
    if (searchScope === 'window') {
      const anchorId = step.params?.uiSearchWindowAnchorId ?? configuredTarget.windowAnchorId
      const anchor = this.workspace?.windowAnchors?.find((item) => item.id === anchorId)
      if (!anchor) throw new Error(`${logLabel}：请选择有效的搜索窗口锚点`)
      const windowBounds = await this.resolveAndCacheWindowAnchor(anchor)
      if (!windowBounds) throw new Error(`${logLabel}：未找到搜索窗口 "${anchor.name}"`)
      return windowBounds
    }
    if (searchScope === 'region') {
      const explicitSearchRegion = step.params?.uiSearchRegion
        ? await this.resolveRegion(step.params.uiSearchRegion, ctx)
        : null
      if (!explicitSearchRegion) throw new Error(`${logLabel}：请选择有效的限制搜索区域`)
      return explicitSearchRegion.rect
    }
    return this.expandAndClipRect(expectedTarget.rect, step.params?.uiSearchPadding ?? 120)
  }

  expandAndClipRect(rect: ScreenRect, padding: number): ScreenRect {
    const safePadding = Math.max(0, Math.round(padding))
    const display = screen.getDisplayMatching(rect)
    const left = Math.max(display.bounds.x, rect.x - safePadding)
    const top = Math.max(display.bounds.y, rect.y - safePadding)
    const right = Math.min(
      display.bounds.x + display.bounds.width,
      rect.x + rect.width + safePadding
    )
    const bottom = Math.min(
      display.bounds.y + display.bounds.height,
      rect.y + rect.height + safePadding
    )
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.max(1, Math.round(right - left)),
      height: Math.max(1, Math.round(bottom - top))
    }
  }

  async resolveAndCacheWindowAnchor(
    anchor: WindowAnchor,
    forceRefresh = false
  ): Promise<ScreenRect | null> {
    if (!forceRefresh) {
      const cachedBounds = this.windowBoundsCache.get(anchor.id)
      if (cachedBounds) return cachedBounds

      const pendingResolution = this.windowResolutionPromises.get(anchor.id)
      if (pendingResolution) return pendingResolution
    } else {
      this.windowBoundsCache.delete(anchor.id)
    }

    const pendingResolution = resolveWindowAnchorBounds(anchor)
      .then((bounds) => {
        if (bounds) {
          this.windowBoundsCache.set(anchor.id, bounds)
          this.windowResolutionWarnings.delete(`window-not-found:${anchor.id}`)
        } else {
          this.windowBoundsCache.delete(anchor.id)
        }
        return bounds
      })
      .catch(() => {
        this.windowBoundsCache.delete(anchor.id)
        return null
      })

    this.windowResolutionPromises.set(anchor.id, pendingResolution)
    try {
      return await pendingResolution
    } finally {
      if (this.windowResolutionPromises.get(anchor.id) === pendingResolution) {
        this.windowResolutionPromises.delete(anchor.id)
      }
    }
  }

  async resolveConfiguredRegion(region: Region): Promise<Region | null> {
    if (region.coordinateMode !== 'window') return region
    const anchorId = region.windowAnchorId
    const anchor = this.workspace?.windowAnchors?.find((item) => item.id === anchorId)
    if (!anchor) {
      const warningKey = `missing-anchor:${anchorId ?? ''}`
      if (!this.windowResolutionWarnings.has(warningKey)) {
        this.windowResolutionWarnings.add(warningKey)
        this.callbacks.onLog(`区域 "${region.name}" 的窗口锚点不存在，已跳过`)
      }
      return null
    }

    const currentBounds = await this.resolveAndCacheWindowAnchor(anchor)
    if (!currentBounds) {
      const warningKey = `window-not-found:${anchor.id}`
      if (!this.windowResolutionWarnings.has(warningKey)) {
        this.windowResolutionWarnings.add(warningKey)
        this.callbacks.onLog(`未找到窗口锚点 "${anchor.name}"，关联区域暂不执行`)
      }
      return null
    }

    const widthDelta = Math.abs(currentBounds.width - anchor.capturedBounds.width)
    const heightDelta = Math.abs(currentBounds.height - anchor.capturedBounds.height)
    if (widthDelta > 4 || heightDelta > 4) {
      const warningKey = `window-resized:${anchor.id}`
      if (!this.windowResolutionWarnings.has(warningKey)) {
        this.windowResolutionWarnings.add(warningKey)
        this.callbacks.onLog(
          `窗口 "${anchor.name}" 尺寸已变化（捕获 ${anchor.capturedBounds.width}×${anchor.capturedBounds.height}，当前 ${currentBounds.width}×${currentBounds.height}）；区域仍按固定相对偏移执行`
        )
      }
    }

    return {
      ...region,
      rect: {
        x: currentBounds.x + region.rect.x,
        y: currentBounds.y + region.rect.y,
        width: region.rect.width,
        height: region.rect.height
      }
    }
  }

  async resolveRegion(name: string | undefined, ctx: StepContext): Promise<Region | null> {
    if (!name) return null
    const runtimeRegion = this.uiRegionCache.get(name)
    if (runtimeRegion) return runtimeRegion
    const configuredRegion = ctx.regions.find((region) => region.name === name)
    if (!configuredRegion) return null
    return this.resolveConfiguredRegion(configuredRegion)
  }

  resolveTemplate(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{([^}]+)\}/g, (_, path) => {
      const val = this.resolveVariablePath(path.trim(), variables)
      return String(val ?? `{${path}}`)
    })
  }

  resolveVariablePath(path: string, variables: Record<string, unknown>): unknown {
    if (path === '' || variables == null) return undefined
    let current: unknown = variables
    const parts = path.split('.')
    for (const part of parts) {
      if (current == null) return undefined
      const bracketMatch = part.match(/^(\w+)\[(\d+)\]$/)
      if (bracketMatch) {
        const key = bracketMatch[1]
        const idx = parseInt(bracketMatch[2], 10)
        const obj = (current as Record<string, unknown>)[key]
        if (!Array.isArray(obj)) return undefined
        current = obj[idx]
        continue
      }
      const bareBracketMatch = part.match(/^\[(\d+)\]$/)
      if (bareBracketMatch) {
        const idx = parseInt(bareBracketMatch[1], 10)
        if (!Array.isArray(current)) return undefined
        current = current[idx]
        continue
      }
      if (typeof current !== 'object' || current === null) return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  /** 万能坐标解析：处理AI返回的各种奇葩格式，返回 [x, y] 或 null */
  private parseCoordinate(point: unknown): [number, number] | null {
    if (point == null) return null

    // 对象格式 {"x": number, "y": number}
    if (typeof point === 'object' && !Array.isArray(point)) {
      const p = point as Record<string | number, unknown>
      const x = p.x ?? p.left ?? p[0]
      const y = p.y ?? p.top ?? p[1]
      if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) {
        return [x, y]
      }
      return null
    }

    // 数组格式 [x, y]
    if (Array.isArray(point) && point.length >= 2) {
      const x = point[0]
      const y = point[1]
      if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) {
        return [x, y]
      }
      return null
    }

    // 字符串格式
    if (typeof point === 'string') {
      // 排除无效值
      if (point === '' || point === 'https://' || point === 'https:///' || point.includes('://')) {
        return null
      }

      // XML格式: <point>832 229</point>
      const xmlMatch = point.match(/<point>\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*<\/point>/)
      if (xmlMatch) {
        return [parseFloat(xmlMatch[1]), parseFloat(xmlMatch[2])]
      }

      // 逗号分隔: "352, 278" 或 "352,278"
      const commaMatch = point.match(/^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/)
      if (commaMatch) {
        return [parseFloat(commaMatch[1]), parseFloat(commaMatch[2])]
      }

      // 纯数字字符串: "352"
      const num = parseFloat(point)
      if (!isNaN(num) && isFinite(num)) {
        return [num, 0] // 只有x，y默认0
      }
    }

    return null
  }

  normalizedToScreen(point: AIPoint, region: ScreenRect): [number, number] {
    const parsed = this.parseCoordinate(point)
    const [screenX, screenY] = aiPointToRegionDip(parsed ?? [0, 0], region)
    return this.dipPointToInput(screenX, screenY)
  }

  validateActionInRegion(action: AIAction): boolean {
    if (action.type === 'type_text' || action.type === 'key_press' || action.type === 'hotkey') {
      return true
    }
    const posParsed = this.parseCoordinate(action.position)
    const fromParsed = this.parseCoordinate(action.from)
    const toParsed = this.parseCoordinate(action.to)
    if (!posParsed && !fromParsed && !toParsed) return false
    const points: [number, number][] = []
    if (posParsed) points.push(posParsed)
    if (fromParsed) points.push(fromParsed)
    if (toParsed) points.push(toParsed)
    return points.every((point) => isAIActionPointInBounds(point))
  }

  filterSafeActions(
    plan: AIActionPlan,
    region: ScreenRect | undefined,
    maxActions: number
  ): AIAction[] {
    const actions = plan.actions.slice(0, maxActions)
    if (!region) {
      this.callbacks.onLog('execute_ai_actions: 未指定限制区域，所有动作默认通过')
      return actions
    }
    return actions.filter((a) => {
      const ok = this.validateActionInRegion(a)
      if (!ok) {
        const detail = JSON.stringify({ from: a.from, to: a.to, text: a.text, keyName: a.keyName })
        this.callbacks.onLog(
          `execute_ai_actions: 越界过滤 · ${a.type} · 区域(${region.x},${region.y},${region.width}x${region.height}) · ${detail}${a.reason ? ' · ' + a.reason : ''}`
        )
      }
      return ok
    })
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new NodeAbortedError(this.currentNodeId))
        return
      }
      const timer = setTimeout(resolve, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(new NodeAbortedError(this.currentNodeId))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}
