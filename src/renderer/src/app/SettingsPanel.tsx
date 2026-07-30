import { useState, useCallback, useEffect, useMemo } from 'react'
import { showToast } from '../toast'
import { getErrorMessage } from '../../../core/error-utils'
import {
  getDefaultModelProviderSettings,
  getModelProviderCatalogItem,
  getModelProviderConnection,
  modelProviderProfileToSettings,
  type ModelProviderConnectionMode,
  type ModelProviderProfile
} from '../../../core/model-provider'
import type { AppSettings, ModelTestResult, ModelTestType, OperationResult } from './types'

export function SettingsPanel(): React.JSX.Element {
  const defaults = useMemo(() => getDefaultModelProviderSettings(), [])
  const defaultConnection = useMemo(
    () => getModelProviderConnection(defaults.providerId, defaults.connectionMode),
    [defaults]
  )
  const [profiles, setProfiles] = useState<ModelProviderProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(true)
  const [profileName, setProfileName] = useState(
    `${getModelProviderCatalogItem(defaults.providerId).name} · ${defaultConnection.name}`
  )
  const [providerId, setProviderId] = useState(defaults.providerId)
  const [connectionMode, setConnectionMode] = useState<ModelProviderConnectionMode>(
    defaults.connectionMode
  )
  const [apiKey, setApiKey] = useState(defaults.apiKey)
  const [model, setModel] = useState(defaults.model)
  const [baseURL, setBaseURL] = useState(defaults.baseURL)
  const [timeoutMs, setTimeoutMs] = useState(defaults.timeoutMs)
  const [models, setModels] = useState<string[]>([])
  const [modelsSource, setModelsSource] = useState<'manual' | 'remote'>('manual')
  const [modelsFetchedAt, setModelsFetchedAt] = useState<string | undefined>()
  const [_modelListError, setModelListError] = useState('')
  const [_loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testingType, setTestingType] = useState<ModelTestType | null>(null)
  const [_textTestResult, setTextTestResult] = useState<ModelTestResult | null>(null)
  const [_visionTestResult, setVisionTestResult] = useState<ModelTestResult | null>(null)
  const selectedProfile = selectedProfileId
    ? profiles.find((item) => item.id === selectedProfileId) || null
    : null

  const loadProfileIntoEditor = useCallback((profile: ModelProviderProfile) => {
    setSelectedProfileId(profile.id)
    setCreatingNew(false)
    setProfileName(profile.name)
    setProviderId(profile.providerId)
    setConnectionMode(profile.connectionMode)
    setApiKey(profile.apiKey)
    setModel(profile.model)
    setBaseURL(profile.baseURL)
    setTimeoutMs(profile.timeoutMs)
    setModels(profile.availableModels)
    setModelsSource(profile.modelsSource)
    setModelsFetchedAt(profile.modelsFetchedAt)
    setModelListError('')
    setTextTestResult(null)
    setVisionTestResult(null)
  }, [])

  const beginAddProvider = useCallback(
    (sourceOverride?: ModelProviderProfile | null) => {
      // 添加模型连接时优先复制当前连接的认证信息和地址，用户只需要选择新的模型。
      // 这样同一供应商可以保存多个模型连接，且不会因为点击“添加”而覆盖旧配置。
      const source =
        sourceOverride === undefined
          ? selectedProfile || profiles.find((item) => item.id === activeProfileId) || null
          : sourceOverride
      const next = source
        ? modelProviderProfileToSettings(source)
        : getDefaultModelProviderSettings()
      const nextProvider = getModelProviderCatalogItem(next.providerId)
      const nextConnection = getModelProviderConnection(next.providerId, next.connectionMode)
      setSelectedProfileId(null)
      setCreatingNew(true)
      setProfileName(`${nextProvider.name} · ${nextConnection.name}`)
      setProviderId(next.providerId)
      setConnectionMode(next.connectionMode)
      setApiKey(source ? source.apiKey : '')
      setModel('')
      setBaseURL(next.baseURL)
      setTimeoutMs(next.timeoutMs)
      setModels(source?.modelsSource === 'remote' ? source.availableModels : [])
      setModelsSource(source?.modelsSource === 'remote' ? 'remote' : 'manual')
      setModelsFetchedAt(source?.modelsSource === 'remote' ? source.modelsFetchedAt : undefined)
      setModelListError('')
      setTextTestResult(null)
      setVisionTestResult(null)
    },
    [activeProfileId, profiles, selectedProfile]
  )

  useEffect(() => {
    const load = async (): Promise<void> => {
      const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings | undefined
      if (!settings) return
      const savedProfiles = settings.modelProviderProfiles?.items || []
      const savedActiveId = settings.modelProviderProfiles?.activeProfileId || ''
      setProfiles(savedProfiles)
      setActiveProfileId(savedActiveId)
      const active = savedProfiles.find((item) => item.id === savedActiveId) || savedProfiles[0]
      if (active) loadProfileIntoEditor(active)
    }

    void load()
  }, [loadProfileIntoEditor])

  const persistProfiles = useCallback(
    async (nextProfiles: ModelProviderProfile[], nextActiveId: string): Promise<boolean> => {
      const active = nextProfiles.find((item) => item.id === nextActiveId)
      const activeSettings = active
        ? modelProviderProfileToSettings(active)
        : getDefaultModelProviderSettings()
      try {
        const result = await window.electron?.invoke<OperationResult>('settings:set', {
          vision: { apiKey: activeSettings.apiKey },
          modelProvider: activeSettings,
          modelProviderProfiles: {
            activeProfileId: active?.id || '',
            items: nextProfiles
          }
        } satisfies Partial<AppSettings>)
        if (result && !result.success) throw new Error(result.error || '保存失败')
        return true
      } catch (error: unknown) {
        showToast(`保存失败：${getErrorMessage(error)}`, 'error')
        return false
      }
    },
    []
  )

  // @ts-expect-error保留供未来表单恢复使用
  const _handleProviderChange = useCallback((nextId: string) => {
    const nextProvider = getModelProviderCatalogItem(nextId)
    const nextConnection = nextProvider.connections[0]
    setProviderId(nextProvider.id)
    setConnectionMode(nextConnection.id)
    setProfileName(`${nextProvider.name} · ${nextConnection.name}`)
    setBaseURL(nextConnection.baseURL)
    setModel('')
    setModels([])
    setModelsSource('manual')
    setModelsFetchedAt(undefined)
    setModelListError('')
    setTextTestResult(null)
    setVisionTestResult(null)
  }, [])

  // @ts-expect-error保留供未来表单恢复使用
  const _handleConnectionModeChange = useCallback(
    (nextMode: string) => {
      const nextConnection = getModelProviderConnection(providerId, nextMode)
      setConnectionMode(nextConnection.id)
      setProfileName(`${getModelProviderCatalogItem(providerId).name} · ${nextConnection.name}`)
      setBaseURL(nextConnection.baseURL)
      setModel('')
      setModels([])
      setModelsSource('manual')
      setModelsFetchedAt(undefined)
      setModelListError('')
      setTextTestResult(null)
      setVisionTestResult(null)
    },
    [providerId]
  )

  // @ts-expect-error保留供未来表单恢复使用
  const _handleLoadModels = useCallback(async () => {
    if (!apiKey || !baseURL) return
    setLoadingModels(true)
    setModelListError('')
    try {
      const result = await window.electron?.invoke<{
        success: boolean
        models?: string[]
        source?: 'manual' | 'remote'
        fetchedAt?: string
        error?: string
      }>('models:list', { providerId, connectionMode, apiKey, baseURL })
      const nextModels = result?.models || []
      if (result?.success && result.source === 'remote' && nextModels.length > 0) {
        setModels(nextModels)
        setModelsSource('remote')
        setModelsFetchedAt(result?.fetchedAt)
        showToast(`已读取 ${nextModels.length} 个可用模型`, 'success')
      } else {
        const message = result?.error || '供应商没有返回可用模型'
        setModels([])
        setModelsSource('manual')
        setModelsFetchedAt(undefined)
        setModelListError(message)
        showToast(`读取模型失败：${message}`, 'error')
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      setModels([])
      setModelsSource('manual')
      setModelsFetchedAt(undefined)
      setModelListError(message)
      showToast(`读取模型失败：${message}`, 'error')
    } finally {
      setLoadingModels(false)
    }
  }, [apiKey, baseURL, connectionMode, providerId])

  // @ts-expect-error保留供未来表单恢复使用
  const _handleSaveProvider = useCallback(async () => {
    const trimmedName = profileName.trim()
    const trimmedKey = apiKey.trim()
    const trimmedModel = model.trim()
    const trimmedBaseURL = baseURL.trim()
    if (!trimmedName) return showToast('请填写连接名称', 'error')
    if (!trimmedKey && providerId !== 'custom') return showToast('请填写 API Key', 'error')
    if (!trimmedBaseURL) return showToast('请填写接口地址', 'error')
    if (!trimmedModel) return showToast('请选择或填写模型', 'error')

    // “添加”模式永远创建新 ID，避免 React 状态尚未刷新时误更新旧连接。
    const isAdding = creatingNew || !selectedProfileId
    const id = isAdding
      ? `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      : selectedProfileId
    const nextProfile: ModelProviderProfile = {
      id,
      name: trimmedName,
      providerId,
      connectionMode,
      apiKey: trimmedKey,
      model: trimmedModel,
      baseURL: trimmedBaseURL.replace(/\/$/, ''),
      timeoutMs,
      availableModels: modelsSource === 'remote' ? models : [],
      modelsSource,
      modelsFetchedAt
    }
    const nextProfiles =
      !isAdding && selectedProfileId
        ? profiles.map((item) => (item.id === selectedProfileId ? nextProfile : item))
        : [...profiles, nextProfile]
    // 添加和编辑都不切换当前模型，只有用户点击“使用”才会改变运行配置。
    const nextActiveId = activeProfileId
    setSaving(true)
    const saved = await persistProfiles(nextProfiles, nextActiveId)
    setSaving(false)
    if (!saved) return
    setProfiles(nextProfiles)
    setActiveProfileId(nextActiveId)
    loadProfileIntoEditor(nextProfile)
    showToast(isAdding ? '模型连接已添加，请手动选择使用' : '模型连接已保存', 'success')
  }, [
    apiKey,
    activeProfileId,
    baseURL,
    connectionMode,
    creatingNew,
    loadProfileIntoEditor,
    model,
    models,
    modelsFetchedAt,
    modelsSource,
    persistProfiles,
    profileName,
    profiles,
    providerId,
    selectedProfileId,
    timeoutMs
  ])

  const handleSetActive = useCallback(
    async (profile: ModelProviderProfile) => {
      if (profile.id === activeProfileId) return
      setSaving(true)
      const saved = await persistProfiles(profiles, profile.id)
      setSaving(false)
      if (!saved) return
      setActiveProfileId(profile.id)
      showToast(`正在使用 ${profile.name}`, 'success')
    },
    [activeProfileId, persistProfiles, profiles]
  )

  const handleDeleteProvider = useCallback(
    async (profile: ModelProviderProfile) => {
      const nextProfiles = profiles.filter((item) => item.id !== profile.id)
      const nextActiveId = activeProfileId === profile.id ? '' : activeProfileId
      setSaving(true)
      const saved = await persistProfiles(nextProfiles, nextActiveId)
      setSaving(false)
      if (!saved) return
      setProfiles(nextProfiles)
      setActiveProfileId(nextActiveId)
      if (selectedProfileId === profile.id) {
        const nextSelected =
          nextProfiles.find((item) => item.id === nextActiveId) || nextProfiles[0]
        if (nextSelected) loadProfileIntoEditor(nextSelected)
        else beginAddProvider(null)
      }
      showToast(`已删除 ${profile.name}`, 'success')
    },
    [
      activeProfileId,
      beginAddProvider,
      loadProfileIntoEditor,
      persistProfiles,
      profiles,
      selectedProfileId
    ]
  )

  const handleTestConnection = useCallback(
    async (testType: ModelTestType) => {
      if (!apiKey) return
      setTestingType(testType)
      if (testType === 'text') setTextTestResult(null)
      else setVisionTestResult(null)
      try {
        const result = await window.electron?.invoke<ModelTestResult>('engine:testConnection', {
          apiKey,
          providerId,
          connectionMode,
          model,
          baseURL,
          timeoutMs,
          testType
        })
        if (result) {
          if (testType === 'text') setTextTestResult(result)
          else setVisionTestResult(result)
        }
        if (result?.success) {
          showToast(testType === 'text' ? '文本模型连接成功' : '图片理解测试成功', 'success')
        } else {
          showToast(
            `${testType === 'text' ? '文本模型测试' : '图片理解测试'}失败：${result?.error || ''}`,
            'error'
          )
        }
      } catch (error: unknown) {
        showToast(
          `${testType === 'text' ? '文本模型测试' : '图片理解测试'}失败：${getErrorMessage(error)}`,
          'error'
        )
      } finally {
        setTestingType(null)
      }
    },
    [apiKey, baseURL, connectionMode, model, providerId, timeoutMs]
  )

  return (
    <div className="settings-page model-provider-page slide-up">
      <div className="settings-page-header">
        <div>
          <h1>模型供应商</h1>
          <p>保存多个模型连接，需要时切换当前使用的供应商与模型。</p>
        </div>
      </div>

      <div className="provider-card-layout">
        <div className="provider-card-list-column">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={() => beginAddProvider()}
            >
              <span aria-hidden="true">＋</span> 添加模型
            </button>
          </div>

          <div className="provider-card-list">
            {profiles.length === 0 ? (
              <div className="provider-card-empty-list">
                还没有保存供应商，点击上方按钮添加第一条连接。
              </div>
            ) : (
              profiles.map((profile) => {
                const itemProvider = getModelProviderCatalogItem(profile.providerId)
                const itemConnection = getModelProviderConnection(
                  profile.providerId,
                  profile.connectionMode
                )
                const isActive = profile.id === activeProfileId
                const isSelected = profile.id === selectedProfileId
                return (
                  <button
                    type="button"
                    className={`provider-card-list-item ${isSelected ? 'selected' : ''}`}
                    key={profile.id}
                    onClick={() => loadProfileIntoEditor(profile)}
                  >
                    <span className="provider-card-list-logo">{itemProvider.shortName}</span>
                    <span className="provider-card-list-copy">
                      <strong title={profile.name}>{profile.name}</strong>
                      <span>
                        {itemConnection.name} · {profile.model || '未选择模型'}
                      </span>
                    </span>
                    {isActive ? (
                      <span className="provider-card-active-dot" aria-label="当前使用" />
                    ) : null}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="provider-detail-card card">
          {creatingNew ? (
            <>
              <div className="provider-detail-header">
                <div className="provider-detail-title-wrap">
                  <span className="provider-card-list-logo">＋</span>
                  <div>
                    <div className="card-title">添加模型连接</div>
                    <h2>配置新连接</h2>
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">供应商</label>
                <select
                  className="form-input"
                  value={providerId}
                  onChange={(event) => {
                    const nextProvider = getModelProviderCatalogItem(event.target.value)
                    const nextConnection = nextProvider.connections[0]
                    setProviderId(nextProvider.id)
                    setConnectionMode(nextConnection.id)
                    setProfileName(`${nextProvider.name} · ${nextConnection.name}`)
                    setBaseURL(nextConnection.baseURL)
                    setModel('')
                  }}
                >
                  <option value="volcengine">火山方舟 / 豆包</option>
                  <option value="openai">OpenAI</option>
                  <option value="custom">自定义</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">连接方式</label>
                <select
                  className="form-input"
                  value={connectionMode}
                  onChange={(event) => {
                    const nextConnection = getModelProviderConnection(providerId, event.target.value)
                    setConnectionMode(nextConnection.id)
                    setProfileName(`${getModelProviderCatalogItem(providerId).name} · ${nextConnection.name}`)
                    setBaseURL(nextConnection.baseURL)
                  }}
                >
                  <option value="agent-plan">Agent Plan</option>
                  <option value="api">API Key</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">连接名称</label>
                <input
                  className="form-input"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder="例如：DeepSeek 日常账号"
                />
              </div>

              <div className="form-group">
                <label className="form-label">API Key</label>
                <input
                  className="form-input"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={providerId === 'custom' ? '本地服务无密钥时可留空' : '输入该连接的 API Key'}
                  autoComplete="off"
                />
                <div className="form-hint">密钥仅保存在本机，不会显示在供应商列表中。</div>
              </div>

              <div className="form-group">
                <label className="form-label">接口地址</label>
                <input
                  className="form-input"
                  value={baseURL}
                  onChange={(event) => setBaseURL(event.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">模型</label>
                <input
                  className="form-input"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="输入模型 ID，例如 doubao-seed-1-6-vision-250815"
                />
              </div>

              <div className="form-group">
                <label className="form-label">超时时间（毫秒）</label>
                <select
                  className="form-input"
                  value={timeoutMs}
                  onChange={(event) => setTimeoutMs(Number(event.target.value))}
                >
                  <option value={30000}>30 秒</option>
                  <option value={60000}>60 秒</option>
                  <option value={90000}>90 秒</option>
                  <option value={120000}>120 秒</option>
                  <option value={180000}>180 秒</option>
                  <option value={300000}>300 秒</option>
                </select>
              </div>

              <div className="provider-detail-actions" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCreatingNew(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (!apiKey.trim() && providerId !== 'custom') {
                      showToast('请填写 API Key', 'error')
                      return
                    }
                    if (!model.trim()) {
                      showToast('请填写模型', 'error')
                      return
                    }
                    const newProfile: ModelProviderProfile = {
                      id: `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      name: profileName,
                      providerId,
                      connectionMode,
                      apiKey: apiKey.trim(),
                      model: model.trim(),
                      baseURL: baseURL.trim(),
                      timeoutMs,
                      availableModels: [],
                      modelsSource: 'manual'
                    }
                    void persistProfiles([...profiles, newProfile], activeProfileId).then((saved) => {
                      if (saved) {
                        setProfiles((prev) => [...prev, newProfile])
                        setCreatingNew(false)
                        loadProfileIntoEditor(newProfile)
                        showToast('模型连接已添加', 'success')
                      }
                    })
                  }}
                >
                  添加
                </button>
              </div>
            </>
          ) : selectedProfile ? (
            <>
              <div className="provider-detail-header">
                <div className="provider-detail-title-wrap">
                  <span className="provider-card-list-logo">
                    {getModelProviderCatalogItem(selectedProfile.providerId).shortName}
                  </span>
                  <div>
                    <div className="card-title">模型连接详情</div>
                    <h2 title={selectedProfile.name}>{selectedProfile.name}</h2>
                  </div>
                </div>
                {selectedProfile.id === activeProfileId ? (
                  <span className="provider-detail-status">
                    <span />
                    当前使用
                  </span>
                ) : null}
              </div>

              <p className="provider-detail-description">
                {getModelProviderCatalogItem(selectedProfile.providerId).description}
              </p>

              <div className="provider-detail-info">
                <div>
                  <strong>{getModelProviderConnection(selectedProfile.providerId, selectedProfile.connectionMode).name}</strong>
                  <span>连接方式</span>
                </div>
                <div>
                  <strong>{selectedProfile.model || '未选择'}</strong>
                  <span>模型</span>
                </div>
                <div>
                  <strong>{selectedProfile.timeoutMs / 1000}秒</strong>
                  <span>超时</span>
                </div>
              </div>

              <div className="provider-detail-meta">
                <span>接口地址</span>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all' }}>
                  {selectedProfile.baseURL}
                </strong>
              </div>

              <div className="provider-detail-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSetActive(selectedProfile)}
                  disabled={saving || selectedProfile.id === activeProfileId}
                >
                  {selectedProfile.id === activeProfileId ? '使用中' : '使用'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleTestConnection('text')}
                  disabled={!apiKey || testingType !== null}
                >
                  {testingType === 'text' ? '测试中…' : '测试文本'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleTestConnection('vision')}
                  disabled={!apiKey || testingType !== null}
                >
                  {testingType === 'vision' ? '测试中…' : '测试图片'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary provider-detail-danger"
                  onClick={() => void handleDeleteProvider(selectedProfile)}
                  disabled={saving}
                >
                  删除
                </button>
              </div>
            </>
          ) : (
            <div className="project-detail-empty">
              <span className="provider-card-list-logo" style={{ width: 48, height: 48, fontSize: 14 }}>
                AI
              </span>
              <h2>选择一个模型连接</h2>
              <p>左侧列表中选择连接，查看它的配置概况。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
