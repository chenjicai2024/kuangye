import { forwardRef, useImperativeHandle, useState } from 'react'
import { Section } from '../Section'
import { inputStyle, labelStyle } from '../../styles'
import type { StepFormHandle, StepFormProps } from './SimpleForms'

export const PixelChangeForm = forwardRef<StepFormHandle, StepFormProps>(function PixelChangeForm(
  { markDirty, params },
  ref
) {
  const [threshold, setThreshold] = useState(
    String(params?.pixelChangeThreshold ?? '0.5')
  )

  useImperativeHandle(ref, () => ({
    collectParams: () => {
      const t = Number(threshold)
      return {
        pixelChangeThreshold: Number.isFinite(t) && t > 0 ? t : 0.5
      }
    }
  }))

  return (
    <Section title="像素变化阈值">
      <div style={labelStyle}>变化阈值（%）</div>
      <input
        type="number"
        min="0.1"
        step="0.1"
        value={threshold}
        onChange={(e) => {
          setThreshold(e.target.value)
          markDirty()
        }}
        style={inputStyle}
      />
      <div style={{ color: '#737b8c', fontSize: 11, marginTop: 5, lineHeight: 1.5 }}>
        像素差异超过此百分比时判定为变化。默认 0.5%，一条新消息通常改变 5% 以上。
      </div>
    </Section>
  )
})
