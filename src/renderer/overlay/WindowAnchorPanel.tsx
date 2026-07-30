import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { WindowAnchor } from '../../core/action-chain/types'

interface WindowAnchorPanelProps {
  windowAnchors: WindowAnchor[]
  renamingWindowAnchorId: string | null
  windowAnchorRenameValue: string
  windowAnchorRenameError: string
  setRenamingWindowAnchorId: Dispatch<SetStateAction<string | null>>
  setWindowAnchorRenameValue: Dispatch<SetStateAction<string>>
  setWindowAnchorRenameError: Dispatch<SetStateAction<string>>
  windowAnchorRenameInputRef: RefObject<HTMLInputElement | null>
  commitWindowAnchorRename: (anchorId: string) => void
  beginRenameWindowAnchor: (anchor: WindowAnchor) => void
  deleteWindowAnchor: (anchorId: string) => void
}

export function WindowAnchorPanel({
  windowAnchors,
  renamingWindowAnchorId,
  windowAnchorRenameValue,
  windowAnchorRenameError,
  setRenamingWindowAnchorId,
  setWindowAnchorRenameValue,
  setWindowAnchorRenameError,
  windowAnchorRenameInputRef,
  commitWindowAnchorRename,
  beginRenameWindowAnchor,
  deleteWindowAnchor
}: WindowAnchorPanelProps) {
  if (windowAnchors.length === 0) return null

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ color: '#fde68a', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
        窗口锚点（{windowAnchors.length}）
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {windowAnchors.map((anchor) => (
          <div
            key={anchor.id}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(250,204,21,0.08)',
              border: '1px solid rgba(250,204,21,0.2)'
            }}
          >
            {renamingWindowAnchorId === anchor.id ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    ref={windowAnchorRenameInputRef}
                    value={windowAnchorRenameValue}
                    onChange={(event) => {
                      setWindowAnchorRenameValue(event.target.value)
                      setWindowAnchorRenameError('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') {
                        event.stopPropagation()
                      }
                      if (event.key === 'Enter') commitWindowAnchorRename(anchor.id)
                      if (event.key === 'Escape') {
                        setRenamingWindowAnchorId(null)
                        setWindowAnchorRenameError('')
                      }
                    }}
                    aria-label={`重命名窗口锚点${anchor.name}`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: 26,
                      boxSizing: 'border-box',
                      borderRadius: 5,
                      border: `1px solid ${windowAnchorRenameError ? 'rgba(239,68,68,0.7)' : 'rgba(250,204,21,0.4)'}`,
                      background: 'rgba(255,255,255,0.08)',
                      color: '#fff',
                      padding: '3px 7px',
                      fontSize: 12
                    }}
                  />
                  <button
                    onClick={() => commitWindowAnchorRename(anchor.id)}
                    style={{
                      background: 'rgba(16,185,129,0.18)',
                      border: '1px solid rgba(16,185,129,0.35)',
                      borderRadius: 5,
                      color: '#6ee7b7',
                      fontSize: 11,
                      padding: '3px 7px',
                      cursor: 'pointer'
                    }}
                  >
                    确认
                  </button>
                  <button
                    onClick={() => {
                      setRenamingWindowAnchorId(null)
                      setWindowAnchorRenameError('')
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#9ca3af',
                      fontSize: 11,
                      cursor: 'pointer'
                    }}
                  >
                    取消
                  </button>
                </div>
                {windowAnchorRenameError && (
                  <div style={{ color: '#f87171', fontSize: 10, marginTop: 4 }}>
                    {windowAnchorRenameError}
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span
                  onDoubleClick={() => beginRenameWindowAnchor(anchor)}
                  title="双击重命名窗口锚点"
                  style={{
                    color: '#fde68a',
                    fontSize: 12,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    cursor: 'text'
                  }}
                >
                  {anchor.name}
                </span>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => beginRenameWindowAnchor(anchor)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#fde68a',
                      fontSize: 11,
                      cursor: 'pointer'
                    }}
                  >
                    重命名
                  </button>
                  <button
                    onClick={() => deleteWindowAnchor(anchor.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ef4444',
                      fontSize: 11,
                      cursor: 'pointer'
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            )}
            <div
              title={anchor.title}
              style={{
                color: '#9ca3af',
                fontSize: 10,
                marginTop: 3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {anchor.ownerName || anchor.title} · {anchor.capturedBounds.width}×
              {anchor.capturedBounds.height} · 主窗截图
              {anchor.capturedImagePath ? '已保存' : '未保存'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
