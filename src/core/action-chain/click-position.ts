import type { ScreenRect } from '../rpa/types'

export type ClickPositionMode = 'center' | 'random'

const SAFE_INSET_RATIO = 0.15

function normalizedRandom(random: () => number): number {
  const value = random()
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

/**
 * 计算区域点击位置。随机模式只使用中间 70% 的安全范围，避免误点边缘。
 */
export function clickPointInRegion(
  rect: ScreenRect,
  mode: ClickPositionMode = 'center',
  random: () => number = Math.random
): [number, number] {
  if (mode !== 'random') {
    return [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)]
  }

  const minX = rect.x + rect.width * SAFE_INSET_RATIO
  const maxX = rect.x + rect.width * (1 - SAFE_INSET_RATIO)
  const minY = rect.y + rect.height * SAFE_INSET_RATIO
  const maxY = rect.y + rect.height * (1 - SAFE_INSET_RATIO)
  return [
    Math.round(minX + (maxX - minX) * normalizedRandom(random)),
    Math.round(minY + (maxY - minY) * normalizedRandom(random))
  ]
}
