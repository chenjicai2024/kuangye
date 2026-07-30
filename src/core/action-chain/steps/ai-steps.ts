import { EngineApi } from '../engine-api'
import { AIAction, AIActionPlan, ActionStep, OutputField, StepContext } from '../types'
import { captureScreenRegion } from '../../rpa/screenshot-utils'
import { readActionChainAsset } from '../assets'
import {
  dragAction,
  hotkeyAction,
  humanLikeClick,
  humanLikeMove,
  keyPressAction,
  rightClickAction,
  sendReplyByCoordsAction
} from '../../rpa/input-utils'
import { parseUiLayoutAdjustmentPlan } from '../ui-layout-adjustment'
import { buildStructuredPrompt, getTemplate } from '../ai-templates'

export async function executeScreenshotToAi(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) {
    throw new Error(`截图给AI：区域"${step.region ?? ''}"未找到`)
  }
  api.callbacks.onLog(`截图给AI "${region.name}"：正在截图`)
  const result = await captureScreenRegion(region.rect)
  if (!result.success || !result.screenshotBase64) {
    throw new Error('截图给AI：截图失败')
  }
  api.callbacks.onLog(`截图给AI "${region.name}"：截图完成`)

  const variableName = step.params?.variableName ?? 'reply'
  const outputMode = step.params?.outputMode ?? 'text'
  let tracePrompt = ''
  let traceReply = ''
  let traceParsed: unknown

  // 文本模式：兼容旧行为
  if (outputMode === 'text') {
    const aiPrompt = step.params?.aiPrompt ?? '请描述这张截图的内容'
    // 记录发送内容（在调用 AI 之前）
    await api.callbacks.onTrace?.({
      kind: 'ai',
      phase: 'think',
      stepIndex: api.state.currentStep,
      nodeId: api.currentNodeId,
      stepType: step.type,
      message: `AI 分析区域 "${region.name}"`,
      screenshotBase64: result.screenshotBase64,
      region: { name: region.name, rect: region.rect },
      ai: {
        prompt: aiPrompt,
        outputMode,
        variableName,
        rawResponse: '（等待模型返回...）',
        model: api.model
      }
    })
    const aiReply = await api.runAiWithProgress(
      `AI分析"${region.name}"`,
      (sig) => api.aiClient!.detectVision(aiPrompt, result.screenshotBase64!, undefined, sig),
      signal
    )
    ctx.variables[variableName] = aiReply.trim()
    api.callbacks.onLog(
      `AI 分析区域 "${region.name}" -> 变量 "${variableName}" = ${aiReply.slice(0, 80)}`
    )
    // 更新 trace 记录（添加模型返回）
    await api.callbacks.onTrace?.({
      kind: 'ai',
      phase: 'think',
      stepIndex: api.state.currentStep,
      nodeId: api.currentNodeId,
      stepType: step.type,
      message: `AI 分析区域 "${region.name}"`,
      ai: {
        prompt: aiPrompt,
        outputMode,
        variableName,
        rawResponse: aiReply,
        model: api.model
      }
    })
    return
  }

  // 结构化模式：加载 schema + 模板
  let effectiveSchema: OutputField[]
  let fullPrompt: string
  let systemPrompt: string | undefined

  if (outputMode === 'structured_json') {
    effectiveSchema = step.params?.outputSchema ?? []
    const schemaDesc = effectiveSchema.map((f) => `  "${f.name}": <${f.type}>`).join(',\n')
    fullPrompt =
      (step.params?.aiPrompt ?? '请分析这张截图的内容') +
      `\n\n请只返回一个 JSON 对象，格式如下（不要包含任何其他文字、markdown 代码块标记或解释）：\n{\n${schemaDesc}\n}`
    systemPrompt = undefined
  } else {
    const template = getTemplate(outputMode)
    if (!template) {
      throw new Error(`截图给AI：未知输出模式"${outputMode}"`)
    }
    effectiveSchema = template.outputSchema
    fullPrompt = buildStructuredPrompt(template, step.params?.aiPrompt)
    systemPrompt = template.systemPrompt
  }

  // 记录发送内容（在调用 AI 之前）
  await api.callbacks.onTrace?.({
    kind: 'ai',
    phase: 'think',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `AI 结构化分析 "${region.name}" [${outputMode}]`,
    screenshotBase64: result.screenshotBase64,
    region: { name: region.name, rect: region.rect },
    ai: {
      prompt: fullPrompt,
      systemPrompt,
      outputMode,
      variableName,
      rawResponse: '（等待模型返回...）',
      model: api.model
    }
  })

  const aiReply = await api.runAiWithProgress(
    `AI结构化分析"${region.name}"`,
    (sig) => api.aiClient!.detectVision(fullPrompt, result.screenshotBase64!, systemPrompt, sig),
    signal
  )
  tracePrompt = fullPrompt
  traceReply = aiReply
  ctx.variables[variableName] = aiReply.trim()

  const jsonMatch = aiReply.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      traceParsed = parsed
      // 把整个解析后的对象也存到 variableName 键下，
      // 这样 execute_ai_actions 可以直接读取整个 AIActionPlan
      if (outputMode === 'action_plan') {
        ctx.variables[variableName] = parsed
      }
      for (const field of effectiveSchema) {
        const val = parsed[field.name]
        if (val === undefined) continue
        switch (field.type) {
          case 'boolean':
            ctx.variables[field.name] = Boolean(val)
            break
          case 'number':
            ctx.variables[field.name] = Number(val)
            break
          case 'object':
          case 'array':
          case 'action_list':
          case 'point':
          case 'action':
          case 'rect':
            ctx.variables[field.name] = val
            break
          default:
            ctx.variables[field.name] = String(val)
        }
      }
      if (outputMode === 'chat_analysis') {
        const needReply = parsed.needReply === true
        const replyText = typeof parsed.replyText === 'string' ? parsed.replyText.trim() : ''
        const confidence = Number(parsed.confidence)
        const confidenceText = Number.isFinite(confidence)
          ? ` · 置信度 ${(confidence * 100).toFixed(0)}%`
          : ''
        const replySummary = replyText
          ? ` · 回复：${replyText.slice(0, 80)}`
          : parsed.replyText === undefined
            ? ' · 回复字段缺失'
            : ' · 无回复内容'
        api.callbacks.onLog(
          `AI分析 "${region.name}"：${needReply ? '需要回复' : '无需回复'}${confidenceText}${replySummary}`
        )
      } else {
        api.callbacks.onLog(
          `AI结构化分析 "${region.name}" [${outputMode}]：已写入变量 "${variableName}" 和 ${effectiveSchema.length} 个字段`
        )
      }
    } catch {
      api.callbacks.onLog(
        `AI 结构化分析 "${region.name}" JSON 解析失败，原始回复已存入 "${variableName}"`
      )
    }
  } else {
    api.callbacks.onLog(
      `AI 结构化分析 "${region.name}" 未返回 JSON，原始回复已存入 "${variableName}"`
    )
  }
  await api.callbacks.onTrace?.({
    kind: 'ai',
    phase: 'think',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `AI 分析区域 "${region.name}" [${outputMode}]`,
    ai: {
      prompt: tracePrompt,
      systemPrompt,
      outputMode,
      variableName,
      rawResponse: traceReply,
      parsedResponse: traceParsed,
      model: api.model
    }
  })
}

export async function executeExecuteAiActions(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const variableName = step.params?.variableName ?? 'aiActions'
  const plan = ctx.variables[variableName] as AIActionPlan | undefined
  if (!plan) {
    throw new Error(
      `执行AI动作：变量"${variableName}"不存在（可用变量：${Object.keys(ctx.variables).join(', ') || '无'}）`
    )
  }
  if (!plan.actions || !Array.isArray(plan.actions)) {
    throw new Error(
      `执行AI动作：变量"${variableName}"不是有效的动作计划（值：${JSON.stringify(plan).slice(0, 200)}）`
    )
  }
  if (plan.actions.length === 0) {
    api.callbacks.onLog(
      `execute_ai_actions: AI 返回了空 actions 数组（confidence=${plan.confidence ?? '?'}，reason="${plan.reason ?? ''}"）。游戏可能无可操作内容，或 AI 提示词需调整。`
    )
    return
  }
  api.callbacks.onLog(
    `execute_ai_actions: 收到 ${plan.actions.length} 个动作（confidence=${plan.confidence ?? '?'}）`
  )
  // 详细打印每个动作的信息
  for (let i = 0; i < plan.actions.length; i++) {
    const a = plan.actions[i]
    api.callbacks.onLog(
      `  [${i + 1}] type=${a.type} position=${JSON.stringify(a.position)} from=${JSON.stringify(a.from)} to=${JSON.stringify(a.to)} text="${a.text ?? ''}" key="${a.keyName ?? ''}" reason="${a.reason ?? ''}"`
    )
  }

  const minConf = step.params?.minConfidence ?? 0.7
  const maxAct = step.params?.maxActions ?? 3

  if (plan.confidence != null && plan.confidence < minConf) {
    api.callbacks.onLog(`execute_ai_actions: 置信度 ${plan.confidence} < 阈值 ${minConf}，跳过执行`)
    return
  }

  const region = await api.resolveRegion(step.region, ctx)
  const safeActions = api.filterSafeActions(plan, region?.rect, maxAct)

  if (safeActions.length === 0) {
    throw new Error('执行AI动作：没有通过安全检查的有效动作')
  }

  for (const action of safeActions) {
    if (!api.state.running || signal?.aborted) return
    const rect = region?.rect
    const sf = rect ? api.scaleFactorForRect(rect) : api.scaleFactor
    api.callbacks.onLog(
      `  执行前: action.type=${action.type} region=${JSON.stringify(rect)} scaleFactor=${sf}`
    )

    if (action.type === 'click') {
      const clickPos = action.position || action.from
      if (!clickPos || !rect) {
        api.callbacks.onLog(`  click: 缺少position或rect，跳过`)
        continue
      }
      const [px, py] = api.normalizedToScreen(clickPos, rect)
      api.callbacks.onLog(`  click: AI坐标=${JSON.stringify(clickPos)} -> 屏幕坐标=(${px},${py})`)
      await humanLikeMove(px, py)
      if (!api.state.running || signal?.aborted) return
      await humanLikeClick('left')
      await api.callbacks.onTrace?.({
        kind: 'action',
        phase: 'act',
        stepIndex: api.state.currentStep,
        nodeId: api.currentNodeId,
        stepType: step.type,
        message: `执行 AI 点击：屏幕坐标 (${px}, ${py})`,
        region: region ? { name: region.name, rect: region.rect } : undefined,
        action: {
          type: 'click',
          normalizedFrom: action.from,
          screenFrom: [px, py],
          reason: action.reason
        }
      })
    } else if (action.type === 'right_click') {
      const rightClickPos = action.position || action.from
      if (!rightClickPos || !rect) {
        api.callbacks.onLog(`  right_click: 缺少position或rect，跳过`)
        continue
      }
      const [px, py] = api.normalizedToScreen(rightClickPos, rect)
      api.callbacks.onLog(
        `  right_click: AI坐标=${JSON.stringify(rightClickPos)} -> 屏幕坐标=(${px},${py})`
      )
      await rightClickAction([px, py])
      await api.callbacks.onTrace?.({
        kind: 'action',
        phase: 'act',
        stepIndex: api.state.currentStep,
        nodeId: api.currentNodeId,
        stepType: step.type,
        message: `执行 AI 右键：屏幕坐标 (${px}, ${py})`,
        region: region ? { name: region.name, rect: region.rect } : undefined,
        action: {
          type: 'right_click',
          normalizedFrom: action.from,
          screenFrom: [px, py],
          reason: action.reason
        }
      })
    } else if (action.type === 'drag') {
      if (!action.from || !action.to || !rect) {
        api.callbacks.onLog(`  drag: 缺少from/to或rect，跳过`)
        continue
      }
      const [sx, sy] = api.normalizedToScreen(action.from, rect)
      const [ex, ey] = api.normalizedToScreen(action.to, rect)
      api.callbacks.onLog(
        `  drag: AI from=${JSON.stringify(action.from)} -> (${sx},${sy})  AI to=${JSON.stringify(action.to)} -> (${ex},${ey})`
      )
      await dragAction([sx, sy], [ex, ey])
      await api.callbacks.onTrace?.({
        kind: 'action',
        phase: 'act',
        stepIndex: api.state.currentStep,
        nodeId: api.currentNodeId,
        stepType: step.type,
        message: `执行 AI 拖动：(${sx}, ${sy}) -> (${ex}, ${ey})`,
        region: region ? { name: region.name, rect: region.rect } : undefined,
        action: {
          type: 'drag',
          normalizedFrom: action.from,
          normalizedTo: action.to,
          screenFrom: [sx, sy],
          screenTo: [ex, ey],
          reason: action.reason
        }
      })
    } else if (action.type === 'type_text') {
      const textPos = action.position || action.from
      if (!textPos || !action.text || !rect) {
        api.callbacks.onLog(`  type_text: 缺少position/text或rect，跳过`)
        continue
      }
      const [px, py] = api.normalizedToScreen(textPos, rect)
      api.callbacks.onLog(
        `  type_text: AI坐标=${JSON.stringify(textPos)} -> 屏幕坐标=(${px},${py})`
      )
      await sendReplyByCoordsAction(px, py, action.text)
      await api.callbacks.onTrace?.({
        kind: 'action',
        phase: 'act',
        stepIndex: api.state.currentStep,
        nodeId: api.currentNodeId,
        stepType: step.type,
        message: `执行 AI 输入：屏幕坐标 (${px}, ${py})`,
        region: region ? { name: region.name, rect: region.rect } : undefined,
        action: {
          type: 'type_text',
          normalizedFrom: action.from,
          screenFrom: [px, py],
          text: action.text,
          reason: action.reason
        }
      })
    } else if (action.type === 'key_press') {
      if (!action.keyName) {
        api.callbacks.onLog(`  key_press: 缺少keyName，跳过`)
        continue
      }
      await keyPressAction(action.keyName)
      await api.callbacks.onTrace?.({
        kind: 'action',
        phase: 'act',
        stepIndex: api.state.currentStep,
        nodeId: api.currentNodeId,
        stepType: step.type,
        message: `执行 AI 按键: ${action.keyName}`,
        action: { type: 'key_press', keyName: action.keyName, reason: action.reason }
      })
    } else if (action.type === 'hotkey') {
      if (!action.keyName) {
        api.callbacks.onLog(`  hotkey: 缺少keyName，跳过`)
        continue
      }
      await hotkeyAction(action.keyName, action.modifiers ?? [])
      await api.callbacks.onTrace?.({
        kind: 'action',
        phase: 'act',
        stepIndex: api.state.currentStep,
        nodeId: api.currentNodeId,
        stepType: step.type,
        message: `执行 AI 组合键: ${(action.modifiers ?? []).join('+')}+${action.keyName}`,
        action: {
          type: 'hotkey',
          keyName: action.keyName,
          modifiers: action.modifiers ?? [],
          reason: action.reason
        }
      })
    } else {
      api.callbacks.onLog(`execute_ai_actions: 未知动作类型 "${(action as AIAction).type}"`)
      continue
    }
    api.callbacks.onLog(`执行AI动作: ${action.type}${action.reason ? ' · ' + action.reason : ''}`)
  }
}

export async function executeAdjustUiLayout(
  api: EngineApi,
  step: ActionStep,
  _ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const anchor = api.workspace?.windowAnchors?.find(
    (item) => item.id === step.params?.windowAnchorId
  )
  if (!anchor) throw new Error('UI布局调整：请选择有效的窗口锚点')
  if (!anchor.capturedImagePath) {
    throw new Error(`UI布局调整：窗口"${anchor.name}"没有标准主窗口截图，请重新捕获窗口`)
  }
  const instruction = step.params?.layoutInstruction?.trim()
  if (!instruction) throw new Error('UI布局调整：请填写自然语言调整要求')

  const bounds = await api.resolveAndCacheWindowAnchor(anchor, true)
  if (!bounds) throw new Error(`UI布局调整：未找到窗口"${anchor.name}"`)
  const sizeDelta =
    Math.abs(bounds.width - anchor.capturedBounds.width) +
    Math.abs(bounds.height - anchor.capturedBounds.height)
  if (sizeDelta > 6) {
    throw new Error(
      `UI布局调整：窗口尺寸与标准图不一致（标准 ${anchor.capturedBounds.width}×${anchor.capturedBounds.height}，当前 ${bounds.width}×${bounds.height}），请先执行窗口校准`
    )
  }

  const currentCapture = await captureScreenRegion(bounds)
  if (!currentCapture.success || !currentCapture.screenshotBase64) {
    throw new Error('UI布局调整：截取当前窗口失败')
  }
  const referenceImage = await readActionChainAsset(anchor.capturedImagePath)
  const allowedAction = step.params?.layoutAllowedAction ?? 'drag'
  // 记录发送内容（在调用 AI 之前）
  await api.callbacks.onTrace?.({
    kind: 'ai',
    phase: 'think',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `UI布局调整`,
    screenshotBase64: currentCapture.screenshotBase64,
    region: { name: '当前窗口', rect: bounds },
    ai: {
      prompt: instruction,
      outputMode: 'layout_adjustment',
      variableName: '',
      rawResponse: '（等待模型返回...）',
      model: api.model
    }
  })
  const rawPlan = await api.runAiWithProgress(
    'UI布局调整',
    (sig) =>
      api.aiClient!.planUiLayoutAdjustment(
        instruction,
        referenceImage.toString('base64'),
        currentCapture.screenshotBase64!,
        allowedAction,
        sig
      ),
    signal
  )
  const plan = parseUiLayoutAdjustmentPlan(rawPlan)
  if (!plan.needAdjust) {
    api.callbacks.onLog(
      `UI布局调整：无需操作${plan.reason ? ` · ${plan.reason}` : ''} · 置信度 ${(plan.confidence * 100).toFixed(0)}%`
    )
    return
  }
  const minConfidence = Math.min(1, Math.max(0, step.params?.minConfidence ?? 0.85))
  if (plan.confidence < minConfidence) {
    throw new Error(
      `UI布局调整：AI置信度 ${(plan.confidence * 100).toFixed(0)}% 低于阈值 ${(minConfidence * 100).toFixed(0)}%，未执行鼠标动作`
    )
  }
  const action = plan.action
  if (!action || action.type !== allowedAction || !api.validateActionInRegion(action)) {
    throw new Error('UI布局调整：AI动作未通过类型或窗口边界检查')
  }
  if (!api.state.running || signal?.aborted) return

  if (action.type === 'drag' && action.from && action.to) {
    const [sx, sy] = api.normalizedToScreen(action.from, bounds)
    const [ex, ey] = api.normalizedToScreen(action.to, bounds)
    api.callbacks.onLog(
      `UI布局调整：准备拖动 (${sx}, ${sy}) -> (${ex}, ${ey})${action.reason ? ` · ${action.reason}` : ''}`
    )
    await dragAction([sx, sy], [ex, ey])
    await api.callbacks.onTrace?.({
      kind: 'action',
      phase: 'act',
      stepIndex: api.state.currentStep,
      nodeId: api.currentNodeId,
      stepType: step.type,
      message: `UI布局调整拖动：(${sx}, ${sy}) -> (${ex}, ${ey})`,
      action: {
        type: 'drag',
        normalizedFrom: action.from,
        normalizedTo: action.to,
        screenFrom: [sx, sy],
        screenTo: [ex, ey],
        reason: action.reason
      }
    })
  } else if (action.type === 'click' && action.from) {
    const [px, py] = api.normalizedToScreen(action.from, bounds)
    api.callbacks.onLog(
      `UI布局调整：准备点击 (${px}, ${py})${action.reason ? ` · ${action.reason}` : ''}`
    )
    await humanLikeMove(px, py)
    if (!api.state.running || signal?.aborted) return
    await humanLikeClick('left')
    await api.callbacks.onTrace?.({
      kind: 'action',
      phase: 'act',
      stepIndex: api.state.currentStep,
      nodeId: api.currentNodeId,
      stepType: step.type,
      message: `UI布局调整点击：屏幕坐标 (${px}, ${py})`,
      action: {
        type: 'click',
        normalizedFrom: action.from,
        screenFrom: [px, py],
        reason: action.reason
      }
    })
  }
  api.uiRegionCache.clear()
  api.callbacks.onLog(
    `UI布局调整完成：已执行一个${allowedAction === 'drag' ? '拖动' : '点击'}动作 · 置信度 ${(plan.confidence * 100).toFixed(0)}%`
  )
}
