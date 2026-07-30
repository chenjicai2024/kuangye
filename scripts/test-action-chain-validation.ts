import assert from 'node:assert/strict'
import type {
  ActionChain,
  ExecutionChain,
  FlowNode,
  Workspace
} from '../src/core/action-chain/types'
import { validateWorkspaceForRun } from '../src/core/action-chain/validation'
import {
  normalizeRedDotThreshold,
  RisingEdgeTriggerGate,
  shouldResumeRedDotWait
} from '../src/core/action-chain/trigger-gate'
import { repairWorkspaceFlow } from '../src/core/action-chain/flow-migration'
import { clickPointInRegion } from '../src/core/action-chain/click-position'
import { parseUiLayoutAdjustmentPlan } from '../src/core/action-chain/ui-layout-adjustment'

function node(id: string, type: FlowNode['type'], extra: Partial<FlowNode['data']> = {}): FlowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { type, ...extra }
  }
}

function executionChain(overrides: Partial<ExecutionChain> = {}): ExecutionChain {
  return {
    id: 'exec-1',
    name: '主流程',
    enabled: true,
    trigger: 'default',
    nodes: [node('start', 'wait')],
    edges: [],
    ...overrides
  }
}

function workspace(executionChains: ExecutionChain[], chains: ActionChain[] = []): Workspace {
  return {
    windowAnchors: [],
    views: [
      {
        name: '默认视图',
        regions: [{ name: '按钮', rect: { x: 0, y: 0, width: 20, height: 20 } }]
      }
    ],
    executionChains,
    chains
  }
}

assert.deepEqual(validateWorkspaceForRun(workspace([executionChain()])), [])

const multipleEntries = validateWorkspaceForRun(
  workspace([executionChain({ nodes: [node('a', 'wait'), node('b', 'wait')] })])
)
assert.ok(multipleEntries.some((item) => item.code === 'entry_count'))

const ambiguousOutput = validateWorkspaceForRun(
  workspace([
    executionChain({
      nodes: [node('a', 'wait'), node('b', 'wait'), node('c', 'wait')],
      edges: [
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'ac', source: 'a', target: 'c' }
      ]
    })
  ])
)
assert.ok(ambiguousOutput.some((item) => item.code === 'multiple_outputs'))

const validRandomBranch = validateWorkspaceForRun(
  workspace([
    executionChain({
      nodes: [
        node('random', 'random_branch'),
        node('route-1', 'wait'),
        node('route-2', 'wait'),
        node('route-3', 'wait')
      ],
      edges: [
        { id: 'r1', source: 'random', target: 'route-1', probabilityWeight: 50 },
        { id: 'r2', source: 'random', target: 'route-2', probabilityWeight: 30 },
        { id: 'r3', source: 'random', target: 'route-3', probabilityWeight: 20 }
      ]
    })
  ])
)
assert.ok(!validRandomBranch.some((item) => item.code === 'multiple_outputs'))
assert.ok(!validRandomBranch.some((item) => item.code === 'random_branch_routes'))

// 循环计数器允许"继续"+"退出"两条出边，不应误报为普通节点多出口
const validLoopCounter = validateWorkspaceForRun(
  workspace([
    executionChain({
      nodes: [
        node('loop', 'loop_counter', { params: { loopMaxCount: 3 } }),
        node('body', 'wait'),
        node('done', 'wait')
      ],
      edges: [
        { id: 'lc-continue', source: 'loop', target: 'body', sourceHandle: 'continue' },
        { id: 'lc-exit', source: 'loop', target: 'done', sourceHandle: 'exit' }
      ]
    })
  ])
)
assert.ok(!validLoopCounter.some((item) => item.code === 'multiple_outputs'))
assert.ok(!validLoopCounter.some((item) => item.code === 'ambiguous_loop_branch'))

const incompleteRandomBranch = validateWorkspaceForRun(
  workspace([
    executionChain({
      nodes: [node('random', 'random_branch'), node('route-1', 'wait')],
      edges: [{ id: 'r1', source: 'random', target: 'route-1', probabilityWeight: 100 }]
    })
  ])
)
assert.ok(incompleteRandomBranch.some((item) => item.code === 'random_branch_routes'))

const actionA: ActionChain = {
  id: 'action-a',
  name: '动作A',
  trigger: 'sub',
  nodes: [node('call-b', 'call_chain', { params: { callChainName: '动作B' } })],
  edges: []
}
const actionB: ActionChain = {
  id: 'action-b',
  name: '动作B',
  trigger: 'sub',
  nodes: [node('call-a', 'call_chain', { params: { callChainName: '动作A' } })],
  edges: []
}
const recursiveCalls = validateWorkspaceForRun(
  workspace(
    [
      executionChain({
        nodes: [node('call-a-root', 'call_chain', { params: { callChainName: '动作A' } })]
      })
    ],
    [actionA, actionB]
  )
)
assert.ok(recursiveCalls.some((item) => item.code === 'recursive_call'))

const missingRegion = validateWorkspaceForRun(
  workspace([executionChain({ nodes: [node('click', 'click')] })])
)
assert.ok(missingRegion.some((item) => item.code === 'missing_region'))

const chatExtractMissingRegion = validateWorkspaceForRun(
  workspace([executionChain({ nodes: [node('extract-chat', 'extract_chat_details')] })])
)
assert.ok(chatExtractMissingRegion.some((item) => item.code === 'missing_region'))

const textOnlyChatReply = validateWorkspaceForRun(
  workspace([executionChain({ nodes: [node('reply', 'generate_chat_reply')] })])
)
assert.ok(!textOnlyChatReply.some((item) => item.code === 'missing_region'))

const screenshotChatReplyMissingRegion = validateWorkspaceForRun(
  workspace([
    executionChain({
      nodes: [node('reply', 'generate_chat_reply', { params: { chatIncludeScreenshot: true } })]
    })
  ])
)
assert.ok(screenshotChatReplyMissingRegion.some((item) => item.code === 'missing_region'))

const actionChainAsGlobal = validateWorkspaceForRun(
  workspace(
    [],
    [
      {
        id: 'action-global',
        name: '不应全局运行',
        enabled: true,
        trigger: 'default',
        nodes: [node('wait', 'wait')],
        edges: []
      }
    ]
  )
)
assert.ok(actionChainAsGlobal.some((item) => item.code === 'no_runnable_chain'))

const triggerGate = new RisingEdgeTriggerGate()
assert.equal(triggerGate.shouldTrigger('red-dot', false, 0), false)
assert.equal(triggerGate.shouldTrigger('red-dot', true, 1000), true)
assert.equal(triggerGate.shouldTrigger('red-dot', true, 4000), false)
assert.equal(triggerGate.shouldTrigger('red-dot', false, 4100), false)
assert.equal(triggerGate.shouldTrigger('red-dot', true, 4200), true)
triggerGate.reset()
assert.equal(triggerGate.shouldTrigger('red-dot', true, 4300), true)

// 等待节点采用当前比例与可配置阈值判断，不做上升沿去重。
assert.equal(shouldResumeRedDotWait(14, 5), true)
assert.equal(shouldResumeRedDotWait(14, 5), true)
assert.equal(shouldResumeRedDotWait(5, 5), false)
assert.equal(shouldResumeRedDotWait(0.6), true)
assert.equal(normalizeRedDotThreshold(undefined), 0.5)
assert.equal(normalizeRedDotThreshold(-2), 0)
assert.equal(normalizeRedDotThreshold(120), 100)

assert.deepEqual(clickPointInRegion({ x: 100, y: 200, width: 100, height: 50 }), [150, 225])
const clickRandomValues = [0, 1]
assert.deepEqual(
  clickPointInRegion(
    { x: 100, y: 200, width: 100, height: 50 },
    'random',
    () => clickRandomValues.shift() ?? 0.5
  ),
  [115, 243]
)

const layoutDragPlan = parseUiLayoutAdjustmentPlan(
  '{"needAdjust":true,"confidence":92,"reason":"恢复分隔线","action":{"type":"drag","from":{"x":500,"y":420},"to":{"x":500,"y":610}}}'
)
assert.equal(layoutDragPlan.needAdjust, true)
assert.equal(layoutDragPlan.confidence, 0.92)
assert.equal(layoutDragPlan.action?.type, 'drag')
assert.deepEqual(layoutDragPlan.action?.from, {
  x: 500,
  y: 420,
  coordinateSpace: 'region_normalized'
})
assert.throws(
  () =>
    parseUiLayoutAdjustmentPlan(
      '{"needAdjust":true,"confidence":0.9,"action":{"type":"drag","from":{"x":1200,"y":50},"to":{"x":500,"y":500}}}'
    ),
  /起点坐标无效/
)
assert.deepEqual(parseUiLayoutAdjustmentPlan('{"needAdjust":false,"confidence":0.95}'), {
  needAdjust: false,
  confidence: 0.95,
  reason: undefined
})

const legacyTriggerWorkspace = workspace([
  executionChain({
    trigger: 'red_dot',
    triggerRegion: '按钮',
    nodes: [node('legacy-start', 'click', { region: '按钮' })]
  })
])
assert.equal(repairWorkspaceFlow(legacyTriggerWorkspace), true)
assert.equal(legacyTriggerWorkspace.executionChains[0].trigger, 'default')
assert.equal(legacyTriggerWorkspace.executionChains[0].triggerRegion, undefined)
assert.equal(legacyTriggerWorkspace.executionChains[0].nodes[0].type, 'wait_red_dot')
assert.equal(legacyTriggerWorkspace.executionChains[0].nodes[0].data.region, '按钮')
assert.ok(
  legacyTriggerWorkspace.executionChains[0].edges.some(
    (edge) =>
      edge.source === legacyTriggerWorkspace.executionChains[0].nodes[0].id &&
      edge.target === 'legacy-start'
  )
)

console.log('action-chain validation tests passed')
