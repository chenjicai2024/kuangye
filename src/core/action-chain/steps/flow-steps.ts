import { EngineApi, NodeAbortedError } from '../engine-api'
import { ActionStep, StepContext } from '../types'
import { calculateRedDotPercentage, captureScreenRegion } from '../../rpa/screenshot-utils'
import { normalizeRedDotThreshold, shouldResumeRedDotWait } from '../trigger-gate'

export async function executeCallChain(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const chainName = step.params?.callChainName
  if (!chainName) {
    throw new Error('调用动作链：未指定目标动作链')
  }
  // 先在执行链中查找，再在动作链中查找
  const targetExecChain = (api.workspace!.executionChains ?? []).find((c) => c.name === chainName)
  const targetChain = targetExecChain ?? api.workspace!.chains.find((c) => c.name === chainName)
  if (!targetChain) {
    throw new Error(`调用动作链：动作链"${chainName}"未找到`)
  }
  const chainLabel = targetExecChain ? '执行链' : '动作链'
  api.callbacks.onLog(`调用${chainLabel}: "${chainName}"`)
  // 给子链创建独立的变量副本，清除并行标记，避免主链的 parallel_winner 污染子链
  const subVariables = { ...ctx.variables }
  delete subVariables['parallel_winner']
  delete subVariables['parallel_winner_label']
  const subCtx: StepContext = { regions: ctx.regions, variables: subVariables }
  const subNodes = targetChain.nodes ?? []
  const subEdges = targetChain.edges ?? []
  const subNodeMap = api.buildNodeMap(subNodes)
  let subNode = api.findEntryNode(subNodes, subEdges)
  while (subNode && api.state.running) {
    const subStep = subNode.data
    if (subStep.condition && !api.evaluateCondition(subStep.condition, subCtx.variables)) {
      subNode = api.getNextNode(subNode.id, subEdges, subCtx, subNodeMap, subStep)
      continue
    }
    await api.executeStep(subStep, subCtx, signal)
    const jumpNode = api.consumeJumpTarget(subCtx, subNodes, subNodeMap)
    subNode = jumpNode ?? api.getNextNode(subNode.id, subEdges, subCtx, subNodeMap, subStep)
  }
  // 变量同步回父链
  Object.assign(ctx.variables, subCtx.variables)
  api.callbacks.onLog(`子链 "${chainName}" 执行完毕`)
}

export async function executeIfElse(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const condition = step.condition
  if (!condition) {
    throw new Error('条件分支：未设置判断条件')
  }
  const result = api.evaluateCondition(step.condition!, ctx.variables)
  api.callbacks.onLog(
    `条件判断: ${api.formatConditionForLog(step.condition!)} -> ${result ? 'true' : 'false'}`
  )
  // 分支走向由 getNextNode 根据 edges 和条件结果决定
}

export async function executeRandomBranch(
  api: EngineApi,
  _step: ActionStep,
  _ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  api.callbacks.onLog('随机分支开始抽取路线')
}

export async function executeJumpTo(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const targetNodeId = step.params?.jumpToNodeId
  const target = step.params?.jumpToStep
  if (!targetNodeId && target === undefined) {
    throw new Error('跳转：未设置目标节点')
  }
  ctx.jumpTargetNodeId = targetNodeId
  ctx.jumpTarget = target
  api.callbacks.onLog(
    targetNodeId ? `跳转到节点 ${targetNodeId}` : `跳转到第 ${(target ?? 0) + 1} 步`
  )
}

export async function executeParallel(
  _api: EngineApi,
  _step: ActionStep,
  _ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  // 并行节点本身不执行动作，分叉逻辑在 executeChain 主循环拦截处理
}

export async function executeParallelProcess(
  _api: EngineApi,
  _step: ActionStep,
  _ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  // 并行处理节点是汇聚点，协调逻辑在 executeChain 主循环拦截处理
}

export async function executeTrigger(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const mode = step.params?.triggerMode ?? 'start'
  const targetNodeId = step.params?.triggerTargetNodeId
  if (!targetNodeId) {
    api.callbacks.onLog('触发节点：未设置目标节点，跳过')
    return
  }
  if (mode === 'stop') {
    const controller = api.activeNodeControllers.get(targetNodeId)
    if (controller) {
      controller.abort()
      api.activeNodeControllers.delete(targetNodeId)
      api.callbacks.onLog(`触发节点：已停止节点 ${targetNodeId}`)
    } else {
      api.callbacks.onLog(`触发节点：目标节点 ${targetNodeId} 不在运行中`)
    }
  } else {
    // 启动模式：跳转到目标节点重新执行
    ctx.jumpTargetNodeId = targetNodeId
    api.callbacks.onLog(`触发节点：启动节点 ${targetNodeId}`)
  }
}

export async function executeWaitRedDot(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) throw new Error(`等待红点出现：区域"${step.region ?? ''}"未找到`)
  const threshold = normalizeRedDotThreshold(step.params?.redDotThreshold)
  const deadline = step.timeoutMs ? Date.now() + step.timeoutMs : Number.POSITIVE_INFINITY
  api.callbacks.onLog(`开始等待区域"${region.name}"红色像素比例超过 ${threshold.toFixed(2)}%`)

  while (api.state.running && !signal?.aborted) {
    const result = await captureScreenRegion(region.rect)
    if (!result.success || !result.screenshotBase64) {
      throw new Error('等待红点出现：截图失败')
    }
    const percentage = await calculateRedDotPercentage(result.screenshotBase64)
    if (percentage === null) throw new Error('等待红点出现：无法计算红色像素比例')
    const hasRed = shouldResumeRedDotWait(percentage, threshold)
    ctx.variables[`${region.name}_red_dot`] = hasRed
    ctx.variables[`${region.name}_red_ratio`] = percentage

    // "等待红点"是显式流程条件，而不是后台事件监听：进入节点时红点已经存在，
    // 也必须立即通过。上升沿去重只用于旧版链级触发，避免同一红点重复启动整条链。
    if (hasRed) {
      api.callbacks.onLog(
        `区域"${region.name}"达到红点阈值｜红色像素比例 ${percentage.toFixed(2)}% > ${threshold.toFixed(2)}%｜输出 ${region.name}_red_dot=true，${region.name}_red_ratio=${percentage.toFixed(2)}，继续执行流程`
      )
      return
    }
    if (Date.now() >= deadline) throw new Error(`区域"${region.name}"等待红点出现超时`)
    await api.sleep(500, signal)
  }
  if (signal?.aborted) throw new NodeAbortedError(api.currentNodeId)
  return
}
