import assert from 'node:assert/strict'
import type { SingleCondition } from '../src/core/action-chain/types'
import {
  buildCondition,
  conditionItemWithOperator,
  conditionItemWithVariable,
  normalizeConditionItems
} from '../src/renderer/src/flow-editor/condition-utils'

const variables = [
  { name: '聊天框_changed', type: 'boolean' as const },
  { name: 'replyText', type: 'string' as const }
]
const emptyBoolean: SingleCondition = {
  variable: '聊天框_changed',
  operator: 'equals',
  value: ''
}

assert.equal(conditionItemWithVariable(emptyBoolean, '聊天框_changed', variables).value, 'true')
assert.equal(conditionItemWithVariable(emptyBoolean, 'replyText', variables).value, '')
assert.equal(conditionItemWithOperator(emptyBoolean, 'equals', variables).value, 'true')
assert.equal(
  conditionItemWithOperator({ ...emptyBoolean, value: 'false' }, 'not_equals', variables).value,
  'false'
)
assert.equal(conditionItemWithOperator(emptyBoolean, 'is_true', variables).value, '')
assert.equal(normalizeConditionItems([emptyBoolean], variables)[0].value, 'true')
assert.deepEqual(buildCondition(true, 'and', [emptyBoolean], variables), {
  variable: '聊天框_changed',
  operator: 'equals',
  value: 'true'
})
assert.deepEqual(
  buildCondition(
    true,
    'and',
    [emptyBoolean, { variable: 'replyText', operator: 'equals', value: '' }],
    variables
  ),
  {
    logic: 'and',
    conditions: [
      { variable: '聊天框_changed', operator: 'equals', value: 'true' },
      { variable: 'replyText', operator: 'equals', value: '' }
    ]
  }
)

console.log('condition-utils tests passed')
