import type {
  ConditionOperator,
  OutputField,
  SingleCondition,
  StepCondition
} from '../../../core/action-chain/types'

export type ConditionVariable = Pick<OutputField, 'name' | 'type'>

export function conditionNeedsValue(operator: ConditionOperator): boolean {
  return operator !== 'is_true' && operator !== 'is_false'
}

export function normalizeBooleanConditionValue(value: string): 'true' | 'false' {
  return value === 'false' ? 'false' : 'true'
}

export function conditionItemWithVariable(
  item: SingleCondition,
  variableName: string,
  variables: ConditionVariable[]
): SingleCondition {
  const variableType = variables.find((variable) => variable.name === variableName)?.type
  return {
    ...item,
    variable: variableName,
    value: variableType === 'boolean' && conditionNeedsValue(item.operator) ? 'true' : ''
  }
}

export function conditionItemWithOperator(
  item: SingleCondition,
  operator: ConditionOperator,
  variables: ConditionVariable[]
): SingleCondition {
  const variableType = variables.find((variable) => variable.name === item.variable)?.type
  return {
    ...item,
    operator,
    value: !conditionNeedsValue(operator)
      ? ''
      : variableType === 'boolean'
        ? normalizeBooleanConditionValue(item.value)
        : item.value
  }
}

export function normalizeConditionItems(
  items: SingleCondition[],
  variables: ConditionVariable[]
): SingleCondition[] {
  return items.map((item) => {
    if (!conditionNeedsValue(item.operator)) {
      return item.value === '' ? item : { ...item, value: '' }
    }
    const variableType = variables.find((variable) => variable.name === item.variable)?.type
    if (variableType !== 'boolean') return item
    const normalizedValue = normalizeBooleanConditionValue(item.value)
    return normalizedValue === item.value ? item : { ...item, value: normalizedValue }
  })
}

export function buildCondition(
  enabled: boolean,
  logic: 'and' | 'or',
  items: SingleCondition[],
  variables: ConditionVariable[]
): StepCondition | undefined {
  if (!enabled) return undefined
  const validItems = normalizeConditionItems(items, variables).filter((item) =>
    item.variable.trim()
  )
  if (validItems.length === 0) return undefined
  if (validItems.length === 1) return validItems[0]
  return { logic, conditions: validItems }
}
