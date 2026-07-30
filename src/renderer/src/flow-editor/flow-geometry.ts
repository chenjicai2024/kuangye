import type { FlowPortSide } from '../../../core/action-chain/types'

export interface FlowPoint {
  x: number
  y: number
}

export interface FlowRect {
  left: number
  top: number
  width: number
  height: number
}

const SIDE_VECTOR: Record<FlowPortSide, FlowPoint> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
}

export function nodePortPoint(
  position: FlowPoint,
  width: number,
  height: number,
  side: FlowPortSide
): FlowPoint {
  switch (side) {
    case 'top':
      return { x: position.x + width / 2, y: position.y }
    case 'right':
      return { x: position.x + width, y: position.y + height / 2 }
    case 'bottom':
      return { x: position.x + width / 2, y: position.y + height }
    case 'left':
      return { x: position.x, y: position.y + height / 2 }
  }
}

export function closestPortSide(point: FlowPoint, rect: FlowRect): FlowPortSide {
  const distances: Array<[FlowPortSide, number]> = [
    ['top', Math.abs(point.y - rect.top)],
    ['right', Math.abs(point.x - (rect.left + rect.width))],
    ['bottom', Math.abs(point.y - (rect.top + rect.height))],
    ['left', Math.abs(point.x - rect.left)]
  ]
  distances.sort((a, b) => a[1] - b[1])
  return distances[0][0]
}

export function targetSideFacingPoint(from: FlowPoint, to: FlowPoint): FlowPortSide {
  const deltaX = to.x - from.x
  const deltaY = to.y - from.y
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX >= 0 ? 'left' : 'right'
  return deltaY >= 0 ? 'top' : 'bottom'
}

export function edgePath(
  from: FlowPoint,
  sourceSide: FlowPortSide,
  to: FlowPoint,
  targetSide: FlowPortSide
): string {
  const distance = Math.min(180, Math.max(50, Math.hypot(to.x - from.x, to.y - from.y) * 0.35))
  const sourceVector = SIDE_VECTOR[sourceSide]
  const targetVector = SIDE_VECTOR[targetSide]
  const control1 = {
    x: from.x + sourceVector.x * distance,
    y: from.y + sourceVector.y * distance
  }
  const control2 = {
    x: to.x + targetVector.x * distance,
    y: to.y + targetVector.y * distance
  }
  return `M ${from.x} ${from.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${to.x} ${to.y}`
}
