import assert from 'node:assert/strict'
import {
  closestPortSide,
  edgePath,
  nodePortPoint,
  targetSideFacingPoint
} from '../src/renderer/src/flow-editor/flow-geometry'

assert.deepEqual(nodePortPoint({ x: 10, y: 20 }, 100, 60, 'top'), { x: 60, y: 20 })
assert.deepEqual(nodePortPoint({ x: 10, y: 20 }, 100, 60, 'right'), { x: 110, y: 50 })
assert.deepEqual(nodePortPoint({ x: 10, y: 20 }, 100, 60, 'bottom'), { x: 60, y: 80 })
assert.deepEqual(nodePortPoint({ x: 10, y: 20 }, 100, 60, 'left'), { x: 10, y: 50 })

const rect = { left: 100, top: 100, width: 80, height: 60 }
assert.equal(closestPortSide({ x: 130, y: 102 }, rect), 'top')
assert.equal(closestPortSide({ x: 178, y: 130 }, rect), 'right')
assert.equal(closestPortSide({ x: 140, y: 158 }, rect), 'bottom')
assert.equal(closestPortSide({ x: 102, y: 130 }, rect), 'left')

assert.equal(targetSideFacingPoint({ x: 0, y: 0 }, { x: 100, y: 10 }), 'left')
assert.equal(targetSideFacingPoint({ x: 100, y: 0 }, { x: 0, y: 10 }), 'right')
assert.equal(targetSideFacingPoint({ x: 0, y: 0 }, { x: 10, y: 100 }), 'top')
assert.equal(targetSideFacingPoint({ x: 0, y: 100 }, { x: 10, y: 0 }), 'bottom')

assert.equal(
  edgePath({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left'),
  'M 0 0 C 50 0, 50 0, 100 0'
)

console.log('flow-geometry tests passed')
