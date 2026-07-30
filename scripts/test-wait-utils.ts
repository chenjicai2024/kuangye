import assert from 'node:assert/strict'
import { resolveWaitDuration } from '../src/core/action-chain/wait-utils'

assert.equal(resolveWaitDuration({ waitMs: 2500 }), 2500)
assert.equal(resolveWaitDuration({ waitMode: 'fixed', waitMs: -1 }), 0)
assert.equal(
  resolveWaitDuration({ waitMode: 'random', waitMinMs: 1000, waitMaxMs: 5000 }, () => 0),
  1000
)
assert.equal(
  resolveWaitDuration({ waitMode: 'random', waitMinMs: 1000, waitMaxMs: 5000 }, () => 0.999999),
  5000
)
assert.equal(
  resolveWaitDuration({ waitMode: 'random', waitMinMs: 5000, waitMaxMs: 1000 }, () => 0.5),
  5000
)

console.log('wait-utils tests passed')
