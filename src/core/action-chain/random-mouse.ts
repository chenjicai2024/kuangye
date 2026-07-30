import type { ScreenRect } from '../rpa/types'

export interface RandomMouseConfig {
  minMoves?: number
  maxMoves?: number
  minPauseMs?: number
  maxPauseMs?: number
}

export interface RandomMouseMove {
  x: number
  y: number
  pauseAfterMs: number
}

function inclusiveRandomInteger(min: number, max: number, random: () => number): number {
  return min + Math.floor(random() * (max - min + 1))
}

export function createRandomMousePlan(
  rect: ScreenRect,
  config: RandomMouseConfig,
  random: () => number = Math.random
): RandomMouseMove[] {
  const minMoves = Math.max(1, Math.floor(config.minMoves ?? 1))
  const maxMoves = Math.max(minMoves, Math.floor(config.maxMoves ?? 3))
  const minPauseMs = Math.max(0, Math.floor(config.minPauseMs ?? 100))
  const maxPauseMs = Math.max(minPauseMs, Math.floor(config.maxPauseMs ?? 400))
  const moveCount = inclusiveRandomInteger(minMoves, maxMoves, random)
  const marginX = Math.max(0, rect.width * 0.1)
  const marginY = Math.max(0, rect.height * 0.1)
  const usableWidth = Math.max(0, rect.width - marginX * 2)
  const usableHeight = Math.max(0, rect.height - marginY * 2)

  return Array.from({ length: moveCount }, () => ({
    x: rect.x + marginX + random() * usableWidth,
    y: rect.y + marginY + random() * usableHeight,
    pauseAfterMs: inclusiveRandomInteger(minPauseMs, maxPauseMs, random)
  }))
}
