import type { ScreenRect } from '../../core/rpa/types'
import type { WindowAnchor } from '../../core/action-chain/types'
import type { NamedRect, PointerState } from './overlay-types'

export function rectFromPointer(p: PointerState): ScreenRect {
  const left = Math.min(p.startX, p.currentX)
  const top = Math.min(p.startY, p.currentY)
  const w = Math.abs(p.currentX - p.startX)
  const h = Math.abs(p.currentY - p.startY)
  return { x: Math.round(left), y: Math.round(top), width: Math.round(w), height: Math.round(h) }
}

export function findAnchorById(
  anchors: WindowAnchor[],
  anchorId?: string
): WindowAnchor | undefined {
  if (!anchorId) return undefined
  return anchors.find((anchor) => anchor.id === anchorId)
}

export function absoluteRectForRegion(region: NamedRect, anchors: WindowAnchor[]): ScreenRect {
  if (region.coordinateMode === 'window') {
    const anchor = findAnchorById(anchors, region.windowAnchorId)
    if (anchor) {
      return {
        x: anchor.capturedBounds.x + region.x,
        y: anchor.capturedBounds.y + region.y,
        width: region.width,
        height: region.height
      }
    }
  }
  return { x: region.x, y: region.y, width: region.width, height: region.height }
}

export function convertRegionPositionValue(
  region: NamedRect,
  mode: 'screen' | 'window',
  anchors: WindowAnchor[],
  anchorId?: string
): NamedRect {
  const absolute = absoluteRectForRegion(region, anchors)
  if (mode === 'window') {
    const anchor = findAnchorById(anchors, anchorId)
    if (anchor) {
      return {
        ...region,
        x: absolute.x - anchor.capturedBounds.x,
        y: absolute.y - anchor.capturedBounds.y,
        coordinateMode: 'window',
        windowAnchorId: anchor.id
      }
    }
  }
  return {
    ...region,
    ...absolute,
    coordinateMode: 'screen',
    windowAnchorId: undefined
  }
}
