import { ScreenRect } from '../rpa/types'

export interface WindowAnchor {
  id: string
  name: string
  title: string
  ownerName: string
  ownerPath?: string
  capturedBounds: ScreenRect
  capturedImagePath?: string
  capturedImageScaleFactor?: number
}

export interface Region {
  name: string
  rect: ScreenRect
  coordinateMode?: 'screen' | 'window'
  windowAnchorId?: string
  templateImagePath?: string
  templateScaleFactor?: number
}

export type StepType =
  | 'detect_pixel_change'
  | 'check_pixel_diff'
  | 'detect_red_dot'
  | 'wait_red_dot'
  | 'set_baseline'
  | 'refresh_window_anchor'
  | 'relocate_window_anchor'
  | 'adjust_ui_layout'
  | 'locate_ui_region'
  | 'ai_locate_ui_region'
  | 'call_chain'
  | 'if_else'
  | 'random_branch'
  | 'jump_to'
  | 'click'
  | 'random_mouse'
  | 'right_click'
  | 'drag'
  | 'key_press'
  | 'hotkey'
  | 'screenshot_to_ai'
  | 'extract_chat_details'
  | 'record_chat_history'
  | 'generate_chat_reply'
  | 'type_text'
  | 'wait'
  | 'execute_ai_actions'
  | 'parallel'
  | 'parallel_process'
  | 'trigger'
  | 'loop_counter'

export type AIOutputMode = 'text' | 'structured_json' | 'chat_analysis' | 'decision' | 'action_plan'

export interface StepParams {
  region?: string
  dragEndRegion?: string
  variableName?: string
  aiPrompt?: string
  textTemplate?: string
  textInputMode?: 'instant' | 'progressive'
  textChunkStrategy?: 'random' | 'natural'
  textChunkMin?: number
  textChunkMax?: number
  textChunkDelayMinMs?: number
  textChunkDelayMaxMs?: number
  clickPolicy?: 'single' | 'double'
  clickPositionMode?: 'center' | 'random'
  randomMouseMinMoves?: number
  randomMouseMaxMoves?: number
  randomMousePauseMinMs?: number
  randomMousePauseMaxMs?: number
  keyName?: string
  modifiers?: string[]
  waitMode?: 'fixed' | 'random'
  waitMs?: number
  waitMinMs?: number
  waitMaxMs?: number
  redDotThreshold?: number
  callChainName?: string
  jumpToStep?: number
  jumpToNodeId?: string
  outputSchema?: OutputField[]
  outputMode?: AIOutputMode
  minConfidence?: number
  maxActions?: number
  windowAnchorId?: string
  refreshAllWindowAnchors?: boolean
  layoutInstruction?: string
  layoutAllowedAction?: 'drag' | 'click'
  uiLocateMode?: 'template' | 'relative'
  uiSearchScope?: 'nearby' | 'window' | 'region'
  uiSearchWindowAnchorId?: string
  uiReferenceRegion?: string
  uiSearchRegion?: string
  uiSearchPadding?: number
  uiMatchThreshold?: number
  uiOffsetX?: number
  uiOffsetY?: number
  uiVisionPrompt?: string
  uiReferenceImageRegion?: string
  chatSnapshotVariable?: string
  chatConversationVariable?: string
  chatReplyVariable?: string
  chatRecordMode?: 'snapshot' | 'outgoing_reply'
  chatContextTokenBudget?: number
  chatIncludeScreenshot?: boolean
  chatReplyPrompt?: string
  parallelMode?: 'race' | 'gather'
  parallelTimeoutMs?: number
  triggerMode?: 'start' | 'stop'
  triggerTargetNodeId?: string
  loopMaxCount?: number
  pixelChangeThreshold?: number
}

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'is_true'
  | 'is_false'
  | 'greater_than'
  | 'less_than'

export interface SingleCondition {
  variable: string
  operator: ConditionOperator
  value: string
}

export interface CompoundCondition {
  logic: 'and' | 'or'
  conditions: SingleCondition[]
}

export type StepCondition = SingleCondition | CompoundCondition

export function isCompoundCondition(c: StepCondition): c is CompoundCondition {
  return 'logic' in c && 'conditions' in c
}

export interface OutputField {
  name: string
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'object'
    | 'array'
    | 'point'
    | 'rect'
    | 'action'
    | 'action_list'
}

export type VariableType = OutputField['type']

export interface Variable {
  name: string
  type: VariableType
}

export type AICoordinateSpace = 'region_normalized' | 'screen_absolute'

export interface AIPoint {
  x: number
  y: number
  coordinateSpace?: AICoordinateSpace
}

export interface AIRect {
  x: number
  y: number
  width: number
  height: number
  coordinateSpace?: AICoordinateSpace
}

export interface AIAction {
  type: 'click' | 'right_click' | 'drag' | 'type_text' | 'key_press' | 'hotkey'
  target?: AIPoint
  position?: AIPoint
  from?: AIPoint
  to?: AIPoint
  text?: string
  keyName?: string
  modifiers?: string[]
  region?: string
  reason?: string
}

export interface AIActionPlan {
  actions: AIAction[]
  confidence: number
  reason?: string
}

export interface ActionStep {
  type: StepType
  region?: string
  params?: StepParams
  condition?: StepCondition
  trueSteps?: ActionStep[]
  falseSteps?: ActionStep[]
  onError?: 'continue' | 'stop' | 'jump'
  errorJumpStep?: number
  timeoutMs?: number
  retryCount?: number
  retryDelayMs?: number
  maxFailures?: number
}

export type TriggerType = 'pixel_change' | 'red_dot' | 'manual' | 'default' | 'sub' | 'none'

export interface FlowNode {
  id: string
  type: StepType
  position: { x: number; y: number }
  data: ActionStep
  label?: string
  legacyStepIndex?: number
}

export type FlowPortSide = 'top' | 'right' | 'bottom' | 'left'

export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: 'true' | 'false' | 'start' | 'stop' | 'continue' | 'exit'
  sourcePort?: FlowPortSide
  targetPort?: FlowPortSide
  probabilityWeight?: number
}

export interface ActionChain {
  id?: string
  name: string
  /** 面向用户和构建助手的功能说明，不参与运行时控制。 */
  description?: string
  enabled?: boolean
  trigger: TriggerType
  triggerRegion?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** @deprecated 旧格式兼容 */
  steps?: ActionStep[]
}

export interface ExecutionChain {
  id?: string
  name: string
  /** 面向用户和构建助手的功能说明，不参与运行时控制。 */
  description?: string
  enabled?: boolean
  trigger: TriggerType
  triggerRegion?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** @deprecated 旧格式兼容 */
  steps?: ActionStep[]
}

export interface View {
  name: string
  regions: Region[]
}

export interface Workspace {
  windowAnchors: WindowAnchor[]
  views: View[]
  executionChains: ExecutionChain[]
  chains: ActionChain[]
}

export interface EngineState {
  running: boolean
  runMode?: 'global' | 'single'
  targetChainType?: 'executionChain' | 'actionChain'
  targetChainId?: string
  currentChain: string | null
  currentChainType?: 'executionChain' | 'actionChain'
  currentStep: number
  errors: string[]
  variables: Record<string, unknown>
}

export interface StepLog {
  chainType?: 'executionChain' | 'actionChain'
  chainName: string
  stepIndex: number
  nodeId?: string
  stepType: string
  status: 'running' | 'success' | 'skipped' | 'error'
  message: string
  detail?: string
  elapsedMs?: number
}

export interface StepContext {
  regions: Region[]
  variables: Record<string, unknown>
  jumpTarget?: number
  jumpTargetNodeId?: string
}

export interface Project {
  id: string
  name: string
  workspace: Workspace
  createdAt: number
  updatedAt: number
}

export interface ProjectsStore {
  projects: Project[]
  lastSelectedProjectId?: string
}

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  click: '点击',
  random_mouse: '随机鼠标',
  right_click: '右键点击',
  drag: '拖动',
  type_text: '输入文字',
  key_press: '按键',
  hotkey: '组合键',
  wait: '等待',
  screenshot_to_ai: '截图给AI',
  extract_chat_details: '解析聊天详情',
  record_chat_history: '记录聊天内容',
  generate_chat_reply: '基于聊天记录生成回复',
  check_pixel_diff: '像素检测',
  detect_pixel_change: '等待像素变化',
  detect_red_dot: '检测红点',
  wait_red_dot: '等待红点出现',
  set_baseline: '刷新像素',
  refresh_window_anchor: '窗口校准',
  relocate_window_anchor: '重新定位窗口',
  adjust_ui_layout: 'UI布局调整',
  locate_ui_region: '定位UI区域',
  ai_locate_ui_region: 'AI视觉定位',
  if_else: '条件分支',
  random_branch: '随机分支',
  call_chain: '调用动作链',
  jump_to: '跳转',
  execute_ai_actions: '执行AI动作',
  parallel: '并行节点',
  parallel_process: '并行处理',
  trigger: '触发节点',
  loop_counter: '循环计数器'
}

export const STEP_TYPE_CATEGORIES: { label: string; types: StepType[] }[] = [
  {
    label: '鼠标操作',
    types: ['click', 'random_mouse', 'right_click', 'drag']
  },
  {
    label: '键盘操作',
    types: ['type_text', 'key_press', 'hotkey']
  },
  {
    label: '流程控制',
    types: [
      'wait',
      'if_else',
      'random_branch',
      'jump_to',
      'call_chain',
      'parallel',
      'parallel_process',
      'trigger',
      'loop_counter'
    ]
  },
  {
    label: '窗口与坐标',
    types: [
      'refresh_window_anchor',
      'relocate_window_anchor',
      'adjust_ui_layout',
      'locate_ui_region',
      'ai_locate_ui_region'
    ]
  },
  {
    label: '触发与检测',
    types: [
      'screenshot_to_ai',
      'extract_chat_details',
      'record_chat_history',
      'generate_chat_reply',
      'check_pixel_diff',
      'detect_pixel_change',
      'detect_red_dot',
      'wait_red_dot',
      'set_baseline',
      'execute_ai_actions'
    ]
  }
]
