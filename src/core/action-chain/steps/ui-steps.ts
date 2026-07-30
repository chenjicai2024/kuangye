import { EngineApi } from '../engine-api'
import { ActionStep, Region, StepContext } from '../types'
import { captureScreenRegion } from '../../rpa/screenshot-utils'
import { readActionChainAsset } from '../assets'
import { findTemplateMatch } from '../../rpa/template-match'
import { parseBBoxes } from '../../rpa/vision-utils'

export async function executeLocateUiRegion(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  const targetName = step.region
  const configuredTarget = ctx.regions.find((region) => region.name === targetName)
  if (!configuredTarget) {
    throw new Error(`定位UI区域：目标区域 "${targetName ?? ''}" 不存在`)
  }

  const mode = step.params?.uiLocateMode ?? 'template'
  let locatedRegion: Region
  let matchScore: number | undefined

  if (mode === 'relative') {
    const referenceName = step.params?.uiReferenceRegion
    if (!referenceName || referenceName === targetName) {
      throw new Error('定位UI区域：请选择另一个区域作为相对基准')
    }
    const reference = await api.resolveRegion(referenceName, ctx)
    if (!reference) throw new Error(`定位UI区域：基准区域 "${referenceName}" 不存在`)

    const configuredAbsolute = await api.resolveConfiguredRegion(configuredTarget)
    if (!configuredAbsolute) throw new Error(`定位UI区域：无法解析 "${targetName}" 的初始位置`)
    const offsetX = step.params?.uiOffsetX ?? configuredAbsolute.rect.x - reference.rect.x
    const offsetY = step.params?.uiOffsetY ?? configuredAbsolute.rect.y - reference.rect.y
    locatedRegion = {
      ...configuredTarget,
      coordinateMode: 'screen',
      windowAnchorId: undefined,
      rect: {
        x: Math.round(reference.rect.x + offsetX),
        y: Math.round(reference.rect.y + offsetY),
        width: configuredTarget.rect.width,
        height: configuredTarget.rect.height
      }
    }
  } else {
    if (!configuredTarget.templateImagePath) {
      throw new Error(
        `定位UI区域：区域 "${targetName}" 尚未保存模板图片，请重新打开框选界面并完成一次确认`
      )
    }
    const expectedTarget = await api.resolveConfiguredRegion(configuredTarget)
    if (!expectedTarget) throw new Error(`定位UI区域：无法解析 "${targetName}" 的初始位置`)

    const searchRect = await api.resolveUiSearchRect(
      step,
      configuredTarget,
      expectedTarget,
      ctx,
      '定位UI区域'
    )
    const screenshot = await captureScreenRegion(searchRect)
    if (!screenshot.success || !screenshot.nativeImage || !screenshot.display) {
      throw new Error(`定位UI区域：搜索范围截图失败`)
    }
    const templatePng = await readActionChainAsset(configuredTarget.templateImagePath)
    const currentScaleFactor = screenshot.display.scaleFactor || 1
    const preferredScale =
      currentScaleFactor / Math.max(0.1, configuredTarget.templateScaleFactor ?? 1)
    const threshold = step.params?.uiMatchThreshold ?? 0.82
    const match = await findTemplateMatch(
      screenshot.nativeImage.toPNG(),
      templatePng,
      preferredScale,
      threshold
    )
    if (!match) {
      throw new Error(`定位UI区域：未找到 "${targetName}"（匹配阈值 ${threshold}）`)
    }
    matchScore = match.score
    locatedRegion = {
      ...configuredTarget,
      coordinateMode: 'screen',
      windowAnchorId: undefined,
      rect: {
        x: Math.round(searchRect.x + match.x / currentScaleFactor),
        y: Math.round(searchRect.y + match.y / currentScaleFactor),
        width: Math.max(1, Math.round(match.width / currentScaleFactor)),
        height: Math.max(1, Math.round(match.height / currentScaleFactor))
      }
    }
  }

  api.uiRegionCache.set(configuredTarget.name, locatedRegion)
  const runtimeStates = {
    ...((ctx.variables.uiRegions as Record<string, unknown> | undefined) ?? {})
  }
  runtimeStates[configuredTarget.name] = {
    mode,
    rect: { ...locatedRegion.rect },
    score: matchScore,
    resolvedAt: Date.now()
  }
  ctx.variables.uiRegions = runtimeStates
  api.callbacks.onLog(
    `已定位UI区域 "${configuredTarget.name}": (${locatedRegion.rect.x}, ${locatedRegion.rect.y}) ${locatedRegion.rect.width}×${locatedRegion.rect.height}${matchScore === undefined ? '' : `，匹配度 ${(matchScore * 100).toFixed(1)}%`}`
  )
}

export async function executeAiLocateUiRegion(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const targetName = step.region
  const configuredTarget = ctx.regions.find((region) => region.name === targetName)
  if (!configuredTarget) {
    throw new Error(`AI视觉定位：目标区域 "${targetName ?? ''}" 不存在`)
  }
  const userPrompt = step.params?.uiVisionPrompt?.trim()
  if (!userPrompt) throw new Error('AI视觉定位：请填写要让AI寻找的目标描述')

  const expectedTarget = await api.resolveConfiguredRegion(configuredTarget)
  if (!expectedTarget) throw new Error(`AI视觉定位：无法解析 "${targetName}" 的初始位置`)
  const searchRect = await api.resolveUiSearchRect(
    step,
    configuredTarget,
    expectedTarget,
    ctx,
    'AI视觉定位'
  )
  const screenshot = await captureScreenRegion(searchRect)
  if (!screenshot.success || !screenshot.screenshotBase64) {
    throw new Error('AI视觉定位：搜索范围截图失败')
  }

  const referenceRegionName = step.params?.uiReferenceImageRegion
  let referenceImageBase64: string | undefined
  if (referenceRegionName) {
    const referenceRegion = ctx.regions.find((region) => region.name === referenceRegionName)
    if (!referenceRegion?.templateImagePath) {
      throw new Error(`AI视觉定位：参考区域 "${referenceRegionName}" 没有模板图片`)
    }
    const referencePng = await readActionChainAsset(referenceRegion.templateImagePath)
    referenceImageBase64 = `data:image/png;base64,${referencePng.toString('base64')}`
  }

  // 记录发送内容（在调用 AI 之前）
  await api.callbacks.onTrace?.({
    kind: 'ai',
    phase: 'think',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `AI 视觉定位区域 "${configuredTarget.name}"`,
    screenshotBase64: screenshot.screenshotBase64,
    region: { name: 'AI 搜索范围', rect: searchRect },
    ai: {
      prompt: userPrompt,
      outputMode: 'ui_location',
      variableName: configuredTarget.name,
      rawResponse: '（等待模型返回...）',
      model: api.model
    }
  })

  const aiReply = await api.aiClient!.detectUiLocation(
    userPrompt,
    screenshot.screenshotBase64,
    referenceImageBase64,
    signal
  )
  const bbox = parseBBoxes(aiReply)[0]
  if (!bbox || bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) {
    throw new Error(`AI视觉定位：没有识别出 "${targetName}" 的有效区域`)
  }
  const x1 = Math.max(0, Math.min(1000, bbox[0]))
  const y1 = Math.max(0, Math.min(1000, bbox[1]))
  const x2 = Math.max(0, Math.min(1000, bbox[2]))
  const y2 = Math.max(0, Math.min(1000, bbox[3]))
  const locatedRegion: Region = {
    ...configuredTarget,
    coordinateMode: 'screen',
    windowAnchorId: undefined,
    rect: {
      x: Math.round(searchRect.x + (x1 / 1000) * searchRect.width),
      y: Math.round(searchRect.y + (y1 / 1000) * searchRect.height),
      width: Math.max(1, Math.round(((x2 - x1) / 1000) * searchRect.width)),
      height: Math.max(1, Math.round(((y2 - y1) / 1000) * searchRect.height))
    }
  }

  api.uiRegionCache.set(configuredTarget.name, locatedRegion)
  const runtimeStates = {
    ...((ctx.variables.uiRegions as Record<string, unknown> | undefined) ?? {})
  }
  runtimeStates[configuredTarget.name] = {
    mode: 'vision',
    rect: { ...locatedRegion.rect },
    prompt: userPrompt,
    resolvedAt: Date.now()
  }
  ctx.variables.uiRegions = runtimeStates
  api.callbacks.onLog(
    `AI已定位区域 "${configuredTarget.name}": (${locatedRegion.rect.x}, ${locatedRegion.rect.y}) ${locatedRegion.rect.width}×${locatedRegion.rect.height}`
  )
  await api.callbacks.onTrace?.({
    kind: 'ai',
    phase: 'think',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `AI 视觉定位区域 "${configuredTarget.name}"`,
    ai: {
      prompt: userPrompt,
      outputMode: 'ui_location',
      variableName: configuredTarget.name,
      rawResponse: aiReply,
      parsedResponse: { bbox, resolvedRect: locatedRegion.rect, referenceRegionName },
      model: api.model
    }
  })
}
