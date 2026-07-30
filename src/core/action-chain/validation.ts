import type {
  ActionChain,
  ActionStep,
  ExecutionChain,
  FlowEdge,
  FlowNode,
  Workspace
} from './types'
import { normalizedBranchWeight } from './random-branch'

export type ValidationSeverity = 'error' | 'warning'

export interface ActionChainValidationIssue {
  severity: ValidationSeverity
  code: string
  message: string
  chainName?: string
  nodeId?: string
}

export interface ActionChainValidationTarget {
  targetType: 'executionChain' | 'actionChain'
  targetId: string
}

type ChainLike = ActionChain | ExecutionChain

const REGION_STEP_TYPES = new Set<ActionStep['type']>([
  'click',
  'random_mouse',
  'right_click',
  'drag',
  'type_text',
  'screenshot_to_ai',
  'extract_chat_details',
  'check_pixel_diff',
  'detect_pixel_change',
  'detect_red_dot',
  'wait_red_dot',
  'set_baseline',
  'locate_ui_region',
  'ai_locate_ui_region'
])

function issue(
  issues: ActionChainValidationIssue[],
  severity: ValidationSeverity,
  code: string,
  message: string,
  chain: ChainLike,
  nodeId?: string
): void {
  issues.push({ severity, code, message, chainName: chain.name, nodeId })
}

function validateNodeParameters(
  workspace: Workspace,
  chain: ChainLike,
  node: FlowNode,
  actionChainsByName: Map<string, ActionChain[]>,
  issues: ActionChainValidationIssue[]
): void {
  const step = node.data
  const regionNames = new Set(
    workspace.views.flatMap((view) => view.regions.map((region) => region.name))
  )

  if (REGION_STEP_TYPES.has(step.type)) {
    if (!step.region) {
      issue(
        issues,
        'error',
        'missing_region',
        `节点“${node.label ?? step.type}”没有选择目标区域`,
        chain,
        node.id
      )
    } else if (!regionNames.has(step.region)) {
      issue(
        issues,
        'error',
        'unknown_region',
        `节点引用的区域“${step.region}”不存在`,
        chain,
        node.id
      )
    }
  }

  if (step.type === 'generate_chat_reply' && step.params?.chatIncludeScreenshot) {
    if (!step.region) {
      issue(
        issues,
        'error',
        'missing_region',
        '附带截图的聊天回复节点没有选择聊天区域',
        chain,
        node.id
      )
    } else if (!regionNames.has(step.region)) {
      issue(
        issues,
        'error',
        'unknown_region',
        `聊天回复节点引用的区域“${step.region}”不存在`,
        chain,
        node.id
      )
    }
  }

  if (step.type === 'drag') {
    const endRegion = step.params?.dragEndRegion
    if (!endRegion) {
      issue(issues, 'error', 'missing_drag_end', '拖动节点没有选择终点区域', chain, node.id)
    } else if (!regionNames.has(endRegion)) {
      issue(issues, 'error', 'unknown_drag_end', `拖动终点区域“${endRegion}”不存在`, chain, node.id)
    }
  }

  if (step.type === 'if_else' && !step.condition) {
    issue(issues, 'error', 'missing_condition', '条件分支节点没有设置判断条件', chain, node.id)
  }

  if (step.type === 'call_chain') {
    const targetName = step.params?.callChainName
    const matches = targetName ? (actionChainsByName.get(targetName) ?? []) : []
    if (!targetName) {
      issue(
        issues,
        'error',
        'missing_call_target',
        '调用动作链节点没有选择目标动作链',
        chain,
        node.id
      )
    } else if (matches.length === 0) {
      issue(
        issues,
        'error',
        'unknown_call_target',
        `要调用的动作链“${targetName}”不存在`,
        chain,
        node.id
      )
    } else if (matches.length > 1) {
      issue(
        issues,
        'error',
        'ambiguous_call_target',
        `存在多个名为“${targetName}”的动作链，调用目标不明确`,
        chain,
        node.id
      )
    }
  }
}

function validateChainGraph(
  workspace: Workspace,
  chain: ChainLike,
  actionChainsByName: Map<string, ActionChain[]>,
  issues: ActionChainValidationIssue[]
): void {
  const nodes = chain.nodes ?? []
  const edges = chain.edges ?? []
  if (nodes.length === 0) {
    issue(issues, 'error', 'empty_chain', '链中没有任何节点', chain)
    return
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const validEdges: FlowEdge[] = []
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      issue(issues, 'error', 'dangling_edge', '存在连接到已删除节点的连线', chain)
      continue
    }
    validEdges.push(edge)
  }

  const incoming = new Set(validEdges.map((edge) => edge.target))
  const entries = nodes.filter((node) => !incoming.has(node.id))
  if (entries.length !== 1) {
    issue(
      issues,
      'error',
      'entry_count',
      entries.length === 0
        ? '流程没有明确入口，可能形成了无入口环路'
        : `流程存在 ${entries.length} 个入口，只允许一个`,
      chain
    )
  }

  for (const node of nodes) {
    validateNodeParameters(workspace, chain, node, actionChainsByName, issues)
    const outEdges = validEdges.filter((edge) => edge.source === node.id)
    if (node.data.type === 'if_else') {
      const trueEdges = outEdges.filter((edge) => edge.sourceHandle === 'true')
      const falseEdges = outEdges.filter((edge) => edge.sourceHandle === 'false')
      const untypedEdges = outEdges.filter((edge) => edge.sourceHandle === undefined)
      if (trueEdges.length > 1 || falseEdges.length > 1 || untypedEdges.length > 0) {
        issue(
          issues,
          'error',
          'ambiguous_branch',
          '条件分支只能各有一条真连线和假连线，不能使用普通连线',
          chain,
          node.id
        )
      }
    } else if (node.data.type === 'random_branch') {
      if (outEdges.length < 2) {
        issue(
          issues,
          'error',
          'random_branch_routes',
          '随机分支节点至少需要连接两条路线',
          chain,
          node.id
        )
      }
      if (
        outEdges.some(
          (edge) =>
            edge.probabilityWeight !== undefined &&
            (!Number.isFinite(edge.probabilityWeight) || edge.probabilityWeight < 0)
        )
      ) {
        issue(
          issues,
          'error',
          'invalid_branch_weight',
          '随机分支路线权重必须是大于或等于0的数字',
          chain,
          node.id
        )
      } else if (
        outEdges.length > 0 &&
        outEdges.reduce((sum, edge) => sum + normalizedBranchWeight(edge), 0) <= 0
      ) {
        issue(
          issues,
          'error',
          'empty_branch_weight',
          '随机分支至少需要一条权重大于0的路线',
          chain,
          node.id
        )
      }
    } else if (node.data.type === 'parallel') {
      if (outEdges.length < 2) {
        issue(issues, 'error', 'parallel_routes', '并行节点至少需要连接两条分支', chain, node.id)
      }
    } else if (node.data.type === 'trigger') {
      if (outEdges.length < 1) {
        issue(
          issues,
          'error',
          'trigger_no_target',
          '触发节点需要至少连接一条连线到目标节点',
          chain,
          node.id
        )
      }
    } else if (node.data.type === 'parallel_process') {
      const inEdges = validEdges.filter((edge) => edge.target === node.id)
      if (inEdges.length < 1) {
        issue(
          issues,
          'error',
          'parallel_process_no_input',
          '并行处理节点需要至少连接一条来自并行分支的连线',
          chain,
          node.id
        )
      }
    } else if (node.data.type === 'loop_counter') {
      const exitEdges = outEdges.filter((edge) => edge.sourceHandle === 'exit')
      const continueEdges = outEdges.filter((edge) => edge.sourceHandle === 'continue')
      const untypedEdges = outEdges.filter((edge) => edge.sourceHandle === undefined)
      if (exitEdges.length > 1 || continueEdges.length > 1 || untypedEdges.length > 0) {
        issue(
          issues,
          'error',
          'ambiguous_loop_branch',
          '循环计数器只能各有一条"继续"和"退出"连线，不能使用普通连线',
          chain,
          node.id
        )
      }
    } else if (outEdges.length > 1) {
      issue(issues, 'error', 'multiple_outputs', '普通节点只能连接一个下一节点', chain, node.id)
    }
  }

  if (entries.length === 1) {
    const reachable = new Set<string>()
    const queue = [entries[0].id]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (reachable.has(current)) continue
      reachable.add(current)
      for (const edge of validEdges) {
        if (edge.source === current && !reachable.has(edge.target)) queue.push(edge.target)
      }
    }
    const unreachable = nodes.filter((node) => !reachable.has(node.id))
    if (unreachable.length > 0) {
      issue(
        issues,
        'error',
        'unreachable_nodes',
        `存在 ${unreachable.length} 个从入口无法到达的节点`,
        chain
      )
    }
  }
}

function findCallCycle(
  roots: ChainLike[],
  actionChainsByName: Map<string, ActionChain[]>
): string[] | null {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(chain: ChainLike, path: string[]): string[] | null {
    const key = chain.id ?? `name:${chain.name}`
    if (visiting.has(key)) return [...path, chain.name]
    if (visited.has(key)) return null
    visiting.add(key)
    for (const node of chain.nodes ?? []) {
      if (node.data.type !== 'call_chain') continue
      const targetName = node.data.params?.callChainName
      const target = targetName ? actionChainsByName.get(targetName)?.[0] : undefined
      if (!target) continue
      const cycle = visit(target, [...path, chain.name])
      if (cycle) return cycle
    }
    visiting.delete(key)
    visited.add(key)
    return null
  }

  for (const root of roots) {
    const cycle = visit(root, [])
    if (cycle) return cycle
  }
  return null
}

function collectReachableChains(
  roots: ChainLike[],
  actionChainsByName: Map<string, ActionChain[]>
): ChainLike[] {
  const result: ChainLike[] = []
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const chain = queue.shift()!
    const key = chain.id ?? `name:${chain.name}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(chain)
    for (const node of chain.nodes ?? []) {
      if (node.data.type !== 'call_chain') continue
      const targetName = node.data.params?.callChainName
      const target = targetName ? actionChainsByName.get(targetName)?.[0] : undefined
      if (target) queue.push(target)
    }
  }
  return result
}

export function validateWorkspaceForRun(
  workspace: Workspace,
  target: ActionChainValidationTarget | null = null
): ActionChainValidationIssue[] {
  const issues: ActionChainValidationIssue[] = []
  const actionChainsByName = new Map<string, ActionChain[]>()
  for (const chain of workspace.chains ?? []) {
    actionChainsByName.set(chain.name, [...(actionChainsByName.get(chain.name) ?? []), chain])
  }
  // 也收录执行链，使 call_chain 能够引用执行链
  for (const chain of workspace.executionChains ?? []) {
    actionChainsByName.set(chain.name, [...(actionChainsByName.get(chain.name) ?? []), chain])
  }

  let roots: ChainLike[]
  if (target) {
    const pool =
      target.targetType === 'executionChain' ? workspace.executionChains : workspace.chains
    const chain = (pool ?? []).find((item) => item.id === target.targetId)
    if (!chain) {
      return [{ severity: 'error', code: 'missing_target', message: '指定链不存在' }]
    }
    roots = [chain]
  } else {
    roots = (workspace.executionChains ?? []).filter((chain) => chain.enabled === true)
    if (roots.length === 0) {
      return [{ severity: 'error', code: 'no_runnable_chain', message: '没有启用的执行链' }]
    }
  }

  const chainsToValidate = collectReachableChains(roots, actionChainsByName)
  for (const chain of chainsToValidate)
    validateChainGraph(workspace, chain, actionChainsByName, issues)

  const cycle = findCallCycle(roots, actionChainsByName)
  if (cycle) {
    issues.push({
      severity: 'error',
      code: 'recursive_call',
      message: `动作链形成循环调用：${cycle.join(' → ')}`
    })
  }

  const regionNames = new Set(
    workspace.views.flatMap((view) => view.regions.map((region) => region.name))
  )
  for (const chain of roots) {
    if ((chain.trigger === 'red_dot' || chain.trigger === 'pixel_change') && !chain.triggerRegion) {
      issue(issues, 'error', 'missing_trigger_region', '事件触发链没有选择触发区域', chain)
    } else if (
      (chain.trigger === 'red_dot' || chain.trigger === 'pixel_change') &&
      chain.triggerRegion &&
      !regionNames.has(chain.triggerRegion)
    ) {
      issue(
        issues,
        'error',
        'unknown_trigger_region',
        `触发区域“${chain.triggerRegion}”不存在`,
        chain
      )
    }
  }

  return issues
}

export function formatValidationErrors(issues: ActionChainValidationIssue[]): string {
  return issues
    .filter((item) => item.severity === 'error')
    .map((item) => `${item.chainName ? `${item.chainName}：` : ''}${item.message}`)
    .join('；')
}
