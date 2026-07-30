import assert from 'node:assert/strict'
import { getTemplate, buildStructuredPrompt } from '../src/core/action-chain/ai-templates'
import {
  aiPointToRegionDip,
  isAIActionPointInBounds
} from '../src/core/action-chain/ai-action-coordinates'

const chatListRegion = { x: 286, y: 153, width: 213, height: 263 }
const [x, y] = aiPointToRegionDip([136, 381], chatListRegion)

assert.ok(Math.abs(x - 314.968) < 0.001)
assert.ok(Math.abs(y - 253.203) < 0.001)
assert.equal(isAIActionPointInBounds([136, 381]), true)
assert.equal(isAIActionPointInBounds([1001, 381]), false)
assert.deepEqual(aiPointToRegionDip([0.5, 0.5], chatListRegion), [392.5, 284.5])

const template = getTemplate('action_plan')
assert.ok(template)
const prompt = buildStructuredPrompt(template, '请点击目标头像，坐标使用图片像素')
assert.match(prompt, /最终坐标协议（优先级最高）/)
assert.match(prompt, /0 到 1000/)
assert.match(prompt, /本地程序负责换算/)

console.log('ai-action-coordinate tests passed')
