import assert from 'node:assert/strict'
import { insertTemplateToken } from '../src/renderer/src/flow-editor/template-utils'

assert.deepEqual(insertTemplateToken('', '{reply}'), {
  value: '{reply}',
  caret: 7
})

assert.deepEqual(insertTemplateToken('发送：', '{reply}', 3, 3), {
  value: '发送：{reply}',
  caret: 10
})

assert.deepEqual(insertTemplateToken('你好旧内容', '{reply}', 2, 5), {
  value: '你好{reply}',
  caret: 9
})

assert.deepEqual(insertTemplateToken('A', '{reply}', -10, 99), {
  value: '{reply}',
  caret: 7
})

console.log('template-utils tests passed')
