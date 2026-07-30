import assert from 'node:assert/strict'
import { createRandomMousePlan } from '../src/core/action-chain/random-mouse'

const values = [0.5, 0, 0, 0, 0.999999, 0.999999, 0.999999]
let index = 0
const plan = createRandomMousePlan(
  { x: 100, y: 200, width: 300, height: 100 },
  { minMoves: 1, maxMoves: 3, minPauseMs: 100, maxPauseMs: 400 },
  () => values[index++] ?? 0
)

assert.equal(plan.length, 2)
assert.deepEqual(plan[0], { x: 130, y: 210, pauseAfterMs: 100 })
assert.ok(plan[1].x < 370 && plan[1].x > 369)
assert.ok(plan[1].y < 290 && plan[1].y > 289)
assert.equal(plan[1].pauseAfterMs, 400)

const fixedPlan = createRandomMousePlan(
  { x: 0, y: 0, width: 10, height: 10 },
  { minMoves: 2, maxMoves: 2, minPauseMs: 0, maxPauseMs: 0 },
  () => 0
)
assert.equal(fixedPlan.length, 2)
assert.ok(fixedPlan.every((move) => move.x === 1 && move.y === 1 && move.pauseAfterMs === 0))

console.log('random-mouse tests passed')
