import type { ComponentType, RefAttributes } from 'react'
import type { StepType } from '../../../../../core/action-chain/types'
import type { StepFormHandle, StepFormProps } from './SimpleForms'
import {
  ClickForm,
  RandomMouseForm,
  WaitForm,
  WaitRedDotForm,
  KeyPressHotkeyForm,
  RandomBranchForm
} from './SimpleForms'
import {
  DragForm,
  CallChainForm,
  JumpToForm,
  ParallelProcessForm,
  TriggerForm,
  WindowAnchorForm
} from './NavigationForms'
import { ScreenshotToAiForm } from './ScreenshotToAiForm'
import { ExecuteAiActionsForm } from './ExecuteAiActionsForm'
import { TypeTextForm } from './TypeTextForm'
import { AdjustUiLayoutForm } from './AdjustUiLayoutForm'
import { LocateUiRegionForm } from './LocateUiRegionForm'
import { AiLocateUiRegionForm } from './AiLocateUiRegionForm'
import { LoopCounterForm } from './LoopCounterForm'
import { PixelChangeForm } from './PixelChangeForm'

export {
  ScreenshotToAiForm,
  ExecuteAiActionsForm,
  TypeTextForm,
  AdjustUiLayoutForm,
  LocateUiRegionForm,
  AiLocateUiRegionForm
}

// 统一为 ComponentType，实际 props 在 StepInspector 中按 step.type 传入
export type StepFormComponent = ComponentType<StepFormProps & RefAttributes<StepFormHandle> & Record<string, unknown>>

export const SIMPLE_FORM_REGISTRY: Partial<Record<StepType, StepFormComponent>> = {
  click: ClickForm as unknown as StepFormComponent,
  random_mouse: RandomMouseForm as unknown as StepFormComponent,
  wait: WaitForm as unknown as StepFormComponent,
  wait_red_dot: WaitRedDotForm as unknown as StepFormComponent,
  key_press: KeyPressHotkeyForm as unknown as StepFormComponent,
  hotkey: KeyPressHotkeyForm as unknown as StepFormComponent,
  random_branch: RandomBranchForm as unknown as StepFormComponent,
  drag: DragForm as unknown as StepFormComponent,
  call_chain: CallChainForm as unknown as StepFormComponent,
  jump_to: JumpToForm as unknown as StepFormComponent,
  parallel_process: ParallelProcessForm as unknown as StepFormComponent,
  trigger: TriggerForm as unknown as StepFormComponent,
  refresh_window_anchor: WindowAnchorForm as unknown as StepFormComponent,
  relocate_window_anchor: WindowAnchorForm as unknown as StepFormComponent,
  loop_counter: LoopCounterForm as unknown as StepFormComponent,
  detect_pixel_change: PixelChangeForm as unknown as StepFormComponent,
  check_pixel_diff: PixelChangeForm as unknown as StepFormComponent
}

export type { StepFormHandle, StepFormProps }
