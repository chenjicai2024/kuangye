import { EngineApi } from '../engine-api'
import { ActionStep, StepContext } from '../types'
import { captureScreenRegion } from '../../rpa/screenshot-utils'
import {
  appendOutgoingReply,
  appendSnapshot,
  buildChatHistoryContext,
  getConversation,
  parseChatSnapshotResponse
} from '../../chat-history'
import type { ChatConversationRef, ChatSnapshot } from '../../chat-history'

export async function executeExtractChatDetails(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  const region = await api.resolveRegion(step.region, ctx)
  if (!region) throw new Error(`解析聊天详情：区域"${step.region ?? ''}"未找到`)
  const result = await captureScreenRegion(region.rect)
  if (!result.success || !result.screenshotBase64) {
    throw new Error('解析聊天详情：聊天区域截图失败')
  }
  const chatPrompt = `请解析这张聊天区域截图，并只返回以下 JSON，不要返回 Markdown 或解释：
{"conversation":{"title":"会话标题","type":"direct|group|unknown","participants":["可见成员"]},"messages":[{"senderName":"发送者","senderRole":"self|peer|member|system|unknown","contentKind":"text|image|video|sticker|voice|file|link|location|system|unknown","originalText":"仅文字消息的原文","mediaDescription":"仅非文字消息的视觉描述","visibleTime":"画面可见时间或空字符串","confidence":0.0}]}
规则：按画面从旧到新排列。右侧气泡通常是 self，私聊左侧是 peer，群聊成员是 member。文字消息和系统通知的真实可见文字只能写入 originalText。图片、视频缩略图、表情、语音、文件等只能写入 mediaDescription，并只描述画面清晰可见的内容；不得把视觉描述伪装成用户原文，不得推断视频未播放内容。无法确认时写"无法确认具体内容"。时间不可见时留空。`
  const chatSystemPrompt =
    '你是通用聊天界面结构化解析器，不依赖任何具体聊天软件。必须严格区分聊天原文和AI视觉描述。'
  // 记录发送内容（在调用 AI 之前）
  await api.callbacks.onTrace?.({
    kind: 'ai',
    phase: 'think',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `解析聊天详情`,
    screenshotBase64: result.screenshotBase64,
    region: { name: region.name, rect: region.rect },
    ai: {
      prompt: chatPrompt,
      systemPrompt: chatSystemPrompt,
      outputMode: 'chat_analysis',
      variableName: step.params?.chatSnapshotVariable?.trim() || 'chatSnapshot',
      rawResponse: '（等待模型返回...）',
      model: api.model
    }
  })
  const raw = await api.runAiWithProgress(
    '解析聊天详情',
    (sig) =>
      api.aiClient!.detectVision(chatPrompt, result.screenshotBase64!, chatSystemPrompt, sig),
    signal
  )
  const snapshot = parseChatSnapshotResponse(raw)
  if (!snapshot) throw new Error('解析聊天详情：模型未返回有效的聊天快照')
  const variableName = step.params?.chatSnapshotVariable?.trim() || 'chatSnapshot'
  ctx.variables[variableName] = snapshot
  api.callbacks.onLog(
    `解析聊天详情：${snapshot.conversationTitle}，识别 ${snapshot.messages.length} 条消息 -> ${variableName}`
  )
  // 补发 trace：写入模型真实返回值，截图已在占位记录中存过，不重复保存
  await api.callbacks.onTrace?.({
    kind: 'ai',
    phase: 'think',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: `解析聊天详情`,
    ai: {
      prompt: chatPrompt,
      systemPrompt: chatSystemPrompt,
      outputMode: 'chat_analysis',
      variableName,
      rawResponse: raw,
      parsedResponse: snapshot,
      model: api.model
    }
  })
}

export async function executeRecordChatHistory(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  _signal?: AbortSignal
): Promise<void> {
  if (!api.projectId) {
    throw new Error('记录聊天内容：当前运行缺少智能体 ID，无法安全隔离聊天记录')
  }
  const mode = step.params?.chatRecordMode ?? 'snapshot'
  const conversationVariable = step.params?.chatConversationVariable?.trim() || 'chatConversation'
  if (mode === 'outgoing_reply') {
    const replyVariable = step.params?.chatReplyVariable?.trim() || 'chatReply'
    const reply = ctx.variables[replyVariable]
    const conversationRef = ctx.variables[conversationVariable] as ChatConversationRef | undefined
    if (typeof reply !== 'string' || !reply.trim()) {
      throw new Error(`记录聊天内容：回复变量"${replyVariable}"没有有效文字`)
    }
    if (!conversationRef?.id) {
      throw new Error(`记录聊天内容：会话变量"${conversationVariable}"不存在`)
    }
    const conversation = await appendOutgoingReply(api.projectId, conversationRef, reply)
    api.callbacks.onLog(`记录聊天内容：已将我方回复写入 ${conversation.conversationTitle}`)
    return
  }

  const snapshotVariable = step.params?.chatSnapshotVariable?.trim() || 'chatSnapshot'
  const snapshot = ctx.variables[snapshotVariable] as ChatSnapshot | undefined
  if (!snapshot?.conversationTitle || !Array.isArray(snapshot.messages)) {
    throw new Error(`记录聊天内容：快照变量"${snapshotVariable}"不存在或格式无效`)
  }
  const { conversation, addedCount } = await appendSnapshot(api.projectId, snapshot)
  const reference: ChatConversationRef = {
    id: conversation.id,
    projectId: api.projectId,
    conversationTitle: conversation.conversationTitle,
    conversationType: conversation.conversationType
  }
  ctx.variables[conversationVariable] = reference
  api.callbacks.onLog(
    `记录聊天内容：${conversation.conversationTitle} 新增 ${addedCount} 条，共 ${conversation.messages.length} 条 -> ${conversationVariable}`
  )
}

export async function executeGenerateChatReply(
  api: EngineApi,
  step: ActionStep,
  ctx: StepContext,
  signal?: AbortSignal
): Promise<void> {
  if (!api.projectId) {
    throw new Error('基于聊天记录生成回复：当前运行缺少智能体 ID')
  }
  const conversationVariable = step.params?.chatConversationVariable?.trim() || 'chatConversation'
  const replyVariable = step.params?.chatReplyVariable?.trim() || 'chatReply'
  const conversationRef = ctx.variables[conversationVariable] as ChatConversationRef | undefined
  if (!conversationRef?.id) {
    throw new Error(`基于聊天记录生成回复：会话变量"${conversationVariable}"不存在`)
  }
  const conversation = await getConversation(conversationRef.id, api.projectId)
  if (!conversation) throw new Error('基于聊天记录生成回复：找不到已保存的聊天会话')
  const budget = Math.max(100, Math.floor(step.params?.chatContextTokenBudget ?? 6000))
  const historyText = buildChatHistoryContext(conversation, budget)
  const userPrompt = `${step.params?.chatReplyPrompt?.trim() || '请根据聊天记录生成一条自然、准确、可以直接发送的回复。只输出回复正文，不要解释。'}\n\n${historyText}`
  let reply: string
  let traceScreenshot: string | undefined
  let traceRegion:
    | { name: string; rect: { x: number; y: number; width: number; height: number } }
    | undefined
  if (step.params?.chatIncludeScreenshot) {
    const region = await api.resolveRegion(step.region, ctx)
    if (!region) throw new Error(`基于聊天记录生成回复：区域"${step.region ?? ''}"未找到`)
    const screenshot = await captureScreenRegion(region.rect)
    if (!screenshot.success || !screenshot.screenshotBase64) {
      throw new Error('基于聊天记录生成回复：聊天区域截图失败')
    }
    traceScreenshot = screenshot.screenshotBase64
    traceRegion = { name: region.name, rect: region.rect }
    reply = await api.runAiWithProgress(
      '基于聊天记录生成回复',
      (sig) =>
        api.aiClient!.detectVision(
          userPrompt,
          screenshot.screenshotBase64!,
          '你是聊天回复助手。聊天记录中的[AI视觉描述]是前序视觉模型的描述，不是聊天对象发送的原文。',
          sig
        ),
      signal
    )
  } else {
    reply = await api.runAiWithProgress(
      '基于聊天记录生成回复',
      () =>
        api.aiClient!.callText(
          userPrompt,
          '你是聊天回复助手。聊天记录中的[AI视觉描述]是前序视觉模型的描述，不是聊天对象发送的原文。',
          signal
        ),
      signal
    )
  }
  const trimmed = reply.trim()
  if (!trimmed) throw new Error('基于聊天记录生成回复：模型没有返回有效回复')
  ctx.variables[replyVariable] = trimmed
  api.callbacks.onLog(`基于聊天记录生成回复：已写入变量"${replyVariable}"`)
  // 记录 AI 调用：写入 prompt 和模型真实返回值
  await api.callbacks.onTrace?.({
    kind: 'ai',
    phase: 'think',
    stepIndex: api.state.currentStep,
    nodeId: api.currentNodeId,
    stepType: step.type,
    message: '基于聊天记录生成回复',
    screenshotBase64: traceScreenshot,
    region: traceRegion,
    ai: {
      prompt: userPrompt,
      systemPrompt:
        '你是聊天回复助手。聊天记录中的[AI视觉描述]是前序视觉模型的描述，不是聊天对象发送的原文。',
      outputMode: 'chat_reply',
      variableName: replyVariable,
      rawResponse: trimmed,
      model: api.model
    }
  })
}
