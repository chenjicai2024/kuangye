import { ipcMain, nativeImage, desktopCapturer } from 'electron'
import { isRecord } from '../../core/error-utils'
import { getErrorMessage } from '../../core/error-utils'
import { AIClient } from '../../core/ai-client'
import {
  normalizeSettings,
  createTrackedVisionConfig,
  icon,
  getTokenUsageSnapshot,
  type AppSettings,
  type TokenUsageRange,
  type MainContext,
  DEFAULT_MODEL_PROVIDER,
  getModelProviderConnection,
  normalizeModelProviderTimeout
} from '../ipc-context'

export function registerEngineIpc(ctx: MainContext): void {
  ipcMain.handle('tokenUsage:get', async (_event, requestedRange?: unknown) => {
    const range: TokenUsageRange =
      requestedRange === 'today' ||
      requestedRange === '7d' ||
      requestedRange === '30d' ||
      requestedRange === 'all'
        ? requestedRange
        : 'all'
    return getTokenUsageSnapshot(range)
  })

  ipcMain.handle('engine:testConnection', async (_event, data: unknown) => {
    const input = isRecord(data) ? data : {}
    const testType = input.testType === 'vision' ? 'vision' : 'text'
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
    if (!apiKey) return { testType, success: false, error: '缺少 API Key' }
    try {
      const current = normalizeSettings(ctx.settingsStore.store)
      const testSettings: AppSettings = {
        ...current,
        modelProvider: {
          ...current.modelProvider,
          providerId:
            typeof input.providerId === 'string'
              ? input.providerId
              : current.modelProvider.providerId,
          connectionMode:
            input.connectionMode === 'api' ||
            input.connectionMode === 'token-plan' ||
            input.connectionMode === 'coding-plan' ||
            input.connectionMode === 'agent-plan'
              ? input.connectionMode
              : current.modelProvider.connectionMode,
          apiKey,
          model:
            typeof input.model === 'string' && input.model
              ? input.model
              : current.modelProvider.model,
          baseURL:
            typeof input.baseURL === 'string' && input.baseURL
              ? input.baseURL
              : current.modelProvider.baseURL,
          timeoutMs: normalizeModelProviderTimeout(input.timeoutMs, current.modelProvider.timeoutMs)
        }
      }
      const client = new AIClient(createTrackedVisionConfig(testSettings, 'connection-test'))
      if (testType === 'text') {
        const connection = await client.testConnection()
        return {
          testType,
          success: connection.success,
          error: connection.error
        }
      }

      const testImage = nativeImage.createFromPath(icon)
      if (testImage.isEmpty()) {
        return {
          testType,
          success: false,
          error: '模型接口连接成功，但程序内置测试图片读取失败'
        }
      }
      try {
        const visionAnswer = await client.detectVision(
          '判断图片中央最醒目的英文字母是什么。只输出这个英文字母，不要解释。',
          testImage.resize({ width: 64, height: 64, quality: 'good' }).toPNG().toString('base64'),
          '你是图片识别测试助手，只输出图片中央最醒目的一个英文字母。'
        )
        const normalizedAnswer = visionAnswer
          .trim()
          .replace(/[^a-z]/gi, '')
          .toUpperCase()
        const visionPassed = normalizedAnswer === 'K'
        return {
          testType,
          success: visionPassed,
          error: visionPassed ? undefined : '模型已响应图片请求，但没有正确识别内置测试图片'
        }
      } catch (error: unknown) {
        return {
          testType,
          success: false,
          error: `模型接口连接成功，但图片理解请求失败：${getErrorMessage(error)}`
        }
      }
    } catch (error: unknown) {
      return {
        testType,
        success: false,
        error: getErrorMessage(error)
      }
    }
  })

  ipcMain.handle('models:list', async (_event, data: unknown) => {
    const input = isRecord(data) ? data : {}
    const providerId =
      typeof input.providerId === 'string' ? input.providerId : DEFAULT_MODEL_PROVIDER
    const connectionMode = typeof input.connectionMode === 'string' ? input.connectionMode : 'api'
    const defaults = getModelProviderConnection(providerId, connectionMode)
    const baseURL =
      typeof input.baseURL === 'string' && input.baseURL ? input.baseURL : defaults.baseURL
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
    if (!apiKey) {
      return {
        success: false,
        models: [],
        source: 'manual',
        error: '缺少 API Key，请填写后重试或手动输入模型 ID'
      }
    }
    const modelsURL = /\/models\/?$/i.test(baseURL)
      ? baseURL.replace(/\/$/, '')
      : `${baseURL.replace(/\/$/, '')}/models`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(modelsURL, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const json = (await response.json()) as {
        data?: Array<{ id?: unknown }>
        models?: Array<{ id?: unknown } | string>
      }
      const rawModels = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.models)
          ? json.models
          : []
      const models = rawModels.length
        ? rawModels
            .map((item) => (typeof item === 'string' ? item : item.id))
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      const uniqueModels = Array.from(new Set(models)).sort((left, right) =>
        left.localeCompare(right)
      )
      if (uniqueModels.length === 0) throw new Error('接口未返回可用模型')
      return {
        success: true,
        models: uniqueModels,
        source: 'remote',
        fetchedAt: new Date().toISOString()
      }
    } catch (error: unknown) {
      return {
        success: false,
        models: [],
        source: 'manual',
        error:
          error instanceof Error && error.name === 'AbortError'
            ? '读取模型列表超时，请检查接口地址或网络后重试'
            : `读取远程模型失败：${getErrorMessage(error)}`
      }
    } finally {
      clearTimeout(timeout)
    }
  })

  ipcMain.handle('capture-screen', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      if (sources && sources.length > 0) {
        return sources[0].thumbnail.toDataURL()
      }
      return null
    } catch (error) {
      console.error('Screen capture failed:', error)
      return null
    }
  })
}
