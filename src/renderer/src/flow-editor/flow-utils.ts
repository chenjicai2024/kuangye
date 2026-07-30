import type React from 'react'
import type {
  ActionChain,
  ExecutionChain,
  FlowPortSide,
  StepType,
  TriggerType,
  Variable,
  VariableType,
  Workspace
} from '../../../core/action-chain/types'

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  pixel_change: '旧版像素触发',
  red_dot: '旧版红点触发',
  manual: '单次运行',
  default: '循环运行',
  sub: '子链',
  none: '无'
}
export const EXECUTION_TRIGGER_TYPES: TriggerType[] = ['manual', 'default']

export const VISIBLE_NODE_WIDTH = 154
export const VISIBLE_NODE_HEIGHT = 56
export const CONDITION_NODE_HEIGHT = 56
export const FLOW_PORT_SIDES: FlowPortSide[] = ['top', 'right', 'bottom', 'left']
export const FLOW_PORT_LABELS: Record<FlowPortSide, string> = {
  top: '上方',
  right: '右侧',
  bottom: '下方',
  left: '左侧'
}

export type VisibleSourceHandle = 'true' | 'false' | 'start' | 'stop' | 'continue' | 'exit' | undefined

export interface KeyboardActions {
  edgeId: string
  nodeId: string
  multiSize: number
  clearSelection: () => void
  copySelectedNodes: () => void
  pasteNodes: () => void
  selectAllNodes: () => void
  deleteSelectedEdge: () => void
  deleteSelectedNode: () => void
  undo: () => void
  redo: () => void
}

let nodeIdCounter = 0

export function genId(prefix: string): string {
  nodeIdCounter += 1
  return `${prefix}-${Date.now()}-${nodeIdCounter}`
}

export function defaultWorkspace(): Workspace {
  return {
    windowAnchors: [],
    views: [{ name: '默认视图', regions: [] }],
    executionChains: [],
    chains: []
  }
}

export function chainKindLabel(tab: 'executionChains' | 'chains'): string {
  return tab === 'executionChains' ? '执行链' : '动作链'
}

export function chainKindHint(tab: 'executionChains' | 'chains'): string {
  return tab === 'executionChains'
    ? '主流程，启动引擎时运行。可调用动作链和基础步骤。'
    : '可复用的子模块，被执行链通过 call_chain 调用。'
}

export function edgeColor(sourceHandle?: string): string {
  if (sourceHandle === 'true') return '#10b981'
  if (sourceHandle === 'false') return '#ef4444'
  if (sourceHandle === 'start') return '#10b981'
  if (sourceHandle === 'stop') return '#ef4444'
  if (sourceHandle === 'continue') return '#10b981'
  if (sourceHandle === 'exit') return '#ef4444'
  return '#38bdf8'
}

export function visibleNodeHeight(type: StepType): number {
  return type === 'if_else' ? CONDITION_NODE_HEIGHT : VISIBLE_NODE_HEIGHT
}

export function flowPortPosition(side: FlowPortSide): React.CSSProperties {
  switch (side) {
    case 'top':
      return { left: '50%', top: -18, transform: 'translateX(-50%)' }
    case 'right':
      return { right: -18, top: '50%', transform: 'translateY(-50%)' }
    case 'bottom':
      return { left: '50%', bottom: -18, transform: 'translateX(-50%)' }
    case 'left':
      return { left: -18, top: '50%', transform: 'translateY(-50%)' }
  }
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], [data-flow-editor-interactive]'
    )
  )
}

export function collectVariables(chain: ActionChain | ExecutionChain | undefined): Variable[] {
  const variables: Variable[] = []
  const seen = new Set<string>()

  function add(name: string, type: VariableType): void {
    if (!name || seen.has(name)) return
    seen.add(name)
    variables.push({ name, type })
  }

  for (const node of chain?.nodes ?? []) {
    const step = node.data
    if (step.type === 'screenshot_to_ai') {
      for (const field of step.params?.outputSchema ?? []) add(field.name, field.type)
      add(step.params?.variableName ?? 'reply', 'string')
    }
    if (step.type === 'extract_chat_details') {
      add(step.params?.chatSnapshotVariable ?? 'chatSnapshot', 'object')
    }
    if (
      step.type === 'record_chat_history' &&
      (step.params?.chatRecordMode ?? 'snapshot') === 'snapshot'
    ) {
      add(step.params?.chatConversationVariable ?? 'chatConversation', 'object')
    }
    if (step.type === 'generate_chat_reply') {
      add(step.params?.chatReplyVariable ?? 'chatReply', 'string')
    }
    if (step.type === 'check_pixel_diff' && step.region) {
      add(`${step.region}_diff`, 'boolean')
      add(`${step.region}_diff_ratio`, 'number')
    }
    if (step.type === 'detect_red_dot' && step.region) add(`${step.region}_red_ratio`, 'number')
    if (step.type === 'wait_red_dot' && step.region) add(`${step.region}_red_dot`, 'boolean')
    if (step.type === 'wait_red_dot' && step.region) add(`${step.region}_red_ratio`, 'number')
    if (step.type === 'detect_pixel_change' && step.region) {
      add(`${step.region}_changed`, 'boolean')
      add(`${step.region}_change_ratio`, 'number')
    }
    if (step.type === 'parallel_process' && step.params?.parallelMode === 'race') {
      add('parallel_winner', 'number')
      add('parallel_winner_label', 'string')
    }
  }

  return variables
}
