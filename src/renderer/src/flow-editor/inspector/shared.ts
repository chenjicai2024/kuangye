import type { ConditionOperator, Region, SingleCondition, StepCondition, WindowAnchor } from '../../../../core/action-chain/types'
import { isCompoundCondition } from '../../../../core/action-chain/types'

export function absoluteRegionRect(
  region: Region | undefined,
  anchors: WindowAnchor[]
): Region['rect'] | null {
  if (!region) return null
  if (region.coordinateMode === 'window' && region.windowAnchorId) {
    const anchor = anchors.find((item) => item.id === region.windowAnchorId)
    if (anchor) {
      return {
        x: anchor.capturedBounds.x + region.rect.x,
        y: anchor.capturedBounds.y + region.rect.y,
        width: region.rect.width,
        height: region.rect.height
      }
    }
  }
  return region.rect
}

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: '等于',
  not_equals: '不等于',
  contains: '包含',
  is_true: '为真',
  is_false: '为假',
  greater_than: '大于',
  less_than: '小于'
}

export function stepIndexToDisplay(value: number | undefined): string {
  return value === undefined ? '' : String(value + 1)
}

export function displayStepToIndex(value: string): number | undefined {
  const stepNumber = Number(value)
  if (!Number.isFinite(stepNumber) || stepNumber < 1) return undefined
  return Math.floor(stepNumber) - 1
}

export function conditionItemsFrom(condition: StepCondition | undefined): {
  enabled: boolean
  logic: 'and' | 'or'
  items: SingleCondition[]
} {
  if (!condition) {
    return {
      enabled: false,
      logic: 'and',
      items: [{ variable: '', operator: 'equals', value: '' }]
    }
  }
  if (isCompoundCondition(condition)) {
    return {
      enabled: true,
      logic: condition.logic,
      items: condition.conditions.length
        ? [...condition.conditions]
        : [{ variable: '', operator: 'equals', value: '' }]
    }
  }
  return {
    enabled: true,
    logic: 'and',
    items: [{ variable: condition.variable, operator: condition.operator, value: condition.value }]
  }
}

export function updateItem(
  items: SingleCondition[],
  index: number,
  patch: Partial<SingleCondition>
): SingleCondition[] {
  return items.map((item, i) => (i === index ? { ...item, ...patch } : item))
}

export const COMMON_KEYS = [
  { value: 'enter', label: 'Enter' },
  { value: 'escape', label: 'Esc' },
  { value: 'tab', label: 'Tab' },
  { value: 'space', label: '空格' },
  { value: 'backspace', label: 'Backspace' },
  { value: 'delete', label: 'Delete' },
  { value: 'up', label: '↑' },
  { value: 'down', label: '↓' },
  { value: 'left', label: '←' },
  { value: 'right', label: '->' }
]

export const MODIFIER_OPTIONS = [
  { value: 'ctrl', label: 'Ctrl' },
  { value: 'alt', label: 'Alt' },
  { value: 'shift', label: 'Shift' }
]

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export type EditRegionFn = (
  name: string,
  rect: { x: number; y: number; width: number; height: number }
) => Promise<string | null>
