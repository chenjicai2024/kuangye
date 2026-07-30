import { useEffect, useState } from 'react'

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

interface CapturedWindow {
  id: number
  title: string
  ownerName: string
  ownerPath?: string
  processId: number
  bounds: ScreenRect
}

interface CandidatePayload {
  window?: CapturedWindow
}

export function ActionChainCaptureToolbar(): React.ReactElement {
  const [sessionId, setSessionId] = useState('')
  const [candidate, setCandidate] = useState<CapturedWindow | null>(null)

  useEffect(() => {
    const cleanupInit = window.electron?.on('action-chain-capture-toolbar:init', (payload) => {
      const value = payload as { id?: string }
      setSessionId(value.id ?? '')
    })
    const cleanupCandidate = window.electron?.on(
      'action-chain-capture-toolbar:candidate',
      (payload) => {
        const value = payload as CandidatePayload
        setCandidate(value.window ?? null)
      }
    )
    window.electron?.send('action-chain-capture-toolbar:ready')
    return () => {
      cleanupInit?.()
      cleanupCandidate?.()
    }
  }, [])

  function send(action: 'confirm' | 'retry' | 'cancel'): void {
    if (!sessionId) return
    window.electron?.send(`action-chain-capture-toolbar:${action}`, { id: sessionId })
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        boxSizing: 'border-box',
        color: '#f8fafc',
        background: 'rgba(10, 11, 16, 0.96)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 18,
        padding: '0 16px',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span style={{ color: '#fff', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>
          捕获窗口
        </span>
        <span
          style={{
            padding: '4px 10px',
            borderRadius: 999,
            background: candidate ? 'rgba(16,185,129,0.16)' : 'rgba(250,204,21,0.14)',
            border: `1px solid ${candidate ? 'rgba(16,185,129,0.4)' : 'rgba(250,204,21,0.35)'}`,
            color: candidate ? '#6ee7b7' : '#fde68a',
            fontSize: 12,
            whiteSpace: 'nowrap'
          }}
        >
          {candidate ? '已识别，请确认' : '请点击目标程序'}
        </span>
        <div
          title={candidate?.title}
          style={{
            minWidth: 0,
            color: '#9ca3af',
            fontSize: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {candidate
            ? `${candidate.ownerName || candidate.title} · ${candidate.title} · (${candidate.bounds.x}, ${candidate.bounds.y}) ${candidate.bounds.width}×${candidate.bounds.height}`
            : '框选界面保持不变，点击会穿透到下面的窗口。'}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => send('cancel')}
          style={{
            border: '1px solid rgba(255,255,255,0.16)',
            borderRadius: 7,
            padding: '6px 12px',
            background: 'rgba(255,255,255,0.06)',
            color: '#cbd5e1',
            cursor: 'pointer'
          }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => send('retry')}
          disabled={!candidate}
          style={{
            border: '1px solid rgba(250,204,21,0.32)',
            borderRadius: 7,
            padding: '6px 12px',
            background: 'rgba(250,204,21,0.1)',
            color: candidate ? '#fde68a' : '#6b7280',
            cursor: candidate ? 'pointer' : 'not-allowed'
          }}
        >
          重新选择
        </button>
        <button
          type="button"
          onClick={() => send('confirm')}
          disabled={!candidate}
          style={{
            border: 'none',
            borderRadius: 7,
            padding: '6px 14px',
            background: candidate ? '#10b981' : '#374151',
            color: candidate ? '#fff' : '#9ca3af',
            fontWeight: 700,
            cursor: candidate ? 'pointer' : 'not-allowed'
          }}
        >
          确认捕获
        </button>
      </div>
    </div>
  )
}
