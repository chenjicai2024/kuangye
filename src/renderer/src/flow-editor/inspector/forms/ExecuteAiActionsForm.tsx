import { forwardRef, useImperativeHandle, useState } from 'react'
import type { Region, StepParams } from '../../../../../core/action-chain/types'
import { inputStyle, labelStyle } from '../../styles'
import { Section } from '../Section'
import type { EditRegionFn } from '../shared'
import type { StepFormHandle, StepFormProps } from './SimpleForms'

interface ExecuteAiActionsFormProps extends StepFormProps {
  region: string
  setRegion: (value: string) => void
  regions: Region[]
  regionNames: string[]
  onEditRegion?: EditRegionFn
}

export const ExecuteAiActionsForm = forwardRef<StepFormHandle, ExecuteAiActionsFormProps>(
  function ExecuteAiActionsForm(
    { markDirty, params, region, setRegion, regions, regionNames, onEditRegion },
    ref
  ) {
    const [variableName, setVariableName] = useState(params?.variableName ?? '')
    const [minConfidence, setMinConfidence] = useState(String(params?.minConfidence ?? '0.7'))
    const [maxActions, setMaxActions] = useState(String(params?.maxActions ?? '3'))

    useImperativeHandle(ref, () => ({
      collectParams: () => {
        const result: Partial<StepParams> = {}
        result.variableName = variableName.trim() || 'aiActions'
        const minConf = Number(minConfidence)
        if (Number.isFinite(minConf) && minConf >= 0 && minConf <= 1) result.minConfidence = minConf
        const maxAct = Number(maxActions)
        if (Number.isFinite(maxAct) && maxAct > 0) result.maxActions = maxAct
        return result
      }
    }))

    return (
      <Section title="AI 动作执行">
        <div style={labelStyle}>动作变量名</div>
        <input
          value={variableName}
          onChange={(e) => {
            setVariableName(e.target.value)
            markDirty()
          }}
          style={inputStyle}
        />

        <div style={{ ...labelStyle, marginTop: 10 }}>最低置信度</div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={minConfidence}
          onChange={(e) => {
            setMinConfidence(e.target.value)
            markDirty()
          }}
          style={{ width: '100%' }}
        />
        <div style={{ color: '#737b8c', fontSize: 11, textAlign: 'center' }}>{minConfidence}</div>

        <div style={{ ...labelStyle, marginTop: 10 }}>最大动作数</div>
        <input
          value={maxActions}
          onChange={(e) => {
            setMaxActions(e.target.value)
            markDirty()
          }}
          inputMode="numeric"
          style={inputStyle}
        />

        <div style={{ ...labelStyle, marginTop: 10 }}>限制区域 (可选)</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            value={region}
            onChange={(e) => {
              setRegion(e.target.value)
              markDirty()
            }}
            style={{ ...inputStyle, flex: 1 }}
          >
            <option value="">不限制</option>
            {regionNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {onEditRegion && (
            <button
              onClick={async () => {
                const r = region ? regions.find((item) => item.name === region) : null
                const returned = r
                  ? await onEditRegion(region, r.rect)
                  : await onEditRegion('', { x: 0, y: 0, width: 200, height: 200 })
                if (returned) {
                  setRegion(returned)
                  markDirty()
                }
              }}
              style={{
                padding: '6px 8px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid rgba(56,189,248,0.3)',
                background: 'rgba(56,189,248,0.1)',
                color: '#38bdf8',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {region ? '编辑' : '框选'}
            </button>
          )}
        </div>
      </Section>
    )
  }
)
