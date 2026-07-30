import type { AIAction, AIPoint } from './types'
import { isRecord } from '../error-utils'

export interface UILayoutAdjustmentPlan {
  needAdjust: boolean
  confidence: number
  reason?: string
  action?: AIAction
}

function parsePoint(value: unknown): AIPoint | null {
  if (!isRecord(value)) return null
  const x = Number(value.x)
  const y = Number(value.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) {
    return null
  }
  return { x, y, coordinateSpace: 'region_normalized' }
}

export function parseUiLayoutAdjustmentPlan(raw: string): UILayoutAdjustmentPlan {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI没有返回有效JSON')

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('AI返回的JSON无法解析')
  }
  if (!isRecord(parsed)) throw new Error('AI返回的布局调整计划格式无效')

  const needAdjust = parsed.needAdjust === true
  let confidence = Number(parsed.confidence)
  if (!Number.isFinite(confidence)) confidence = 0
  if (confidence > 1 && confidence <= 100) confidence /= 100
  confidence = Math.min(1, Math.max(0, confidence))
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : undefined
  if (!needAdjust) return { needAdjust: false, confidence, reason }

  if (!isRecord(parsed.action)) throw new Error('AI认为需要调整，但没有返回有效动作')
  const type = parsed.action.type
  if (type !== 'drag' && type !== 'click') {
    throw new Error(`AI返回了不允许的布局动作“${String(type)}”`)
  }
  const from = parsePoint(parsed.action.from)
  if (!from) throw new Error('AI返回的动作起点坐标无效')
  let to: AIPoint | undefined
  if (type === 'drag') {
    const parsedTo = parsePoint(parsed.action.to)
    if (!parsedTo) throw new Error('AI返回的拖动终点坐标无效')
    to = parsedTo
  }

  return {
    needAdjust: true,
    confidence,
    reason,
    action: {
      type,
      from,
      to,
      reason: typeof parsed.action.reason === 'string' ? parsed.action.reason.trim() : reason
    }
  }
}
