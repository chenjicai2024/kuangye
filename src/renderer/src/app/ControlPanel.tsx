import { useState, useCallback, useRef, useEffect } from 'react'
import { t } from '../i18n'
import { showToast } from '../toast'
import { PlayIcon, StopIcon, MinimizeIcon, GearIcon } from './icons'
import { classifyEngineLog, stepLabel } from './log-utils'
import type { ActiveLogStep, LogEntry } from './types'
import { LOG_TYPE_LABELS } from './types'
import type { Project } from '../../../core/action-chain/types'

function ControlPanel({
  projectListKey,
  selectedProjectId,
  selectedProjectName,
  chains,
  selectedChainId,
  setSelectedChainId,
  loadingChains,
  onSelectProject,
  onEnterActionChain
}: {
  projectListKey: number
  selectedProjectId: string | null
  selectedProjectName: string
  chains: Array<{ id: string; name: string; kind: 'actionChain' | 'executionChain'; nodes: number }>
  selectedChainId: string
  setSelectedChainId: (id: string) => void
  loadingChains: boolean
  onSelectProject: (id: string | null, name: string) => void
  onEnterActionChain: (projectId?: string) => void
}): React.JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logCopyStatus, setLogCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const logRef = useRef<HTMLDivElement>(null)
  const nextLogIdRef = useRef(1)
  const activeStepRef = useRef<ActiveLogStep | null>(null)
  const logCopyResetTimerRef = useRef<number | null>(null)

  const addLog = useCallback((type: LogEntry['type'], content: string, stepKey?: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    const entry = { id: nextLogIdRef.current++, time, type, content, stepKey }
    setLogs((prev) => [...prev.slice(-99), entry])
  }, [])

  const finishStepLog = useCallback(
    (
      step: ActiveLogStep,
      status: 'success' | 'skipped' | 'error',
      message: string,
      elapsedMs?: number
    ) => {
      const elapsed = elapsedMs != null ? ` · ${elapsedMs}ms` : ''
      const marker = status === 'success' ? '✓' : status === 'skipped' ? '－' : '✕'

      setLogs((prev) => {
        const index = prev.findLastIndex((entry) => entry.stepKey === step.key)
        if (index >= 0) {
          const next = [...prev]
          next[index] = {
            ...next[index],
            type: status === 'error' ? 'error' : next[index].type,
            content: `${marker} ${next[index].content}${elapsed}`
          }
          return next
        }

        const content =
          status === 'success'
            ? `${marker} ${stepLabel(step.stepType)}${elapsed}`
            : `${marker} ${stepLabel(step.stepType)}：${message}${elapsed}`
        const fallback: LogEntry = {
          id: nextLogIdRef.current++,
          time: new Date().toLocaleTimeString('en-US', { hour12: false }),
          type: status === 'error' ? 'error' : 'flow',
          content
        }
        return [...prev.slice(-99), fallback]
      })
    },
    []
  )

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  useEffect(
    () => () => {
      if (logCopyResetTimerRef.current !== null) {
        window.clearTimeout(logCopyResetTimerRef.current)
      }
    },
    []
  )

  const copyLogs = useCallback(async (): Promise<void> => {
    if (logs.length === 0) return

    const text = logs
      .map((entry) => `${entry.time} ${LOG_TYPE_LABELS[entry.type]} ${entry.content}`)
      .join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setLogCopyStatus('copied')
    } catch (error) {
      console.error('复制运行日志失败:', error)
      setLogCopyStatus('error')
    }

    if (logCopyResetTimerRef.current !== null) {
      window.clearTimeout(logCopyResetTimerRef.current)
    }
    logCopyResetTimerRef.current = window.setTimeout(() => {
      setLogCopyStatus('idle')
      logCopyResetTimerRef.current = null
    }, 1800)
  }, [logs])

  const clearLogs = useCallback((): void => {
    setLogs([])
    setLogCopyStatus('idle')
    activeStepRef.current = null
  }, [])

  // 动作链引擎日志
  useEffect(() => {
    const cleanup = window.electron?.on('action-chain:log', (message: unknown) => {
      const content = String(message)
      const activeStep = activeStepRef.current
      addLog(classifyEngineLog(content, activeStep), content, activeStep?.key)
    })
    return cleanup
  }, [addLog])

  // 动作链步骤日志
  useEffect(() => {
    const cleanup = window.electron?.on('action-chain:stepLog', (log: unknown) => {
      const item = log as {
        chainName?: string
        nodeId?: string
        stepIndex?: number
        stepType?: string
        status?: string
        message?: string
        elapsedMs?: number
      }
      const stepIndex = (item.stepIndex ?? 0) + 1
      const step = {
        key: `${item.chainName ?? ''}:${item.nodeId ?? item.stepType ?? ''}:${stepIndex}`,
        stepType: item.stepType ?? 'unknown'
      }

      if (item.status === 'running') {
        activeStepRef.current = step
        return
      }

      if (activeStepRef.current?.key === step.key) activeStepRef.current = null
      finishStepLog(
        step,
        item.status === 'error' ? 'error' : item.status === 'skipped' ? 'skipped' : 'success',
        item.message ?? '',
        item.elapsedMs
      )
    })
    return cleanup
  }, [finishStepLog])

  return (
    <div className="fade-in">
      <div className="status-indicator idle">
        <div className="status-dot idle" />
        <span className="status-text">{t('status.idle')}</span>
      </div>

      <ProjectSelectCard
        projectListKey={projectListKey}
        selectedProjectId={selectedProjectId}
        selectedProjectName={selectedProjectName}
        chains={chains}
        selectedChainId={selectedChainId}
        setSelectedChainId={setSelectedChainId}
        loadingChains={loadingChains}
        onSelectProject={onSelectProject}
        onEnterActionChain={onEnterActionChain}
      />

      <div className="card log-card">
        <div className="log-card-header">
          <div className="card-title">{t('control.log')}</div>
          <div className="log-card-actions">
            <button
              type="button"
              className={`log-action-button ${logCopyStatus}`}
              onClick={() => void copyLogs()}
              disabled={logs.length === 0}
              title="复制当前全部运行日志"
            >
              {logCopyStatus === 'copied'
                ? '已复制'
                : logCopyStatus === 'error'
                  ? '复制失败'
                  : '复制日志'}
            </button>
            <button
              type="button"
              className="log-action-button"
              onClick={clearLogs}
              disabled={logs.length === 0}
              title="清空当前运行日志"
            >
              清空日志
            </button>
          </div>
        </div>
        <div className="message-log" ref={logRef}>
          {logs.length === 0 ? (
            <div className="message-log-empty">{t('control.log.empty')}</div>
          ) : (
            logs.map((entry) => (
              <div className="log-entry" key={entry.id}>
                <span className="log-time">{entry.time}</span>
                <span className={`log-type ${entry.type}`}>{LOG_TYPE_LABELS[entry.type]}</span>
                <span>{entry.content}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

interface ProjectSelectCardProps {
  projectListKey: number
  selectedProjectId: string | null
  selectedProjectName: string
  chains: Array<{ id: string; name: string; kind: 'actionChain' | 'executionChain'; nodes: number }>
  selectedChainId: string
  setSelectedChainId: (id: string) => void
  loadingChains: boolean
  onSelectProject: (id: string | null, name: string) => void
  onEnterActionChain: (projectId?: string) => void
}

function ProjectSelectCard({
  projectListKey,
  selectedProjectId,
  selectedProjectName,
  chains,
  selectedChainId,
  setSelectedChainId,
  loadingChains,
  onSelectProject,
  onEnterActionChain
}: ProjectSelectCardProps): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selectedLabel = selectedProjectName || '选择智能体'

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = (await window.electron?.invoke('action-chain:listProjects')) as
        | { projects?: Project[]; lastSelectedProjectId?: string }
        | undefined
      if (!cancelled) setProjects(result?.projects ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [projectListKey])

  // 项目列表变化后，检查选中的项目是否还在列表中
  useEffect(() => {
    if (selectedProjectId && !projects.some((p) => p.id === selectedProjectId)) {
      onSelectProject(null, '')
    }
  }, [projects, selectedProjectId, onSelectProject])

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menuOpen])

  const statusText = selectedProjectId ? '智能体模式' : '请选择智能体'

  return (
    <div
      className={`card target-app-card ${menuOpen ? 'dropdown-open' : ''}`}
      style={{ marginBottom: 12 }}
    >
      <div className="card-title">目标智能体</div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div className="app-select" ref={containerRef}>
          <button
            ref={triggerRef}
            type="button"
            className="app-select-trigger"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-label="选择目标智能体"
            onClick={() => {
              setMenuOpen((open) => !open)
            }}
          >
            <span className="app-select-value">{selectedLabel}</span>
            <svg
              className={`app-select-chevron ${menuOpen ? 'open' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {menuOpen ? (
            <ul className="app-select-panel" role="listbox" aria-label="目标智能体选项">
              {projects.length === 0 ? (
                <li className="app-select-option" style={{ opacity: 0.5, cursor: 'default' }}>
                  <span className="app-select-option-label">暂无智能体，请先创建</span>
                </li>
              ) : null}

              {projects.map((project) => {
                const isSelected = project.id === selectedProjectId
                return (
                  <li
                    key={project.id}
                    role="option"
                    aria-selected={isSelected}
                    className={`app-select-option ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      onSelectProject(project.id, project.name)
                      setMenuOpen(false)
                      triggerRef.current?.focus()
                    }}
                  >
                    <span className="app-select-option-label">{project.name}</span>
                    <button
                      type="button"
                      className="project-edit-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuOpen(false)
                        onEnterActionChain(project.id)
                      }}
                    >
                      编辑
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </div>

      <div
        className="form-hint"
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: selectedProjectId ? '#94a3b8' : '#fbbf24'
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: 999,
            background: selectedProjectId ? '#34d399' : '#fbbf24',
            flexShrink: 0
          }}
        />
        <span style={{ flex: 1 }}>{statusText}</span>
        {selectedProjectId ? (
          <select
            className="bottom-chain-select"
            value={chains.some((c) => c.id === selectedChainId) ? selectedChainId : ''}
            onChange={(e) => setSelectedChainId(e.target.value)}
            disabled={chains.length === 0}
            title={
              chains.length === 0
                ? loadingChains
                  ? '加载链列表中...'
                  : '该智能体没有可用的链'
                : '选择要运行的链'
            }
            style={{
              maxWidth: 160,
              padding: '5px 8px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: '#e5e7eb',
              fontSize: 11,
              fontFamily: 'var(--font-sans)',
              cursor: chains.length === 0 ? 'default' : 'pointer',
              opacity: chains.length === 0 ? 0.5 : 1,
              flexShrink: 0
            }}
          >
            {chains.length === 0 ? (
              <option value="" disabled>
                {loadingChains ? '加载中...' : '无可用链'}
              </option>
            ) : (
              chains.map((c) => (
                <option key={`${c.kind}-${c.id}`} value={c.id}>
                  {c.name} ({c.nodes}节点)
                </option>
              ))
            )}
          </select>
        ) : null}
      </div>
    </div>
  )
}

export function BottomBar({
  runningChain,
  setRunningChain,
  chains,
  selectedChainId,
  selectedProjectId
}: {
  runningChain: boolean
  setRunningChain: (v: boolean) => void
  chains: Array<{ id: string; name: string; kind: 'actionChain' | 'executionChain'; nodes: number }>
  selectedChainId: string
  selectedProjectId: string | null
}): React.JSX.Element {
  const handleStopChain = useCallback(async () => {
    await window.electron?.invoke('action-chain:stop')
    setRunningChain(false)
    showToast('链已停止', 'success')
  }, [setRunningChain])

  const handleRunChain = useCallback(async () => {
    const chain = chains.find((c) => c.id === selectedChainId)
    if (!chain) return
    const result = (await window.electron?.invoke('action-chain:start', {
      targetType: chain.kind === 'executionChain' ? 'executionChain' : 'actionChain',
      targetId: chain.id,
      projectId: selectedProjectId ?? undefined
    })) as { success: boolean; error?: string } | undefined
    if (result?.success) {
      setRunningChain(true)
      showToast(`已启动: ${chain.name}`, 'success')
    } else {
      showToast(result?.error || '启动失败', 'error')
    }
  }, [chains, selectedChainId, selectedProjectId, setRunningChain])

  const handleEnterCompactMode = useCallback(async () => {
    const chain = chains.find((item) => item.id === selectedChainId)
    if (!chain || !selectedProjectId) return

    const result = (await window.electron?.invoke('action-chain:enterCompactMode', {
      projectId: selectedProjectId,
      targetType: chain.kind === 'executionChain' ? 'executionChain' : 'actionChain',
      targetId: chain.id,
      chainName: chain.name
    })) as { success?: boolean; error?: string } | undefined

    if (result?.success !== true) {
      showToast(result?.error || '进入最小化模式失败', 'error')
    }
  }, [chains, selectedChainId, selectedProjectId])

  const isChainMode = chains.length > 0

  return (
    <div className="bottom-bar">
      {runningChain ? (
        <button
          className="bottom-btn bottom-btn-stop"
          onClick={handleStopChain}
          title="停止运行；鼠标失控时可直接按 Esc 全局紧急停止"
        >
          <StopIcon />
          停止 · Esc
        </button>
      ) : isChainMode ? (
        <button className="bottom-btn bottom-btn-play" onClick={handleRunChain}>
          <PlayIcon />
          运行
        </button>
      ) : (
        <button className="bottom-btn bottom-btn-play" disabled>
          <PlayIcon />
          无可用链
        </button>
      )}
      <button
        className="bottom-btn bottom-btn-settings bottom-btn-compact"
        onClick={() => void handleEnterCompactMode()}
        disabled={!isChainMode || !selectedProjectId}
        title="隐藏程序界面，在屏幕右下角显示悬浮运行按钮"
        aria-label="最小化为右下角悬浮运行按钮"
      >
        <MinimizeIcon />
      </button>
      <button
        className="bottom-btn bottom-btn-settings"
        onClick={() => window.electron?.invoke('settings:open')}
        title="设置"
      >
        <GearIcon />
      </button>
    </div>
  )
}

export { ControlPanel }
