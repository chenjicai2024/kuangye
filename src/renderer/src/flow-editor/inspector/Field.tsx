import type React from 'react'
import { inputStyle, labelStyle } from '../styles'

export function Field({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): React.ReactElement {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        style={inputStyle}
      />
    </div>
  )
}
