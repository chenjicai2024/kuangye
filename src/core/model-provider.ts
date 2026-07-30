import { isRecord } from './error-utils'

export type ModelProviderConnectionMode = 'api' | 'token-plan' | 'coding-plan' | 'agent-plan'

export interface ModelProviderConnectionPreset {
  id: ModelProviderConnectionMode
  name: string
  description: string
  baseURL: string
  models: string[]
}

export interface ModelProviderCatalogItem {
  id: string
  name: string
  shortName: string
  description: string
  connections: ModelProviderConnectionPreset[]
}

export interface ModelProviderSettings {
  providerId: string
  connectionMode: ModelProviderConnectionMode
  apiKey: string
  model: string
  baseURL: string
  timeoutMs: number
}

export interface ModelProviderProfile extends ModelProviderSettings {
  id: string
  name: string
  availableModels: string[]
  modelsSource: 'manual' | 'remote'
  modelsFetchedAt?: string
}

export interface ModelProviderProfilesSettings {
  activeProfileId: string
  items: ModelProviderProfile[]
}

export const DEFAULT_MODEL_PROVIDER = 'volcengine-ark'
export const DEFAULT_MODEL_PROVIDER_MODE: ModelProviderConnectionMode = 'api'

export const MODEL_PROVIDER_CATALOG: ModelProviderCatalogItem[] = [
  {
    id: 'volcengine-ark',
    name: '火山方舟 / 豆包',
    shortName: '豆包',
    description: '火山方舟 OpenAI 兼容接口，适合豆包文本与视觉模型。',
    connections: [
      {
        id: 'api',
        name: 'API 按量计费',
        description: '使用火山方舟 API Key，按平台实际调用量计费。',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
        models: []
      },
      {
        id: 'agent-plan',
        name: 'Agent Plan',
        description: '使用火山方舟 Agent Plan 专属 API Key 与套餐接口，消耗套餐 AFP 额度。',
        baseURL: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        models: []
      }
    ]
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    shortName: 'MM',
    description: 'MiniMax OpenAI 兼容接口，支持普通 API Key 和 Token Plan 密钥。',
    connections: [
      {
        id: 'api',
        name: 'API 按量计费',
        description: '使用 MiniMax 开放平台 API Key，适合产品调用。',
        baseURL: 'https://api.minimax.io/v1',
        models: []
      },
      {
        id: 'token-plan',
        name: 'Token Plan',
        description: '使用 sk-cp 开头的 Token Plan 密钥，适合个人交互式智能体工作。',
        baseURL: 'https://api.minimax.io/v1',
        models: []
      }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    shortName: 'OA',
    description: 'OpenAI 官方 API。',
    connections: [
      {
        id: 'api',
        name: 'API 按量计费',
        description: '使用 OpenAI Platform API Key。',
        baseURL: 'https://api.openai.com/v1',
        models: []
      }
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DS',
    description: 'DeepSeek 官方 OpenAI 兼容接口。',
    connections: [
      {
        id: 'api',
        name: 'API 按量计费',
        description: '使用 DeepSeek 开放平台 API Key。',
        baseURL: 'https://api.deepseek.com/v1',
        models: []
      }
    ]
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    shortName: 'Kimi',
    description: 'Kimi 开放平台与 Kimi Code 会员接口。',
    connections: [
      {
        id: 'api',
        name: 'API 按量计费',
        description: '使用 Kimi 开放平台 API Key，适合产品调用。',
        baseURL: 'https://api.moonshot.cn/v1',
        models: []
      },
      {
        id: 'coding-plan',
        name: 'Kimi Code 会员',
        description: '使用 Kimi Code 会员密钥与专用接口，使用范围以 Kimi 官方规则为准。',
        baseURL: 'https://api.kimi.com/coding/v1',
        models: []
      }
    ]
  },
  {
    id: 'qwen',
    name: '阿里云百炼 / 通义千问',
    shortName: 'Qwen',
    description: '阿里云百炼 OpenAI 兼容接口。',
    connections: [
      {
        id: 'api',
        name: 'API 按量计费',
        description: '使用阿里云百炼 API Key。',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: []
      }
    ]
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    shortName: 'GLM',
    description: '智谱开放平台 OpenAI 兼容接口。',
    connections: [
      {
        id: 'api',
        name: 'API 按量计费',
        description: '使用智谱开放平台 API Key。',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        models: []
      }
    ]
  },
  {
    id: 'custom',
    name: '自定义 OpenAI 兼容平台',
    shortName: 'API',
    description: '连接代理、本地模型或其他 OpenAI 兼容服务。',
    connections: [
      {
        id: 'api',
        name: '自定义连接',
        description: '自行填写 Base URL、API Key 和模型名称。',
        baseURL: 'http://127.0.0.1:3000/v1',
        models: []
      }
    ]
  }
]

export function getModelProviderCatalogItem(providerId: string): ModelProviderCatalogItem {
  return (
    MODEL_PROVIDER_CATALOG.find((provider) => provider.id === providerId) ||
    MODEL_PROVIDER_CATALOG.find((provider) => provider.id === DEFAULT_MODEL_PROVIDER)!
  )
}

export function getModelProviderConnection(
  providerId: string,
  connectionMode: string
): ModelProviderConnectionPreset {
  const provider = getModelProviderCatalogItem(providerId)
  return (
    provider.connections.find((connection) => connection.id === connectionMode) ||
    provider.connections[0]
  )
}

export function getDefaultModelProviderSettings(): ModelProviderSettings {
  const connection = getModelProviderConnection(DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_PROVIDER_MODE)
  return {
    providerId: DEFAULT_MODEL_PROVIDER,
    connectionMode: connection.id,
    apiKey: '',
    model: '',
    baseURL: connection.baseURL,
    timeoutMs: 60_000
  }
}

export function normalizeModelProviderSettings(
  raw: unknown,
  legacy: Partial<ModelProviderSettings> = {}
): ModelProviderSettings {
  const record = isRecord(raw) ? raw : {}
  const rawBaseURL = typeof record.baseURL === 'string' ? record.baseURL : legacy.baseURL || ''
  const isVolcengineAgentPlan = /^https:\/\/ark\.cn-beijing\.volces\.com\/api\/plan\/v3\/?$/i.test(
    rawBaseURL
  )
  const requestedProviderId = isVolcengineAgentPlan
    ? 'volcengine-ark'
    : typeof record.providerId === 'string'
      ? record.providerId
      : legacy.providerId
  const provider = getModelProviderCatalogItem(requestedProviderId || DEFAULT_MODEL_PROVIDER)
  const requestedConnectionMode = isVolcengineAgentPlan
    ? 'agent-plan'
    : typeof record.connectionMode === 'string'
      ? record.connectionMode
      : legacy.connectionMode || DEFAULT_MODEL_PROVIDER_MODE
  const connection = getModelProviderConnection(provider.id, requestedConnectionMode)
  const legacyModel = typeof legacy.model === 'string' ? legacy.model : ''

  return {
    providerId: provider.id,
    connectionMode: connection.id,
    apiKey:
      typeof record.apiKey === 'string'
        ? record.apiKey
        : typeof legacy.apiKey === 'string'
          ? legacy.apiKey
          : '',
    model: typeof record.model === 'string' && record.model ? record.model : legacyModel,
    baseURL:
      typeof record.baseURL === 'string' && record.baseURL
        ? record.baseURL
        : typeof legacy.baseURL === 'string' && legacy.baseURL
          ? legacy.baseURL
          : connection.baseURL,
    timeoutMs: normalizeModelProviderTimeout(record.timeoutMs, legacy.timeoutMs || 60_000)
  }
}

export function normalizeModelProviderProfiles(
  raw: unknown,
  legacyProvider: ModelProviderSettings
): ModelProviderProfilesSettings {
  const record = isRecord(raw) ? raw : {}
  const rawItems = Array.isArray(record.items) ? record.items : []
  const seenIds = new Set<string>()
  const items: ModelProviderProfile[] = []

  rawItems.forEach((item, index) => {
    if (!isRecord(item)) return
    const settings = normalizeModelProviderSettings(item, legacyProvider)
    const fallbackId = `provider-${settings.providerId}-${settings.connectionMode}-${index + 1}`
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : fallbackId
    if (seenIds.has(id)) return
    seenIds.add(id)
    const provider = getModelProviderCatalogItem(settings.providerId)
    const connection = getModelProviderConnection(settings.providerId, settings.connectionMode)
    const availableModels = uniqueStrings(item.availableModels)
    const hasRemoteModels = item.modelsSource === 'remote'
    items.push({
      id,
      name:
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : `${provider.name} · ${connection.name}`,
      ...settings,
      // 只有真实远程读取的清单才会保留；手动输入的模型不伪装成远程结果。
      availableModels: hasRemoteModels ? availableModels : [],
      modelsSource: hasRemoteModels ? 'remote' : 'manual',
      modelsFetchedAt:
        hasRemoteModels && typeof item.modelsFetchedAt === 'string' && item.modelsFetchedAt
          ? item.modelsFetchedAt
          : undefined
    })
  })

  if (items.length === 0 && legacyProvider.apiKey) {
    const provider = getModelProviderCatalogItem(legacyProvider.providerId)
    const connection = getModelProviderConnection(
      legacyProvider.providerId,
      legacyProvider.connectionMode
    )
    items.push({
      id: `legacy-${legacyProvider.providerId}-${legacyProvider.connectionMode}`,
      name: `${provider.name} · ${connection.name}`,
      ...legacyProvider,
      availableModels: [],
      modelsSource: 'manual'
    })
  }

  const hasExplicitActiveId = typeof record.activeProfileId === 'string'
  const requestedActiveId = hasExplicitActiveId ? String(record.activeProfileId) : ''
  const activeProfileId = items.some((item) => item.id === requestedActiveId)
    ? requestedActiveId
    : hasExplicitActiveId
      ? ''
      : items[0]?.id || ''

  return { activeProfileId, items }
}

export function modelProviderProfileToSettings(
  profile: ModelProviderProfile
): ModelProviderSettings {
  return {
    providerId: profile.providerId,
    connectionMode: profile.connectionMode,
    apiKey: profile.apiKey,
    model: profile.model,
    baseURL: profile.baseURL,
    timeoutMs: profile.timeoutMs
  }
}

export function normalizeModelProviderTimeout(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(300_000, Math.max(5_000, Math.round(parsed)))
}

export const AGENT_ASSISTANT_MIN_MODEL_TIMEOUT_MS = 300_000

export function getAgentAssistantModelRequestTimeout(providerTimeoutMs: number): number {
  return Math.max(
    normalizeModelProviderTimeout(providerTimeoutMs, 60_000),
    AGENT_ASSISTANT_MIN_MODEL_TIMEOUT_MS
  )
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))
  )
}
