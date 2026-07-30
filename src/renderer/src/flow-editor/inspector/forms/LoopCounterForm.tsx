import { forwardRef, useImperativeHandle, useState } from 'react'
import { Section } from '../Section'
import { inputStyle, labelStyle } from '../../styles'
import type { StepFormHandle, StepFormProps } from './SimpleForms'

export const LoopCounterForm = forwardRef<StepFormHandle, StepFormProps>(function LoopCounterForm(
  { markDirty, params },
  ref
) {
  const [maxCount, setMaxCount] = useState(String(params?.loopMaxCount ?? ''))

  useImperativeHandle(ref, () => ({
    collectParams: () => {
      const count = Number(maxCount)
      return {
        loopMaxCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : undefined
      }
    }
  }))

  return (
    <Section title="循环计数器">
      <div style={labelStyle}>最大循环次数</div>
      <input
        type="number"
        min="1"
        value={maxCount}
        onChange={(e) => {
          setMaxCount(e.target.value)
          markDirty()
        }}
        placeholder="例如：5"
        style={inputStyle}
      />
      <div style={{ color: '#737b8c', fontSize: 11, marginTop: 7, lineHeight: 1.5 }}>
        每次执行到此节点计数 +1。
      </div>
      <div style={{ color: '#737b8c', fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
        <b style={{ color: '#10b981' }}>继续</b> 口：未达上限，正常执行下一个节点
      </div>
      <div style={{ color: '#737b8c', fontSize: 11, marginTop: 2, lineHeight: 1.5 }}>
        <b style={{ color: '#ef4444' }}>退出</b> 口：达到上限，流程从这里离开
      </div>
      <div style={{ color: '#737b8c', fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
        重新运行后计数器自动归零。
      </div>
    </Section>
  )
})
