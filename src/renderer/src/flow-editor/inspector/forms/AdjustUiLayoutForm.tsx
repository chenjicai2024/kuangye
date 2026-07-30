import { forwardRef, useImperativeHandle, useState } from 'react'
import type { StepParams, WindowAnchor } from '../../../../../core/action-chain/types'
import { inputStyle, labelStyle } from '../../styles'
import { Section } from '../Section'
import type { StepFormHandle, StepFormProps } from './SimpleForms'

interface AdjustUiLayoutFormProps extends StepFormProps {
  windowAnchors: WindowAnchor[]
}

export const AdjustUiLayoutForm = forwardRef<StepFormHandle, AdjustUiLayoutFormProps>(
  function AdjustUiLayoutForm({ markDirty, params, windowAnchors }, ref) {
    const [windowAnchorTarget, setWindowAnchorTarget] = useState(
      params?.refreshAllWindowAnchors
        ? '__all__'
        : (params?.windowAnchorId ?? windowAnchors[0]?.id ?? '')
    )
    const [layoutInstruction, setLayoutInstruction] = useState(params?.layoutInstruction ?? '')
    const [layoutAllowedAction, setLayoutAllowedAction] = useState<'drag' | 'click'>(
      params?.layoutAllowedAction ?? 'drag'
    )
    const [minConfidence, setMinConfidence] = useState(String(params?.minConfidence ?? '0.85'))

    useImperativeHandle(ref, () => ({
      collectParams: () => {
        const result: Partial<StepParams> = {}
        if (windowAnchorTarget && windowAnchorTarget !== '__all__') {
          result.windowAnchorId = windowAnchorTarget
        }
        result.layoutInstruction = layoutInstruction.trim()
        result.layoutAllowedAction = layoutAllowedAction
        const confidence = Number(minConfidence)
        result.minConfidence = Number.isFinite(confidence)
          ? Math.min(1, Math.max(0, confidence))
          : 0.85
        return result
      }
    }))

    return (
      <Section title="UI布局调整">
        <div style={labelStyle}>目标窗口</div>
        <select
          value={windowAnchorTarget === '__all__' ? '' : windowAnchorTarget}
          onChange={(event) => {
            setWindowAnchorTarget(event.target.value)
            markDirty()
          }}
          style={inputStyle}
        >
          {windowAnchors.length === 0 && <option value="">尚未捕获窗口</option>}
          {windowAnchors.map((anchor) => (
            <option key={anchor.id} value={anchor.id}>
              {anchor.name} · 主窗截图{anchor.capturedImagePath ? '已保存' : '未保存'}
            </option>
          ))}
        </select>

        <div style={{ ...labelStyle, marginTop: 10 }}>自然语言调整要求</div>
        <textarea
          value={layoutInstruction}
          onChange={(event) => {
            setLayoutInstruction(event.target.value)
            markDirty()
          }}
          placeholder="例如：对照标准图，把聊天记录区和输入区之间的分隔线恢复到相同高度；忽略聊天内容、头像和时间差异。"
          style={{ ...inputStyle, minHeight: 104, resize: 'vertical', lineHeight: 1.55 }}
        />

        <div style={{ ...labelStyle, marginTop: 10 }}>本节点允许执行的动作</div>
        <select
          value={layoutAllowedAction}
          onChange={(event) => {
            setLayoutAllowedAction(event.target.value === 'click' ? 'click' : 'drag')
            markDirty()
          }}
          style={inputStyle}
        >
          <option value="drag">拖动一个位置</option>
          <option value="click">点击一个位置</option>
        </select>

        <div style={{ ...labelStyle, marginTop: 10 }}>最低置信度（0-1）</div>
        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          value={minConfidence}
          onChange={(event) => {
            setMinConfidence(event.target.value)
            markDirty()
          }}
          style={inputStyle}
        />
        <div style={{ color: '#737b8c', fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
          AI会对比捕获时保存的标准主窗口图片和当前窗口，一次最多执行一个动作。需要调整多个位置时，请串联多个UI布局调整节点。动作坐标由本地换算并限制在目标窗口内部。
        </div>
      </Section>
    )
  }
)
