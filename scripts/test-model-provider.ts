import assert from 'node:assert/strict'
import {
  MODEL_PROVIDER_CATALOG,
  getAgentAssistantModelRequestTimeout,
  getDefaultModelProviderSettings,
  getModelProviderConnection,
  normalizeModelProviderProfiles,
  normalizeModelProviderSettings,
  normalizeModelProviderTimeout
} from '../src/core/model-provider'

assert.ok(
  MODEL_PROVIDER_CATALOG.every((provider) =>
    provider.connections.every((connection) => connection.models.length === 0)
  ),
  '模型供应商目录不得包含预置模型'
)

const legacy = normalizeModelProviderSettings(
  {
    providerId: 'deepseek',
    apiKey: 'legacy-key',
    model: 'deepseek-v4-pro',
    baseURL: 'https://api.deepseek.com/v1',
    timeoutMs: 90_000
  },
  getDefaultModelProviderSettings()
)
const migrated = normalizeModelProviderProfiles(undefined, legacy)
assert.equal(migrated.items.length, 1)
assert.equal(migrated.activeProfileId, 'legacy-deepseek-api')
assert.equal(migrated.items[0].apiKey, 'legacy-key')
assert.equal(migrated.items[0].model, 'deepseek-v4-pro')

const registry = normalizeModelProviderProfiles(
  {
    activeProfileId: 'kimi-plan',
    items: [
      {
        id: 'deepseek-api',
        name: 'DeepSeek 主账号',
        providerId: 'deepseek',
        connectionMode: 'api',
        apiKey: 'ds-key',
        model: 'deepseek-v4-flash',
        baseURL: 'https://api.deepseek.com/v1',
        timeoutMs: 60_000,
        availableModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        modelsSource: 'remote'
      },
      {
        id: 'kimi-plan',
        name: 'Kimi 会员',
        providerId: 'moonshot',
        connectionMode: 'coding-plan',
        apiKey: 'kimi-key',
        model: 'kimi-for-coding',
        baseURL: 'https://api.kimi.com/coding/v1',
        timeoutMs: 120_000,
        availableModels: ['kimi-for-coding'],
        modelsSource: 'manual'
      }
    ]
  },
  legacy
)
assert.equal(registry.items.length, 2)
assert.equal(registry.activeProfileId, 'kimi-plan')
assert.equal(registry.items[1].connectionMode, 'coding-plan')

const kimiPlan = getModelProviderConnection('moonshot', 'coding-plan')
assert.equal(kimiPlan.baseURL, 'https://api.kimi.com/coding/v1')
assert.equal(kimiPlan.models.length, 0)

const minimaxPlan = getModelProviderConnection('minimax', 'token-plan')
assert.equal(minimaxPlan.baseURL, 'https://api.minimax.io/v1')
assert.equal(minimaxPlan.models.length, 0)

const agentPlan = getModelProviderConnection('volcengine-ark', 'agent-plan')
assert.equal(agentPlan.baseURL, 'https://ark.cn-beijing.volces.com/api/plan/v3')
assert.equal(agentPlan.models.length, 0)

const migratedBuiltinAgentPlanProfiles = normalizeModelProviderProfiles(
  {
    activeProfileId: 'agent-plan-builtin',
    items: [
      {
        id: 'agent-plan-builtin',
        providerId: 'volcengine-ark',
        connectionMode: 'agent-plan',
        apiKey: 'agent-plan-key',
        model: 'kimi-k3',
        baseURL: agentPlan.baseURL,
        timeoutMs: 60_000,
        availableModels: ['kimi-k3', 'minimax-m3'],
        modelsSource: 'manual'
      }
    ]
  },
  legacy
)
assert.equal(migratedBuiltinAgentPlanProfiles.items[0].availableModels.length, 0)
assert.equal(migratedBuiltinAgentPlanProfiles.items[0].modelsSource, 'manual')

const explicitlyInactive = normalizeModelProviderProfiles(
  {
    activeProfileId: '',
    items: [
      {
        id: 'manual-model',
        providerId: 'deepseek',
        connectionMode: 'api',
        apiKey: 'key',
        model: 'manually-entered-model',
        baseURL: 'https://api.deepseek.com/v1',
        timeoutMs: 60_000,
        availableModels: ['must-not-survive-as-remote'],
        modelsSource: 'manual'
      }
    ]
  },
  legacy
)
assert.equal(explicitlyInactive.activeProfileId, '')
assert.deepEqual(explicitlyInactive.items[0].availableModels, [])

const migratedAgentPlan = normalizeModelProviderSettings({
  providerId: 'custom',
  apiKey: 'agent-plan-key',
  model: 'kimi-k3',
  baseURL: 'https://ark.cn-beijing.volces.com/api/plan/v3',
  timeoutMs: 60_000
})
assert.equal(migratedAgentPlan.providerId, 'volcengine-ark')
assert.equal(migratedAgentPlan.connectionMode, 'agent-plan')
assert.equal(migratedAgentPlan.model, 'kimi-k3')

assert.equal(normalizeModelProviderTimeout(1_000, 60_000), 5_000)
assert.equal(normalizeModelProviderTimeout(999_000, 60_000), 300_000)
assert.equal(getAgentAssistantModelRequestTimeout(60_000), 300_000)
assert.equal(getAgentAssistantModelRequestTimeout(300_000), 300_000)

console.log('model-provider tests passed')
