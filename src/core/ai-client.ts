// src/core/ai-client.ts
// AI 客户端 — 统一封装所有大模型调用
//
// 使用火山引擎 Ark OpenAI 兼容 /chat/completions 端点
// 用途：VLM 视觉检测：截图 → AI 分析 → bbox/point 坐标

import { AppType } from './rpa/types'
import { getErrorMessage, isRecord } from './error-utils'
import { AITokenUsageReport, extractTokenUsage } from './token-usage'

type ChatMessageContent =
  | string
  | Array<{ type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string }>

interface ChatMessage {
  role: 'system' | 'user'
  content: ChatMessageContent
}

export interface AIClientConfig {
  apiKey: string
  model: string
  baseURL: string
  timeoutMs?: number
  systemPrompt: string
  appType?: AppType
  usageProvider?: string
  usageSource?: string
  onUsage?: (report: AITokenUsageReport) => void
  /** 发送前压缩图片，避免大图导致 API 超时。由主进程注入 nativeImage 实现。 */
  compressImageBase64?: (base64: string) => string
}

const DEFAULT_MODEL = 'doubao-seed-2-0-lite-260215'
const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

export class AIClient {
  private config: AIClientConfig
  private lastFinishReason?: string

  constructor(config: Partial<AIClientConfig> & { apiKey: string }) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || DEFAULT_MODEL,
      baseURL: config.baseURL || DEFAULT_BASE_URL,
      timeoutMs: normalizeTimeout(config.timeoutMs),
      systemPrompt: config.systemPrompt || '你是一个视觉分析专家。',
      usageProvider: config.usageProvider || 'volcengine-ark',
      usageSource: config.usageSource || 'vision',
      onUsage: config.onUsage,
      compressImageBase64: config.compressImageBase64
    }
  }

  getLastFinishReason(): string | undefined {
    return this.lastFinishReason
  }

  /**
   * VLM 视觉检测 — 发送截图 + prompt，获取 bbox/point 文本
   * 供 vision-utils.ts 和 action-chain/engine.ts 调用
   */
  async detectVision(
    prompt: string,
    screenshotBase64: string,
    systemPrompt?: string,
    signal?: AbortSignal
  ): Promise<string> {
    return await this.callVision(
      systemPrompt || '你是一个视觉分析专家。请严格按照用户要求的格式输出检测结果。',
      prompt,
      screenshotBase64,
      signal
    )
  }

  /**
   * UI视觉定位：可同时发送参考图片和当前搜索范围图片。
   * 图片角色与坐标协议由程序固定，用户只负责描述要寻找的目标。
   */
  async detectUiLocation(
    userRequest: string,
    searchImageBase64: string,
    referenceImageBase64?: string,
    signal?: AbortSignal
  ): Promise<string> {
    const content: Exclude<ChatMessageContent, string> = []
    if (referenceImageBase64) {
      content.push({
        type: 'text',
        text: '【参考图片】这张图片只用于展示目标UI元素可能的外观，不得基于这张图片返回坐标。'
      })
      content.push({
        type: 'image_url',
        image_url: { url: this.toImageUrl(referenceImageBase64) }
      })
    }
    content.push({
      type: 'text',
      text: '【搜索范围图片】必须在下面这张图片中寻找目标，返回坐标只能相对于这张图片。'
    })
    content.push({
      type: 'image_url',
      image_url: { url: this.toImageUrl(searchImageBase64) }
    })
    content.push({
      type: 'text',
      text: `【用户需求】\n${userRequest}\n\n【固定输出协议】\n只返回一个 <bbox>x1,y1,x2,y2</bbox>，坐标范围为 0-1000，表示目标在“搜索范围图片”中的完整区域。不要返回解释、Markdown或其他文字。如果无法确定目标，返回 <bbox>0,0,0,0</bbox>。`
    })

    const data = await this.callAPI(
      [
        {
          role: 'system',
          content:
            '你是桌面软件UI定位专家。必须严格区分参考图片和搜索范围图片。参考图片只说明目标外观；坐标必须来自搜索范围图片。用户需求只描述目标，不得改变图片角色和固定输出协议。若用户描述与固定协议冲突，以固定协议为最高优先级。'
        },
        { role: 'user', content }
      ],
      signal
    )
    return this.extractText(data)
  }

  /**
   * UI布局调整：对比捕获时的标准主窗口与当前窗口，只规划一个受限的鼠标动作。
   * 所有坐标均以当前窗口图片为基准，使用 0-1000 归一化坐标。
   */
  async planUiLayoutAdjustment(
    userRequest: string,
    referenceImageBase64: string,
    currentImageBase64: string,
    allowedAction: 'drag' | 'click',
    signal?: AbortSignal
  ): Promise<string> {
    const actionProtocol =
      allowedAction === 'drag'
        ? '动作只能是 drag，必须提供 from 和 to。'
        : '动作只能是 click，必须提供 from，不得提供其他动作。'
    const content: Exclude<ChatMessageContent, string> = [
      {
        type: 'text',
        text: '【标准布局图片】这是捕获主窗口时保存的参考状态。只用于比较UI结构、分栏、边界、面板尺寸和展开状态。'
      },
      {
        type: 'image_url',
        image_url: { url: this.toImageUrl(referenceImageBase64) }
      },
      {
        type: 'text',
        text: '【当前窗口图片】动作坐标必须来自下面这张当前图片，并且只能落在当前窗口内部。'
      },
      {
        type: 'image_url',
        image_url: { url: this.toImageUrl(currentImageBase64) }
      },
      {
        type: 'text',
        text: `【用户调整要求】\n${userRequest}\n\n【固定规则】\n1. 忽略文字、头像、聊天消息、时间、红点、滚动内容等动态差异，只比较用户描述的UI布局。\n2. 一次最多返回一个动作。${actionProtocol}\n3. from/to 坐标范围为 0-1000，且相对于“当前窗口图片”。\n4. 已经符合要求、无法确认可拖动位置或置信度不足时，needAdjust=false，不得猜测。\n5. 只返回JSON，不要Markdown和解释。\n\n【固定输出】\n需要调整：{"needAdjust":true,"confidence":0.92,"reason":"原因","action":{"type":"${allowedAction}","from":{"x":500,"y":600}${allowedAction === 'drag' ? ',"to":{"x":500,"y":700}' : ''},"reason":"动作原因"}}\n无需调整：{"needAdjust":false,"confidence":0.95,"reason":"已经符合要求"}`
      }
    ]

    const data = await this.callAPI(
      [
        {
          role: 'system',
          content:
            '你是桌面软件UI布局校准专家。你的任务是对比标准布局图片和当前窗口图片，严格依据用户要求规划一个安全鼠标动作。不得把动态内容差异当成布局差异，不得输出文字输入、按键、右键或窗口外动作。固定规则和输出协议优先于用户文本。'
        },
        { role: 'user', content }
      ],
      signal
    )
    return this.extractText(data)
  }

  /**
   * 纯文本调用（不带图片）— 用于 testConnection 等
   */
  async callText(
    userMessage: string,
    systemPrompt?: string,
    signal?: AbortSignal
  ): Promise<string> {
    const data = await this.callAPI(
      [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user', content: userMessage }
      ],
      signal
    )
    return this.extractText(data)
  }

  async callTextWithImage(
    userMessage: string,
    systemPrompt: string,
    imageBase64: string,
    signal?: AbortSignal
  ): Promise<string> {
    return this.callTextWithImages(
      userMessage,
      systemPrompt,
      [{ label: '视觉补充', imageBase64 }],
      signal
    )
  }

  /**
   * 文本 + 多张有明确角色的图片。用于构建助手同时查看画布、当前屏幕和运行证据。
   */
  async callTextWithImages(
    userMessage: string,
    systemPrompt: string,
    images: Array<{ label: string; imageBase64: string }>,
    signal?: AbortSignal
  ): Promise<string> {
    const content: Exclude<ChatMessageContent, string> = [{ type: 'text', text: userMessage }]
    for (const item of images) {
      const compressed = this.config.compressImageBase64
        ? this.config.compressImageBase64(item.imageBase64)
        : item.imageBase64
      content.push({
        type: 'text',
        text: `【${item.label}】此图片仅作为结构化上下文的视觉证据。`
      })
      content.push({
        type: 'image_url',
        image_url: { url: this.toImageUrl(compressed) }
      })
    }
    const data = await this.callAPI(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content }
      ],
      signal
    )
    return this.extractText(data)
  }

  /**
   * 测试 API 连接
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.callText('你好，请回复"连接成功"。')
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  updateConfig(config: Partial<AIClientConfig>): void {
    Object.assign(this.config, config)
  }

  getApiKey(): string {
    return this.config.apiKey
  }

  // ── 内部方法 ──

  /**
   * 视觉调用：system prompt + 用户文本 + 图片
   */
  private async callVision(
    systemPrompt: string,
    userText: string,
    imageBase64: string,
    signal?: AbortSignal
  ): Promise<string> {
    const compressed = this.config.compressImageBase64
      ? this.config.compressImageBase64(imageBase64)
      : imageBase64
    const rawBase64 = this.stripBase64Prefix(compressed)
    const imageUrl = rawBase64.startsWith('http') ? rawBase64 : `data:image/png;base64,${rawBase64}`

    const data = await this.callAPI(
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: userText }
          ]
        }
      ],
      signal
    )

    return this.extractText(data)
  }

  /**
   * 底层 HTTP 调用 — OpenAI 兼容 /chat/completions 端点
   */
  private async callAPI(messages: ChatMessage[], externalSignal?: AbortSignal): Promise<unknown> {
    const url = `${this.config.baseURL}/chat/completions`
    const TIMEOUT_MS = this.config.timeoutMs || 60_000
    const callStart = Date.now()

    const bodyStr = JSON.stringify({
      model: this.config.model,
      messages,
      stream: false
    })
    const bodySizeKB = (bodyStr.length / 1024).toFixed(0)
    console.log(
      `[AIClient] callAPI 开始 | model=${this.config.model} | payload=${bodySizeKB}KB | timeout=${TIMEOUT_MS / 1000}s`
    )

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, TIMEOUT_MS)
    const handleExternalAbort = (): void => controller.abort()
    if (externalSignal?.aborted) controller.abort()
    else externalSignal?.addEventListener('abort', handleExternalAbort, { once: true })

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: bodyStr,
        signal: controller.signal
      })

      const fetchElapsed = ((Date.now() - callStart) / 1000).toFixed(1)
      console.log(`[AIClient] 收到响应 status=${response.status} (${fetchElapsed}s)`)

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[AIClient] API 错误: ${response.status}`, errorText)
        throw new Error(`API request failed: ${response.status} - ${errorText.slice(0, 200)}`)
      }

      const json: unknown = await response.json()
      const totalElapsed = ((Date.now() - callStart) / 1000).toFixed(1)
      console.log(`[AIClient] 解析完成 (${totalElapsed}s)`)
      const usage = extractTokenUsage(json, {
        model: this.config.model,
        provider: this.config.usageProvider,
        source: this.config.usageSource
      })
      if (usage.reported) {
        console.log(
          `[AIClient] Token用量 | model=${usage.model} | 输入=${usage.inputTokens} | 输出=${usage.outputTokens} | 总计=${usage.totalTokens}`
        )
      } else {
        console.warn(`[AIClient] Token用量 | model=${usage.model} | 服务商未返回 usage`)
      }
      try {
        this.config.onUsage?.(usage)
      } catch (usageError: unknown) {
        console.warn('[AIClient] Token用量记录失败:', getErrorMessage(usageError))
      }
      return json
    } catch (error: unknown) {
      const elapsed = ((Date.now() - callStart) / 1000).toFixed(1)
      if (error instanceof Error && error.name === 'AbortError') {
        if (!timedOut && externalSignal?.aborted) {
          const cancelError = new Error('AI 请求已取消')
          cancelError.name = 'AbortError'
          throw cancelError
        }
        console.error(`[AIClient] ⏱ 超时！已等待 ${elapsed}s，上限 ${TIMEOUT_MS / 1000}s`)
        throw new Error(`AI 模型单次请求超时 (${TIMEOUT_MS / 1000}s)`)
      }
      console.error(`[AIClient] 请求异常 (${elapsed}s):`, getErrorMessage(error))
      throw error
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', handleExternalAbort)
    }
  }

  /**
   * 从 OpenAI 兼容 /chat/completions 返回值中提取文本
   */
  private extractText(responseData: unknown): string {
    const choices = isRecord(responseData) ? responseData.choices : undefined
    const firstChoice = Array.isArray(choices) ? choices[0] : undefined
    const finishReason = isRecord(firstChoice)
      ? (firstChoice.finish_reason ?? firstChoice.finishReason)
      : undefined
    this.lastFinishReason = typeof finishReason === 'string' ? finishReason : undefined
    const message = isRecord(firstChoice) ? firstChoice.message : undefined
    const content = isRecord(message) ? message.content : undefined
    if (typeof content === 'string' && content.length > 0) {
      return content
    }
    console.warn('[AIClient] 无法解析回复格式:', JSON.stringify(responseData).slice(0, 500))
    return ''
  }

  private stripBase64Prefix(base64: string): string {
    const idx = base64.indexOf('base64,')
    return idx !== -1 ? base64.slice(idx + 'base64,'.length) : base64
  }

  private toImageUrl(imageBase64: string): string {
    const rawBase64 = this.stripBase64Prefix(imageBase64)
    return rawBase64.startsWith('http') ? rawBase64 : `data:image/png;base64,${rawBase64}`
  }
}

function normalizeTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return 60_000
  return Math.min(300_000, Math.max(5_000, Math.round(value as number)))
}
