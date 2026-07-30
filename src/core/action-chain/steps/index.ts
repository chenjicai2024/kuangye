import { StepType } from '../types'
import type { StepHandler } from '../engine-api'
import {
  executeClick,
  executeCheckPixelDiff,
  executeDetectPixelChange,
  executeDetectRedDot,
  executeDrag,
  executeHotkey,
  executeKeyPress,
  executeRandomMouse,
  executeRefreshWindowAnchor,
  executeRelocateWindowAnchor,
  executeRightClick,
  executeSetBaseline,
  executeTypeText,
  executeWait,
  executeLoopCounter
} from './basic-steps'
import { executeAdjustUiLayout, executeExecuteAiActions, executeScreenshotToAi } from './ai-steps'
import {
  executeCallChain,
  executeIfElse,
  executeJumpTo,
  executeParallel,
  executeParallelProcess,
  executeRandomBranch,
  executeTrigger,
  executeWaitRedDot
} from './flow-steps'
import { executeAiLocateUiRegion, executeLocateUiRegion } from './ui-steps'
import {
  executeExtractChatDetails,
  executeGenerateChatReply,
  executeRecordChatHistory
} from './chat-steps'

export const STEP_HANDLER_REGISTRY: Partial<Record<StepType, StepHandler>> = {
  // basic-steps
  wait: executeWait,
  refresh_window_anchor: executeRefreshWindowAnchor,
  relocate_window_anchor: executeRelocateWindowAnchor,
  click: executeClick,
  right_click: executeRightClick,
  drag: executeDrag,
  type_text: executeTypeText,
  key_press: executeKeyPress,
  hotkey: executeHotkey,
  random_mouse: executeRandomMouse,
  detect_pixel_change: executeDetectPixelChange,
  check_pixel_diff: executeCheckPixelDiff,
  set_baseline: executeSetBaseline,
  detect_red_dot: executeDetectRedDot,
  loop_counter: executeLoopCounter,

  // ai-steps
  screenshot_to_ai: executeScreenshotToAi,
  execute_ai_actions: executeExecuteAiActions,
  adjust_ui_layout: executeAdjustUiLayout,

  // flow-steps
  call_chain: executeCallChain,
  if_else: executeIfElse,
  random_branch: executeRandomBranch,
  jump_to: executeJumpTo,
  parallel: executeParallel,
  parallel_process: executeParallelProcess,
  trigger: executeTrigger,
  wait_red_dot: executeWaitRedDot,

  // ui-steps
  locate_ui_region: executeLocateUiRegion,
  ai_locate_ui_region: executeAiLocateUiRegion,

  // chat-steps
  extract_chat_details: executeExtractChatDetails,
  record_chat_history: executeRecordChatHistory,
  generate_chat_reply: executeGenerateChatReply
}
