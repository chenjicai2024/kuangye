import type { ScreenRect } from '../../core/rpa/types'
import type { WindowAnchor } from '../../core/action-chain/types'

export interface NamedRect extends ScreenRect {
  name: string
  shape?: 'rect' | 'circle'
  coordinateMode?: 'screen' | 'window'
  windowAnchorId?: string
  templateImagePath?: string
  templateScaleFactor?: number
  editable?: boolean
  visible?: boolean
}

export interface CapturedWindow {
  id: number
  title: string
  ownerName: string
  ownerPath?: string
  processId: number
  bounds: ScreenRect
  capturedImagePath?: string
  capturedImageScaleFactor?: number
}

export interface WindowCaptureResult {
  ok: boolean
  window?: CapturedWindow
  error?: string
}

export interface WindowCaptureCandidatePayload {
  window?: CapturedWindow
}

export interface ViewRegionData {
  name: string
  regions: NamedRect[]
}

export interface InitPayload {
  id: string
  display: {
    id: number
    bounds: { x: number; y: number; width: number; height: number }
    scaleFactor: number
  }
  contentOriginAbs: { x: number; y: number }
  windowAnchors?: WindowAnchor[]
  views?: ViewRegionData[]
  // 向后兼容
  existingRegions?: NamedRect[]
}

export interface PointerState {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export interface DragState {
  pointerId: number
  mode: 'move' | 'resize'
  startClientX: number
  startClientY: number
  initialRect: NamedRect
  source: { type: 'new'; idx: number } | { type: 'existing'; viewIdx: number; regionIdx: number }
}

export const MIN_DRAG_PX = 6
export const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']
export const PANEL_WIDTH = 320
export const TOPBAR_HEIGHT = 56

declare global {
  interface Window {
    electron?: {
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void
      send: (channel: string, ...args: unknown[]) => void
    }
  }
}
