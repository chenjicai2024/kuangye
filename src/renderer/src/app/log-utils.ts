import { STEP_TYPE_LABELS, type StepType } from '../../../core/action-chain/types'
import type { ActiveLogStep, LogEntry } from './types'

export function stepLogType(stepType: string): LogEntry['type'] {
  if (stepType === 'screenshot_to_ai' || stepType === 'execute_ai_actions') return 'ai'
  if (
    stepType === 'click' ||
    stepType === 'right_click' ||
    stepType === 'drag' ||
    stepType === 'type_text' ||
    stepType === 'key_press' ||
    stepType === 'hotkey'
  ) {
    return 'operation'
  }
  return 'flow'
}

export function classifyEngineLog(message: string, activeStep: ActiveLogStep | null): LogEntry['type'] {
  // 只匹配系统固定格式的错误日志前缀，避免 AI 回复内容中的"失败"等词被误判
  if (
    /^引擎异常|^引擎因步骤失败|^节点.*累计失败|^节点.*失败次数已达上限|^指定链不存在|^跳转失败|^区域.*的窗口锚点不存在|^未找到窗口锚点/.test(
      message
    )
  ) {
    return 'error'
  }
  if (/安全提示|接管鼠标和键盘|跳过|无需回复|内容为空|字段缺失|无法确定/.test(message)) {
    return 'warning'
  }
  if (/AI|结构化分析|截图给AI/.test(message)) return 'ai'
  if (/红点|像素变化/.test(message) && !activeStep) return 'trigger'
  if (/点击|输入|按下|拖动/.test(message)) return 'operation'
  return activeStep ? stepLogType(activeStep.stepType) : 'flow'
}

export function stepLabel(stepType: string): string {
  return STEP_TYPE_LABELS[stepType as StepType] ?? stepType
}

export const tokenNumberFormatter = new Intl.NumberFormat('zh-CN')

export function formatTokenCount(value: number): string {
  return tokenNumberFormatter.format(value)
}

export function formatUsageTime(value: string | null): string {
  if (!value) return '暂无记录'
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '未知时间' : time.toLocaleString('zh-CN')
}
