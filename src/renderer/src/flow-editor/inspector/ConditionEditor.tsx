import type React from 'react'
import type { ConditionOperator, SingleCondition, Variable } from '../../../../core/action-chain/types'
import { inputStyle, smallButtonStyle, ghostButtonStyle } from '../styles'
import { OPERATOR_LABELS, updateItem } from './shared'
import {
  conditionItemWithOperator,
  conditionItemWithVariable,
  conditionNeedsValue,
  normalizeBooleanConditionValue
} from '../condition-utils'

export function ConditionEditor({
  logic,
  items,
  variables,
  parallelWinnerOptions,
  parallelWinnerLabelOptions,
  onLogicChange,
  onItemsChange
}: {
  logic: 'and' | 'or'
  items: SingleCondition[]
  variables: Variable[]
  parallelWinnerOptions: Array<{ value: string; label: string }>
  parallelWinnerLabelOptions: Array<{ value: string; label: string }>
  onLogicChange: (logic: 'and' | 'or') => void
  onItemsChange: (items: SingleCondition[]) => void
}): React.ReactElement {
  return (
    <div style={{ marginTop: 10 }}>
      {items.length > 1 && (
        <select
          value={logic}
          onChange={(e) => onLogicChange(e.target.value as 'and' | 'or')}
          style={inputStyle}
        >
          <option value="and">AND（全部满足）</option>
          <option value="or">OR（任意满足）</option>
        </select>
      )}
      {items.map((item, index) => {
        const variableType = variables.find((variable) => variable.name === item.variable)?.type
        const needsValue = conditionNeedsValue(item.operator)
        return (
          <div
            key={index}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 86px 120px 42px',
              gap: 6,
              marginTop: 8
            }}
          >
            <select
              value={item.variable}
              onChange={(e) =>
                onItemsChange(
                  items.map((current, itemIndex) =>
                    itemIndex === index
                      ? conditionItemWithVariable(current, e.target.value, variables)
                      : current
                  )
                )
              }
              style={inputStyle}
            >
              <option value="">变量</option>
              {variables.map((variable) => (
                <option key={variable.name} value={variable.name}>
                  {variable.name}
                </option>
              ))}
            </select>
            <select
              value={item.operator}
              onChange={(e) =>
                onItemsChange(
                  items.map((current, itemIndex) =>
                    itemIndex === index
                      ? conditionItemWithOperator(
                          current,
                          e.target.value as ConditionOperator,
                          variables
                        )
                      : current
                  )
                )
              }
              style={inputStyle}
            >
              {Object.entries(OPERATOR_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {needsValue ? (
              variableType === 'boolean' ? (
                <select
                  value={normalizeBooleanConditionValue(item.value)}
                  onChange={(e) =>
                    onItemsChange(updateItem(items, index, { value: e.target.value }))
                  }
                  style={inputStyle}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : item.variable === 'parallel_winner' && parallelWinnerOptions.length > 0 ? (
                <select
                  value={item.value}
                  onChange={(e) =>
                    onItemsChange(updateItem(items, index, { value: e.target.value }))
                  }
                  style={inputStyle}
                >
                  <option value="">选择分支</option>
                  {parallelWinnerOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : item.variable === 'parallel_winner_label' &&
                parallelWinnerLabelOptions.length > 0 ? (
                <select
                  value={item.value}
                  onChange={(e) =>
                    onItemsChange(updateItem(items, index, { value: e.target.value }))
                  }
                  style={inputStyle}
                >
                  <option value="">选择分支</option>
                  {parallelWinnerLabelOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={item.value}
                  type={
                    item.operator === 'greater_than' || item.operator === 'less_than'
                      ? 'number'
                      : 'text'
                  }
                  onChange={(e) =>
                    onItemsChange(updateItem(items, index, { value: e.target.value }))
                  }
                  style={inputStyle}
                />
              )
            ) : (
              <div />
            )}
            <button
              onClick={() => {
                if (items.length <= 1) return
                onItemsChange(items.filter((_, i) => i !== index))
              }}
              disabled={items.length <= 1}
              style={{
                ...smallButtonStyle,
                color: items.length <= 1 ? '#475569' : '#ef4444',
                cursor: items.length <= 1 ? 'default' : 'pointer'
              }}
            >
              删
            </button>
          </div>
        )
      })}
      <button
        onClick={() => onItemsChange([...items, { variable: '', operator: 'equals', value: '' }])}
        style={{ ...ghostButtonStyle, marginTop: 8 }}
      >
        + 添加条件
      </button>
    </div>
  )
}
