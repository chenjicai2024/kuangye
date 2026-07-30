import { EngineApi, NodeAbortedError, rectCenter } from '../engine-api'
import { ActionStep, StepContext, WindowAnchor } from '../types'
import { resolveWaitDuration } from '../wait-utils'
import { calibrateWindowAnchor } from '../../rpa/window-anchor-utils'
import { createRandomMousePlan } from '../random-mouse'
import { clickPointInRegion } from '../click-position'
import {
  humanLikeClick,
  humanLikeMove,
  dragAction,
  hotkeyAction,
  keyPressAction,
  rightClickAction,
  typeTextByCoordsAction,
  typeTextProgressivelyByCoordsAction
} from '../../rpa/input-utils'
import { calculateRedDotPercentage, captureScreenRegion } from '../../rpa/screenshot-utils'
import { comparePngBuffers } from '../../rpa/image-compare'

export async function executeWait(
  api: EngineApi,
  step: ActionStep,
  _ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const waitMs = resolveWaitDuration(step.params ?? {})
  api.callbacks.onLog(`${step.params?.waitMode === 'random' ? '随机等待' : '等待'} ${waitMs}ms`)
  await api.sleep(waitMs, signal)
}

export async function executeRefreshWindowAnchor(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const allAnchors = api.workspace?.windowAnchors ?? []
  const anchors = step.params?.refreshAllWindowAnchors
    ? allAnchors
    : [
        allAnchors.find((anchor) => anchor.id === step.params?.windowAnchorId) ?? allAnchors[0]
      ].filter((anchor): anchor is WindowAnchor => Boolean(anchor))

  if (anchors.length === 0) {
    throw new Error(
      step.params?.refreshAllWindowAnchors
        ? '项目中没有可校准的窗口锚点'
        : '窗口校准节点尚未选择有效的窗口锚点'
    )
  }

  const runtimeStates = {
    ...((ctx.variables.windowAnchors as Record<string, unknown> | undefined) ?? {})
  }
  for (const anchor of anchors) {
    const calibration = await calibrateWindowAnchor(anchor)
    if (!calibration) {
      throw new Error(`未找到窗口锚点 "${anchor.name}"`)
    }
    if (!calibration.calibrated) {
      throw new Error(
        `窗口校准失败 "${anchor.name}"：目标 ${calibration.expected.width}×${calibration.expected.height}，实际 ${calibration.actual.width}×${calibration.actual.height}`
      )
    }

    const bounds = await api.resolveAndCacheWindowAnchor(anchor, true)
    if (!bounds) throw new Error(`窗口校准后无法重新读取 "${anchor.name}"`)
    runtimeStates[anchor.id] = {
      name: anchor.name,
      bounds: { ...bounds },
      resolvedAt: Date.now()
    }
    api.callbacks.onLog(
      `窗口校准完成 "${anchor.name}"：${calibration.before.width}×${calibration.before.height} -> ${bounds.width}×${bounds.height}，已确认与捕获尺寸一致`
    )
    api.windowResolutionWarnings.delete(`window-resized:${anchor.id}`)
  }
  ctx.variables.windowAnchors = runtimeStates
  api.uiRegionCache.clear()
  api.callbacks.onLog('窗口校准已确认，旧的UI区域定位缓存已清除')
}

export async function executeRelocateWindowAnchor(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const allAnchors = api.workspace?.windowAnchors ?? []
  const anchors = step.params?.refreshAllWindowAnchors
    ? allAnchors
    : [
        allAnchors.find((anchor) => anchor.id === step.params?.windowAnchorId) ?? allAnchors[0]
      ].filter((anchor): anchor is WindowAnchor => Boolean(anchor))

  if (anchors.length === 0) {
    throw new Error(
      step.params?.refreshAllWindowAnchors
        ? '项目中没有可重新定位的窗口锚点'
        : '重新定位窗口节点尚未选择有效的窗口锚点'
    )
  }

  const runtimeStates = {
    ...((ctx.variables.windowAnchors as Record<string, unknown> | undefined) ?? {})
  }
  for (const anchor of anchors) {
    const bounds = await api.resolveAndCacheWindowAnchor(anchor, true)
    if (!bounds) throw new Error(`未找到窗口锚点 "${anchor.name}"`)
    runtimeStates[anchor.id] = {
      name: anchor.name,
      bounds: { ...bounds },
      resolvedAt: Date.now()
    }
    api.callbacks.onLog(
      `已重新定位窗口 "${anchor.name}"：(${bounds.x}, ${bounds.y}) ${bounds.width}×${bounds.height}`
    )
  }
  ctx.variables.windowAnchors = runtimeStates
  api.uiRegionCache.clear()
  api.callbacks.onLog('窗口位置已更新，旧的UI区域定位缓存已清除')
}

export async function executeClick(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) {
    throw new Error(`点击：区域"${step.region ?? ''}"未找到`)
  }
  const positionMode = step.params?.clickPositionMode ?? 'center'
  const [cx, cy] = clickPointInRegion(region.rect, positionMode)
  const [px, py] = api.dipPointToInput(cx, cy)
  await humanLikeMove(px, py)
  if (!api.state.running || signal?.aborted) return
  const policy = step.params?.clickPolicy ?? 'single'
  if (policy === 'double') {
    await humanLikeClick('left')
    if (!api.state.running || signal?.aborted) return
    await api.sleep(60, signal)
    if (!api.state.running || signal?.aborted) return
    await humanLikeClick('left')
  } else {
    await humanLikeClick('left')
  }
  const positionLabel = positionMode === 'random' ? '区域内安全随机' : '固定中心'
  api.callbacks.onLog(
    `点击区域"${region.name}"：${policy === 'double' ? '双击' : '单击'}｜${positionLabel}位置 (${px}, ${py})`
  )
  await api.callbacks.onTrace?.({
    kind: 'action',
    phase: 'act',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `点击区域 "${region.name}" (${policy}, ${positionMode})，屏幕坐标 (${px}, ${py})`,
    region: { name: region.name, rect: region.rect },
    action: { type: 'click', policy, screenFrom: [px, py] }
  })
}

export async function executeRightClick(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) {
    throw new Error(`右键点击：区域"${step.region ?? ''}"未找到`)
  }
  const [cx, cy] = rectCenter(region.rect)
  const [px, py] = api.dipPointToInput(cx, cy)
  await rightClickAction([px, py])
  api.callbacks.onLog(`右键点击区域 "${region.name}"`)
  await api.callbacks.onTrace?.({
    kind: 'action',
    phase: 'act',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `右键点击 "${region.name}"，屏幕坐标 (${px}, ${py})`,
    region: { name: region.name, rect: region.rect },
    action: { type: 'right_click', screenFrom: [px, py] }
  })
}

export async function executeDrag(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const startRegion = await api.resolveRegion(step.region, ctx)
  if (!startRegion) {
    throw new Error(`拖动：起点区域"${step.region ?? ''}"未找到`)
  }
  const endRegion = await api.resolveRegion(step.params?.dragEndRegion, ctx)
  if (!endRegion) {
    throw new Error(`拖动：终点区域"${step.params?.dragEndRegion ?? ''}"未找到`)
  }
  const [sx, sy] = rectCenter(startRegion.rect)
  const [ex, ey] = rectCenter(endRegion.rect)
  const [startPx, startPy] = api.dipPointToInput(sx, sy)
  const [endPx, endPy] = api.dipPointToInput(ex, ey)
  await dragAction([startPx, startPy], [endPx, endPy])
  api.callbacks.onLog(`从区域 "${startRegion.name}" 拖动到 "${endRegion.name}"`)
  await api.callbacks.onTrace?.({
    kind: 'action',
    phase: 'act',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `拖动 (${startPx}, ${startPy}) -> (${endPx}, ${endPy})`,
    region: { name: startRegion.name, rect: startRegion.rect },
    action: { type: 'drag', screenFrom: [startPx, startPy], screenTo: [endPx, endPy] }
  })
}

export async function executeTypeText(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) {
    throw new Error(`输入文字：区域"${step.region ?? ''}"未找到`)
  }
  const template = step.params?.textTemplate ?? ''
  const text = api.resolveTemplate(template, ctx.variables)
  const [cx, cy] = rectCenter(region.rect)
  const [px, py] = api.dipPointToInput(cx, cy)
  const progressive = step.params?.textInputMode === 'progressive'
  const typed = progressive
    ? await typeTextProgressivelyByCoordsAction(px, py, text, {
        strategy: step.params?.textChunkStrategy,
        minChunkSize: step.params?.textChunkMin,
        maxChunkSize: step.params?.textChunkMax,
        minDelayMs: step.params?.textChunkDelayMinMs,
        maxDelayMs: step.params?.textChunkDelayMaxMs
      })
    : await typeTextByCoordsAction(px, py, text)
  if (!typed) throw new Error('输入文字：文字输入失败')
  api.callbacks.onLog(
    `在区域 "${region.name}" ${progressive ? '渐进输入' : '输入'}: ${text.slice(0, 50)}`
  )
  await api.callbacks.onTrace?.({
    kind: 'action',
    phase: 'act',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `在区域 "${region.name}" ${progressive ? '渐进输入' : '输入'}文本，屏幕坐标 (${px}, ${py})`,
    region: { name: region.name, rect: region.rect },
    action: { type: 'type_text', screenFrom: [px, py], text }
  })
}

export async function executeKeyPress(
  api: EngineApi,
  step: ActionStep,
  _ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const keyName = step.params?.keyName
  if (!keyName) {
    throw new Error('按键：未设置按键')
  }
  await keyPressAction(keyName)
  api.callbacks.onLog(`按下按键: ${keyName}`)
  await api.callbacks.onTrace?.({
    kind: 'action',
    phase: 'act',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `按下按键: ${keyName}`,
    action: { type: 'key_press', keyName }
  })
}

export async function executeHotkey(
  api: EngineApi,
  step: ActionStep,
  _ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const hotkeyName = step.params?.keyName
  if (!hotkeyName) {
    throw new Error('组合键：未设置主键')
  }
  await hotkeyAction(hotkeyName, step.params?.modifiers ?? [])
  api.callbacks.onLog(`按下组合键: ${(step.params?.modifiers ?? []).join('+')}+${hotkeyName}`)
  await api.callbacks.onTrace?.({
    kind: 'action',
    phase: 'act',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `按下组合键: ${(step.params?.modifiers ?? []).join('+')}+${hotkeyName}`,
    action: { type: 'hotkey', keyName: hotkeyName, modifiers: step.params?.modifiers ?? [] }
  })
}

export async function executeRandomMouse(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) throw new Error(`随机鼠标：区域"${step.region ?? ''}"未找到`)
  const plan = createRandomMousePlan(region.rect, {
    minMoves: step.params?.randomMouseMinMoves,
    maxMoves: step.params?.randomMouseMaxMoves,
    minPauseMs: step.params?.randomMousePauseMinMs,
    maxPauseMs: step.params?.randomMousePauseMaxMs
  })
  let lastPoint: [number, number] | undefined
  api.callbacks.onLog(`随机鼠标将在区域"${region.name}"内移动 ${plan.length} 次`)
  for (const [index, move] of plan.entries()) {
    if (!api.state.running || signal?.aborted) return
    const [px, py] = api.dipPointToInput(move.x, move.y)
    await humanLikeMove(px, py)
    if (!api.state.running || signal?.aborted) return
    lastPoint = [px, py]
    api.callbacks.onLog(
      `随机鼠标 ${index + 1}/${plan.length}：移动到 (${px}, ${py})，停顿 ${move.pauseAfterMs}ms`
    )
    if (move.pauseAfterMs > 0) await api.sleep(move.pauseAfterMs, signal)
  }
  await api.callbacks.onTrace?.({
    kind: 'action',
    phase: 'act',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `在区域"${region.name}"内完成 ${plan.length} 次随机鼠标移动`,
    region: { name: region.name, rect: region.rect },
    action: {
      type: 'random_mouse',
      screenTo: lastPoint,
      reason: `随机移动 ${plan.length} 次，全程未点击`
    }
  })
}

export async function executeDetectPixelChange(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) {
    throw new Error(`等待像素变化：区域"${step.region ?? ''}"未找到`)
  }
  // 在步骤中使用时：先存基线，然后轮询等待变化
  const result = await captureScreenRegion(region.rect)
  if (!result.success || !result.nativeImage) throw new Error('等待像素变化：基线截图失败')
  api.baselines.set(region.name, result.nativeImage.toPNG())
  api.callbacks.onLog(`设置像素基线: "${region.name}"`)

  const deadline = step.timeoutMs ? Date.now() + step.timeoutMs : Number.POSITIVE_INFINITY
  const changeThreshold = step.params?.pixelChangeThreshold ?? 0.5
  while (api.state.running && !signal?.aborted) {
    await api.sleep(500, signal)
    const result = await api.checkPixelChange(region, changeThreshold)
    if (result.hasChanged) {
      ctx.variables[`${region.name}_changed`] = true
      ctx.variables[`${region.name}_change_ratio`] = result.diffPercentage
      return
    }
    if (Date.now() >= deadline) throw new Error(`区域"${region.name}"等待像素变化超时`)
  }
  if (signal?.aborted) throw new NodeAbortedError(api.currentNodeId)
  return
}

export async function executeCheckPixelDiff(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) {
    throw new Error(`像素检测：区域"${step.region ?? ''}"未找到`)
  }
  const baseline = api.baselines.get(region.name)
  if (!baseline) {
    ctx.variables[`${region.name}_diff`] = false
    api.callbacks.onLog(`像素检测：区域"${region.name}"没有基线｜输出 ${region.name}_diff=false`)
    return
  }
  const result = await captureScreenRegion(region.rect)
  if (!result.success || !result.nativeImage) {
    throw new Error(`像素检测：区域"${region.name}"截图失败`)
  }
  const current = result.nativeImage.toPNG()
  const changeThreshold = step.params?.pixelChangeThreshold ?? 0.5
  const diff = comparePngBuffers(baseline, current, { threshold: 0.1, changeThreshold })
  ctx.variables[`${region.name}_diff`] = diff.hasChanged
  ctx.variables[`${region.name}_diff_ratio`] = diff.diffPercentage
  api.callbacks.onLog(
    `像素对比 "${region.name}": ${diff.hasChanged ? '有变化' : '无变化'} (${diff.diffPercentage.toFixed(1)}%)｜输出 ${region.name}_diff=${diff.hasChanged}，${region.name}_diff_ratio=${diff.diffPercentage.toFixed(2)}`
  )
}

export async function executeSetBaseline(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) {
    throw new Error(`刷新像素：区域"${step.region ?? ''}"未找到`)
  }
  const result = await captureScreenRegion(region.rect)
  if (!result.success || !result.nativeImage) {
    throw new Error(`刷新像素：区域"${region.name}"截图失败`)
  }
  api.baselines.set(region.name, result.nativeImage.toPNG())
  api.callbacks.onLog(`像素已刷新: "${region.name}"`)
}

export async function executeDetectRedDot(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) {
    throw new Error(`检测红点：区域"${step.region ?? ''}"未找到`)
  }
  const result = await captureScreenRegion(region.rect)
  if (!result.success || !result.screenshotBase64) throw new Error('检测红点：截图失败')
  const percentage = await calculateRedDotPercentage(result.screenshotBase64)
  if (percentage === null) throw new Error('检测红点：无法计算红色像素比例')
  ctx.variables[`${region.name}_red_ratio`] = percentage
  api.callbacks.onLog(
    `检测红点"${region.name}"：红色像素比例 ${percentage.toFixed(2)}%｜输出 ${region.name}_red_ratio=${percentage.toFixed(2)}`
  )
}

export async function executeLoopCounter(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const maxCount = step.params?.loopMaxCount

  if (!maxCount || maxCount <= 0) {
    api.callbacks.onLog('循环计数器：未设置最大次数，直接通过')
    return
  }

  const counterKey = `__loop_counter_${api.currentNodeId}`
  const count = ((ctx.variables[counterKey] as number) ?? 0) + 1
  ctx.variables[counterKey] = count

  api.callbacks.onLog(
    `循环计数器：第 ${count}/${maxCount} 次${count >= maxCount ? '（达到上限，退出循环）' : ''}`
  )
}
