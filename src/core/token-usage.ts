import { isRecord } from './error-utils'

export interface AITokenUsageReport {
  model: string
  provider: string
  source: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  reasoningTokens: number
  reported: boolean
  occurredAt: string
}

function readTokenCount(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.round(value)
    }
  }
  return null
}

/**
 * 兼容 OpenAI Chat/Responses 风格的 usage 字段。没有 usage 时也返回一条未计量报告，
 * 让界面能明确区分“没有消耗”和“服务商没有返回统计”。
 */
export function extractTokenUsage(
  response: unknown,
  context: { model: string; provider?: string; source?: string }
): AITokenUsageReport {
  const root = isRecord(response) ? response : {}
  const usage = isRecord(root.usage) ? root.usage : {}
  const promptDetails = isRecord(usage.prompt_tokens_details)
    ? usage.prompt_tokens_details
    : isRecord(usage.input_tokens_details)
      ? usage.input_tokens_details
      : {}
  const completionDetails = isRecord(usage.completion_tokens_details)
    ? usage.completion_tokens_details
    : isRecord(usage.output_tokens_details)
      ? usage.output_tokens_details
      : {}

  const inputTokens = readTokenCount(usage, 'prompt_tokens', 'input_tokens')
  const outputTokens = readTokenCount(usage, 'completion_tokens', 'output_tokens')
  const explicitTotal = readTokenCount(usage, 'total_tokens')
  const reported = inputTokens !== null || outputTokens !== null || explicitTotal !== null

  return {
    model: context.model || 'unknown',
    provider: context.provider || 'unknown',
    source: context.source || 'unknown',
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    totalTokens: explicitTotal ?? (inputTokens ?? 0) + (outputTokens ?? 0),
    cachedTokens: readTokenCount(promptDetails, 'cached_tokens') ?? 0,
    reasoningTokens: readTokenCount(completionDetails, 'reasoning_tokens') ?? 0,
    reported,
    occurredAt: new Date().toISOString()
  }
}
