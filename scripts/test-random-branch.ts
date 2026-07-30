import assert from 'node:assert/strict'
import { selectWeightedBranch } from '../src/core/action-chain/random-branch'

const branches = [
  { id: 'route-1', probabilityWeight: 50 },
  { id: 'route-2', probabilityWeight: 30 },
  { id: 'route-3', probabilityWeight: 20 }
]

assert.equal(selectWeightedBranch(branches, () => 0)?.branch.id, 'route-1')
assert.equal(selectWeightedBranch(branches, () => 0.499999)?.branch.id, 'route-1')
assert.equal(selectWeightedBranch(branches, () => 0.5)?.branch.id, 'route-2')
assert.equal(selectWeightedBranch(branches, () => 0.799999)?.branch.id, 'route-2')
assert.equal(selectWeightedBranch(branches, () => 0.8)?.branch.id, 'route-3')
assert.equal(selectWeightedBranch(branches, () => 0.999999)?.branch.id, 'route-3')
assert.equal(
  selectWeightedBranch([], () => 0),
  null
)
assert.equal(
  selectWeightedBranch([{ probabilityWeight: 0 }, { probabilityWeight: 0 }], () => 0.5),
  null
)

const defaultWeights = [{ id: 'a' }, { id: 'b' }]
assert.equal(selectWeightedBranch(defaultWeights, () => 0.25)?.branch.id, 'a')
assert.equal(selectWeightedBranch(defaultWeights, () => 0.75)?.branch.id, 'b')

console.log('random-branch tests passed')
