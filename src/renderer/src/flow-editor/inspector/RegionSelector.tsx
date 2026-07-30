import type React from 'react'
import type { Region } from '../../../../core/action-chain/types'
import { inputStyle, labelStyle } from '../styles'

interface RegionSelectorProps {
  value: string
  onChange: (value: string) => void
  regions: Region[]
  regionNames: string[]
  onEditRegion?: (
    name: string,
    rect: { x: number; y: number; width: number; height: number }
  ) => Promise<string | null>
  label?: string
  placeholder?: string
}

export function RegionSelector({
  value,
  onChange,
  regions,
  regionNames,
  onEditRegion,
  label = '目标区域',
  placeholder = '选择区域'
}: RegionSelectorProps): React.ReactElement {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        >
          <option value="">{placeholder}</option>
          {regionNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {onEditRegion && (
          <button
            onClick={async () => {
              const r = value ? regions.find((item) => item.name === value) : null
              const returned = r
                ? await onEditRegion(value, r.rect)
                : await onEditRegion('', { x: 0, y: 0, width: 200, height: 200 })
              if (returned) onChange(returned)
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
            {value ? '编辑' : '框选'}
          </button>
        )}
      </div>
    </div>
  )
}
