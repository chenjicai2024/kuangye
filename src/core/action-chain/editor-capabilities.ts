import type { StepParams, StepType } from './types'

export type StepRegionEditorMode = 'primary' | 'optional' | 'conditional' | 'none'

export interface StepEditorCapability {
  regionEditor: StepRegionEditorMode
  params: readonly (keyof StepParams)[]
}

/**
 * 节点属性面板实际开放给用户的字段。
 * AI 编辑提案必须复用这份表，不能自行扩大节点参数权限。
 */
export const STEP_EDITOR_CAPABILITIES = {
  detect_pixel_change: { regionEditor: 'primary', params: ['pixelChangeThreshold'] },
  check_pixel_diff: { regionEditor: 'primary', params: ['pixelChangeThreshold'] },
  detect_red_dot: { regionEditor: 'primary', params: ['redDotThreshold'] },
  wait_red_dot: { regionEditor: 'primary', params: ['redDotThreshold'] },
  set_baseline: { regionEditor: 'primary', params: [] },
  refresh_window_anchor: {
    regionEditor: 'none',
    params: ['windowAnchorId', 'refreshAllWindowAnchors']
  },
  relocate_window_anchor: {
    regionEditor: 'none',
    params: ['windowAnchorId', 'refreshAllWindowAnchors']
  },
  adjust_ui_layout: {
    regionEditor: 'none',
    params: ['windowAnchorId', 'layoutInstruction', 'layoutAllowedAction', 'minConfidence']
  },
  locate_ui_region: {
    regionEditor: 'primary',
    params: [
      'uiLocateMode',
      'uiSearchScope',
      'uiSearchWindowAnchorId',
      'uiReferenceRegion',
      'uiSearchRegion',
      'uiSearchPadding',
      'uiMatchThreshold',
      'uiOffsetX',
      'uiOffsetY'
    ]
  },
  ai_locate_ui_region: {
    regionEditor: 'primary',
    params: [
      'uiVisionPrompt',
      'uiReferenceImageRegion',
      'uiSearchScope',
      'uiSearchWindowAnchorId',
      'uiSearchRegion',
      'uiSearchPadding'
    ]
  },
  call_chain: { regionEditor: 'none', params: ['callChainName'] },
  if_else: { regionEditor: 'none', params: [] },
  random_branch: { regionEditor: 'none', params: [] },
  jump_to: { regionEditor: 'none', params: ['jumpToStep', 'jumpToNodeId'] },
  click: { regionEditor: 'primary', params: ['clickPolicy', 'clickPositionMode'] },
  random_mouse: {
    regionEditor: 'primary',
    params: [
      'randomMouseMinMoves',
      'randomMouseMaxMoves',
      'randomMousePauseMinMs',
      'randomMousePauseMaxMs'
    ]
  },
  right_click: { regionEditor: 'primary', params: [] },
  drag: { regionEditor: 'primary', params: ['dragEndRegion'] },
  key_press: { regionEditor: 'none', params: ['keyName'] },
  hotkey: { regionEditor: 'none', params: ['keyName', 'modifiers'] },
  screenshot_to_ai: {
    regionEditor: 'primary',
    params: ['variableName', 'aiPrompt', 'outputMode', 'outputSchema']
  },
  extract_chat_details: { regionEditor: 'primary', params: ['chatSnapshotVariable'] },
  record_chat_history: {
    regionEditor: 'none',
    params: [
      'chatRecordMode',
      'chatSnapshotVariable',
      'chatConversationVariable',
      'chatReplyVariable'
    ]
  },
  generate_chat_reply: {
    regionEditor: 'conditional',
    params: [
      'chatConversationVariable',
      'chatReplyVariable',
      'chatContextTokenBudget',
      'chatIncludeScreenshot',
      'chatReplyPrompt'
    ]
  },
  type_text: {
    regionEditor: 'primary',
    params: [
      'textTemplate',
      'textInputMode',
      'textChunkStrategy',
      'textChunkMin',
      'textChunkMax',
      'textChunkDelayMinMs',
      'textChunkDelayMaxMs'
    ]
  },
  wait: { regionEditor: 'none', params: ['waitMode', 'waitMs', 'waitMinMs', 'waitMaxMs'] },
  execute_ai_actions: {
    regionEditor: 'optional',
    params: ['variableName', 'minConfidence', 'maxActions']
  },
  parallel: { regionEditor: 'none', params: [] },
  parallel_process: { regionEditor: 'none', params: ['parallelMode', 'parallelTimeoutMs'] },
  trigger: { regionEditor: 'none', params: ['triggerMode', 'triggerTargetNodeId'] },
  loop_counter: { regionEditor: 'none', params: ['loopMaxCount'] }
} as const satisfies Record<StepType, StepEditorCapability>

export const COMMON_EDITABLE_STEP_DATA_FIELDS = [
  'condition',
  'onError',
  'errorJumpStep',
  'timeoutMs',
  'retryCount',
  'retryDelayMs',
  'maxFailures'
] as const

export function getStepEditorCapability(type: StepType): StepEditorCapability {
  return STEP_EDITOR_CAPABILITIES[type]
}

export function stepCanEditRegion(type: StepType): boolean {
  return getStepEditorCapability(type).regionEditor !== 'none'
}

export function stepHasPrimaryRegionEditor(type: StepType): boolean {
  return getStepEditorCapability(type).regionEditor === 'primary'
}

export function stepParamIsEditable(type: StepType, key: keyof StepParams): boolean {
  return getStepEditorCapability(type).params.includes(key)
}

export function agentEditorCapabilitiesPayload(): object {
  return {
    commonNodeDataFields: COMMON_EDITABLE_STEP_DATA_FIELDS,
    nodeTypeIsReadOnlyAfterCreation: true,
    nodeLabelIsSystemManaged: true,
    stepTypes: STEP_EDITOR_CAPABILITIES,
    regions: {
      mayReferenceExisting: true,
      mayCreateRenameOrDelete: false
    },
    edges: {
      mayCreateAndDelete: true,
      editableExistingFieldsBySourceType: {
        if_else: ['sourceHandle'],
        random_branch: ['probabilityWeight']
      }
    }
  }
}
