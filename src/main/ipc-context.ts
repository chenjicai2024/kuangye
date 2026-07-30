import {
  BrowserWindow,
  desktopCapturer,
  nativeImage,
  screen,
  type Rectangle,
  type WebContents
} from 'electron'
import Store from 'electron-store'
import icon from '../../resources/icon.png?asset'
import { ActionChainEngine } from '../core/action-chain/engine'
import { loadProjectWorkspace } from '../core/action-chain/store'
import { Workspace } from '../core/action-chain/types'
import { readActionChainProjectAsset } from '../core/action-chain/assets'
import { getErrorMessage, isRecord } from '../core/error-utils'
import * as experienceStore from '../core/work-memory/experience-store'
import type { RunSession } from '../core/work-memory/types'
import * as chatHistoryStore from '../core/chat-history/store'
import { type AIClientConfig } from '../core/ai-client'
import {
  getAgentAssistantModelRequestTimeout,
  getModelProviderConnection,
  getDefaultModelProviderSettings,
  normalizeModelProviderProfiles,
  normalizeModelProviderSettings,
  modelProviderProfileToSettings,
  type ModelProviderProfilesSettings,
  type ModelProviderSettings
} from '../core/model-provider'
import { recordTokenUsage, type TokenUsageRange } from './token-usage-store'
import { InstalledProviderInfo } from './provider-bundle'
import { selectAgentProjectAssetReferences } from '../core/agent-assistant/project-assets'
import type {
  AgentAssistantEvent,
  AgentAssistantPermissions,
  AgentAssistantSendPayload,
  AgentDiagnosticContext
} from '../core/agent-assistant/types'

const StoreImport = Store as typeof Store & { default?: typeof Store }
const StoreClass = typeof Store === 'function' ? Store : StoreImport.default!

export { StoreClass }

// ── 常量 ──

const VISION_IMAGE_MAX_DIMENSION = 1280
const VISION_IMAGE_MIN_BASE64_KB = 100

export const DEFAULT_PROVIDER_HUB_URL =
  process.env.KUANGYE_PROVIDER_HUB_URL || 'https://kuangye.dev/provider-hub.json'
export const PROVIDER_HUB_CACHE_KEY = 'providerHubCache'

export const EMERGENCY_STOP_SHORTCUT = 'Escape'

export { icon }

// ── 类型定义 ──

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
    config: Record<string, unknown>
  }
}

export type ProviderConfigFieldType = 'text' | 'password' | 'url' | 'select' | 'textarea'

export type ProviderConfigField = {
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

export type ProviderCatalogItem = {
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

export type ProviderHubCache = {
  sourceUrl: string
  fetchedAt: string
  providers: ProviderCatalogItem[]
}

export type ProviderHubEntry = {
  id?: unknown
  enabled?: unknown
  manifestUrl?: unknown
}

export type ProviderHubManifest = {
  id?: unknown
  name?: unknown
  description?: unknown
  version?: unknown
  capabilities?: unknown
  configSchema?: unknown
}

export interface CompactModePayload {
  projectId: string
  chainName: string
  targetType: 'executionChain' | 'actionChain'
  targetId: string
}

export interface CompactSession {
  controller: BrowserWindow
  target: CompactModePayload
  originWindowId: number
  visibleWindowIds: number[]
  exiting: boolean
}

// ── 纯函数 ──

function compressVisionImageBase64(base64: string): string {
  const raw = base64.includes('base64,') ? base64.slice(base64.indexOf('base64,') + 7) : base64
  if (raw.length < VISION_IMAGE_MIN_BASE64_KB * 1024) return base64
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(raw, 'base64'))
    if (image.isEmpty()) return base64
    const size = image.getSize()
    const maxDim = Math.max(size.width, size.height)
    let target = image
    if (maxDim > VISION_IMAGE_MAX_DIMENSION) {
      const scale = VISION_IMAGE_MAX_DIMENSION / maxDim
      target = image.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality: 'good'
      })
    }
    return target.toJPEG(70).toString('base64')
  } catch {
    return base64
  }
}

export function createTrackedVisionConfig(settings: AppSettings, source: string): AIClientConfig {
  const provider = getModelProviderConnection(
    settings.modelProvider.providerId,
    settings.modelProvider.connectionMode
  )
  return {
    apiKey: settings.modelProvider.apiKey,
    model: settings.modelProvider.model,
    baseURL: settings.modelProvider.baseURL || provider.baseURL,
    timeoutMs:
      source === 'agent-assistant'
        ? getAgentAssistantModelRequestTimeout(settings.modelProvider.timeoutMs)
        : settings.modelProvider.timeoutMs,
    systemPrompt: '你是一个视觉分析专家。',
    usageProvider: settings.modelProvider.providerId,
    usageSource: source,
    onUsage: recordTokenUsage,
    compressImageBase64: compressVisionImageBase64
  }
}

export function normalizeFieldType(value: unknown, format?: unknown): ProviderConfigFieldType {
  if (value === 'password' || value === 'url' || value === 'select' || value === 'textarea') {
    return value
  }
  if (format === 'password') return 'password'
  if (format === 'uri' || format === 'url') return 'url'
  return 'text'
}

export function normalizeOptions(
  value: unknown
): Array<{ label: string; value: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const options = value
    .map((item) => {
      if (typeof item === 'string') return { label: item, value: item }
      if (!isRecord(item)) return null
      const label = typeof item.label === 'string' ? item.label : String(item.value || '')
      const optionValue = typeof item.value === 'string' ? item.value : ''
      return optionValue ? { label, value: optionValue } : null
    })
    .filter(Boolean) as Array<{ label: string; value: string }>
  return options.length ? options : undefined
}

export function normalizeManifestConfigFields(configSchema: unknown): ProviderConfigField[] {
  if (!isRecord(configSchema)) return []

  const required = Array.isArray(configSchema.required)
    ? configSchema.required.filter((key): key is string => typeof key === 'string')
    : []

  if (Array.isArray(configSchema.fields)) {
    return configSchema.fields
      .map((field) => {
        if (!isRecord(field) || typeof field.key !== 'string') return null
        return {
          key: field.key,
          label: typeof field.label === 'string' ? field.label : field.key,
          type: normalizeFieldType(field.type),
          required: field.required === true || required.includes(field.key),
          readonly: field.readonly === true,
          placeholder: typeof field.placeholder === 'string' ? field.placeholder : undefined,
          hint: typeof field.hint === 'string' ? field.hint : undefined,
          defaultValue: typeof field.defaultValue === 'string' ? field.defaultValue : undefined,
          options: normalizeOptions(field.options)
        }
      })
      .filter(Boolean) as ProviderConfigField[]
  }

  if (!isRecord(configSchema.properties)) return []

  return Object.entries(configSchema.properties).map(([key, property]) => {
    const schema = isRecord(property) ? property : {}
    const title = typeof schema.title === 'string' ? schema.title : key
    return {
      key,
      label: title,
      type: normalizeFieldType(schema.type, schema.format),
      required: required.includes(key),
      readonly: schema.readonly === true || schema.readOnly === true,
      placeholder: typeof schema.placeholder === 'string' ? schema.placeholder : undefined,
      hint: typeof schema.description === 'string' ? schema.description : undefined,
      defaultValue: typeof schema.default === 'string' ? schema.default : undefined,
      options: normalizeOptions(schema.enum)
    }
  })
}

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  return response.json()
}

function normalizeInstalledProvider(raw: unknown): InstalledProviderInfo | null {
  if (!isRecord(raw)) return null
  const requiredKeys = ['id', 'name', 'version', 'entryFile', 'installedAt'] as const
  if (!requiredKeys.every((key) => typeof raw[key] === 'string')) return null
  return {
    id: raw.id as string,
    name: raw.name as string,
    version: raw.version as string,
    entryFile: raw.entryFile as string,
    installedAt: raw.installedAt as string
  }
}

export function normalizeSettings(raw: unknown): AppSettings {
  const root = isRecord(raw) ? raw : {}
  const vision = isRecord(root.vision) ? root.vision : {}
  const rawModelProvider = isRecord(root.modelProvider) ? root.modelProvider : {}
  const chatProvider = isRecord(root.chatProvider) ? root.chatProvider : {}
  const oldApiKey = typeof root.apiKey === 'string' ? root.apiKey : ''
  const defaultModelProvider = getDefaultModelProviderSettings()
  const oldModel =
    typeof root.model === 'string' && root.model ? root.model : defaultModelProvider.model
  const oldSystemPrompt = typeof root.systemPrompt === 'string' ? root.systemPrompt : ''
  const rawProviderConfig: Record<string, unknown> = isRecord(chatProvider.config)
    ? { ...chatProvider.config }
    : {}

  if (rawProviderConfig.apiKey === undefined && oldApiKey) {
    rawProviderConfig.apiKey = oldApiKey
  }
  if (rawProviderConfig.model === undefined && oldModel) {
    rawProviderConfig.model = oldModel
  }
  if (rawProviderConfig.systemPrompt === undefined && oldSystemPrompt) {
    rawProviderConfig.systemPrompt = oldSystemPrompt
  }

  const standaloneModelProvider = normalizeModelProviderSettings(rawModelProvider, {
    apiKey: typeof vision.apiKey === 'string' ? vision.apiKey : oldApiKey,
    model: oldModel
  })
  const modelProviderProfiles = normalizeModelProviderProfiles(
    root.modelProviderProfiles,
    standaloneModelProvider
  )
  const activeProfile = modelProviderProfiles.items.find(
    (profile) => profile.id === modelProviderProfiles.activeProfileId
  )
  const modelProvider = activeProfile
    ? modelProviderProfileToSettings(activeProfile)
    : standaloneModelProvider

  return {
    locale: root.locale === 'en' ? 'en' : 'zh',
    vision: {
      apiKey: typeof vision.apiKey === 'string' ? vision.apiKey : oldApiKey
    },
    modelProvider,
    modelProviderProfiles,
    chatProvider: {
      manifestUrl:
        typeof chatProvider.manifestUrl === 'string'
          ? chatProvider.manifestUrl
          : typeof root.providerManifestUrl === 'string'
            ? root.providerManifestUrl
            : '',
      installed: normalizeInstalledProvider(chatProvider.installed),
      config: rawProviderConfig
    }
  }
}

export function withSchemaDefaults(
  schema: { properties: Record<string, { default?: unknown }> },
  current: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...current }
  for (const [key, field] of Object.entries(schema.properties || {})) {
    if (next[key] === undefined && field.default !== undefined) {
      next[key] = field.default
    }
  }
  return next
}

function workspaceUsesChatHistory(workspace: Workspace): boolean {
  return [...(workspace.executionChains ?? []), ...(workspace.chains ?? [])].some((chain) =>
    (chain.nodes ?? []).some((node) =>
      ['extract_chat_details', 'record_chat_history', 'generate_chat_reply'].includes(
        node.data.type
      )
    )
  )
}

export async function ensureLegacyChatHistoryAssigned(projectId: string): Promise<void> {
  const scoped = await chatHistoryStore.listConversations(projectId)
  if (scoped.length > 0) return
  const hasLegacy = (await chatHistoryStore.listConversations()).some((item) => !item.projectId)
  if (!hasLegacy) return
  const loadedProject = await loadProjectWorkspace(projectId)
  if (loadedProject.projectId !== projectId || !workspaceUsesChatHistory(loadedProject.workspace)) {
    return
  }
  await chatHistoryStore.adoptLegacyConversations(projectId)
}

export async function ensureLegacyCardsAssigned(projectId: string): Promise<void> {
  const scoped = await experienceStore.listCards(projectId)
  if (scoped.length > 0) return
  const adopted = await experienceStore.adoptLegacyCards(projectId)
  if (adopted > 0) {
    console.log(`[work-memory] 已迁移 ${adopted} 张旧版经验卡片到智能体 ${projectId}`)
  }
}

export function truncateDiagnosticText(
  value: string | undefined,
  limit = 3000
): string | undefined {
  if (!value) return value
  return value.length > limit ? `${value.slice(0, limit)}\n…（内容已截断）` : value
}

function compactDiagnosticVariables(
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!value) return undefined
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, item]) => {
        try {
          const serialized = JSON.stringify(item)
          return [key, serialized.length > 1500 ? `${serialized.slice(0, 1500)}…` : item]
        } catch {
          return [key, String(item)]
        }
      })
  )
}

export function compactRunSession(session: RunSession): RunSession {
  return {
    ...session,
    steps: session.steps.slice(-40).map((step) => ({
      ...step,
      message: truncateDiagnosticText(step.message, 1200) ?? '',
      detail: truncateDiagnosticText(step.detail, 1800),
      variables: compactDiagnosticVariables(step.variables),
      ai: step.ai
        ? {
            ...step.ai,
            prompt: truncateDiagnosticText(step.ai.prompt, 3000) ?? '',
            systemPrompt: truncateDiagnosticText(step.ai.systemPrompt, 2000),
            rawResponse: truncateDiagnosticText(step.ai.rawResponse, 4000) ?? ''
          }
        : undefined,
      action: step.action
        ? { ...step.action, text: truncateDiagnosticText(step.action.text, 1500) }
        : undefined
    }))
  }
}

export function normalizeAgentAssistantPermissions(
  value: AgentAssistantSendPayload['permissions']
): AgentAssistantPermissions {
  return {
    includeProjectAssets: value?.includeProjectAssets !== false,
    includeWorkMemory: value?.includeWorkMemory !== false,
    includeChatHistory: value?.includeChatHistory !== false,
    captureFullScreen: value?.captureFullScreen === true
  }
}

export function sendAgentAssistantEvent(sender: WebContents, event: AgentAssistantEvent): void {
  if (!sender.isDestroyed()) sender.send('agent-assistant:event', event)
}

export async function captureAgentAssistantCanvas(
  sender: WebContents,
  rect: AgentAssistantSendPayload['canvasCaptureRect']
): Promise<string | undefined> {
  if (
    !rect ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return undefined
  }
  const window = BrowserWindow.fromWebContents(sender)
  if (!window || window.isDestroyed()) return undefined
  const bounds: Rectangle = {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  }
  const image = await window.webContents.capturePage(bounds)
  if (image.isEmpty()) return undefined
  const size = image.getSize()
  const resized = size.width > 1200 ? image.resize({ width: 1200, quality: 'good' }) : image
  return resized.toPNG().toString('base64')
}

export async function captureCurrentDisplayBase64(): Promise<string | undefined> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.max(1, Math.min(1920, Math.round(display.size.width * display.scaleFactor)))
  const height = Math.max(1, Math.min(1080, Math.round(display.size.height * display.scaleFactor)))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources.at(0)
  if (!source || source.thumbnail.isEmpty()) return undefined
  return source.thumbnail.toPNG().toString('base64')
}

export async function collectAgentProjectAssetImages(
  projectId: string,
  message: string,
  context: AgentAssistantSendPayload['context']
): Promise<{
  availableCount: number
  omittedCount: number
  images: Array<{ label: string; imageBase64: string }>
}> {
  const selection = selectAgentProjectAssetReferences(context, message)
  const images: Array<{ label: string; imageBase64: string }> = []
  for (const reference of selection.selected) {
    try {
      const buffer = await readActionChainProjectAsset(projectId, reference.assetPath)
      const source = nativeImage.createFromBuffer(buffer)
      if (source.isEmpty()) continue
      const size = source.getSize()
      const resized =
        Math.max(size.width, size.height) > 1600
          ? size.width >= size.height
            ? source.resize({ width: 1600, quality: 'good' })
            : source.resize({ height: 1600, quality: 'good' })
          : source
      images.push({ label: reference.label, imageBase64: resized.toPNG().toString('base64') })
    } catch (error) {
      console.warn(
        `[agent-assistant] 读取项目视觉资产失败 (${reference.label}):`,
        getErrorMessage(error)
      )
    }
  }
  return {
    availableCount: selection.availableCount,
    omittedCount: Math.max(0, selection.availableCount - images.length),
    images
  }
}

export function focusWindowContents(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  try {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    if (!win.isFocused()) win.focus()
    if (!win.webContents.isDestroyed() && !win.webContents.isFocused()) {
      win.webContents.focus()
    }
  } catch {
    // 窗口可能正在关闭，焦点恢复失败不应影响主流程
  }
}

export function bindWindowContentFocus(win: BrowserWindow): void {
  // focus 事件：窗口已是活动窗口，无条件同步 webContents
  win.on('focus', () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.focus()
  })
  // show/restore 事件：仅在窗口确实是活动窗口时才同步，
  // 避免 showWindowInactive() 恢复的隐藏窗口抢焦点
  win.on('show', () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    if (win.isFocused()) win.webContents.focus()
  })
  win.on('restore', () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    if (win.isFocused()) win.webContents.focus()
  })
}

// ── MainContext 接口 ──

export interface MainContext {
  settingsStore: Store<Record<string, unknown>>
  getEngine: () => ActionChainEngine | null
  setEngine: (engine: ActionChainEngine | null) => void
  getCurrentSessionId: () => string | null
  setCurrentSessionId: (id: string | null) => void
  getCurrentRunningProjectId: () => string | null
  setCurrentRunningProjectId: (id: string | null) => void
  subWindows: Map<string, BrowserWindow>
  actionChainWindowModes: Map<number, 'run' | 'settings'>
  activeAgentAssistantRequests: Map<
    string,
    { controller: AbortController; senderId: number; sessionId: string }
  >
  stopActionChainRuntime: () => void
  registerEmergencyStopShortcut: () => void
  unregisterEmergencyStopShortcut: () => void
  enterCompactMode: (
    origin: BrowserWindow,
    target: CompactModePayload
  ) => Promise<{ success: boolean; error?: string; alreadyActive?: boolean }>
  exitCompactMode: (closeController?: boolean) => Promise<void>
  createSubWindow: (
    kind: string,
    opts: {
      width: number
      height: number
      minWidth: number
      minHeight: number
      windowKind?: string
      query?: Record<string, string>
    }
  ) => void
  getCachedProviderHub: () => ProviderHubCache | null
  fetchProviderHub: (url?: string) => Promise<ProviderHubCache>
  collectAgentDiagnosticContext: (
    projectId: string,
    permissions: AgentAssistantPermissions
  ) => Promise<{
    diagnostics: AgentDiagnosticContext
    workMemoryImages: Array<{ label: string; imageBase64: string }>
  }>
}

// Re-export TokenUsageRange for engine-ipc
export type { TokenUsageRange }
export { getTokenUsageSnapshot } from './token-usage-store'
export { DEFAULT_MODEL_PROVIDER, getModelProviderConnection, normalizeModelProviderTimeout } from '../core/model-provider'
