import {
  STEP_TYPE_LABELS,
  type ActionChain,
  type ActionStep,
  type ExecutionChain,
  type FlowEdge,
  type FlowNode,
  type StepCondition,
  type StepParams,
  type StepType,
  type Workspace
} from '../action-chain/types'
import { isRecord } from '../error-utils'
import { stepCanEditRegion, stepParamIsEditable } from '../action-chain/editor-capabilities'
import { validateWorkspaceForRun } from '../action-chain/validation'
import type {
  AgentAssistantResponse,
  AgentChainKind,
  AgentEditOperation,
  AgentEditProposal,
  AgentProposalDiff,
  AgentProposalSimulation
} from './types'

type ChainLike = ActionChain | ExecutionChain

const OPERATION_TYPES = new Set([
  'create_chain',
  'rename_chain',
  'update_chain',
  'delete_chain',
  'create_node',
  'update_node',
  'move_node',
  'delete_node',
  'create_edge',
  'update_edge',
  'delete_edge'
])

const STEP_TYPES = new Set<StepType>(Object.keys(STEP_TYPE_LABELS) as StepType[])
const STEP_KEYS = new Set([
  'type',
  'region',
  'params',
  'condition',
  'onError',
  'errorJumpStep',
  'timeoutMs',
  'retryCount',
  'retryDelayMs',
  'maxFailures'
])
const STEP_PARAM_KEYS = new Set<keyof StepParams>([
  'region',
  'dragEndRegion',
  'variableName',
  'aiPrompt',
  'textTemplate',
  'textInputMode',
  'textChunkStrategy',
  'textChunkMin',
  'textChunkMax',
  'textChunkDelayMinMs',
  'textChunkDelayMaxMs',
  'clickPolicy',
  'clickPositionMode',
  'randomMouseMinMoves',
  'randomMouseMaxMoves',
  'randomMousePauseMinMs',
  'randomMousePauseMaxMs',
  'keyName',
  'modifiers',
  'waitMode',
  'waitMs',
  'waitMinMs',
  'waitMaxMs',
  'redDotThreshold',
  'callChainName',
  'jumpToStep',
  'jumpToNodeId',
  'outputSchema',
  'outputMode',
  'minConfidence',
  'maxActions',
  'windowAnchorId',
  'refreshAllWindowAnchors',
  'layoutInstruction',
  'layoutAllowedAction',
  'uiLocateMode',
  'uiSearchScope',
  'uiSearchWindowAnchorId',
  'uiReferenceRegion',
  'uiSearchRegion',
  'uiSearchPadding',
  'uiMatchThreshold',
  'uiOffsetX',
  'uiOffsetY',
  'uiVisionPrompt',
  'uiReferenceImageRegion',
  'chatSnapshotVariable',
  'chatConversationVariable',
  'chatReplyVariable',
  'chatRecordMode',
  'chatContextTokenBudget',
  'chatIncludeScreenshot',
  'chatReplyPrompt'
])
const EDGE_PATCH_KEYS = new Set([
  'source',
  'target',
  'sourceHandle',
  'sourcePort',
  'targetPort',
  'probabilityWeight'
])

function cloneWorkspace(workspace: Workspace): Workspace {
  return JSON.parse(JSON.stringify(workspace)) as Workspace
}

function createId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}-${randomId}`
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} 必须是非空文本`)
  }
  return value.trim()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, field)
}

function optionalDescription(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${field} 必须是文本`)
  const description = value.trim()
  if (description.length > 4000) throw new Error(`${field} 最多 4000 个字符`)
  return description
}

function chainKind(value: unknown): AgentChainKind {
  if (value !== 'executionChain' && value !== 'actionChain') {
    throw new Error('chainKind 只能是 executionChain 或 actionChain')
  }
  return value
}

function stepType(value: unknown): StepType {
  if (typeof value !== 'string' || !STEP_TYPES.has(value as StepType)) {
    throw new Error(`不支持的节点类型：${String(value)}`)
  }
  return value as StepType
}

function position(value: unknown, field: string): { x: number; y: number } {
  if (
    !isRecord(value) ||
    typeof value.x !== 'number' ||
    !Number.isFinite(value.x) ||
    typeof value.y !== 'number' ||
    !Number.isFinite(value.y)
  ) {
    throw new Error(`${field} 必须包含有效的 x 和 y`)
  }
  return { x: value.x, y: value.y }
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, field: string): void {
  const forbidden = Object.keys(value).filter((key) => !allowed.has(key))
  if (forbidden.length > 0) throw new Error(`${field} 包含未授权字段：${forbidden.join('、')}`)
}

function sanitizeCondition(value: unknown): StepCondition | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('condition 格式不正确')
  if ('logic' in value || 'conditions' in value) {
    assertOnlyKeys(value, new Set(['logic', 'conditions']), 'condition')
    if ((value.logic !== 'and' && value.logic !== 'or') || !Array.isArray(value.conditions)) {
      throw new Error('复合 condition 格式不正确')
    }
    return {
      logic: value.logic,
      conditions: value.conditions.map((item) => {
        const parsed = sanitizeCondition(item)
        if (!parsed || 'logic' in parsed) throw new Error('复合条件只能包含单项条件')
        return parsed
      })
    }
  }
  assertOnlyKeys(value, new Set(['variable', 'operator', 'value']), 'condition')
  const operator = value.operator
  if (
    operator !== 'equals' &&
    operator !== 'not_equals' &&
    operator !== 'contains' &&
    operator !== 'is_true' &&
    operator !== 'is_false' &&
    operator !== 'greater_than' &&
    operator !== 'less_than'
  ) {
    throw new Error('condition.operator 不受支持')
  }
  return {
    variable: requiredString(value.variable, 'condition.variable'),
    operator,
    value: typeof value.value === 'string' ? value.value : ''
  }
}

function sanitizeParams(value: unknown): StepParams | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('params 必须是对象')
  const normalizedValue = { ...value }
  // action_plan 使用程序内置的固定 schema。部分兼容模型会返回字符串别名，
  // 其含义明确且无需写入 Workspace，可安全规范化为省略 outputSchema。
  if (
    normalizedValue.outputMode === 'action_plan' &&
    normalizedValue.outputSchema === 'AIActionPlan'
  ) {
    delete normalizedValue.outputSchema
  }
  assertOnlyKeys(normalizedValue, STEP_PARAM_KEYS as Set<string>, 'params')
  const stringKeys = new Set([
    'region',
    'dragEndRegion',
    'variableName',
    'aiPrompt',
    'textTemplate',
    'keyName',
    'callChainName',
    'jumpToNodeId',
    'windowAnchorId',
    'layoutInstruction',
    'uiSearchWindowAnchorId',
    'uiReferenceRegion',
    'uiSearchRegion',
    'uiVisionPrompt',
    'uiReferenceImageRegion',
    'chatSnapshotVariable',
    'chatConversationVariable',
    'chatReplyVariable',
    'chatReplyPrompt'
  ])
  const numberKeys = new Set([
    'textChunkMin',
    'textChunkMax',
    'textChunkDelayMinMs',
    'textChunkDelayMaxMs',
    'randomMouseMinMoves',
    'randomMouseMaxMoves',
    'randomMousePauseMinMs',
    'randomMousePauseMaxMs',
    'waitMs',
    'waitMinMs',
    'waitMaxMs',
    'redDotThreshold',
    'jumpToStep',
    'minConfidence',
    'maxActions',
    'uiSearchPadding',
    'uiMatchThreshold',
    'uiOffsetX',
    'uiOffsetY',
    'chatContextTokenBudget'
  ])
  const booleanKeys = new Set(['refreshAllWindowAnchors', 'chatIncludeScreenshot'])
  const enumValues: Record<string, string[]> = {
    textInputMode: ['instant', 'progressive'],
    textChunkStrategy: ['random', 'natural'],
    clickPolicy: ['single', 'double'],
    clickPositionMode: ['center', 'random'],
    waitMode: ['fixed', 'random'],
    outputMode: ['text', 'structured_json', 'chat_analysis', 'decision', 'action_plan'],
    layoutAllowedAction: ['drag', 'click'],
    uiLocateMode: ['template', 'relative'],
    uiSearchScope: ['nearby', 'window', 'region'],
    chatRecordMode: ['snapshot', 'outgoing_reply']
  }
  for (const [key, candidate] of Object.entries(normalizedValue)) {
    if (stringKeys.has(key) && typeof candidate !== 'string') {
      throw new Error(`params.${key} 必须是文本`)
    }
    if (numberKeys.has(key) && (typeof candidate !== 'number' || !Number.isFinite(candidate))) {
      throw new Error(`params.${key} 必须是有效数字`)
    }
    if (booleanKeys.has(key) && typeof candidate !== 'boolean') {
      throw new Error(`params.${key} 必须是布尔值`)
    }
    if (
      enumValues[key] &&
      (typeof candidate !== 'string' || !enumValues[key].includes(candidate))
    ) {
      throw new Error(`params.${key} 的值不受支持`)
    }
  }
  if (
    normalizedValue.modifiers !== undefined &&
    (!Array.isArray(normalizedValue.modifiers) ||
      normalizedValue.modifiers.some((item) => typeof item !== 'string'))
  ) {
    throw new Error('params.modifiers 必须是文本数组')
  }
  if (normalizedValue.outputSchema !== undefined) {
    const outputTypes = new Set([
      'string',
      'number',
      'boolean',
      'object',
      'array',
      'point',
      'rect',
      'action',
      'action_list'
    ])
    if (
      !Array.isArray(normalizedValue.outputSchema) ||
      normalizedValue.outputSchema.some(
        (item) =>
          !isRecord(item) ||
          Object.keys(item).some((key) => key !== 'name' && key !== 'type') ||
          typeof item.name !== 'string' ||
          !item.name.trim() ||
          typeof item.type !== 'string' ||
          !outputTypes.has(item.type)
      )
    ) {
      throw new Error('params.outputSchema 格式不正确')
    }
  }
  return JSON.parse(JSON.stringify(normalizedValue)) as StepParams
}

function parseConditionShorthand(value: string): ReturnType<typeof sanitizeCondition> | undefined {
  const match = value.trim().match(/^(.+?)\s*(==|!=|>|<)\s*(.+)$/)
  if (!match) return undefined
  const variable = match[1].trim()
  const symbol = match[2]
  const rawValue = match[3].trim().replace(/^["']|["']$/g, '')
  if (!variable || !rawValue) return undefined
  if (symbol === '==' && rawValue === 'true') {
    return { variable, operator: 'is_true', value: '' }
  }
  if (symbol === '==' && rawValue === 'false') {
    return { variable, operator: 'is_false', value: '' }
  }
  return {
    variable,
    operator:
      symbol === '=='
        ? 'equals'
        : symbol === '!='
          ? 'not_equals'
          : symbol === '>'
            ? 'greater_than'
            : 'less_than',
    value: rawValue
  }
}

function sanitizeStepPatch(
  value: unknown,
  requireType: boolean,
  allowType: boolean
): Partial<ActionStep> {
  if (!isRecord(value)) throw new Error('节点 data 必须是对象')
  assertOnlyKeys(value, STEP_KEYS, '节点 data')
  if ('trueSteps' in value || 'falseSteps' in value) {
    throw new Error('AI 不允许写入旧版嵌套步骤')
  }
  const result: Partial<ActionStep> = {}
  if (value.type !== undefined) {
    if (!allowType) throw new Error('AI 不允许修改已有节点的类型')
    result.type = stepType(value.type)
  }
  if (requireType && !result.type) throw new Error('节点 data.type 缺失')
  if (value.region !== undefined) result.region = optionalString(value.region, 'data.region')
  let params = value.params
  if (isRecord(params)) {
    const remainingParams = { ...params }
    for (const key of [
      'timeoutMs',
      'retryCount',
      'retryDelayMs',
      'maxFailures',
      'errorJumpStep'
    ] as const) {
      const candidate = remainingParams[key]
      if (candidate === undefined) continue
      if (value[key] !== undefined) throw new Error(`data.${key} 与 params.${key} 重复`)
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
        throw new Error(`params.${key} 必须是有效数字`)
      }
      result[key] = candidate
      delete remainingParams[key]
    }
    params = remainingParams
  }
  if (
    result.type === 'if_else' &&
    value.condition === undefined &&
    isRecord(params) &&
    typeof params.condition === 'string'
  ) {
    const condition = parseConditionShorthand(params.condition)
    if (!condition) throw new Error('params.condition 条件表达式格式不正确')
    const remainingParams = { ...params }
    delete remainingParams.condition
    params = remainingParams
    result.condition = condition
  }
  if (params !== undefined) result.params = sanitizeParams(params)
  if (value.condition !== undefined) result.condition = sanitizeCondition(value.condition)
  if (value.onError !== undefined) {
    if (value.onError !== 'continue' && value.onError !== 'stop' && value.onError !== 'jump') {
      throw new Error('data.onError 不受支持')
    }
    result.onError = value.onError
  }
  for (const key of [
    'errorJumpStep',
    'timeoutMs',
    'retryCount',
    'retryDelayMs',
    'maxFailures'
  ] as const) {
    const candidate = value[key]
    if (candidate !== undefined) {
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
        throw new Error(`data.${key} 必须是有效数字`)
      }
      result[key] = candidate
    }
  }
  return result
}

function assertEditableStepData(type: StepType, data: Partial<ActionStep>, field: string): void {
  if (data.type !== undefined && data.type !== type) {
    throw new Error(`${field}.type 与节点类型不一致`)
  }
  if (data.region !== undefined && !stepCanEditRegion(type)) {
    throw new Error(`${field}.region 不是“${STEP_TYPE_LABELS[type]}”节点的用户可编辑字段`)
  }
  for (const key of Object.keys(data.params ?? {}) as (keyof StepParams)[]) {
    if (!stepParamIsEditable(type, key)) {
      throw new Error(`${field}.params.${key} 不是“${STEP_TYPE_LABELS[type]}”节点的用户可编辑字段`)
    }
  }
}

function assertEditableStepValues(
  step: ActionStep,
  field: string,
  changedParamKeys?: ReadonlySet<keyof StepParams>
): void {
  const params = step.params
  if (!params) return
  const shouldValidate = (key: keyof StepParams): boolean =>
    changedParamKeys === undefined || changedParamKeys.has(key)
  const positiveIntegerKeys: (keyof StepParams)[] = [
    'textChunkMin',
    'textChunkMax',
    'randomMouseMinMoves',
    'randomMouseMaxMoves',
    'maxActions'
  ]
  for (const key of positiveIntegerKeys) {
    if (!shouldValidate(key)) continue
    const value = params[key]
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    ) {
      throw new Error(`${field}.params.${key} 必须是大于 0 的整数`)
    }
  }
  const nonNegativeIntegerKeys: (keyof StepParams)[] = [
    'textChunkDelayMinMs',
    'textChunkDelayMaxMs',
    'randomMousePauseMinMs',
    'randomMousePauseMaxMs',
    'waitMs',
    'waitMinMs',
    'waitMaxMs',
    'uiSearchPadding'
  ]
  for (const key of nonNegativeIntegerKeys) {
    if (!shouldValidate(key)) continue
    const value = params[key]
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    ) {
      throw new Error(`${field}.params.${key} 必须是大于或等于 0 的整数`)
    }
  }
  if (
    shouldValidate('redDotThreshold') &&
    params.redDotThreshold !== undefined &&
    (params.redDotThreshold < 0 || params.redDotThreshold > 100)
  ) {
    throw new Error(`${field}.params.redDotThreshold 必须在 0 到 100 之间`)
  }
  if (
    shouldValidate('minConfidence') &&
    params.minConfidence !== undefined &&
    (params.minConfidence < 0 || params.minConfidence > 1)
  ) {
    throw new Error(`${field}.params.minConfidence 必须在 0 到 1 之间`)
  }
  if (
    shouldValidate('uiMatchThreshold') &&
    params.uiMatchThreshold !== undefined &&
    (params.uiMatchThreshold <= 0 || params.uiMatchThreshold > 1)
  ) {
    throw new Error(`${field}.params.uiMatchThreshold 必须大于 0 且不超过 1`)
  }
  if (
    shouldValidate('chatContextTokenBudget') &&
    params.chatContextTokenBudget !== undefined &&
    params.chatContextTokenBudget < 100
  ) {
    throw new Error(`${field}.params.chatContextTokenBudget 不能小于 100`)
  }
  if (
    (shouldValidate('textChunkMin') || shouldValidate('textChunkMax')) &&
    params.textChunkMin !== undefined &&
    params.textChunkMax !== undefined &&
    params.textChunkMax < params.textChunkMin
  ) {
    throw new Error(`${field}.params.textChunkMax 不能小于 textChunkMin`)
  }
  if (
    (shouldValidate('textChunkDelayMinMs') || shouldValidate('textChunkDelayMaxMs')) &&
    params.textChunkDelayMinMs !== undefined &&
    params.textChunkDelayMaxMs !== undefined &&
    params.textChunkDelayMaxMs < params.textChunkDelayMinMs
  ) {
    throw new Error(`${field}.params.textChunkDelayMaxMs 不能小于 textChunkDelayMinMs`)
  }
  if (
    (shouldValidate('randomMouseMinMoves') || shouldValidate('randomMouseMaxMoves')) &&
    params.randomMouseMinMoves !== undefined &&
    params.randomMouseMaxMoves !== undefined &&
    params.randomMouseMaxMoves < params.randomMouseMinMoves
  ) {
    throw new Error(`${field}.params.randomMouseMaxMoves 不能小于 randomMouseMinMoves`)
  }
  if (
    (shouldValidate('randomMousePauseMinMs') || shouldValidate('randomMousePauseMaxMs')) &&
    params.randomMousePauseMinMs !== undefined &&
    params.randomMousePauseMaxMs !== undefined &&
    params.randomMousePauseMaxMs < params.randomMousePauseMinMs
  ) {
    throw new Error(`${field}.params.randomMousePauseMaxMs 不能小于 randomMousePauseMinMs`)
  }
  if (
    (shouldValidate('waitMinMs') || shouldValidate('waitMaxMs')) &&
    params.waitMinMs !== undefined &&
    params.waitMaxMs !== undefined &&
    params.waitMaxMs < params.waitMinMs
  ) {
    throw new Error(`${field}.params.waitMaxMs 不能小于 waitMinMs`)
  }
}

function parseEdgeFields(value: unknown, partial: boolean): Partial<FlowEdge> {
  if (!isRecord(value)) throw new Error('连线数据必须是对象')
  assertOnlyKeys(value, EDGE_PATCH_KEYS, '连线数据')
  const result: Partial<FlowEdge> = {}
  if (!partial || value.source !== undefined)
    result.source = requiredString(value.source, 'edge.source')
  if (!partial || value.target !== undefined)
    result.target = requiredString(value.target, 'edge.target')
  if (value.sourceHandle !== undefined) {
    if (
      value.sourceHandle !== 'true' &&
      value.sourceHandle !== 'false' &&
      value.sourceHandle !== 'start' &&
      value.sourceHandle !== 'stop' &&
      value.sourceHandle !== 'continue' &&
      value.sourceHandle !== 'exit'
    ) {
      throw new Error('edge.sourceHandle 只能是 true、false、start、stop、continue 或 exit')
    }
    result.sourceHandle = value.sourceHandle
  }
  for (const key of ['sourcePort', 'targetPort'] as const) {
    const candidate = value[key]
    if (candidate !== undefined) {
      if (!['top', 'right', 'bottom', 'left'].includes(String(candidate))) {
        throw new Error(`edge.${key} 不受支持`)
      }
      result[key] = candidate as FlowEdge[typeof key]
    }
  }
  if (value.probabilityWeight !== undefined) {
    if (
      typeof value.probabilityWeight !== 'number' ||
      !Number.isFinite(value.probabilityWeight) ||
      value.probabilityWeight < 0
    ) {
      throw new Error('edge.probabilityWeight 必须是大于或等于 0 的数字')
    }
    result.probabilityWeight = value.probabilityWeight
  }
  return result
}

function parseOperation(value: unknown): AgentEditOperation {
  if (!isRecord(value) || typeof value.type !== 'string' || !OPERATION_TYPES.has(value.type)) {
    throw new Error(`不支持的编辑操作：${isRecord(value) ? String(value.type) : String(value)}`)
  }
  const kind = chainKind(value.chainKind)
  if (value.type === 'create_chain') {
    if (!isRecord(value.chain)) throw new Error('create_chain.chain 缺失')
    assertOnlyKeys(
      value.chain,
      new Set(['id', 'ref', 'name', 'description', 'enabled', 'trigger']),
      'create_chain.chain'
    )
    const trigger = value.chain.trigger
    if (kind === 'executionChain') {
      if (trigger !== undefined && trigger !== 'manual' && trigger !== 'default') {
        throw new Error('执行链触发方式只能是 manual 或 default')
      }
    } else {
      if (trigger !== undefined && trigger !== 'sub') {
        throw new Error('动作链触发方式固定为 sub')
      }
      if (value.chain.enabled !== undefined && value.chain.enabled !== false) {
        throw new Error('动作链不能由 AI 设置为启用')
      }
    }
    return {
      type: value.type,
      chainKind: kind,
      chain: {
        id: optionalString(value.chain.id, 'chain.id') ?? createId('ai-chain'),
        ref: optionalString(value.chain.ref, 'chain.ref'),
        name: requiredString(value.chain.name, 'chain.name'),
        description: optionalDescription(value.chain.description, 'chain.description'),
        enabled:
          kind === 'executionChain'
            ? typeof value.chain.enabled === 'boolean'
              ? value.chain.enabled
              : true
            : false,
        trigger:
          kind === 'executionChain'
            ? (trigger as 'manual' | 'default' | undefined)
            : ('sub' as const)
      }
    }
  }
  const chainId = requiredString(value.chainId, 'chainId')
  if (value.type === 'rename_chain') {
    return { type: value.type, chainKind: kind, chainId, name: requiredString(value.name, 'name') }
  }
  if (value.type === 'update_chain') {
    if (!isRecord(value.patch)) throw new Error('update_chain.patch 缺失')
    assertOnlyKeys(
      value.patch,
      new Set(['description', 'enabled', 'trigger']),
      'update_chain.patch'
    )
    if (Object.keys(value.patch).length === 0) throw new Error('update_chain.patch 不能为空')
    if (
      kind === 'actionChain' &&
      (value.patch.enabled !== undefined || value.patch.trigger !== undefined)
    ) {
      throw new Error('动作链只能修改功能说明，不能修改启用或触发设置')
    }
    if (value.patch.enabled !== undefined && typeof value.patch.enabled !== 'boolean') {
      throw new Error('update_chain.patch.enabled 必须是布尔值')
    }
    if (
      value.patch.trigger !== undefined &&
      value.patch.trigger !== 'manual' &&
      value.patch.trigger !== 'default'
    ) {
      throw new Error('update_chain.patch.trigger 只能是 manual 或 default')
    }
    return {
      type: value.type,
      chainKind: kind,
      chainId,
      patch: {
        description: optionalDescription(value.patch.description, 'update_chain.patch.description'),
        enabled: value.patch.enabled as boolean | undefined,
        trigger: value.patch.trigger as 'manual' | 'default' | undefined
      }
    }
  }
  if (value.type === 'delete_chain') return { type: value.type, chainKind: kind, chainId }
  if (value.type === 'create_node') {
    if (!isRecord(value.node)) throw new Error('create_node.node 缺失')
    assertOnlyKeys(
      value.node,
      new Set(['id', 'ref', 'type', 'position', 'data']),
      'create_node.node'
    )
    const type = stepType(value.node.type)
    const data =
      value.node.data === undefined ? {} : sanitizeStepPatch(value.node.data, false, true)
    if (data.type && data.type !== type) throw new Error('node.type 与 node.data.type 不一致')
    assertEditableStepData(type, data, 'create_node.node.data')
    assertEditableStepValues({ ...data, type }, 'create_node.node.data')
    return {
      type: value.type,
      chainKind: kind,
      chainId,
      node: {
        id: optionalString(value.node.id, 'node.id') ?? createId('ai-node'),
        ref: optionalString(value.node.ref, 'node.ref'),
        type,
        position:
          value.node.position === undefined
            ? undefined
            : position(value.node.position, 'node.position'),
        data: { ...data, type }
      }
    }
  }
  if (value.type === 'update_node') {
    if (!isRecord(value.patch)) throw new Error('update_node.patch 缺失')
    assertOnlyKeys(value.patch, new Set(['position', 'data']), 'update_node.patch')
    const data =
      value.patch.data === undefined ? undefined : sanitizeStepPatch(value.patch.data, false, false)
    if (value.patch.position === undefined && data === undefined) {
      throw new Error('update_node.patch 不能为空')
    }
    return {
      type: value.type,
      chainKind: kind,
      chainId,
      nodeId: requiredString(value.nodeId, 'nodeId'),
      patch: {
        position:
          value.patch.position === undefined
            ? undefined
            : position(value.patch.position, 'patch.position'),
        data
      }
    }
  }
  if (value.type === 'move_node') {
    return {
      type: value.type,
      chainKind: kind,
      chainId,
      nodeId: requiredString(value.nodeId, 'nodeId'),
      position: position(value.position, 'position')
    }
  }
  if (value.type === 'delete_node') {
    return {
      type: value.type,
      chainKind: kind,
      chainId,
      nodeId: requiredString(value.nodeId, 'nodeId')
    }
  }
  if (value.type === 'create_edge') {
    if (!isRecord(value.edge)) throw new Error('create_edge.edge 缺失')
    const id = optionalString(value.edge.id, 'edge.id') ?? createId('ai-edge')
    const fields = parseEdgeFields(
      Object.fromEntries(Object.entries(value.edge).filter(([key]) => key !== 'id')),
      false
    )
    return {
      type: value.type,
      chainKind: kind,
      chainId,
      edge: { id, source: fields.source!, target: fields.target!, ...fields } as FlowEdge
    }
  }
  if (value.type === 'update_edge') {
    if (!isRecord(value.patch)) throw new Error('update_edge.patch 缺失')
    assertOnlyKeys(value.patch, new Set(['sourceHandle', 'probabilityWeight']), 'update_edge.patch')
    if (Object.keys(value.patch).length === 0) throw new Error('update_edge.patch 不能为空')
    return {
      type: value.type,
      chainKind: kind,
      chainId,
      edgeId: requiredString(value.edgeId, 'edgeId'),
      patch: parseEdgeFields(value.patch, true)
    }
  }
  return {
    type: 'delete_edge',
    chainKind: kind,
    chainId,
    edgeId: requiredString(value.edgeId, 'edgeId')
  }
}

function unwrapJsonFence(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? trimmed
}

function escapeLiteralJsonControls(raw: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (!inString) {
      result += character
      if (character === '"') inString = true
      continue
    }
    if (escaped) {
      result += character
      escaped = false
      continue
    }
    if (character === '\\') {
      result += character
      escaped = true
      continue
    }
    if (character === '"') {
      result += character
      inString = false
      continue
    }
    if (character === '\r' && raw[index + 1] === '\n') continue
    if (character === '\n') result += '\\n'
    else if (character === '\r') result += '\\r'
    else if (character === '\t') result += '\\t'
    else if (character.charCodeAt(0) < 0x20) {
      result += `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    } else result += character
  }
  return result
}

function removeTrailingJsonCommas(raw: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (inString) {
      result += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      result += character
      continue
    }
    if (character === ',') {
      let lookahead = index + 1
      while (lookahead < raw.length && /\s/.test(raw[lookahead])) lookahead += 1
      if (raw[lookahead] === '}' || raw[lookahead] === ']') continue
    }
    result += character
  }
  return result
}

function extractJsonObjectText(raw: string): string | null {
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) return null
  return raw.slice(firstBrace, lastBrace + 1)
}

function extractJson(raw: string): unknown {
  const unwrapped = unwrapJsonFence(raw)
  const isolated = extractJsonObjectText(unwrapped)
  const fullyRepaired = removeTrailingJsonCommas(escapeLiteralJsonControls(isolated ?? unwrapped))
  const candidates = [
    unwrapped,
    escapeLiteralJsonControls(unwrapped),
    isolated,
    isolated ? escapeLiteralJsonControls(isolated) : null,
    fullyRepaired
  ].filter((candidate): candidate is string => typeof candidate === 'string')
  const uniqueCandidates: string[] = []
  for (const candidate of candidates) {
    for (const variant of [candidate, removeTrailingJsonCommas(candidate)]) {
      if (!uniqueCandidates.includes(variant)) uniqueCandidates.push(variant)
    }
  }
  let lastError: unknown
  for (const candidate of uniqueCandidates) {
    try {
      return JSON.parse(candidate)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法解析模型返回的 JSON')
}

export class AgentAssistantJsonFormatError extends Error {
  constructor(message = '模型返回的编辑提案不是合法 JSON') {
    super(message)
    this.name = 'AgentAssistantJsonFormatError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

function decodeLooseJsonString(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (match, escape: string) => {
    if (escape.startsWith('u')) return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
    const replacements: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t'
    }
    return replacements[escape] ?? match
  })
}

function normalizeAssistantText(content: string): string {
  return (
    content
      // 还原 JSON 转义字符（当整个 JSON 被原样传入时）
      .replace(/\\\\/g, '\x00')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '  ')
      .replace(/\\"/g, '"')
      .replace(/\x00/g, '\\')
      .replace(/\r\n/g, '\n')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/^\s*---+\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

function parseLooseTextEnvelope(
  raw: string
): { type: 'answer' | 'clarification'; content: string } | null {
  const text = unwrapJsonFence(raw)
  try {
    const repaired = JSON.parse(escapeLiteralJsonControls(text)) as unknown
    if (
      isRecord(repaired) &&
      (repaired.type === 'answer' || repaired.type === 'clarification') &&
      typeof repaired.content === 'string'
    ) {
      return { type: repaired.type, content: normalizeAssistantText(repaired.content) }
    }
  } catch {
    // 再尝试只提取普通问答外壳；编辑提案绝不走宽松解析。
  }

  const typeMatch = text.match(/^\s*\{\s*"type"\s*:\s*"(answer|clarification)"\s*,/)
  if (!typeMatch) return null
  const contentMatch = /"content"\s*:\s*"/.exec(text)
  const closingMatch = /"\s*}\s*$/.exec(text)
  if (!contentMatch || !closingMatch || closingMatch.index <= contentMatch.index) return null
  const contentStart = contentMatch.index + contentMatch[0].length
  return {
    type: typeMatch[1] as 'answer' | 'clarification',
    content: normalizeAssistantText(
      decodeLooseJsonString(text.slice(contentStart, closingMatch.index))
    )
  }
}

function parseTextEnvelope(
  raw: string
): { type: 'answer' | 'clarification'; content: string } | null {
  try {
    const parsed = extractJson(raw)
    if (
      isRecord(parsed) &&
      (parsed.type === 'answer' || parsed.type === 'clarification') &&
      typeof parsed.content === 'string'
    ) {
      return { type: parsed.type, content: parsed.content }
    }
  } catch {
    return parseLooseTextEnvelope(raw)
  }
  return null
}

function unwrapTextEnvelope(envelope: { type: 'answer' | 'clarification'; content: string }): {
  type: 'answer' | 'clarification'
  content: string
} {
  let current = envelope
  // 部分兼容模型会把规定的 JSON 对象再次塞进 content；限制层数避免异常输入无限解包。
  for (let depth = 0; depth < 4; depth += 1) {
    const nested = parseTextEnvelope(current.content)
    if (!nested) break
    current = nested
  }
  return { ...current, content: normalizeAssistantText(current.content) }
}

export function formatAgentAssistantDisplayText(raw: string): string {
  const envelope = parseTextEnvelope(raw)
  if (envelope) return unwrapTextEnvelope(envelope).content
  return normalizeAssistantText(raw)
}

export function parseAgentAssistantResponse(
  raw: string,
  projectId: string,
  baseRevision: number
): AgentAssistantResponse {
  let parsed: unknown
  try {
    parsed = extractJson(raw)
  } catch {
    const loose = parseLooseTextEnvelope(raw)
    if (loose) return unwrapTextEnvelope(loose)
    if (/"type"\s*:\s*"edit_proposal"/.test(unwrapJsonFence(raw))) {
      throw new AgentAssistantJsonFormatError()
    }
    return {
      type: 'answer',
      content: normalizeAssistantText(raw) || '模型没有返回内容。'
    }
  }
  if (!isRecord(parsed)) return { type: 'answer', content: normalizeAssistantText(raw) }
  if (parsed.type === 'answer' || parsed.type === 'clarification') {
    return unwrapTextEnvelope({
      type: parsed.type,
      content: requiredString(parsed.content, 'content')
    })
  }
  if (parsed.type !== 'edit_proposal') {
    return { type: 'answer', content: normalizeAssistantText(raw) }
  }
  if (!Array.isArray(parsed.operations) || parsed.operations.length === 0) {
    throw new Error('编辑提案没有包含任何操作')
  }
  if (parsed.operations.length > 100) throw new Error('单次编辑提案最多包含 100 个操作')
  let createdChainIndex = 0
  let createdNodeIndex = 0
  const operations = parsed.operations.map((value) => {
    const operation = parseOperation(value)
    if (operation.type === 'create_chain') {
      operation.chain.ref ??= `chain-${createdChainIndex}`
      createdChainIndex += 1
    } else if (operation.type === 'create_node') {
      operation.node.ref ??= `node-${createdNodeIndex}`
      createdNodeIndex += 1
    }
    return operation
  })
  const proposal: AgentEditProposal = {
    id: createId('proposal'),
    projectId,
    baseRevision,
    summary: requiredString(parsed.summary ?? parsed.content, 'summary'),
    operations,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === 'string').slice(0, 20)
      : [],
    status: 'pending',
    createdAt: Date.now()
  }
  return {
    type: 'edit_proposal',
    content: typeof parsed.content === 'string' ? parsed.content : proposal.summary,
    proposal
  }
}

function chainPool(workspace: Workspace, kind: AgentChainKind): ChainLike[] {
  return kind === 'executionChain' ? workspace.executionChains : workspace.chains
}

function findChain(workspace: Workspace, kind: AgentChainKind, id: string): ChainLike {
  const chain = chainPool(workspace, kind).find((candidate) => candidate.id === id)
  if (!chain) throw new Error(`找不到目标${kind === 'executionChain' ? '执行链' : '动作链'}：${id}`)
  return chain
}

function referenceKey(kind: AgentChainKind, scopeId: string, reference: string): string {
  return `${kind}:${scopeId}:${reference}`
}

function registerReference(
  references: Map<string, string>,
  key: string,
  actualId: string,
  field: string
): void {
  const existing = references.get(key)
  if (existing && existing !== actualId)
    throw new Error(`${field} 临时引用重复：${key.split(':').at(-1)}`)
  references.set(key, actualId)
}

function resolveChainId(
  workspace: Workspace,
  references: Map<string, string>,
  kind: AgentChainKind,
  requestedId: string
): string {
  if (chainPool(workspace, kind).some((chain) => chain.id === requestedId)) return requestedId
  return references.get(referenceKey(kind, 'chain', requestedId)) ?? requestedId
}

function resolveNodeId(
  chain: ChainLike,
  references: Map<string, string>,
  kind: AgentChainKind,
  requestedId: string
): string {
  if (chain.nodes.some((node) => node.id === requestedId)) return requestedId
  return references.get(referenceKey(kind, chain.id ?? chain.name, requestedId)) ?? requestedId
}

function nextNodePosition(chain: ChainLike): { x: number; y: number } {
  if (chain.nodes.length === 0) return { x: 120, y: 120 }
  const rightmost = chain.nodes.reduce((best, node) =>
    node.position.x > best.position.x ? node : best
  )
  return { x: rightmost.position.x + 240, y: rightmost.position.y }
}

function registerAffected(
  diff: AgentProposalDiff,
  kind: AgentChainKind,
  chain: ChainLike,
  fallbackId?: string
): void {
  const id = chain.id ?? fallbackId
  if (!id) return
  if (!diff.affectedChains.some((item) => item.chainKind === kind && item.chainId === id)) {
    diff.affectedChains.push({ chainKind: kind, chainId: id, chainName: chain.name })
  }
}

function assertEditableEdgeFields(
  chain: ChainLike,
  edge: Pick<FlowEdge, 'source' | 'sourceHandle' | 'probabilityWeight'>,
  field: string,
  requireBranchHandle: boolean
): void {
  const source = chain.nodes.find((node) => node.id === edge.source)
  if (!source) throw new Error(`${field}.source 指向不存在的节点：${edge.source}`)
  if (source.data.type === 'if_else') {
    if (requireBranchHandle && edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false') {
      throw new Error(`${field}.sourceHandle 必须指定 true 或 false`)
    }
    if (edge.probabilityWeight !== undefined) {
      throw new Error(`${field}.probabilityWeight 只能编辑随机分支连线`)
    }
    return
  }
  if (edge.sourceHandle !== undefined) {
    throw new Error(`${field}.sourceHandle 只能编辑条件分支连线`)
  }
  if (source.data.type !== 'random_branch' && edge.probabilityWeight !== undefined) {
    throw new Error(`${field}.probabilityWeight 只能编辑随机分支连线`)
  }
}

function structuralIssues(workspace: Workspace): string[] {
  const issues: string[] = []
  const chains: Array<{ kind: AgentChainKind; chain: ChainLike }> = [
    ...workspace.executionChains.map((chain) => ({ kind: 'executionChain' as const, chain })),
    ...workspace.chains.map((chain) => ({ kind: 'actionChain' as const, chain }))
  ]
  const chainIds = new Set<string>()
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const actionNames = new Set<string>()
  const regionNames = new Set(
    workspace.views.flatMap((view) => view.regions.map((region) => region.name))
  )
  const anchorIds = new Set(workspace.windowAnchors.map((anchor) => anchor.id))

  for (const { kind, chain } of chains) {
    if (chain.id) {
      if (chainIds.has(chain.id)) issues.push(`duplicate-chain-id:${chain.id}`)
      chainIds.add(chain.id)
    }
    if (kind === 'actionChain') {
      if (actionNames.has(chain.name)) issues.push(`duplicate-action-chain-name:${chain.name}`)
      actionNames.add(chain.name)
    }
    if (chain.triggerRegion && !regionNames.has(chain.triggerRegion)) {
      issues.push(`unknown-trigger-region:${chain.id ?? chain.name}:${chain.triggerRegion}`)
    }
    const localNodes = new Set(chain.nodes.map((node) => node.id))
    for (const node of chain.nodes) {
      if (nodeIds.has(node.id)) issues.push(`duplicate-node-id:${node.id}`)
      nodeIds.add(node.id)
      if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
        issues.push(`invalid-node-position:${node.id}`)
      }
      if (node.type !== node.data.type) issues.push(`node-type-mismatch:${node.id}`)
      const step = node.data
      if (step.region && !regionNames.has(step.region)) {
        issues.push(`unknown-region:${node.id}:${step.region}`)
      }
      const regionParams = [
        step.params?.region,
        step.params?.dragEndRegion,
        step.params?.uiReferenceRegion,
        step.params?.uiSearchRegion,
        step.params?.uiReferenceImageRegion
      ].filter((item): item is string => typeof item === 'string' && item.length > 0)
      for (const name of regionParams) {
        if (!regionNames.has(name)) issues.push(`unknown-region-param:${node.id}:${name}`)
      }
      const anchorParams = [
        step.params?.windowAnchorId,
        step.params?.uiSearchWindowAnchorId
      ].filter((item): item is string => typeof item === 'string' && item.length > 0)
      for (const id of anchorParams) {
        if (!anchorIds.has(id)) issues.push(`unknown-window-anchor:${node.id}:${id}`)
      }
      if (step.type === 'call_chain') {
        const name = step.params?.callChainName
        if (name && !workspace.chains.some((candidate) => candidate.name === name)) {
          issues.push(`unknown-call-chain:${node.id}:${name}`)
        }
      }
    }
    for (const edge of chain.edges) {
      if (edgeIds.has(edge.id)) issues.push(`duplicate-edge-id:${edge.id}`)
      edgeIds.add(edge.id)
      if (!localNodes.has(edge.source) || !localNodes.has(edge.target)) {
        issues.push(`dangling-edge:${edge.id}`)
      }
      if (edge.source === edge.target) issues.push(`self-edge:${edge.id}`)
      const source = chain.nodes.find((node) => node.id === edge.source)
      if (source?.data.type === 'if_else') {
        if (edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false') {
          issues.push(`branch-edge-handle:${edge.id}`)
        }
      } else if (edge.sourceHandle !== undefined) {
        issues.push(`unexpected-edge-handle:${edge.id}`)
      }
    }
    for (const node of chain.nodes) {
      const outgoing = chain.edges.filter((edge) => edge.source === node.id)
      if (node.data.type === 'if_else') {
        for (const handle of ['true', 'false'] as const) {
          if (outgoing.filter((edge) => edge.sourceHandle === handle).length > 1) {
            issues.push(`duplicate-branch:${node.id}:${handle}`)
          }
        }
      } else if (node.data.type !== 'random_branch' && outgoing.length > 1) {
        issues.push(`multiple-outputs:${node.id}`)
      }
    }
  }
  return issues
}

function operationError(index: number, error: unknown): Error {
  return new Error(
    `第 ${index + 1} 个操作失败：${error instanceof Error ? error.message : String(error)}`
  )
}

export function simulateAgentEditProposal(
  sourceWorkspace: Workspace,
  proposal: AgentEditProposal
): AgentProposalSimulation {
  const workspace = cloneWorkspace(sourceWorkspace)
  const diff: AgentProposalDiff = {
    addedNodeIds: [],
    updatedNodeIds: [],
    deletedNodes: [],
    addedEdgeIds: [],
    updatedEdgeIds: [],
    deletedEdges: [],
    affectedChains: []
  }
  const errors: string[] = []
  const baselineIssues = new Set(structuralIssues(sourceWorkspace))
  const chainReferences = new Map<string, string>()
  const nodeReferences = new Map<string, string>()

  for (let index = 0; index < proposal.operations.length; index += 1) {
    const operation = proposal.operations[index]
    try {
      if (operation.type === 'create_chain') {
        assertOnlyKeys(
          operation.chain as unknown as Record<string, unknown>,
          new Set(['id', 'ref', 'name', 'description', 'enabled', 'trigger']),
          'create_chain.chain'
        )
        if (operation.chainKind === 'executionChain') {
          if (
            operation.chain.trigger !== undefined &&
            !['manual', 'default'].includes(operation.chain.trigger)
          ) {
            throw new Error('执行链触发方式只能是 manual 或 default')
          }
        } else {
          if (operation.chain.trigger !== undefined && operation.chain.trigger !== 'sub') {
            throw new Error('动作链触发方式固定为 sub')
          }
          if (operation.chain.enabled === true) throw new Error('动作链不能由 AI 设置为启用')
        }
        const pool = chainPool(workspace, operation.chainKind)
        const chain: ChainLike = {
          id: operation.chain.id ?? createId('ai-chain'),
          name: operation.chain.name,
          description: operation.chain.description,
          enabled:
            operation.chainKind === 'executionChain' ? (operation.chain.enabled ?? true) : false,
          trigger:
            operation.chain.trigger ??
            (operation.chainKind === 'executionChain' ? 'manual' : 'sub'),
          triggerRegion: operation.chain.triggerRegion,
          nodes: [],
          edges: []
        }
        pool.push(chain)
        if (operation.chain.ref) {
          registerReference(
            chainReferences,
            referenceKey(operation.chainKind, 'chain', operation.chain.ref),
            chain.id!,
            'create_chain.chain.ref'
          )
        }
        registerAffected(diff, operation.chainKind, chain)
        continue
      }
      const resolvedChainId = resolveChainId(
        workspace,
        chainReferences,
        operation.chainKind,
        operation.chainId
      )
      const chain = findChain(workspace, operation.chainKind, resolvedChainId)
      registerAffected(diff, operation.chainKind, chain, resolvedChainId)
      if (operation.type === 'rename_chain') {
        const oldName = chain.name
        chain.name = operation.name
        if (operation.chainKind === 'actionChain') {
          for (const candidate of [...workspace.executionChains, ...workspace.chains]) {
            for (const node of candidate.nodes) {
              if (node.data.type === 'call_chain' && node.data.params?.callChainName === oldName) {
                node.data.params.callChainName = operation.name
                if (!diff.updatedNodeIds.includes(node.id)) diff.updatedNodeIds.push(node.id)
              }
            }
          }
        }
      } else if (operation.type === 'update_chain') {
        if (
          operation.chainKind === 'actionChain' &&
          (operation.patch.enabled !== undefined || operation.patch.trigger !== undefined)
        ) {
          throw new Error('动作链只能修改功能说明，不能修改启用或触发设置')
        }
        assertOnlyKeys(
          operation.patch as Record<string, unknown>,
          new Set(['description', 'enabled', 'trigger']),
          'update_chain.patch'
        )
        if (operation.patch.description !== undefined) {
          chain.description = operation.patch.description
        }
        if (operation.patch.enabled !== undefined) chain.enabled = operation.patch.enabled
        if (operation.patch.trigger !== undefined) chain.trigger = operation.patch.trigger
      } else if (operation.type === 'delete_chain') {
        const pool = chainPool(workspace, operation.chainKind)
        const chainIndex = pool.findIndex((candidate) => candidate.id === resolvedChainId)
        if (chainIndex < 0) throw new Error('目标链不存在')
        diff.deletedNodes.push(...pool[chainIndex].nodes)
        diff.deletedEdges.push(...pool[chainIndex].edges)
        pool.splice(chainIndex, 1)
      } else if (operation.type === 'create_node') {
        assertOnlyKeys(
          operation.node as unknown as Record<string, unknown>,
          new Set(['id', 'ref', 'type', 'position', 'data']),
          'create_node.node'
        )
        assertEditableStepData(
          operation.node.type,
          operation.node.data ?? {},
          'create_node.node.data'
        )
        assertEditableStepValues(
          { ...operation.node.data, type: operation.node.type },
          'create_node.node.data'
        )
        const node: FlowNode = {
          id: operation.node.id ?? createId('ai-node'),
          type: operation.node.type,
          position: operation.node.position ?? nextNodePosition(chain),
          data: { type: operation.node.type, ...operation.node.data },
          label: STEP_TYPE_LABELS[operation.node.type]
        }
        node.data.type = node.type
        chain.nodes.push(node)
        if (operation.node.ref) {
          registerReference(
            nodeReferences,
            referenceKey(operation.chainKind, chain.id ?? chain.name, operation.node.ref),
            node.id,
            'create_node.node.ref'
          )
        }
        diff.addedNodeIds.push(node.id)
      } else if (operation.type === 'update_node') {
        const resolvedNodeId = resolveNodeId(
          chain,
          nodeReferences,
          operation.chainKind,
          operation.nodeId
        )
        const node = chain.nodes.find((candidate) => candidate.id === resolvedNodeId)
        if (!node) throw new Error(`找不到节点：${operation.nodeId}`)
        assertOnlyKeys(
          operation.patch as unknown as Record<string, unknown>,
          new Set(['position', 'data']),
          'update_node.patch'
        )
        const dataPatch = operation.patch.data
        if (dataPatch) {
          assertEditableStepData(node.type, dataPatch, 'update_node.patch.data')
          const params = dataPatch.params
          node.data = {
            ...node.data,
            ...dataPatch,
            params:
              params === undefined ? node.data.params : { ...(node.data.params ?? {}), ...params },
            type: node.type
          }
          assertEditableStepValues(
            node.data,
            'update_node.patch.data',
            new Set(Object.keys(params ?? {}) as (keyof StepParams)[])
          )
        }
        if (operation.patch.position) node.position = operation.patch.position
        if (!diff.updatedNodeIds.includes(node.id)) diff.updatedNodeIds.push(node.id)
      } else if (operation.type === 'move_node') {
        const resolvedNodeId = resolveNodeId(
          chain,
          nodeReferences,
          operation.chainKind,
          operation.nodeId
        )
        const node = chain.nodes.find((candidate) => candidate.id === resolvedNodeId)
        if (!node) throw new Error(`找不到节点：${operation.nodeId}`)
        node.position = operation.position
        if (!diff.updatedNodeIds.includes(node.id)) diff.updatedNodeIds.push(node.id)
      } else if (operation.type === 'delete_node') {
        const resolvedNodeId = resolveNodeId(
          chain,
          nodeReferences,
          operation.chainKind,
          operation.nodeId
        )
        const nodeIndex = chain.nodes.findIndex((candidate) => candidate.id === resolvedNodeId)
        if (nodeIndex < 0) throw new Error(`找不到节点：${operation.nodeId}`)
        diff.deletedNodes.push(chain.nodes[nodeIndex])
        chain.nodes.splice(nodeIndex, 1)
        const deleted = chain.edges.filter(
          (edge) => edge.source === resolvedNodeId || edge.target === resolvedNodeId
        )
        diff.deletedEdges.push(...deleted)
        chain.edges = chain.edges.filter(
          (edge) => edge.source !== resolvedNodeId && edge.target !== resolvedNodeId
        )
      } else if (operation.type === 'create_edge') {
        const edge: FlowEdge = {
          id: operation.edge.id ?? createId('ai-edge'),
          source: resolveNodeId(chain, nodeReferences, operation.chainKind, operation.edge.source),
          target: resolveNodeId(chain, nodeReferences, operation.chainKind, operation.edge.target),
          sourceHandle: operation.edge.sourceHandle,
          sourcePort: operation.edge.sourcePort,
          targetPort: operation.edge.targetPort,
          probabilityWeight: operation.edge.probabilityWeight
        }
        assertEditableEdgeFields(chain, edge, 'create_edge.edge', true)
        chain.edges.push(edge)
        diff.addedEdgeIds.push(edge.id)
      } else if (operation.type === 'update_edge') {
        const edge = chain.edges.find((candidate) => candidate.id === operation.edgeId)
        if (!edge) throw new Error(`找不到连线：${operation.edgeId}`)
        assertOnlyKeys(
          operation.patch as Record<string, unknown>,
          new Set(['sourceHandle', 'probabilityWeight']),
          'update_edge.patch'
        )
        assertEditableEdgeFields(chain, { ...edge, ...operation.patch }, 'update_edge.patch', true)
        Object.assign(edge, operation.patch)
        if (!diff.updatedEdgeIds.includes(edge.id)) diff.updatedEdgeIds.push(edge.id)
      } else {
        const edgeIndex = chain.edges.findIndex((candidate) => candidate.id === operation.edgeId)
        if (edgeIndex < 0) throw new Error(`找不到连线：${operation.edgeId}`)
        diff.deletedEdges.push(chain.edges[edgeIndex])
        chain.edges.splice(edgeIndex, 1)
      }
    } catch (error) {
      errors.push(operationError(index, error).message)
      break
    }
  }

  if (errors.length === 0) {
    const newStructuralIssues = structuralIssues(workspace).filter(
      (issue) => !baselineIssues.has(issue)
    )
    errors.push(...newStructuralIssues.map((issue) => `提案会造成新的结构错误：${issue}`))
  }

  const runIssues = diff.affectedChains.flatMap((affected) =>
    validateWorkspaceForRun(workspace, {
      targetType: affected.chainKind,
      targetId: affected.chainId
    })
  )
  const warnings = [
    ...proposal.warnings,
    ...runIssues.map((issue) => `${issue.chainName ? `${issue.chainName}：` : ''}${issue.message}`)
  ]

  return {
    success: errors.length === 0,
    workspace,
    errors,
    warnings: [...new Set(warnings)],
    diff
  }
}
