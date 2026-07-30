const DEFAULT_MODEL = 'doubao-seed-2-0-lite-260215'
const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const APP_LABELS = {
  wechat: '微信',
  wework: '企业微信',
  dingtalk: '钉钉',
  lark: '飞书',
  slack: 'Slack',
  telegram: 'Telegram',
  generic: '即时通讯'
}

function buildDefaultPrompt(appType) {
  const appName = (appType && APP_LABELS[appType]) || '即时通讯'
  return `你是一个${appName}自动回复助手。你会收到一张${appName}的聊天窗口截图。

## 你的任务
分析截图中的聊天内容，生成合适的回复。

## 规则
1. 只输出回复文字，不要解释、不要添加多余内容
2. 防自我循环：仔细观察截图。聊天窗口中，右侧的气泡是"我"发送的。如果最后一条消息是右侧气泡，必须输出 [SKIP]
3. 如果最新消息是系统消息、群公告、红包、转账等非对话消息，输出 [SKIP]
4. 如果无法判断是否需要回复，输出 [SKIP]
5. 回复要自然、口语化，像真人对话`
}

export const manifest = {
  id: 'volcengine-ark',
  apiVersion: 1
}

export function createProvider(context) {
  const providerConfig = context && context.providerConfig ? context.providerConfig : {}

  return {
    async *run(input) {
      if (!input || !input.screenshot) {
        yield { type: 'skip' }
        return
      }

      const apiKey = providerConfig.apiKey
      if (!apiKey) {
        yield { type: 'error', error: '聊天服务缺少接口密钥' }
        return
      }

      const memorySection = buildMemorySection(input.memoryCards)
      const chatHistorySection = buildChatHistorySection(input.chatHistoryContext)
      const thinkingMeta = buildThinkingMetadata(input)
      yield {
        type: 'thinking',
        content: memorySection
          ? `正在分析聊天内容（已加载 ${input.memoryCards.length} 条团队经验）${thinkingMeta}...`
          : `正在分析聊天内容${thinkingMeta}...`
      }

      try {
        const result = await requestReply({
          screenshot: input.screenshot,
          apiKey,
          model: providerConfig.model || DEFAULT_MODEL,
          systemPrompt:
            (providerConfig.systemPrompt || buildDefaultPrompt(input.appType)) +
            memorySection +
            chatHistorySection
        })
        if (context && context.host && typeof context.host.reportUsage === 'function') {
          context.host.reportUsage({
            model: providerConfig.model || DEFAULT_MODEL,
            usage: result.usage,
            source: 'chat-provider'
          })
        }
        const reply = result.content

        if (!reply || reply.trim() === '[SKIP]') {
          yield { type: 'skip' }
          return
        }

        yield { type: 'reply_text', content: reply.trim() }
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        if (context && context.host && typeof context.host.log === 'function') {
          context.host.log(`provider error: ${message}`)
        }
        yield { type: 'error', error: message || '聊天服务调用失败' }
      }
    }
  }
}

async function requestReply({ screenshot, apiKey, model, systemPrompt }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: normalizeImageUrl(screenshot) } },
          { type: 'text', text: '请根据截图中的最新消息进行回复。' }
        ]
      }
    ],
    stream: false
  }

  const response = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`)
  }

  const json = await response.json()
  return {
    content:
      json && json.choices && json.choices[0] && json.choices[0].message
        ? json.choices[0].message.content || ''
        : '',
    usage: json && json.usage ? json.usage : null
  }
}

// 工作记忆注入：把运行时下发的经验卡片拼成 system prompt 附加段
function buildMemorySection(memoryCards) {
  if (!Array.isArray(memoryCards) || memoryCards.length === 0) {
    return ''
  }
  const lines = memoryCards.map((card, index) => {
    const rationale = card.rationale ? `（原因：${card.rationale}）` : ''
    return `${index + 1}. 【${card.scenario}】${card.guidance}${rationale}`
  })
  return `\n\n## 团队经验（来自工作记忆，优先遵循）\n${lines.join('\n')}`
}

// 聊天历史注入：把运行时下发的历史上下文拼成 system prompt 附加段
function buildChatHistorySection(chatHistoryContext) {
  if (!chatHistoryContext || String(chatHistoryContext).trim() === '') {
    return ''
  }
  return String(chatHistoryContext)
}

// 调试用元数据：把 observationId / conversationIdentity 拼到 thinking 文案
function buildThinkingMetadata(input) {
  const parts = []
  if (input.observationId) {
    parts.push(`观察=${input.observationId}`)
  }
  if (input.conversationIdentity) {
    const identity = input.conversationIdentity
    const idParts = []
    if (identity.displayName) idParts.push(identity.displayName)
    if (identity.appType) idParts.push(identity.appType)
    if (idParts.length > 0) {
      parts.push(`会话=${idParts.join('/')}`)
    }
    if (identity.key) {
      parts.push(`key=${identity.key}`)
    }
  }
  if (parts.length === 0) {
    return ''
  }
  return ` [${parts.join(', ')}]`
}

function normalizeImageUrl(screenshot) {
  const rawBase64 = stripBase64Prefix(screenshot)
  if (rawBase64.startsWith('http')) {
    return rawBase64
  }
  return `data:image/png;base64,${rawBase64}`
}

function stripBase64Prefix(base64) {
  const idx = String(base64).indexOf('base64,')
  return idx !== -1 ? String(base64).slice(idx + 'base64,'.length) : String(base64)
}
