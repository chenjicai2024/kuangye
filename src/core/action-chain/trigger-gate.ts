export class RisingEdgeTriggerGate {
  private active = new Set<string>()
  private cooldownUntil = new Map<string, number>()

  reset(): void {
    this.active.clear()
    this.cooldownUntil.clear()
  }

  shouldTrigger(key: string, detected: boolean, now = Date.now(), cooldownMs = 2000): boolean {
    if (!detected) {
      this.active.delete(key)
      return false
    }
    if (this.active.has(key)) return false

    this.active.add(key)
    if ((this.cooldownUntil.get(key) ?? 0) > now) return false
    this.cooldownUntil.set(key, now + Math.max(0, cooldownMs))
    return true
  }
}

export const DEFAULT_RED_DOT_THRESHOLD = 0.5

export function normalizeRedDotThreshold(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_RED_DOT_THRESHOLD
  return Math.min(100, Math.max(0, value as number))
}

/** 编辑器中的等待节点采用当前比例判断，不做上升沿去重。 */
export function shouldResumeRedDotWait(redRatio: number, threshold?: number): boolean {
  return redRatio > normalizeRedDotThreshold(threshold)
}
