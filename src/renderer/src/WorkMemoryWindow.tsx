import { useState, useEffect, useCallback } from 'react'
import { showToast } from './toast'
import { STEP_TYPE_LABELS, type StepType } from '../../core/action-chain/types'

interface SessionIndexEntry {
  id: string
  projectId: string
  chainId: string
  chainName: string
  chainType: 'actionChain' | 'executionChain'
  startedAt: number
  endedAt?: number
  status: 'running' | 'success' | 'error' | 'stopped'
  totalSteps: number
  completedSteps: number
  errorCount: number
}

interface RunSession extends SessionIndexEntry {
  steps: RunStep[]
}

interface RunStep {
  id?: string
  kind?: 'step' | 'ai' | 'action'
  phase?: 'observe' | 'think' | 'act' | 'verify'
  stepIndex: number
  nodeId: string
  stepType: string
  status: 'running' | 'success' | 'skipped' | 'error'
  message: string
  detail?: string
  startedAt: number
  elapsedMs?: number
  screenshotFile?: string
  region?: {
    name: string
    rect: { x: number; y: number; width: number; height: number }
  }
  ai?: {
    prompt: string
    systemPrompt?: string
    outputMode: string
    variableName: string
    rawResponse: string
    parsedResponse?: unknown
    model?: string
  }
  action?: {
    type: string
    policy?: string
    normalizedFrom?: { x: number; y: number; coordinateSpace?: string }
    normalizedTo?: { x: number; y: number; coordinateSpace?: string }
    screenFrom?: [number, number]
    screenTo?: [number, number]
    text?: string
    keyName?: string
    modifiers?: string[]
    reason?: string
  }
}

function JsonBlock({ value }: { value: unknown }): React.JSX.Element {
  return <pre className="trace-code-block">{JSON.stringify(value, null, 2)}</pre>
}

function TraceScreenshot({
  projectId,
  sessionId,
  fileName
}: {
  projectId: string
  sessionId: string
  fileName: string
}): React.JSX.Element {
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.electron
      ?.invoke('memory:getScreenshot', { projectId, sessionId, fileName })
      .then((result) => {
        if (!cancelled) setSource(typeof result === 'string' ? result : null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, sessionId, fileName])

  return source ? (
    <a href={source} target="_blank" rel="noreferrer" className="trace-screenshot-link">
      <img src={source} className="trace-screenshot" alt="发送给 AI 的截图" />
    </a>
  ) : (
    <div className="trace-screenshot-missing">截图无法读取</div>
  )
}

interface ExperienceCard {
  id: string
  projectId: string
  source: 'auto_extract' | 'manual'
  scenario: string
  guidance: string
  rationale?: string
  sourceSessionId?: string
  sourceNodeIds?: string[]
  createdAt: number
  usedCount: number
  successCount: number
  enabled: boolean
}

type TabType = 'sessions' | 'cards'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function statusLabel(status: string): { text: string; className: string } {
  switch (status) {
    case 'success':
      return { text: '成功', className: 'status-success' }
    case 'error':
      return { text: '失败', className: 'status-error' }
    case 'running':
      return { text: '运行中', className: 'status-running' }
    case 'stopped':
      return { text: '已停止', className: 'status-stopped' }
    case 'skipped':
      return { text: '跳过', className: 'status-skipped' }
    default:
      return { text: status, className: '' }
  }
}

export default function WorkMemoryWindow({
  projectId,
  projectName
}: {
  projectId: string
  projectName: string
}): React.JSX.Element {
  const [tab, setTab] = useState<TabType>('sessions')
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([])
  const [selectedSession, setSelectedSession] = useState<RunSession | null>(null)
  const [cards, setCards] = useState<ExperienceCard[]>([])
  const [loading, setLoading] = useState(false)

  const loadSessions = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const result = (await window.electron?.invoke('memory:listSessions', projectId)) as
        | SessionIndexEntry[]
        | undefined
      setSessions(result ?? [])
    } catch (error) {
      console.error('Failed to load sessions:', error)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const loadCards = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const result = (await window.electron?.invoke('memory:listCards', projectId)) as
        | ExperienceCard[]
        | undefined
      setCards(result ?? [])
    } catch (error) {
      console.error('Failed to load cards:', error)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (tab === 'sessions') {
      void loadSessions()
    } else {
      void loadCards()
    }
  }, [tab, loadSessions, loadCards])

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      try {
        const session = (await window.electron?.invoke('memory:getSession', {
          projectId,
          sessionId
        })) as RunSession | undefined
        setSelectedSession(session ?? null)
      } catch (error) {
        console.error('Failed to load session:', error)
      }
    },
    [projectId]
  )

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!confirm('确定删除这条运行记录吗？')) return
      try {
        const deleted = await window.electron?.invoke('memory:deleteSession', {
          projectId,
          sessionId
        })
        if (deleted !== true) {
          showToast('删除失败，记录不属于当前智能体或已经不存在', 'error')
          return
        }
        setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        if (selectedSession?.id === sessionId) {
          setSelectedSession(null)
        }
        showToast('已删除', 'success')
      } catch {
        showToast('删除失败', 'error')
      }
    },
    [projectId, selectedSession]
  )

  const handleExtractFromSession = useCallback(
    async (sessionId: string) => {
      try {
        const result = (await window.electron?.invoke('memory:extractFromSession', {
          projectId,
          sessionId
        })) as {
          success: boolean
          error?: string
        }
        if (result.success) {
          showToast('已提取为经验卡片', 'success')
          void loadCards()
        } else {
          showToast(result.error || '提取失败', 'error')
        }
      } catch {
        showToast('提取失败', 'error')
      }
    },
    [loadCards, projectId]
  )

  const handleDeleteCard = useCallback(
    async (cardId: string) => {
      if (!confirm('确定删除这张经验卡片吗？')) return
      try {
        const deleted = await window.electron?.invoke('memory:deleteCard', {
          projectId,
          id: cardId
        })
        if (deleted !== true) {
          showToast('删除失败，卡片不属于当前智能体或已经不存在', 'error')
          return
        }
        setCards((prev) => prev.filter((c) => c.id !== cardId))
        showToast('已删除', 'success')
      } catch {
        showToast('删除失败', 'error')
      }
    },
    [projectId]
  )

  const handleToggleCard = useCallback(
    async (cardId: string, enabled: boolean) => {
      try {
        const updated = await window.electron?.invoke('memory:setCardEnabled', {
          projectId,
          id: cardId,
          enabled
        })
        if (updated !== true) {
          showToast('操作失败，卡片不属于当前智能体或已经不存在', 'error')
          return
        }
        setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, enabled } : c)))
      } catch {
        showToast('操作失败', 'error')
      }
    },
    [projectId]
  )

  if (!projectId) {
    return (
      <div className="work-memory-window work-memory-invalid">
        <h1>无法打开工作记忆</h1>
        <p>没有指定智能体，请从设置里的智能体详情重新进入。</p>
      </div>
    )
  }

  return (
    <div className="work-memory-window">
      <div className="work-memory-header">
        <div className="work-memory-heading">
          <div>
            <span>智能体专属</span>
            <h1>工作记忆</h1>
          </div>
          <strong title={projectName}>{projectName || '未命名智能体'}</strong>
        </div>
        <div className="tab-bar">
          <button
            className={`tab-btn ${tab === 'sessions' ? 'active' : ''}`}
            onClick={() => setTab('sessions')}
          >
            运行轨迹
          </button>
          <button
            className={`tab-btn ${tab === 'cards' ? 'active' : ''}`}
            onClick={() => setTab('cards')}
          >
            经验卡片
          </button>
        </div>
      </div>

      <div className="work-memory-content">
        {tab === 'sessions' ? (
          <SessionsTab
            sessions={sessions}
            selectedSession={selectedSession}
            projectId={projectId}
            loading={loading}
            onSelect={handleSelectSession}
            onDelete={handleDeleteSession}
            onExtract={handleExtractFromSession}
            onBack={() => setSelectedSession(null)}
          />
        ) : (
          <CardsTab
            cards={cards}
            loading={loading}
            onDelete={handleDeleteCard}
            onToggle={handleToggleCard}
          />
        )}
      </div>
    </div>
  )
}

function SessionsTab({
  sessions,
  selectedSession,
  projectId,
  loading,
  onSelect,
  onDelete,
  onExtract,
  onBack
}: {
  sessions: SessionIndexEntry[]
  selectedSession: RunSession | null
  projectId: string
  loading: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onExtract: (id: string) => void
  onBack: () => void
}): React.JSX.Element {
  if (selectedSession) {
    return (
      <SessionDetailView
        session={selectedSession}
        projectId={projectId}
        onBack={onBack}
        onExtract={() => onExtract(selectedSession.id)}
      />
    )
  }

  return (
    <div className="sessions-list">
      {loading ? (
        <div className="loading">加载中...</div>
      ) : sessions.length === 0 ? (
        <div className="empty">暂无运行记录</div>
      ) : (
        sessions.map((session) => {
          const status = statusLabel(session.status)
          return (
            <div key={session.id} className="session-item" onClick={() => onSelect(session.id)}>
              <div className="session-header">
                <span className="session-name">{session.chainName}</span>
                <span className={`session-status ${status.className}`}>{status.text}</span>
              </div>
              <div className="session-meta">
                <span>{formatTime(session.startedAt)}</span>
                <span>
                  {session.completedSteps}/{session.totalSteps} 步骤
                </span>
                {session.errorCount > 0 && (
                  <span className="error-count">{session.errorCount} 错误</span>
                )}
              </div>
              <div className="session-actions">
                <button
                  className="btn-icon"
                  title="提取为经验"
                  aria-label={`从${session.chainName}提取经验`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onExtract(session.id)
                  }}
                >
                  <ExtractIcon />
                </button>
                <button
                  className="btn-icon btn-danger"
                  title="删除"
                  aria-label={`删除${session.chainName}运行记录`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(session.id)
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

function SessionDetailView({
  session,
  projectId,
  onBack,
  onExtract
}: {
  session: RunSession
  projectId: string
  onBack: () => void
  onExtract: () => void
}): React.JSX.Element {
  const status = statusLabel(session.status)
  const duration =
    session.endedAt && session.startedAt
      ? formatDuration(session.endedAt - session.startedAt)
      : '未知'

  return (
    <div className="session-detail">
      <div className="detail-header">
        <button className="btn-back" onClick={onBack}>
          ← 返回
        </button>
        <h2>{session.chainName}</h2>
        <button className="btn-secondary" onClick={onExtract}>
          提取为经验
        </button>
      </div>

      <div className="detail-meta">
        <span className={`session-status ${status.className}`}>{status.text}</span>
        <span>时长: {duration}</span>
        <span>
          步骤: {session.completedSteps}/{session.totalSteps}
        </span>
        <span>错误: {session.errorCount}</span>
      </div>

      <div className="steps-list">
        {session.steps.map((step, i) => {
          const stepStatus = statusLabel(step.status)
          return (
            <div key={i} className={`step-item ${stepStatus.className}`}>
              <div className="step-header">
                <span className="step-index">#{step.stepIndex + 1}</span>
                <span className="step-type">{STEP_TYPE_LABELS[step.stepType as StepType] ?? step.stepType}</span>
                <span className={`step-status ${stepStatus.className}`}>{stepStatus.text}</span>
                {step.elapsedMs != null && (
                  <span className="step-time">{formatDuration(step.elapsedMs)}</span>
                )}
              </div>
              <div className="step-message">{step.message}</div>
              {step.detail && <div className="step-detail">{step.detail}</div>}
              {step.region && (
                <div className="trace-section">
                  <div className="trace-section-title">截图/操作区域</div>
                  <JsonBlock value={step.region} />
                </div>
              )}
              {step.screenshotFile && (
                <div className="trace-section">
                  <div className="trace-section-title">发送给 AI 的原始截图</div>
                  <TraceScreenshot
                    projectId={projectId}
                    sessionId={session.id}
                    fileName={step.screenshotFile}
                  />
                </div>
              )}
              {step.ai &&
                (step.ai.rawResponse === '（等待模型返回...）' ? (
                  <div className="trace-section trace-ai-section trace-ai-pending">
                    <div className="trace-field-label">⏳ 等待 AI 返回…</div>
                  </div>
                ) : (
                  <div className="trace-section trace-ai-section">
                    <div className="trace-section-title">AI 输入</div>
                    {step.ai.model && (
                      <div className="trace-field-label">模型：{step.ai.model}</div>
                    )}
                    <div className="trace-field-label">输出模式：{step.ai.outputMode}</div>
                    {step.ai.systemPrompt && (
                      <>
                        <div className="trace-field-label">System Prompt</div>
                        <pre className="trace-code-block trace-text-block">
                          {step.ai.systemPrompt}
                        </pre>
                      </>
                    )}
                    <div className="trace-field-label">Prompt</div>
                    <pre className="trace-code-block trace-text-block">{step.ai.prompt}</pre>
                    <div className="trace-section-title">AI 原始返回</div>
                    <pre className="trace-code-block trace-text-block">{step.ai.rawResponse}</pre>
                    {step.ai.parsedResponse !== undefined && (
                      <>
                        <div className="trace-section-title">解析后的数据</div>
                        <JsonBlock value={step.ai.parsedResponse} />
                      </>
                    )}
                  </div>
                ))}
              {step.action && (
                <div className="trace-section trace-action-section">
                  <div className="trace-section-title">实际执行动作</div>
                  <JsonBlock value={step.action} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CardsTab({
  cards,
  loading,
  onDelete,
  onToggle
}: {
  cards: ExperienceCard[]
  loading: boolean
  onDelete: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
}): React.JSX.Element {
  if (loading) {
    return <div className="loading">加载中...</div>
  }

  if (cards.length === 0) {
    return <div className="empty">暂无经验卡片</div>
  }

  return (
    <div className="cards-list">
      {cards.map((card) => (
        <div key={card.id} className={`card-item ${!card.enabled ? 'disabled' : ''}`}>
          <div className="card-header">
            <label className="toggle">
              <input
                type="checkbox"
                checked={card.enabled}
                onChange={(e) => onToggle(card.id, e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
            <span className="card-source">
              {card.source === 'auto_extract' ? '自动提取' : '手动创建'}
            </span>
            <button
              className="btn-icon btn-danger"
              title="删除"
              aria-label={`删除经验卡片：${card.scenario}`}
              onClick={() => onDelete(card.id)}
            >
              <TrashIcon />
            </button>
          </div>
          <div className="card-scenario">{card.scenario}</div>
          <div className="card-guidance">{card.guidance}</div>
          {card.rationale && <div className="card-rationale">{card.rationale}</div>}
          <div className="card-stats">
            <span>使用: {card.usedCount} 次</span>
            <span>成功: {card.successCount} 次</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ExtractIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  )
}

function TrashIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 7h16M9 7V4h6v3M8 10v7M12 10v7M16 10v7M6 7l1 14h10l1-14" />
    </svg>
  )
}
