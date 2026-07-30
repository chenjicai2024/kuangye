import { useState } from 'react'
import { STEP_TYPE_CATEGORIES, STEP_TYPE_LABELS } from '../../../core/action-chain/types'
import type { StepType } from '../../../core/action-chain/types'

export function StepPalette(): React.ReactElement {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggle = (label: string) => {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  return (
    <>
      <div style={{ color: '#8b93a3', fontSize: 11, margin: '14px 0 8px' }}>拖拽到画布添加</div>
      {STEP_TYPE_CATEGORIES.map((category) => (
        <div key={category.label} style={{ marginBottom: 12 }}>
          <div
            onClick={() => toggle(category.label)}
            style={{
              color: '#8b94a7',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              marginBottom: 8,
              padding: '6px 4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              userSelect: 'none'
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '6px solid #8b94a7',
                transform: collapsed[category.label] ? 'rotate(-90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease'
              }}
            />
            {category.label}
          </div>
          {!collapsed[category.label] &&
            category.types.map((type: StepType) => (
              <div
                key={type}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/reactflow-type', type)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                style={{
                  padding: '10px 10px',
                  marginBottom: 5,
                  background: 'rgba(255,255,255,0.045)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'grab',
                  color: '#cbd5e1'
                }}
              >
                {STEP_TYPE_LABELS[type]}
              </div>
            ))}
        </div>
      ))}
    </>
  )
}
