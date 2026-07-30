import React from 'react'
import type { EngineState } from '../../../core/action-chain/types'

export interface LogPanelProps {
  logPanelHeight: number
  logPanelExpanded: boolean
  engineState: EngineState | null
  runtimeLogs: string[]
  logCopyStatus: 'idle' | 'copied' | 'error'
  logBodyRef: React.RefObject<HTMLDivElement | null>
  onStartResize: (event: React.PointerEvent<HTMLDivElement>) => void
  onCopyLogs: () => void
  onClearLogs: () => void
  onTogglePanel: () => void
}

export function LogPanel({
  logPanelHeight,
  logPanelExpanded,
  engineState,
  runtimeLogs,
  logCopyStatus,
  logBodyRef,
  onStartResize,
  onCopyLogs,
  onClearLogs,
  onTogglePanel
}: LogPanelProps): React.ReactElement {
  return (
    <div
      style={{
        height: logPanelHeight,
        minHeight: 72,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        background: '#171923'
      }}
    >
      <div
        onPointerDown={onStartResize}
        title="上下拖动调整日志区域高度"
        style={{
          height: 9,
          flexShrink: 0,
          cursor: 'ns-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          touchAction: 'none'
        }}
      >
        <div
          style={{
            width: 46,
            height: 3,
            borderRadius: 999,
            background: 'rgba(148,163,184,0.42)'
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px 6px'
        }}
      >
        <strong style={{ color: '#cbd5e1', fontSize: 11 }}>运行日志</strong>
        <span style={{ color: '#94a3b8', fontSize: 11, flex: 1, marginLeft: 4 }}>
          {engineState?.currentChain ? `运行中：${engineState.currentChain}` : '空闲'}
        </span>
        <button
          onClick={onCopyLogs}
          disabled={runtimeLogs.length === 0}
          title="复制当前全部运行日志"
          style={{
            background:
              logCopyStatus === 'copied'
                ? 'rgba(16,185,129,0.16)'
                : logCopyStatus === 'error'
                  ? 'rgba(239,68,68,0.14)'
                  : 'rgba(255,255,255,0.06)',
            border:
              logCopyStatus === 'copied'
                ? '1px solid rgba(16,185,129,0.3)'
                : logCopyStatus === 'error'
                  ? '1px solid rgba(239,68,68,0.3)'
                  : '1px solid rgba(255,255,255,0.1)',
            borderRadius: 5,
            color:
              logCopyStatus === 'copied'
                ? '#6ee7b7'
                : logCopyStatus === 'error'
                  ? '#fca5a5'
                  : '#94a3b8',
            padding: '3px 7px',
            fontSize: 10,
            cursor: runtimeLogs.length === 0 ? 'default' : 'pointer',
            opacity: runtimeLogs.length === 0 ? 0.5 : 1
          }}
        >
          {logCopyStatus === 'copied'
            ? '已复制'
            : logCopyStatus === 'error'
              ? '复制失败'
              : '复制日志'}
        </button>
        <button
          onClick={onClearLogs}
          title="清空运行日志"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 5,
            color: '#94a3b8',
            padding: '3px 7px',
            fontSize: 10,
            cursor: 'pointer'
          }}
        >
          清空日志
        </button>
        <button
          onClick={onTogglePanel}
          title={logPanelExpanded ? '收起底部面板' : '展开底部面板'}
          style={{
            background: logPanelExpanded ? 'rgba(16,185,129,0.14)' : 'rgba(255,255,255,0.06)',
            border: logPanelExpanded
              ? '1px solid rgba(16,185,129,0.3)'
              : '1px solid rgba(255,255,255,0.1)',
            borderRadius: 5,
            color: logPanelExpanded ? '#6ee7b7' : '#94a3b8',
            padding: '3px 7px',
            fontSize: 10,
            cursor: 'pointer'
          }}
        >
          {logPanelExpanded ? '收起面板' : '展开面板'}
        </button>
      </div>
      <div
        ref={logBodyRef}
        style={{
          display: logPanelExpanded ? 'block' : 'none',
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '0 12px 8px'
        }}
      >
        {runtimeLogs.length === 0 && (
          <div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.7 }}>暂无运行日志</div>
        )}
        {runtimeLogs.map((log, index) => (
          <div
            key={`${index}-${log}`}
            style={{
              color: '#aab2c0',
              fontSize: 11,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap'
            }}
          >
            {log}
          </div>
        ))}
      </div>
    </div>
  )
}
