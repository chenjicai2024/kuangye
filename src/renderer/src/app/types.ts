import {
  type ModelProviderSettings,
  type ModelProviderProfilesSettings
} from '../../../core/model-provider'

export interface LogEntry {
  id: number
  time: string
  type: 'trigger' | 'flow' | 'operation' | 'ai' | 'warning' | 'error'
  content: string
  stepKey?: string
}

export interface ActiveLogStep {
  key: string
  stepType: string
}

export const LOG_TYPE_LABELS: Record<LogEntry['type'], string> = {
  trigger: '触发',
  flow: '流程',
  operation: '操作',
  ai: 'AI',
  warning: '警告',
  error: '错误'
}

export type SettingsSection = 'base' | 'projects' | 'tokenUsage'

export interface InstalledProviderInfo {
  id: string
  name: string
  version: string
  entryFile: string
  installedAt: string
}

export type ProviderConfigFieldType = 'text' | 'password' | 'url' | 'select' | 'textarea'

export interface ProviderConfigField {
  key: string
  label: string
  type: ProviderConfigFieldType
  required?: boolean
  readonly?: boolean
  placeholder?: string
  hint?: string
  defaultValue?: string
  options?: Array<{ label: string; value: string }>
}

export interface ProviderCatalogItem {
  id: string
  name: string
  description?: string
  version: string
  manifestUrl: string
  capabilities?: string[]
  configSchema: {
    fields: ProviderConfigField[]
  }
}

export interface ProviderHubCache {
  sourceUrl: string
  fetchedAt: string
  providers: ProviderCatalogItem[]
}

export interface ProviderHubResult {
  success: boolean
  error?: string
  catalog?: ProviderHubCache | null
}

export interface OperationResult {
  success: boolean
  error?: string
}

export type ModelTestType = 'text' | 'vision'

export interface ModelTestResult extends OperationResult {
  testType: ModelTestType
}

export interface ProviderInstallResult extends OperationResult {
  installed?: InstalledProviderInfo
}

export interface AppSettings {
  locale: 'zh' | 'en'
  vision: {
    apiKey: string
  }
  modelProvider: ModelProviderSettings
  modelProviderProfiles: ModelProviderProfilesSettings
  chatProvider: {
    manifestUrl: string
    installed: InstalledProviderInfo | null
    config: Record<string, string>
  }
}

export interface ModelTokenUsage {
  key: string
  model: string
  provider: string
  sources: string[]
  requestCount: number
  reportedRequestCount: number
  unreportedRequestCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  reasoningTokens: number
  lastUsedAt: string
}

export interface TokenUsageSnapshot {
  records: ModelTokenUsage[]
  totals: Omit<ModelTokenUsage, 'key' | 'model' | 'provider' | 'sources' | 'lastUsedAt'>
  updatedAt: string | null
}

export type TokenUsageRange = 'today' | '7d' | '30d' | 'all'

export const TOKEN_USAGE_RANGES: Array<{ value: TokenUsageRange; label: string }> = [
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'all', label: '全部' }
]

export const BUILTIN_PROVIDER_CATALOG: ProviderCatalogItem[] = [
  {
    id: 'doubao',
    name: '豆包 Seed',
    description: '本地内置聊天 Provider，使用基础配置中的火山方舟密钥。',
    version: '1.0.0',
    manifestUrl: 'builtin://doubao',
    capabilities: ['chat'],
    configSchema: {
      fields: [
        {
          key: 'apiKey',
          label: 'API Key',
          type: 'password',
          required: true,
          placeholder: '输入火山方舟 API Key'
        },
        {
          key: 'model',
          label: '模型',
          type: 'text',
          required: true,
          readonly: true,
          defaultValue: 'doubao-seed-2-0-lite-260428'
        },
        {
          key: 'baseURL',
          label: 'Base URL',
          type: 'url',
          placeholder: 'https://ark.cn-beijing.volces.com/api/v3'
        },
        {
          key: 'systemPrompt',
          label: '系统提示词',
          type: 'textarea',
          placeholder: '你是一个视觉分析专家...'
        }
      ]
    }
  }
]
