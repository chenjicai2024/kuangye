// src/core/session-types.ts
// 最小化类型定义，仅用于 provider-bundle.ts 的兼容性

export interface ProviderInput {
  text: string
  screenshot?: string
  memoryCards?: Array<{
    scenario: string
    guidance: string
    rationale?: string
  }>
  chatHistoryContext?: string
}

export interface ProviderEvent {
  type: 'thinking' | 'reply_text' | 'skip' | 'error'
  content?: string
  error?: string
}

export interface ProviderAdapter {
  run(input: ProviderInput): AsyncIterable<ProviderEvent>
}
