export interface WaitDurationConfig {
  waitMode?: 'fixed' | 'random'
  waitMs?: number
  waitMinMs?: number
  waitMaxMs?: number
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value as number))
}

export function resolveWaitDuration(
  config: WaitDurationConfig,
  random: () => number = Math.random
): number {
  if (config.waitMode !== 'random') return nonNegativeInteger(config.waitMs, 1000)

  const minMs = nonNegativeInteger(config.waitMinMs, 1000)
  const maxMs = Math.max(minMs, nonNegativeInteger(config.waitMaxMs, 5000))
  return minMs + Math.floor(random() * (maxMs - minMs + 1))
}
