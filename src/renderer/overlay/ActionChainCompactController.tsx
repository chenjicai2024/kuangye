import { useEffect, useMemo, useState } from 'react'
import type { ActionChainRunTarget } from '../../core/action-chain/engine'
import type { EngineState } from '../../core/action-chain/types'

interface CompactTarget extends ActionChainRunTarget {
  projectId: string
  chainName: string
}

interface CompactInitPayload {
  target?: CompactTarget
  state?: EngineState | null
}

const buttonStyle = {
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
  padding: '7px 12px',
  color: '#f8fafc',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  WebkitAppRegion: 'no-drag'
} as React.CSSProperties

export function ActionChainCompactController(): React.ReactElement {
  const [target, setTarget] = useState<CompactTarget | null>(null)
  const [engineState, setEngineState] = useState<EngineState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    const cleanupInit = window.electron?.on('action-chain:compactInit', (payload) => {
      const value = payload as CompactInitPayload
      setTarget(value.target ?? null)
      setEngineState(value.state ?? null)
    })
    const cleanupState = window.electron?.on('action-chain:state', (state) => {
      const value = state as EngineState
      setEngineState(value)
      if (value.running) setError('')
    })
    const cleanupLog = window.electron?.on('action-chain:log', (message) => {
      const content = String(message).trim()
      if (!content) return
      setLogs((current) => [...current.slice(-1), content])
    })
    return () => {
      cleanupInit?.()
      cleanupState?.()
      cleanupLog?.()
    }
  }, [])

  const targetIsRunning = useMemo(
    () =>
      Boolean(
        target &&
        engineState?.running &&
        engineState.targetChainType === target.targetType &&
        engineState.targetChainId === target.targetId
      ),
    [engineState, target]
  )
  const status = targetIsRunning
    ? '运行中'
    : error
      ? '运行失败'
      : engineState?.errors?.length
        ? '运行异常'
        : '等待运行'
  const detail = error || engineState?.errors?.at(-1) || target?.chainName || '正在初始化…'
  const compactLog = logs.length > 0 ? logs.join('\n') : targetIsRunning ? '等待运行日志…' : detail

  async function toggleRun(): Promise<void> {
    if (!target || busy) return
    setBusy(true)
    setError('')
    try {
      const result = (await window.electron?.invoke(
        targetIsRunning ? 'action-chain:stop' : 'action-chain:start',
        ...(targetIsRunning ? [] : [target])
      )) as { success?: boolean; error?: string } | undefined
      if (result?.success !== true) setError(result?.error ?? '操作失败')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  async function restoreWindows(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = (await window.electron?.invoke('action-chain:exitCompactMode')) as
        | { success?: boolean; error?: string }
        | undefined
      if (result?.success !== true) {
        setError(result?.error ?? '恢复窗口失败')
        setBusy(false)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '恢复窗口失败')
      setBusy(false)
    }
  }

  return (
    <div
      style={
        {
          width: '100vw',
          height: '100vh',
          boxSizing: 'border-box',
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: '#f8fafc',
          background: 'rgba(12, 15, 22, 0.96)',
          border: '1px solid rgba(16,185,129,0.38)',
          borderRadius: 12,
          boxShadow: '0 16px 38px rgba(0,0,0,0.5)',
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
          WebkitAppRegion: 'drag',
          userSelect: 'none'
        } as React.CSSProperties
      }
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
          <span
            style={{
              width: 7,
              height: 7,
              flexShrink: 0,
              borderRadius: '50%',
              background: targetIsRunning ? '#10b981' : error ? '#ef4444' : '#64748b'
            }}
          />
          <span style={{ color: '#e5e7eb', fontSize: 12, fontWeight: 700 }}>{status}</span>
        </div>
        <div
          title={compactLog}
          style={{
            height: 32,
            boxSizing: 'border-box',
            padding: '3px 6px',
            color: error ? '#fca5a5' : '#9ca3af',
            background: 'rgba(0,0,0,0.22)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 6,
            fontFamily: "Consolas, 'Microsoft YaHei', monospace",
            fontSize: 9,
            lineHeight: '12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            overflow: 'hidden',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            display: '-webkit-box'
          }}
        >
          {compactLog}
        </div>
      </div>
      <div
        style={
          {
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            flexShrink: 0,
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties
        }
      >
        <button
          type="button"
          onClick={() => void toggleRun()}
          disabled={!target || busy}
          style={{
            ...buttonStyle,
            borderColor: targetIsRunning ? 'rgba(239,68,68,0.45)' : 'transparent',
            background: targetIsRunning ? 'rgba(239,68,68,0.16)' : '#10b981',
            opacity: !target || busy ? 0.55 : 1
          }}
        >
          {targetIsRunning ? '停止' : '运行'}
        </button>
        <button
          type="button"
          onClick={() => void restoreWindows()}
          disabled={busy}
          style={{ ...buttonStyle, background: 'rgba(255,255,255,0.06)', opacity: busy ? 0.55 : 1 }}
        >
          恢复窗口
        </button>
      </div>
    </div>
  )
}
