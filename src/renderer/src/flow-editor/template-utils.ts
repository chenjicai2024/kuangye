export interface TemplateInsertionResult {
  value: string
  caret: number
}

/**
 * 在当前选区插入变量占位符。选区无效时退化为追加到末尾，
 * 让按钮插入和 React 受控输入框始终使用同一份文本状态。
 */
export function insertTemplateToken(
  value: string,
  token: string,
  selectionStart?: number | null,
  selectionEnd?: number | null
): TemplateInsertionResult {
  const fallback = value.length
  const start = clampSelection(selectionStart, fallback, value.length)
  const end = Math.max(start, clampSelection(selectionEnd, start, value.length))
  return {
    value: `${value.slice(0, start)}${token}${value.slice(end)}`,
    caret: start + token.length
  }
}

function clampSelection(value: number | null | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(max, Math.floor(value)))
}
