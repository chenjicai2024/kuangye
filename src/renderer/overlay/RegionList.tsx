import type { Dispatch, SetStateAction } from 'react'
import { useState } from 'react'
import type { WindowAnchor } from '../../core/action-chain/types'
import type { NamedRect, ViewRegionData } from './overlay-types'
import { COLORS } from './overlay-types'
import { findAnchorById } from './overlay-utils'

export interface ExistingRegionRenameHandlers {
  renamingKey: string | null
  value: string
  error: string
  onValueChange: (value: string) => void
  begin: (key: string, name: string) => void
  commit: () => void
  cancel: () => void
}

interface RegionListProps {
  regions: NamedRect[]
  deleteRegion: (idx: number) => void
  toggleRegionEditable: (idx: number) => void
  toggleRegionVisible: (idx: number) => void
  renameRegion: (idx: number, newName: string) => void
  viewList: ViewRegionData[]
  currentViewIdx: number
  existingExpanded: boolean
  setExistingExpanded: Dispatch<SetStateAction<boolean>>
  windowAnchors: WindowAnchor[]
  changeExistingRegionBasis: (viewIndex: number, regionIndex: number, value: string) => void
  deleteExistingRegion: (viewIndex: number, regionIndex: number) => void
  toggleExistingRegionEditable: (viewIndex: number, regionIndex: number) => void
  toggleExistingRegionVisible: (viewIndex: number, regionIndex: number) => void
  renameExistingRegion: (viewIndex: number, regionIndex: number, newName: string) => void
  existingRename: ExistingRegionRenameHandlers
}

export function RegionList({
  regions,
  deleteRegion,
  toggleRegionEditable,
  toggleRegionVisible,
  renameRegion,
  viewList,
  currentViewIdx,
  existingExpanded,
  setExistingExpanded,
  windowAnchors,
  changeExistingRegionBasis,
  deleteExistingRegion,
  toggleExistingRegionEditable,
  toggleExistingRegionVisible,
  renameExistingRegion,
  existingRename
}: RegionListProps) {
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [existingRenamingIdx, setExistingRenamingIdx] = useState<string | null>(null)
  const [existingRenameValue, setExistingRenameValue] = useState('')
  const allExistingCount = viewList.reduce((sum, v) => sum + v.regions.length, 0)
  const currentViewName = viewList[currentViewIdx]?.name ?? '默认视图'

  return (
    <>
      {/* 当前视图的已有区域（可展开查看其他视图） */}
      {allExistingCount > 0 && (
        <div style={{ marginBottom: 20 }}>
          {viewList.map((view, vIdx) => {
            if (view.regions.length === 0) return null
            const isCurrent = vIdx === currentViewIdx
            return (
              <div key={`view-${vIdx}`} style={{ marginBottom: 8 }}>
                <div
                  onClick={() => {
                    if (isCurrent) setExistingExpanded((v) => !v)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    color: isCurrent ? '#fde68a' : '#9ca3af',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '4px 0',
                    cursor: isCurrent ? 'pointer' : 'default',
                    userSelect: 'none'
                  }}
                >
                  <span>
                    {isCurrent ? '▸ ' : ''}
                    {view.name}（{view.regions.length}）
                  </span>
                  {isCurrent && (
                    <span style={{ fontSize: 14 }}>{existingExpanded ? '▾' : '▸'}</span>
                  )}
                </div>
                {isCurrent && existingExpanded && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}
                  >
                    {view.regions.map((r, i) => {
                      const regionKey = `${vIdx}-${i}`
                      const isRenaming = existingRename.renamingKey === regionKey
                      const isInlineRenaming = existingRenamingIdx === regionKey
                      const isEditable = r.editable === true
                      return (
                        <div
                          key={`existing-${vIdx}-${i}`}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: isEditable
                              ? 'rgba(96, 165, 250, 0.1)'
                              : 'rgba(96, 165, 250, 0.06)',
                            border: `1px solid ${isEditable ? 'rgba(96, 165, 250, 0.25)' : 'rgba(96, 165, 250, 0.15)'}`
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 4
                            }}
                          >
                            {isInlineRenaming ? (
                              <input
                                autoFocus
                                value={existingRenameValue}
                                onChange={(e) => setExistingRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && existingRenameValue.trim()) {
                                    renameExistingRegion(vIdx, i, existingRenameValue.trim())
                                    setExistingRenamingIdx(null)
                                  }
                                  if (e.key === 'Escape') setExistingRenamingIdx(null)
                                }}
                                onBlur={() => {
                                  if (existingRenameValue.trim()) {
                                    renameExistingRegion(vIdx, i, existingRenameValue.trim())
                                  }
                                  setExistingRenamingIdx(null)
                                }}
                                style={{
                                  flex: 1,
                                  background: 'rgba(255,255,255,0.1)',
                                  border: '1px solid rgba(255,255,255,0.2)',
                                  borderRadius: 4,
                                  color: '#fff',
                                  padding: '2px 6px',
                                  fontSize: 11,
                                  fontWeight: 600
                                }}
                              />
                            ) : (
                              <span style={{ color: '#93c5fd', fontSize: 12, fontWeight: 600 }}>
                                {r.name}
                              </span>
                            )}
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                              <button
                                onClick={() => {
                                  setExistingRenamingIdx(regionKey)
                                  setExistingRenameValue(r.name)
                                }}
                                title="重命名"
                                style={{
                                  background: 'transparent',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  borderRadius: 4,
                                  color: '#9ca3af',
                                  padding: '2px 6px',
                                  fontSize: 11,
                                  cursor: 'pointer'
                                }}
                              >
                                改名
                              </button>
                              <button
                                onClick={() => toggleExistingRegionEditable(vIdx, i)}
                                title={isEditable ? '锁定区域' : '解锁编辑'}
                                style={{
                                  background: isEditable
                                    ? 'rgba(16,185,129,0.15)'
                                    : 'transparent',
                                  border: `1px solid ${isEditable ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.15)'}`,
                                  borderRadius: 4,
                                  color: isEditable ? '#10b981' : '#9ca3af',
                                  padding: '2px 6px',
                                  fontSize: 11,
                                  cursor: 'pointer'
                                }}
                              >
                                {isEditable ? '锁定' : '编辑'}
                              </button>
                              <button
                                onClick={() => deleteExistingRegion(vIdx, i)}
                                title="删除区域"
                                style={{
                                  background: 'transparent',
                                  border: '1px solid rgba(239,68,68,0.2)',
                                  borderRadius: 4,
                                  color: '#ef4444',
                                  padding: '2px 6px',
                                  fontSize: 11,
                                  cursor: 'pointer'
                                }}
                              >
                                删除
                              </button>
                              <button
                                onClick={() => toggleExistingRegionVisible(vIdx, i)}
                                title={r.visible === false ? '显示区域' : '隐藏区域'}
                                style={{
                                  background: r.visible === false
                                    ? 'rgba(251,191,36,0.15)'
                                    : 'transparent',
                                  border: `1px solid ${r.visible === false ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.15)'}`,
                                  borderRadius: 4,
                                  color: r.visible === false ? '#fbbf24' : '#9ca3af',
                                  padding: '2px 6px',
                                  fontSize: 11,
                                  cursor: 'pointer'
                                }}
                              >
                                {r.visible === false ? '显示' : '隐藏'}
                              </button>
                            </div>
                          </div>
                          <div style={{ color: '#6b7280', fontSize: 10 }}>
                            {r.x}, {r.y} · {r.width}x{r.height}
                            {isEditable && (
                              <span style={{ color: '#10b981', marginLeft: 8 }}>· 可拖动</span>
                            )}
                          </div>
                          <select
                            value={
                              r.coordinateMode === 'window' && r.windowAnchorId
                                ? `window:${r.windowAnchorId}`
                                : 'screen'
                            }
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              changeExistingRegionBasis(vIdx, i, event.target.value)
                            }
                            style={{
                              marginTop: 4,
                              maxWidth: '100%',
                              background: '#20232d',
                              border: '1px solid rgba(255,255,255,0.14)',
                              borderRadius: 4,
                              color: '#cbd5e1',
                              padding: '2px 4px',
                              fontSize: 10
                            }}
                          >
                            <option value="screen">屏幕绝对位置</option>
                            {windowAnchors.map((anchor) => (
                              <option key={anchor.id} value={`window:${anchor.id}`}>
                                相对：{anchor.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {allExistingCount + regions.length === 0 && (
        <div style={{ color: '#6b7280', fontSize: 12, lineHeight: 1.6 }}>
          当前视图: <strong style={{ color: '#fde68a' }}>{currentViewName}</strong>
          <br />
          拖拽空白区域画新框。
          <br />
          拖拽已有区域可移动。
          <br />
          右下角圆点可缩放。
          <br />
          双击区域可改名。
        </div>
      )}

      {regions.map((r, i) => {
        const isEditable = r.editable === true
        const isRenaming = renamingIdx === i
        return (
          <div
            key={`${r.name}-${i}`}
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 10,
              background: isEditable ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isEditable ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'}`
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4
              }}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renameValue.trim()) {
                      renameRegion(i, renameValue.trim())
                      setRenamingIdx(null)
                    }
                    if (e.key === 'Escape') setRenamingIdx(null)
                  }}
                  onBlur={() => {
                    if (renameValue.trim()) {
                      renameRegion(i, renameValue.trim())
                    }
                    setRenamingIdx(null)
                  }}
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 4,
                    color: '#fff',
                    padding: '2px 6px',
                    fontSize: 12,
                    fontWeight: 600
                  }}
                />
              ) : (
                <span style={{ color: COLORS[i % COLORS.length], fontSize: 13, fontWeight: 600 }}>
                  {r.name}
                </span>
              )}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                <button
                  onClick={() => {
                    setRenamingIdx(i)
                    setRenameValue(r.name)
                  }}
                  title="重命名"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 4,
                    color: '#9ca3af',
                    padding: '2px 6px',
                    fontSize: 11,
                    cursor: 'pointer'
                  }}
                >
                  改名
                </button>
                <button
                  onClick={() => toggleRegionEditable(i)}
                  title={isEditable ? '锁定区域' : '解锁编辑'}
                  style={{
                    background: isEditable ? 'rgba(16,185,129,0.15)' : 'transparent',
                    border: `1px solid ${isEditable ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.15)'}`,
                    borderRadius: 4,
                    color: isEditable ? '#10b981' : '#9ca3af',
                    padding: '2px 6px',
                    fontSize: 11,
                    cursor: 'pointer'
                  }}
                >
                  {isEditable ? '锁定' : '编辑'}
                </button>
                <button
                  onClick={() => deleteRegion(i)}
                  title="删除区域"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(239,68,68,0.2)',
                    borderRadius: 4,
                    color: '#ef4444',
                    padding: '2px 6px',
                    fontSize: 11,
                    cursor: 'pointer'
                  }}
                >
                  删除
                </button>
                <button
                  onClick={() => toggleRegionVisible(i)}
                  title={r.visible === false ? '显示区域' : '隐藏区域'}
                  style={{
                    background: r.visible === false
                      ? 'rgba(251,191,36,0.15)'
                      : 'transparent',
                    border: `1px solid ${r.visible === false ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.15)'}`,
                    borderRadius: 4,
                    color: r.visible === false ? '#fbbf24' : '#9ca3af',
                    padding: '2px 6px',
                    fontSize: 11,
                    cursor: 'pointer'
                  }}
                >
                  {r.visible === false ? '显示' : '隐藏'}
                </button>
              </div>
            </div>
            <div style={{ color: '#9ca3af', fontSize: 11 }}>
              {r.x}, {r.y} · {r.width}x{r.height}
              {' · '}
              {r.coordinateMode === 'window'
                ? `相对 ${findAnchorById(windowAnchors, r.windowAnchorId)?.name ?? '未知窗口'}`
                : '屏幕绝对'}
              {isEditable && (
                <span style={{ color: '#10b981', marginLeft: 8 }}>· 可拖动</span>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
