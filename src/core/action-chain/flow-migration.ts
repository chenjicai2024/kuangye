import { ActionChain, ActionStep, ExecutionChain, FlowEdge, FlowNode, Workspace } from './types'

interface BuildContext {
  chainKey: string
  nodeCounter: number
  edgeCounter: number
}

interface ExitPoint {
  source: string
  sourceHandle?: 'true' | 'false'
}

interface SequenceBuildResult {
  firstNodeId: string
  exits: ExitPoint[]
  nextY: number
}

type ChainLike = Partial<ActionChain | ExecutionChain> & {
  steps?: ActionStep[]
  nodes?: FlowNode[]
  edges?: FlowEdge[]
}

function idPart(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? fallback).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || fallback
}

function genNodeId(ctx: BuildContext): string {
  ctx.nodeCounter += 1
  return `node-${ctx.chainKey}-${ctx.nodeCounter}`
}

function genEdgeId(ctx: BuildContext): string {
  ctx.edgeCounter += 1
  return `edge-${ctx.chainKey}-${ctx.edgeCounter}`
}

function addEdge(
  ctx: BuildContext,
  resultEdges: FlowEdge[],
  source: string,
  target: string,
  sourceHandle?: 'true' | 'false'
): void {
  resultEdges.push({
    id: genEdgeId(ctx),
    source,
    target,
    sourceHandle
  })
}

function connectExits(
  ctx: BuildContext,
  resultEdges: FlowEdge[],
  exits: ExitPoint[],
  target: string
): void {
  for (const exit of exits) {
    addEdge(ctx, resultEdges, exit.source, target, exit.sourceHandle)
  }
}

function makeNode(
  ctx: BuildContext,
  step: ActionStep,
  legacyStepIndex: number,
  x: number,
  y: number
): FlowNode {
  return {
    id: genNodeId(ctx),
    type: step.type,
    position: { x, y },
    data: { ...step, trueSteps: undefined, falseSteps: undefined },
    label: step.region || undefined,
    legacyStepIndex
  }
}

function buildSequence(
  steps: ActionStep[],
  ctx: BuildContext,
  resultNodes: FlowNode[],
  resultEdges: FlowEdge[],
  x: number,
  startY: number
): SequenceBuildResult | null {
  if (steps.length === 0) return null

  let firstNodeId = ''
  let pendingExits: ExitPoint[] = []
  let cursorY = startY

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const node = makeNode(ctx, step, i, x, cursorY)
    resultNodes.push(node)
    if (!firstNodeId) firstNodeId = node.id
    if (pendingExits.length > 0) connectExits(ctx, resultEdges, pendingExits, node.id)

    if (step.type !== 'if_else') {
      pendingExits = [{ source: node.id }]
      cursorY += 150
      continue
    }

    const branchStartY = cursorY + 140
    const trueBranch = buildSequence(
      step.trueSteps ?? [],
      ctx,
      resultNodes,
      resultEdges,
      x + 320,
      branchStartY
    )
    const falseBranch = buildSequence(
      step.falseSteps ?? [],
      ctx,
      resultNodes,
      resultEdges,
      x - 320,
      branchStartY
    )

    const exits: ExitPoint[] = []
    if (trueBranch) {
      addEdge(ctx, resultEdges, node.id, trueBranch.firstNodeId, 'true')
      exits.push(...trueBranch.exits)
    } else {
      exits.push({ source: node.id, sourceHandle: 'true' })
    }

    if (falseBranch) {
      addEdge(ctx, resultEdges, node.id, falseBranch.firstNodeId, 'false')
      exits.push(...falseBranch.exits)
    } else {
      exits.push({ source: node.id, sourceHandle: 'false' })
    }

    pendingExits = exits
    cursorY = Math.max(
      cursorY + 180,
      trueBranch?.nextY ?? branchStartY,
      falseBranch?.nextY ?? branchStartY
    )
  }

  return { firstNodeId, exits: pendingExits, nextY: cursorY }
}

export function migrateStepsToFlow(
  steps: ActionStep[],
  chainKey = `chain-${Date.now()}`
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const ctx: BuildContext = {
    chainKey: idPart(chainKey, 'chain'),
    nodeCounter: 0,
    edgeCounter: 0
  }
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  buildSequence(steps, ctx, nodes, edges, 0, 0)
  return { nodes, edges }
}

function chainKey(chain: ChainLike, index: number, kind: 'exec' | 'chain'): string {
  return idPart(chain.id, `${kind}-${index + 1}`)
}

export function migrateChainIfNeeded(
  chain: ChainLike,
  index = 0,
  kind: 'exec' | 'chain' = 'chain'
): boolean {
  const hasSteps = Array.isArray(chain.steps) && chain.steps.length > 0
  const hasNodes = Array.isArray(chain.nodes) && chain.nodes.length > 0
  if (!hasSteps || hasNodes) return false

  const flow = migrateStepsToFlow(chain.steps!, chainKey(chain, index, kind))
  ;(chain as Record<string, unknown>).nodes = flow.nodes
  ;(chain as Record<string, unknown>).edges = flow.edges
  delete chain.steps
  return true
}

function needsRelayout(nodes: FlowNode[]): boolean {
  const occupied = new Set<string>()
  let allAtOrigin = nodes.length > 1
  for (const node of nodes) {
    const key = `${node.position?.x ?? 0}:${node.position?.y ?? 0}`
    if (occupied.has(key)) return true
    occupied.add(key)
    if ((node.position?.x ?? 0) !== 0 || (node.position?.y ?? 0) !== 0) allAtOrigin = false
  }
  return allAtOrigin
}

function relayoutNodes(nodes: FlowNode[], edges: FlowEdge[]): boolean {
  if (!needsRelayout(nodes)) return false

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Set(edges.map((edge) => edge.target))
  const entry = nodes.find((node) => !incoming.has(node.id)) ?? nodes[0]
  const occupied = new Set<string>()
  const visited = new Set<string>()

  function place(nodeId: string, depth: number, lane: number): void {
    const node = nodeById.get(nodeId)
    if (!node || visited.has(nodeId)) return
    visited.add(nodeId)

    let yDepth = depth
    while (occupied.has(`${lane}:${yDepth}`)) yDepth += 1
    occupied.add(`${lane}:${yDepth}`)
    node.position = { x: lane * 320, y: yDepth * 150 }

    const outEdges = edges.filter((edge) => edge.source === nodeId)
    const ordered = [
      ...outEdges.filter((edge) => edge.sourceHandle === 'true'),
      ...outEdges.filter((edge) => edge.sourceHandle === undefined),
      ...outEdges.filter((edge) => edge.sourceHandle === 'false')
    ]
    for (const edge of ordered) {
      const nextLane =
        edge.sourceHandle === 'true' ? lane + 1 : edge.sourceHandle === 'false' ? lane - 1 : lane
      place(edge.target, yDepth + 1, nextLane)
    }
  }

  if (entry) place(entry.id, 0, 0)
  for (const node of nodes) {
    if (!visited.has(node.id)) place(node.id, visited.size + 1, 0)
  }
  return true
}

function repairChainIds(
  chain: ChainLike,
  index: number,
  kind: 'exec' | 'chain',
  usedNodeIds: Set<string>
): boolean {
  if (!Array.isArray(chain.nodes)) {
    chain.nodes = []
  }
  if (!Array.isArray(chain.edges)) {
    chain.edges = []
  }

  const key = chainKey(chain, index, kind)
  let changed = false
  let localCounter = 0
  const idMap = new Map<string, string>()

  for (const node of chain.nodes) {
    if (!node.data) {
      node.data = { type: node.type }
      changed = true
    }
    if (node.data.type !== node.type) {
      node.type = node.data.type
      changed = true
    }
    if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
      node.position = { x: 0, y: localCounter * 150 }
      changed = true
    }

    let nextId = node.id
    if (!nextId || usedNodeIds.has(nextId) || idMap.has(nextId)) {
      do {
        localCounter += 1
        nextId = `node-${key}-repair-${localCounter}`
      } while (usedNodeIds.has(nextId))
      idMap.set(node.id, nextId)
      node.id = nextId
      changed = true
    }
    usedNodeIds.add(node.id)
  }

  if (idMap.size > 0) {
    for (const edge of chain.edges) {
      edge.source = idMap.get(edge.source) ?? edge.source
      edge.target = idMap.get(edge.target) ?? edge.target
    }
  }

  const validNodeIds = new Set(chain.nodes.map((node) => node.id))
  const filteredEdges = chain.edges.filter(
    (edge) => validNodeIds.has(edge.source) && validNodeIds.has(edge.target)
  )
  if (filteredEdges.length !== chain.edges.length) {
    chain.edges = filteredEdges
    changed = true
  }

  changed = relayoutNodes(chain.nodes, chain.edges) || changed
  return changed
}

function migrateExecutionTriggerToNode(chain: ChainLike, index: number): boolean {
  if (chain.trigger !== 'red_dot' && chain.trigger !== 'pixel_change') return false
  if (!Array.isArray(chain.nodes)) chain.nodes = []
  if (!Array.isArray(chain.edges)) chain.edges = []

  const incoming = new Set(chain.edges.map((edge) => edge.target))
  const entry = chain.nodes.find((node) => !incoming.has(node.id)) ?? chain.nodes[0]
  const key = chainKey(chain, index, 'exec')
  const nodeId = `node-${key}-migrated-trigger`
  const triggerType = chain.trigger === 'red_dot' ? 'wait_red_dot' : 'detect_pixel_change'
  chain.nodes.unshift({
    id: nodeId,
    type: triggerType,
    position: entry ? { x: entry.position.x, y: entry.position.y - 150 } : { x: 0, y: 0 },
    data: { type: triggerType, region: chain.triggerRegion },
    label: chain.triggerRegion || undefined
  })
  if (entry) {
    chain.edges.push({ id: `edge-${key}-migrated-trigger`, source: nodeId, target: entry.id })
  }
  chain.trigger = 'default'
  chain.triggerRegion = undefined
  return true
}

export function repairWorkspaceFlow(workspace: Workspace): boolean {
  let changed = false
  const usedNodeIds = new Set<string>()

  workspace.executionChains = (workspace.executionChains ?? []).map((chain, index) => {
    changed = migrateChainIfNeeded(chain, index, 'exec') || changed
    changed = migrateExecutionTriggerToNode(chain, index) || changed
    changed = repairChainIds(chain, index, 'exec', usedNodeIds) || changed
    return chain
  })

  workspace.chains = (workspace.chains ?? []).map((chain, index) => {
    changed = migrateChainIfNeeded(chain, index, 'chain') || changed
    changed = repairChainIds(chain, index, 'chain', usedNodeIds) || changed
    return chain
  })

  return changed
}
