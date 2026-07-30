import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScreenRect } from '../../core/rpa/types'
import type { WindowAnchor } from '../../core/action-chain/types'

import type {
  CapturedWindow,
  DragState,
  InitPayload,
  NamedRect,
  PointerState,
  ViewRegionData,
  WindowCaptureCandidatePayload,
  WindowCaptureResult
} from './overlay-types'
import { COLORS, MIN_DRAG_PX, PANEL_WIDTH, TOPBAR_HEIGHT } from './overlay-types'
import {
  absoluteRectForRegion,
  convertRegionPositionValue,
  findAnchorById,
  rectFromPointer
} from './overlay-utils'
import { RegionList, type ExistingRegionRenameHandlers } from './RegionList'
import { WindowAnchorPanel } from './WindowAnchorPanel'

export function ActionChainOverlayApp(): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const windowAnchorRenameInputRef = useRef<HTMLInputElement>(null)
  const [init, setInit] = useState<InitPayload | null>(null)
  const [regions, setRegions] = useState<NamedRect[]>([])
  const [pointer, setPointer] = useState<PointerState | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [operationMode, setOperationMode] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editCoordinateMode, setEditCoordinateMode] = useState<'screen' | 'window'>('screen')
  const [editWindowAnchorId, setEditWindowAnchorId] = useState('')
  const [nameError, setNameError] = useState('')
  const [shape, setShape] = useState<'rect' | 'circle'>('rect')
  const [capturingWindow, setCapturingWindow] = useState(false)
  const [windowCaptureCandidate, setWindowCaptureCandidate] = useState<CapturedWindow | null>(null)
  const [detectMessage, setDetectMessage] = useState('')
  const [windowAnchors, setWindowAnchors] = useState<WindowAnchor[]>([])
  const [renamingWindowAnchorId, setRenamingWindowAnchorId] = useState<string | null>(null)
  const [windowAnchorRenameValue, setWindowAnchorRenameValue] = useState('')
  const [windowAnchorRenameError, setWindowAnchorRenameError] = useState('')
  const [viewList, setViewList] = useState<ViewRegionData[]>([])
  const [currentViewIdx, setCurrentViewIdx] = useState(0)
  const [newViewName, setNewViewName] = useState('')
  const [showNewViewInput, setShowNewViewInput] = useState(false)
  const [sidebarSide, setSidebarSide] = useState<'left' | 'right'>('right')
  const [existingExpanded, setExistingExpanded] = useState(false)
  const [toolbarPosition, setToolbarPosition] = useState<'top' | 'bottom'>('top')
  const [renamingExisting, setRenamingExisting] = useState<string | null>(null)
  const [existingRenameValue, setExistingRenameValue] = useState('')
  const [existingRenameError, setExistingRenameError] = useState('')

  useEffect(() => {
    const cleanupInit = window.electron?.on('action-chain-overlay:init', (payload) => {
      const initPayload = payload as InitPayload
      setInit(initPayload)
      setRegions([])
      setPointer(null)
      setDragState(null)
      setEditingIdx(null)
      setWindowAnchors(initPayload.windowAnchors ?? [])
      setRenamingWindowAnchorId(null)
      setWindowAnchorRenameValue('')
      setWindowAnchorRenameError('')
      setCapturingWindow(false)
      setWindowCaptureCandidate(null)
      setDetectMessage('捕获窗口：点击按钮后直接选择目标程序，再通过控制条确认')
      if (initPayload.views && initPayload.views.length > 0) {
        setViewList(initPayload.views)
      } else if (initPayload.existingRegions && initPayload.existingRegions.length > 0) {
        setViewList([{ name: '默认视图', regions: initPayload.existingRegions }])
      } else {
        setViewList([{ name: '默认视图', regions: [] }])
      }
      setCurrentViewIdx(0)
      setShowNewViewInput(false)
      requestAnimationFrame(() => rootRef.current?.focus())
    })
    window.electron?.send('action-chain-overlay:ready')
    return cleanupInit
  }, [])

  useEffect(() => {
    if (!renamingWindowAnchorId) return
    const frame = window.requestAnimationFrame(() => windowAnchorRenameInputRef.current?.select())
    return () => window.cancelAnimationFrame(frame)
  }, [renamingWindowAnchorId])

  // 窗口从桌面模式恢复时，重置 UI 状态
  useEffect(() => {
    const cleanup = window.electron?.on('action-chain-overlay:restored', () => {
      setOperationMode(false)
    })
    return cleanup
  }, [])

  useEffect(() => {
    if (editingIdx !== null && inputRef.current) {
      inputRef.current.focus()
    }
  }, [editingIdx])

  // ── 屏幕绝对坐标 / 窗口相对坐标转换 ──

  function toAbsolute(clientX: number, clientY: number): [number, number] {
    if (!init) return [clientX, clientY]
    return [
      Math.round(clientX + init.contentOriginAbs.x),
      Math.round(clientY + init.contentOriginAbs.y)
    ]
  }

  function regionLeft(region: NamedRect): number {
    return absoluteRectForRegion(region, windowAnchors).x - (init?.contentOriginAbs.x ?? 0)
  }

  function regionTop(region: NamedRect): number {
    return absoluteRectForRegion(region, windowAnchors).y - (init?.contentOriginAbs.y ?? 0)
  }

  function recommendedAnchor(rect: ScreenRect): WindowAnchor | undefined {
    return windowAnchors.find((anchor) => {
      const bounds = anchor.capturedBounds
      return (
        rect.x >= bounds.x &&
        rect.y >= bounds.y &&
        rect.x + rect.width <= bounds.x + bounds.width &&
        rect.y + rect.height <= bounds.y + bounds.height
      )
    })
  }

  // ── 框选事件 ──

  function onPointerDown(e: React.PointerEvent): void {
    if (editingIdx !== null) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    setPointer({
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY
    })
  }

  function onPointerMove(e: React.PointerEvent): void {
    if (pointer) {
      setPointer({ ...pointer, currentX: e.clientX, currentY: e.clientY })
      return
    }
    if (dragState) {
      const dx = e.clientX - dragState.startClientX
      const dy = e.clientY - dragState.startClientY
      if (dragState.source.type === 'new') {
        const idx = dragState.source.idx
        if (dragState.mode === 'move') {
          setRegions((prev) =>
            prev.map((r, i) =>
              i === idx
                ? { ...r, x: dragState.initialRect.x + dx, y: dragState.initialRect.y + dy }
                : r
            )
          )
        } else {
          setRegions((prev) =>
            prev.map((r, i) =>
              i === idx
                ? {
                    ...r,
                    width: Math.max(MIN_DRAG_PX, dragState.initialRect.width + dx),
                    height: Math.max(MIN_DRAG_PX, dragState.initialRect.height + dy)
                  }
                : r
            )
          )
        }
      } else {
        const { viewIdx, regionIdx } = dragState.source
        if (dragState.mode === 'move') {
          setViewList((prev) =>
            prev.map((v, vi) =>
              vi === viewIdx
                ? {
                    ...v,
                    regions: v.regions.map((r, ri) =>
                      ri === regionIdx
                        ? { ...r, x: dragState.initialRect.x + dx, y: dragState.initialRect.y + dy }
                        : r
                    )
                  }
                : v
            )
          )
        } else {
          setViewList((prev) =>
            prev.map((v, vi) =>
              vi === viewIdx
                ? {
                    ...v,
                    regions: v.regions.map((r, ri) =>
                      ri === regionIdx
                        ? {
                            ...r,
                            width: Math.max(MIN_DRAG_PX, dragState.initialRect.width + dx),
                            height: Math.max(MIN_DRAG_PX, dragState.initialRect.height + dy)
                          }
                        : r
                    )
                  }
                : v
            )
          )
        }
      }
    }
  }

  function onPointerUp(): void {
    if (pointer) {
      const rect = rectFromPointer(pointer)
      setPointer(null)
      if (rect.width < MIN_DRAG_PX || rect.height < MIN_DRAG_PX) return
      const [ax, ay] = toAbsolute(rect.x, rect.y)
      const newName = uniqueRegionName(`区域${regions.length + 1}`)
      const newRegion: NamedRect = {
        ...rect,
        x: ax,
        y: ay,
        name: newName,
        shape,
        coordinateMode: 'screen'
      }
      const anchor = recommendedAnchor(newRegion)
      setRegions((prev) => [...prev, newRegion])
      setEditingIdx(regions.length)
      setEditName(newRegion.name)
      setEditCoordinateMode(anchor ? 'window' : 'screen')
      setEditWindowAnchorId(anchor?.id ?? '')
      return
    }
    if (dragState) {
      setDragState(null)
    }
  }

  function startRegionDrag(e: React.PointerEvent, idx: number, mode: 'move' | 'resize'): void {
    e.stopPropagation()
    if (regions[idx].editable !== true) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    setDragState({
      pointerId: e.pointerId,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      initialRect: regions[idx],
      source: { type: 'new', idx }
    })
  }

  function startExistingRegionDrag(
    e: React.PointerEvent,
    viewIdx: number,
    regionIdx: number,
    mode: 'move' | 'resize'
  ): void {
    e.stopPropagation()
    const r = viewList[viewIdx]?.regions[regionIdx]
    if (!r || r.editable !== true) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    setDragState({
      pointerId: e.pointerId,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      initialRect: r,
      source: { type: 'existing', viewIdx, regionIdx }
    })
  }

  // ── 命名 / 删除 ──

  const allRegionNames = useCallback(
    (excludeIdx?: number): string[] => {
      const fromNew = regions.filter((_, i) => i !== excludeIdx).map((r) => r.name)
      const fromExisting = viewList.flatMap((v) => v.regions.map((r) => r.name))
      return [...fromNew, ...fromExisting]
    },
    [regions, viewList]
  )

  const uniqueRegionName = useCallback(
    (base: string, excludeIdx?: number): string => {
      const existing = allRegionNames(excludeIdx)
      if (!existing.includes(base)) return base
      let n = 1
      while (existing.includes(`${base}${n}`)) n++
      return `${base}${n}`
    },
    [allRegionNames]
  )

  useEffect(() => {
    const cleanupCandidate = window.electron?.on(
      'action-chain-overlay:windowCaptureCandidate',
      (payload) => {
        const result = payload as WindowCaptureCandidatePayload
        setWindowCaptureCandidate(result.window ?? null)
      }
    )
    const cleanup = window.electron?.on('action-chain-overlay:windowCaptured', (payload) => {
      const result = payload as WindowCaptureResult
      setCapturingWindow(false)
      setWindowCaptureCandidate(null)
      setOperationMode(false)

      if (!result.ok || !result.window) {
        setDetectMessage(result.error || '未捕获到有效窗口')
        return
      }

      const captured = result.window
      const existingAnchor = windowAnchors.find(
        (anchor) =>
          Boolean(captured.ownerPath) &&
          anchor.ownerPath?.toLowerCase() === captured.ownerPath?.toLowerCase() &&
          anchor.title === captured.title
      )
      if (existingAnchor) {
        setWindowAnchors((prev) =>
          prev.map((anchor) =>
            anchor.id === existingAnchor.id
              ? {
                  ...anchor,
                  title: captured.title,
                  ownerName: captured.ownerName,
                  ownerPath: captured.ownerPath,
                  capturedBounds: captured.bounds,
                  capturedImagePath: captured.capturedImagePath ?? anchor.capturedImagePath,
                  capturedImageScaleFactor:
                    captured.capturedImageScaleFactor ?? anchor.capturedImageScaleFactor
                }
              : anchor
          )
        )
        setDetectMessage(`已更新窗口锚点 ${existingAnchor.name} 的当前位置`)
        return
      }
      const baseName = captured.ownerName.trim() || captured.title.trim() || '窗口'
      const existingNames = windowAnchors.map((anchor) => anchor.name)
      let anchorName = baseName
      let suffix = 1
      while (existingNames.includes(anchorName)) anchorName = `${baseName}${suffix++}`
      const nextAnchor: WindowAnchor = {
        id: `window-${Date.now()}-${captured.id}`,
        name: anchorName,
        title: captured.title,
        ownerName: captured.ownerName,
        ownerPath: captured.ownerPath,
        capturedBounds: captured.bounds,
        capturedImagePath: captured.capturedImagePath,
        capturedImageScaleFactor: captured.capturedImageScaleFactor
      }
      setWindowAnchors([...windowAnchors, nextAnchor])
      setRenamingWindowAnchorId(nextAnchor.id)
      setWindowAnchorRenameValue(anchorName)
      setWindowAnchorRenameError('')
      setDetectMessage(`已添加窗口锚点 ${anchorName}：请确认名称，之后框选的区域可相对此窗口定位`)
    })
    return () => {
      cleanupCandidate?.()
      cleanup?.()
    }
  }, [windowAnchors])

  const commitName = useCallback((): void => {
    if (editingIdx === null || !editName.trim()) return
    const name = editName.trim()
    if (allRegionNames(editingIdx).includes(name)) {
      setNameError(`名称"${name}"已存在，请换一个`)
      return
    }
    if (editCoordinateMode === 'window' && !editWindowAnchorId) {
      setNameError('请选择一个窗口锚点')
      return
    }
    setRegions((prev) =>
      prev.map((region, index) =>
        index === editingIdx
          ? {
              ...convertRegionPositionValue(
                region,
                editCoordinateMode,
                windowAnchors,
                editWindowAnchorId
              ),
              name
            }
          : region
      )
    )
    setEditingIdx(null)
    setEditName('')
    setNameError('')
  }, [allRegionNames, editCoordinateMode, editName, editWindowAnchorId, editingIdx, windowAnchors])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Control') {
        event.preventDefault()
        const nextMode = !operationMode
        setOperationMode(nextMode)
        window.electron?.send('action-chain-overlay:toggleMousePassthrough', {
          id: init?.id,
          passthrough: nextMode
        })
      }
      if (event.key === 'Escape') {
        if (pointer) {
          setPointer(null)
          return
        }
        if (dragState) {
          setDragState(null)
          return
        }
        if (editingIdx !== null) {
          setEditingIdx(null)
          setEditName('')
          return
        }
        window.electron?.send('action-chain-overlay:cancel', { id: init?.id })
      }
      if (event.key === 'Enter' && editingIdx !== null) commitName()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commitName, dragState, editingIdx, init?.id, pointer, operationMode])

  function allExistingRegionNames(excludeKey?: string): string[] {
    const names: string[] = []
    viewList.forEach((v, vi) => {
      v.regions.forEach((r, ri) => {
        const key = `${vi}-${ri}`
        if (key !== excludeKey) names.push(r.name)
      })
    })
    return names
  }

  function commitExistingRename(): void {
    if (!renamingExisting) return
    const name = existingRenameValue.trim()
    if (!name) {
      setRenamingExisting(null)
      return
    }
    if (allExistingRegionNames(renamingExisting).includes(name)) {
      setExistingRenameError(`名称"${name}"已存在`)
      return
    }
    const [vi, ri] = renamingExisting.split('-').map(Number)
    setViewList((prev) =>
      prev.map((v, i) =>
        i === vi ? { ...v, regions: v.regions.map((r, j) => (j === ri ? { ...r, name } : r)) } : v
      )
    )
    setRenamingExisting(null)
  }

  function changeExistingRegionBasis(viewIndex: number, regionIndex: number, value: string): void {
    setViewList((prev) =>
      prev.map((view, currentViewIndex) => {
        if (currentViewIndex !== viewIndex) return view
        return {
          ...view,
          regions: view.regions.map((region, currentRegionIndex) => {
            if (currentRegionIndex !== regionIndex) return region
            return value === 'screen'
              ? convertRegionPositionValue(region, 'screen', windowAnchors)
              : convertRegionPositionValue(
                  region,
                  'window',
                  windowAnchors,
                  value.slice('window:'.length)
                )
          })
        }
      })
    )
  }

  function deleteRegion(idx: number): void {
    setRegions((prev) => prev.filter((_, i) => i !== idx))
    if (editingIdx === idx) {
      setEditingIdx(null)
      setEditName('')
    }
  }

  function toggleRegionEditable(idx: number): void {
    setRegions((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, editable: r.editable === true ? false : true } : r))
    )
  }

  function toggleRegionVisible(idx: number): void {
    setRegions((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, visible: r.visible === false ? true : false } : r))
    )
  }

  function renameRegion(idx: number, newName: string): void {
    setRegions((prev) => prev.map((r, i) => (i === idx ? { ...r, name: newName } : r)))
  }

  function toggleExistingRegionEditable(viewIndex: number, regionIndex: number): void {
    setViewList((prev) =>
      prev.map((v, vi) =>
        vi === viewIndex
          ? {
              ...v,
              regions: v.regions.map((r, ri) =>
                ri === regionIndex ? { ...r, editable: r.editable === true ? false : true } : r
              )
            }
          : v
      )
    )
  }

  function renameExistingRegion(viewIndex: number, regionIndex: number, newName: string): void {
    setViewList((prev) =>
      prev.map((v, vi) =>
        vi === viewIndex
          ? {
              ...v,
              regions: v.regions.map((r, ri) => (ri === regionIndex ? { ...r, name: newName } : r))
            }
          : v
      )
    )
  }

  function toggleExistingRegionVisible(viewIndex: number, regionIndex: number): void {
    setViewList((prev) =>
      prev.map((v, vi) =>
        vi === viewIndex
          ? {
              ...v,
              regions: v.regions.map((r, ri) =>
                ri === regionIndex ? { ...r, visible: r.visible === false ? true : false } : r
              )
            }
          : v
      )
    )
  }

  function deleteExistingRegion(viewIndex: number, regionIndex: number): void {
    setViewList((prev) =>
      prev.map((v, vi) =>
        vi === viewIndex
          ? { ...v, regions: v.regions.filter((_, ri) => ri !== regionIndex) }
          : v
      )
    )
  }

  function beginRenameWindowAnchor(anchor: WindowAnchor): void {
    setRenamingWindowAnchorId(anchor.id)
    setWindowAnchorRenameValue(anchor.name)
    setWindowAnchorRenameError('')
  }

  function commitWindowAnchorRename(anchorId: string): void {
    const name = windowAnchorRenameValue.trim()
    if (!name) {
      setWindowAnchorRenameError('名称不能为空')
      return
    }
    if (windowAnchors.some((anchor) => anchor.id !== anchorId && anchor.name === name)) {
      setWindowAnchorRenameError(`名称"${name}"已存在`)
      return
    }
    setWindowAnchors((prev) =>
      prev.map((anchor) => (anchor.id === anchorId ? { ...anchor, name } : anchor))
    )
    setRenamingWindowAnchorId(null)
    setWindowAnchorRenameValue('')
    setWindowAnchorRenameError('')
    setDetectMessage(`窗口锚点已重命名为 ${name}`)
  }

  function deleteWindowAnchor(anchorId: string): void {
    const anchor = findAnchorById(windowAnchors, anchorId)
    if (!anchor) return
    const detachRegion = (region: NamedRect): NamedRect =>
      region.coordinateMode === 'window' && region.windowAnchorId === anchorId
        ? {
            ...region,
            x: anchor.capturedBounds.x + region.x,
            y: anchor.capturedBounds.y + region.y,
            coordinateMode: 'screen',
            windowAnchorId: undefined
          }
        : region
    setRegions((prev) => prev.map(detachRegion))
    setViewList((prev) =>
      prev.map((view) => ({ ...view, regions: view.regions.map(detachRegion) }))
    )
    setWindowAnchors((prev) => prev.filter((item) => item.id !== anchorId))
    if (renamingWindowAnchorId === anchorId) {
      setRenamingWindowAnchorId(null)
      setWindowAnchorRenameValue('')
      setWindowAnchorRenameError('')
    }
    if (editWindowAnchorId === anchorId) {
      setEditCoordinateMode('screen')
      setEditWindowAnchorId('')
    }
    setDetectMessage(`已删除窗口锚点 ${anchor.name}，关联区域已转换为屏幕绝对坐标`)
  }

  // ── 主窗口捕获 ──

  function captureWindow(): void {
    if (!init || capturingWindow) return
    setCapturingWindow(true)
    setWindowCaptureCandidate(null)
    setDetectMessage('请直接点击目标程序；识别后使用浮动控制条确认、重选或取消')
    window.electron?.send('action-chain-overlay:startWindowCapture', { id: init.id })
  }

  // ── 完成 ──

  function onFinish(): void {
    if (!init) return
    let finalWindowAnchors = windowAnchors
    if (renamingWindowAnchorId) {
      const name = windowAnchorRenameValue.trim()
      if (!name) {
        setWindowAnchorRenameError('名称不能为空')
        return
      }
      if (
        windowAnchors.some((anchor) => anchor.id !== renamingWindowAnchorId && anchor.name === name)
      ) {
        setWindowAnchorRenameError(`名称"${name}"已存在`)
        return
      }
      finalWindowAnchors = windowAnchors.map((anchor) =>
        anchor.id === renamingWindowAnchorId ? { ...anchor, name } : anchor
      )
    }
    // 把新画的区域合并到对应视图，并锁定所有区域
    const finalViews: ViewRegionData[] = viewList.map((v, i) => {
      if (i === currentViewIdx && regions.length > 0) {
        const newRegions = regions.map((r) => ({
          name: r.name,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          coordinateMode: r.coordinateMode ?? 'screen',
          windowAnchorId: r.windowAnchorId,
          templateImagePath: r.templateImagePath,
          templateScaleFactor: r.templateScaleFactor,
          editable: false
        }))
        return { name: v.name, regions: [...v.regions, ...newRegions] }
      }
      return v
    })
    window.electron?.send('action-chain-overlay:complete', {
      id: init.id,
      windowAnchors: finalWindowAnchors,
      views: finalViews
    })
  }

  const dragRect = pointer ? rectFromPointer(pointer) : null
  const allExistingCount = viewList.reduce((sum, v) => sum + v.regions.length, 0)
  const sidebarTitle = useMemo(
    () => `${allExistingCount + regions.length} 个区域`,
    [allExistingCount, regions.length]
  )

  const existingRename: ExistingRegionRenameHandlers = {
    renamingKey: renamingExisting,
    value: existingRenameValue,
    error: existingRenameError,
    onValueChange: (v) => {
      setExistingRenameValue(v)
      setExistingRenameError('')
    },
    begin: (key, name) => {
      setRenamingExisting(key)
      setExistingRenameValue(name)
      setExistingRenameError('')
    },
    commit: commitExistingRename,
    cancel: () => setRenamingExisting(null)
  }

  return (
    <div
      ref={rootRef}
      className="overlay__root"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      tabIndex={0}
      style={{
        outline: 'none',
        width: '100vw',
        height: '100vh',
        position: 'relative',
        cursor: operationMode ? 'default' : 'crosshair',
        userSelect: 'none'
      }}
    >
      {/* 桌面模式屏幕边框 - 高级发光动画 */}
      {operationMode && (
        <>
          <style>{`
            @keyframes borderGlow {
              0%, 100% {
                border-color: rgba(16, 185, 129, 0.4);
                box-shadow:
                  inset 0 0 40px rgba(16, 185, 129, 0.05),
                  0 0 60px rgba(16, 185, 129, 0.15),
                  0 0 100px rgba(16, 185, 129, 0.1);
              }
              50% {
                border-color: rgba(16, 185, 129, 1);
                box-shadow:
                  inset 0 0 80px rgba(16, 185, 129, 0.15),
                  0 0 120px rgba(16, 185, 129, 0.4),
                  0 0 200px rgba(16, 185, 129, 0.25),
                  0 0 300px rgba(16, 185, 129, 0.1);
              }
            }
            @keyframes borderScan {
              0% {
                background-position: -200% 0;
              }
              100% {
                background-position: 200% 0;
              }
            }
          `}</style>
          {/* 外层发光 */}
          <div
            style={{
              position: 'fixed',
              inset: -4,
              border: '4px solid transparent',
              background: `linear-gradient(90deg, transparent 0%, rgba(16, 185, 129, 0.8) 50%, transparent 100%) border-box`,
              WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
              animation: 'borderGlow 2s ease-in-out infinite',
              pointerEvents: 'none',
              zIndex: 9999
            }}
          />
          {/* 流光扫描效果 */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              border: '3px solid transparent',
              borderRadius: 0,
              background: `linear-gradient(90deg, transparent 0%, rgba(16, 185, 129, 0.9) 25%, rgba(52, 211, 153, 1) 50%, rgba(16, 185, 129, 0.9) 75%, transparent 100%)`,
              backgroundSize: '200% 100%',
              WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
              padding: 3,
              animation: 'borderScan 3s linear infinite',
              pointerEvents: 'none',
              zIndex: 9999
            }}
          />
        </>
      )}

      {/* 捕获候选窗口：候选信息已经冻结，点击控制条不会改变这里的结果。 */}
      {capturingWindow && windowCaptureCandidate && (
        <div
          style={{
            position: 'absolute',
            left: windowCaptureCandidate.bounds.x - (init?.contentOriginAbs.x ?? 0),
            top: windowCaptureCandidate.bounds.y - (init?.contentOriginAbs.y ?? 0),
            width: windowCaptureCandidate.bounds.width,
            height: windowCaptureCandidate.bounds.height,
            border: '3px solid #10b981',
            background: 'rgba(16,185,129,0.045)',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.55), 0 0 24px rgba(16,185,129,0.42)',
            pointerEvents: 'none',
            zIndex: 1500
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -27,
              left: 0,
              maxWidth: Math.max(180, windowCaptureCandidate.bounds.width),
              padding: '3px 9px',
              borderRadius: 6,
              background: '#059669',
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {windowCaptureCandidate.ownerName || windowCaptureCandidate.title}（
            {windowCaptureCandidate.bounds.width}×{windowCaptureCandidate.bounds.height}）
          </div>
        </div>
      )}

      {/* 窗口锚点：只作为相对坐标基准，不参与动作区域列表。 */}
      {windowAnchors.map((anchor) => (
        <div
          key={anchor.id}
          style={{
            position: 'absolute',
            left: anchor.capturedBounds.x - (init?.contentOriginAbs.x ?? 0),
            top: anchor.capturedBounds.y - (init?.contentOriginAbs.y ?? 0),
            width: anchor.capturedBounds.width,
            height: anchor.capturedBounds.height,
            border: '2px solid rgba(250, 204, 21, 0.9)',
            background: 'rgba(250, 204, 21, 0.04)',
            pointerEvents: 'none',
            zIndex: 4
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -24,
              left: 0,
              padding: '2px 8px',
              borderRadius: 5,
              background: '#ca8a04',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap'
            }}
          >
            窗口锚点：{anchor.name}
          </div>
        </div>
      ))}

      {/* 已有区域（从 viewList 渲染） */}
      {viewList.map((view, vIdx) =>
        view.regions.map((r, rIdx) => {
          if (r.visible === false) return null
          const isEditable = r.editable === true
          const absRect = absoluteRectForRegion(r, windowAnchors)
          const colorIdx = vIdx * 10 + rIdx
          return (
            <div
              key={`existing-${vIdx}-${rIdx}`}
              onPointerDown={(e) => startExistingRegionDrag(e, vIdx, rIdx, 'move')}
              style={{
                position: 'absolute',
                left: absRect.x - (init?.contentOriginAbs.x ?? 0),
                top: absRect.y - (init?.contentOriginAbs.y ?? 0),
                width: r.width,
                height: r.height,
                border: isEditable
                  ? `2px solid ${COLORS[colorIdx % COLORS.length]}`
                  : '2px dashed rgba(96, 165, 250, 0.85)',
                background: isEditable
                  ? `${COLORS[colorIdx % COLORS.length]}15`
                  : 'rgba(96, 165, 250, 0.08)',
                pointerEvents: isEditable ? 'auto' : 'none',
                cursor: isEditable ? 'move' : 'default',
                zIndex: isEditable ? 30 : 5
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: -22,
                  left: 0,
                  padding: '2px 8px',
                  borderRadius: isEditable ? 6 : 4,
                  background: isEditable ? COLORS[colorIdx % COLORS.length] : 'rgba(15, 23, 42, 0.92)',
                  color: isEditable ? '#fff' : '#93c5fd',
                  fontSize: 11,
                  fontWeight: isEditable ? 600 : 400,
                  whiteSpace: 'nowrap'
                }}
              >
                {r.name}
              </div>
              {isEditable && (
                <div
                  style={{
                    position: 'absolute',
                    right: -6,
                    bottom: -6,
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    background: COLORS[colorIdx % COLORS.length],
                    border: '2px solid #fff',
                    cursor: 'nwse-resize'
                  }}
                  onPointerDown={(e) => startExistingRegionDrag(e, vIdx, rIdx, 'resize')}
                />
              )}
            </div>
          )
        })
      )}

      {/* 新画的区域 */}
      {regions.map((r, i) => {
        if (r.visible === false) return null
        const isCircle = r.shape === 'circle'
        const isEditable = r.editable === true
        return (
          <div
            key={`${r.name}-${i}`}
            onPointerDown={(e) => startRegionDrag(e, i, 'move')}
            style={{
              position: 'absolute',
              left: regionLeft(r),
              top: regionTop(r),
              width: r.width,
              height: r.height,
              border: `2px ${isEditable ? 'solid' : 'dashed'} ${COLORS[i % COLORS.length]}`,
              backgroundColor: isEditable ? `${COLORS[i % COLORS.length]}15` : `${COLORS[i % COLORS.length]}08`,
              borderRadius: isCircle ? '50%' : 0,
              pointerEvents: isEditable ? 'auto' : 'none',
              cursor: isEditable ? 'move' : 'default',
              zIndex: isEditable ? 30 : 5
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -24,
                left: 0,
                padding: '2px 8px',
                borderRadius: 6,
                background: isEditable ? COLORS[i % COLORS.length] : 'rgba(15, 23, 42, 0.92)',
                color: isEditable ? '#fff' : COLORS[i % COLORS.length],
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: 'nowrap'
              }}
            >
              {r.name} ({r.width}x{r.height})
            </div>
            {isEditable && (
              <div
                style={{
                  position: 'absolute',
                  right: -6,
                  bottom: -6,
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: COLORS[i % COLORS.length],
                  border: '2px solid #fff',
                  cursor: 'nwse-resize'
                }}
                onPointerDown={(e) => startRegionDrag(e, i, 'resize')}
              />
            )}
          </div>
        )
      })}

      {/* 拖拽中的预览 */}
      {dragRect && (
        <div
          style={{
            position: 'absolute',
            left: dragRect.x,
            top: dragRect.y,
            width: dragRect.width,
            height: dragRect.height,
            border: '2px dashed #10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderRadius: shape === 'circle' ? '50%' : 0,
            pointerEvents: 'none',
            zIndex: 40
          }}
        />
      )}

      {/* 工具栏 —— 上下吸附 */}
      {!operationMode && (
      <div
        style={{
          position: 'fixed',
          ...(toolbarPosition === 'top'
            ? { top: 0, borderBottom: '1px solid rgba(255,255,255,0.1)' }
            : { bottom: 0, borderTop: '1px solid rgba(255,255,255,0.1)' }),
          left: 0,
          right: 0,
          height: TOPBAR_HEIGHT,
          background: 'rgba(10, 11, 16, 0.92)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 1000,
          pointerEvents: 'auto'
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>自由框选</span>
          {/* 视图切换 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              value={currentViewIdx}
              onChange={(e) => {
                // 切换前把当前新画的区域合并到当前视图
                if (regions.length > 0) {
                  setViewList((prev) =>
                    prev.map((v, i) =>
                      i === currentViewIdx
                        ? {
                            ...v,
                            regions: [
                              ...v.regions,
                              ...regions.map((r) => ({
                                name: r.name,
                                x: r.x,
                                y: r.y,
                                width: r.width,
                                height: r.height,
                                coordinateMode: r.coordinateMode ?? 'screen',
                                windowAnchorId: r.windowAnchorId,
                                templateImagePath: r.templateImagePath,
                                templateScaleFactor: r.templateScaleFactor
                              }))
                            ]
                          }
                        : v
                    )
                  )
                }
                setCurrentViewIdx(Number(e.target.value))
                setRegions([])
                setPointer(null)
              }}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6,
                color: '#e5e7eb',
                padding: '3px 8px',
                fontSize: 12
              }}
            >
              {viewList.map((v, i) => (
                <option key={i} value={i}>
                  {v.name} ({v.regions.length})
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowNewViewInput(true)}
              title="新建视图"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6,
                color: '#9ca3af',
                fontSize: 13,
                padding: '2px 8px',
                cursor: 'pointer'
              }}
            >
              +
            </button>
          </div>
          <button
            onClick={() => setShape('rect')}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              background: shape === 'rect' ? 'rgba(59,130,246,0.18)' : 'transparent',
              border: '1px solid rgba(59,130,246,0.35)',
              color: '#93c5fd',
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            矩形
          </button>
          <button
            onClick={() => setShape('circle')}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              background: shape === 'circle' ? 'rgba(139,92,246,0.18)' : 'transparent',
              border: '1px solid rgba(139,92,246,0.35)',
              color: '#c4b5fd',
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            圆形
          </button>
          <button
            onClick={captureWindow}
            disabled={capturingWindow}
            title="点击目标程序后，通过浮动控制条确认、重新选择或取消"
            style={{
              background: 'rgba(250, 204, 21, 0.16)',
              border: '1px solid rgba(250, 204, 21, 0.35)',
              borderRadius: 8,
              color: '#fde68a',
              padding: '6px 12px',
              fontSize: 12,
              cursor: capturingWindow ? 'wait' : 'pointer'
            }}
          >
            {capturingWindow ? '等待确认...' : '捕获窗口'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>
            拖拽空白区域画新框 · 拖拽已有区域可移动 · 右下角可缩放 · 双击改名
          </span>
          <button
            onClick={() => setToolbarPosition((p) => (p === 'top' ? 'bottom' : 'top'))}
            title="切换工具栏位置"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              color: '#9ca3af',
              fontSize: 13,
              padding: '2px 8px',
              cursor: 'pointer'
            }}
          >
            ↕
          </button>
          <button
            onClick={onFinish}
            style={{
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '7px 18px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            完成
          </button>
        </div>
      </div>
      )}

      {/* 右侧浮层面板 */}
      {!operationMode && (
      <aside
        style={{
          position: 'fixed',
          top: TOPBAR_HEIGHT + 12,
          ...(sidebarSide === 'left' ? { left: 12 } : { right: 12 }),
          width: PANEL_WIDTH,
          maxHeight: 'calc(100vh - 80px)',
          background: 'rgba(10, 11, 16, 0.94)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: 16,
          overflow: 'auto',
          zIndex: 1000,
          pointerEvents: 'auto',
          boxShadow: '0 16px 40px rgba(0,0,0,0.28)'
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6
          }}
        >
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{sidebarTitle}</span>
          <button
            onClick={() => setSidebarSide((s) => (s === 'left' ? 'right' : 'left'))}
            title={sidebarSide === 'left' ? '移到右侧' : '移到左侧'}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              color: '#9ca3af',
              fontSize: 13,
              padding: '2px 8px',
              cursor: 'pointer'
            }}
          >
            {sidebarSide === 'left' ? '→' : '←'}
          </button>
        </div>
        <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 16 }}>
          {detectMessage || '实时显示已选区域，支持改名和微调坐标。'}
        </div>

        <WindowAnchorPanel
          windowAnchors={windowAnchors}
          renamingWindowAnchorId={renamingWindowAnchorId}
          windowAnchorRenameValue={windowAnchorRenameValue}
          windowAnchorRenameError={windowAnchorRenameError}
          setRenamingWindowAnchorId={setRenamingWindowAnchorId}
          setWindowAnchorRenameValue={setWindowAnchorRenameValue}
          setWindowAnchorRenameError={setWindowAnchorRenameError}
          windowAnchorRenameInputRef={windowAnchorRenameInputRef}
          commitWindowAnchorRename={commitWindowAnchorRename}
          beginRenameWindowAnchor={beginRenameWindowAnchor}
          deleteWindowAnchor={deleteWindowAnchor}
        />

        <RegionList
          regions={regions}
          deleteRegion={deleteRegion}
          toggleRegionEditable={toggleRegionEditable}
          toggleRegionVisible={toggleRegionVisible}
          renameRegion={renameRegion}
          viewList={viewList}
          currentViewIdx={currentViewIdx}
          existingExpanded={existingExpanded}
          setExistingExpanded={setExistingExpanded}
          windowAnchors={windowAnchors}
          changeExistingRegionBasis={changeExistingRegionBasis}
          deleteExistingRegion={deleteExistingRegion}
          toggleExistingRegionEditable={toggleExistingRegionEditable}
          toggleExistingRegionVisible={toggleExistingRegionVisible}
          renameExistingRegion={renameExistingRegion}
          existingRename={existingRename}
        />
      </aside>
      )}

      {/* 命名弹窗 */}
      {!operationMode && editingIdx !== null && (
        <div
          style={{
            position: 'fixed',
            bottom: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(10, 11, 16, 0.95)',
            backdropFilter: 'blur(16px)',
            borderRadius: 12,
            padding: '16px 20px',
            zIndex: 1001,
            border: '1px solid rgba(255,255,255,0.15)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            maxWidth: 'calc(100vw - 40px)'
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span style={{ color: '#888', fontSize: 13 }}>区域名称:</span>
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => {
              setEditName(e.target.value)
              setNameError('')
            }}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: `1px solid ${nameError ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.2)'}`,
              borderRadius: 6,
              color: '#fff',
              padding: '4px 10px',
              fontSize: 14,
              width: 180
            }}
          />
          <span style={{ color: '#888', fontSize: 13, marginLeft: 8 }}>定位基准:</span>
          <select
            value={
              editCoordinateMode === 'window' && editWindowAnchorId
                ? `window:${editWindowAnchorId}`
                : 'screen'
            }
            onChange={(event) => {
              const value = event.target.value
              if (value === 'screen') {
                setEditCoordinateMode('screen')
                setEditWindowAnchorId('')
              } else {
                setEditCoordinateMode('window')
                setEditWindowAnchorId(value.slice('window:'.length))
              }
              setNameError('')
            }}
            style={{
              background: '#20232d',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6,
              color: '#fff',
              padding: '4px 10px',
              fontSize: 13,
              minWidth: 180
            }}
          >
            <option value="screen">屏幕绝对位置</option>
            {windowAnchors.map((anchor) => (
              <option key={anchor.id} value={`window:${anchor.id}`}>
                相对窗口：{anchor.name}
              </option>
            ))}
          </select>
          {nameError && (
            <span style={{ color: '#ef4444', fontSize: 11, marginLeft: 8 }}>{nameError}</span>
          )}
          <button
            onClick={commitName}
            style={{
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '4px 14px',
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            确定
          </button>
          <button
            onClick={() => {
              if (editingIdx !== null) {
                deleteRegion(editingIdx)
              }
              setEditingIdx(null)
              setEditName('')
            }}
            style={{
              background: 'transparent',
              color: '#888',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              padding: '4px 14px',
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            取消
          </button>
        </div>
      )}

      {/* 新建视图弹窗 */}
      {!operationMode && showNewViewInput && (
        <div
          style={{
            position: 'fixed',
            bottom: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(10, 11, 16, 0.95)',
            backdropFilter: 'blur(16px)',
            borderRadius: 12,
            padding: '16px 20px',
            zIndex: 1001,
            border: '1px solid rgba(255,255,255,0.15)',
            display: 'flex',
            gap: 8,
            alignItems: 'center'
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span style={{ color: '#888', fontSize: 13 }}>视图名称:</span>
          <input
            autoFocus
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newViewName.trim()) {
                setViewList((prev) => [...prev, { name: newViewName.trim(), regions: [] }])
                setCurrentViewIdx(viewList.length)
                setRegions([])
                setNewViewName('')
                setShowNewViewInput(false)
              }
              if (e.key === 'Escape') {
                setNewViewName('')
                setShowNewViewInput(false)
              }
            }}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6,
              color: '#fff',
              padding: '4px 10px',
              fontSize: 14,
              width: 180
            }}
          />
          <button
            onClick={() => {
              if (newViewName.trim()) {
                setViewList((prev) => [...prev, { name: newViewName.trim(), regions: [] }])
                setCurrentViewIdx(viewList.length)
                setRegions([])
                setNewViewName('')
                setShowNewViewInput(false)
              }
            }}
            style={{
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '4px 14px',
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            确定
          </button>
          <button
            onClick={() => {
              setNewViewName('')
              setShowNewViewInput(false)
            }}
            style={{
              background: 'transparent',
              color: '#888',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              padding: '4px 14px',
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            取消
          </button>
        </div>
      )}

      {/* 操作提示 */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: operationMode ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.08)',
          border: operationMode
            ? '1px solid rgba(16,185,129,0.4)'
            : '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8,
          padding: '8px 20px',
          color: operationMode ? '#10b981' : '#888',
          fontSize: 13,
          pointerEvents: 'none',
          userSelect: 'none'
        }}
      >
        {operationMode ? '✓ 桌面模式 · 按 Ctrl+K 返回框选' : '按 Ctrl 进入桌面模式 · 按 Ctrl+K 快速恢复'}
      </div>
    </div>
  )
}