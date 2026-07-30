import assert from 'node:assert/strict'
import { extractTokenUsage } from '../src/core/token-usage'

const chatUsage = extractTokenUsage(
  {
    usage: {
      prompt_tokens: 800,
      completion_tokens: 50,
      total_tokens: 850,
      prompt_tokens_details: { cached_tokens: 120 },
      completion_tokens_details: { reasoning_tokens: 10 }
    }
  },
  { model: 'model-a', provider: 'provider-a', source: 'vision' }
)

assert.equal(chatUsage.reported, true)
assert.equal(chatUsage.inputTokens, 800)
assert.equal(chatUsage.outputTokens, 50)
assert.equal(chatUsage.totalTokens, 850)
assert.equal(chatUsage.cachedTokens, 120)
assert.equal(chatUsage.reasoningTokens, 10)
assert.equal(chatUsage.model, 'model-a')

const responsesUsage = extractTokenUsage(
  { usage: { input_tokens: 400, output_tokens: 20 } },
  { model: 'model-b' }
)
assert.equal(responsesUsage.reported, true)
assert.equal(responsesUsage.totalTokens, 420)

const missingUsage = extractTokenUsage({}, { model: 'model-c' })
assert.equal(missingUsage.reported, false)
assert.equal(missingUsage.totalTokens, 0)

console.log('Token usage parser tests passed')
