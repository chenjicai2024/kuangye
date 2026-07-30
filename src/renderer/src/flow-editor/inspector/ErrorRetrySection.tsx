import type React from 'react'
import type { ActionStep } from '../../../../core/action-chain/types'
import { Section } from './Section'
import { Field } from './Field'
import { inputStyle, labelStyle } from '../styles'

interface ErrorRetrySectionProps {
  onError: NonNullable<ActionStep['onError']>
  errorJumpStep: string
  timeoutMs: string
  retryCount: string
  retryDelayMs: string
  maxFailures: string
  onErrorChange: (value: NonNullable<ActionStep['onError']>) => void
  onErrorJumpStepChange: (value: string) => void
  setTimeoutMs: (value: string) => void
  setRetryCount: (value: string) => void
  setRetryDelayMs: (value: string) => void
  setMaxFailures: (value: string) => void
}

export function ErrorRetrySection({
  onError,
  errorJumpStep,
  timeoutMs,
  retryCount,
  retryDelayMs,
  maxFailures,
  onErrorChange,
  onErrorJumpStepChange,
  setTimeoutMs,
  setRetryCount,
  setRetryDelayMs,
  setMaxFailures
}: ErrorRetrySectionProps): React.ReactElement {
  return (
    <Section title="失败和重试">
      <div style={labelStyle}>失败时</div>
      <select
        value={onError}
        onChange={(e) => onErrorChange(e.target.value as NonNullable<ActionStep['onError']>)}
        style={inputStyle}
      >
        <option value="continue">继续下一步</option>
        <option value="stop">停止引擎</option>
        <option value="jump">跳转到步骤</option>
      </select>
      {onError === 'jump' && (
        <>
          <div style={{ ...labelStyle, marginTop: 10 }}>失败跳转步骤编号</div>
          <input
            value={errorJumpStep}
            onChange={(e) => onErrorJumpStepChange(e.target.value)}
            inputMode="numeric"
            style={inputStyle}
          />
        </>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <Field label="超时 ms" value={timeoutMs} onChange={setTimeoutMs} />
        <Field label="重试次数" value={retryCount} onChange={setRetryCount} />
        <Field label="重试间隔 ms" value={retryDelayMs} onChange={setRetryDelayMs} />
        <Field label="最大失败次数" value={maxFailures} onChange={setMaxFailures} />
      </div>
    </Section>
  )
}
