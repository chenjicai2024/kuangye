// src/core/rpa/coord-utils.ts
// 坐标转换工具函数
//
// 从 vision-utils.ts 提取，打破 screenshot-utils ↔ vision-utils 循环依赖

const IS_WINDOWS = process.platform === 'win32'

export type BBox = [number, number, number, number] // [x1, y1, x2, y2] 归一化 0-1000

/**
 * 归一化 bbox (0-1000) → 屏幕绝对坐标（中心点）
 *
 * 关键平台差异：
 * - macOS: robotjs 用逻辑像素坐标
 * - Windows: robotjs 用物理像素坐标
 */
export function bboxToScreenCoords(
  bbox: BBox,
  bounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number
): [number, number] {
  const [x1, y1, x2, y2] = bbox

  // 归一化 → 相对于窗口的逻辑像素
  const logicalX = ((x1 + x2) / 2 / 1000) * bounds.width
  const logicalY = ((y1 + y2) / 2 / 1000) * bounds.height

  if (IS_WINDOWS) {
    // Windows: robotjs 用物理像素
    const screenX = Math.round((bounds.x + logicalX) * scaleFactor)
    const screenY = Math.round((bounds.y + logicalY) * scaleFactor)
    return [screenX, screenY]
  } else {
    // macOS: robotjs 用逻辑像素
    const screenX = Math.round(bounds.x + logicalX)
    const screenY = Math.round(bounds.y + logicalY)
    return [screenX, screenY]
  }
}

/**
 * 归一化 point (0-1000) → 屏幕绝对坐标
 */
export function pointToScreenCoords(
  point: [number, number],
  bounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number
): [number, number] {
  const [px, py] = point

  const logicalX = (px / 1000) * bounds.width
  const logicalY = (py / 1000) * bounds.height

  if (IS_WINDOWS) {
    return [
      Math.round((bounds.x + logicalX) * scaleFactor),
      Math.round((bounds.y + logicalY) * scaleFactor)
    ]
  } else {
    return [Math.round(bounds.x + logicalX), Math.round(bounds.y + logicalY)]
  }
}

/**
 * 归一化 bbox (0-1000) → 相对于窗口的逻辑像素 crop 区域
 * （用于 captureWechatWindow 的 crop 参数）
 */
export function bboxToCropBounds(
  bbox: BBox,
  windowBounds: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const [bx1, by1, bx2, by2] = bbox

  const x1 = (bx1 / 1000) * windowBounds.width
  const y1 = (by1 / 1000) * windowBounds.height
  const x2 = (bx2 / 1000) * windowBounds.width
  const y2 = (by2 / 1000) * windowBounds.height

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}
