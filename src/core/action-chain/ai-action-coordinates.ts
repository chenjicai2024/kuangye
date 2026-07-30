import type { ScreenRect } from '../rpa/types'

export type ParsedAIPoint = readonly [number, number]

/**
 * 动作计划统一使用截图内部的 0~1000 坐标，本地再映射到目标区域。
 * 同时兼容旧版已经保存的 0~1 比例坐标。
 */
export function aiPointToRegionDip(point: ParsedAIPoint, region: ScreenRect): [number, number] {
  const [x, y] = point
  const isLegacyUnitPoint = x >= 0 && x <= 1 && y >= 0 && y <= 1
  const ratioX = isLegacyUnitPoint ? x : x / 1000
  const ratioY = isLegacyUnitPoint ? y : y / 1000
  return [region.x + region.width * ratioX, region.y + region.height * ratioY]
}

export function isAIActionPointInBounds(point: ParsedAIPoint): boolean {
  const [x, y] = point
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  const isLegacyUnitPoint = x >= 0 && x <= 1 && y >= 0 && y <= 1
  if (isLegacyUnitPoint) return true
  return x >= 0 && x <= 1000 && y >= 0 && y <= 1000
}
