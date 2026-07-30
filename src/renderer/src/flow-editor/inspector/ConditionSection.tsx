import type React from 'react'
import type { SingleCondition, StepType, Variable } from '../../../../core/action-chain/types'
import { Section } from './Section'
import { ConditionEditor } from './ConditionEditor'

interface ConditionSectionProps {
  stepType: StepType
  conditionEnabled: boolean
  conditionLogic: 'and' | 'or'
  conditionItems: SingleCondition[]
  availableVariables: Variable[]
  parallelWinnerOptions: Array<{ value: string; label: string }>
  parallelWinnerLabelOptions: Array<{ value: string; label: string }>
  onConditionEnabledChange: (enabled: boolean) => void
  onLogicChange: (logic: 'and' | 'or') => void
  onItemsChange: (items: SingleCondition[]) => void
}

export function ConditionSection({
  stepType,
  conditionEnabled,
  conditionLogic,
  conditionItems,
  availableVariables,
  parallelWinnerOptions,
  parallelWinnerLabelOptions,
  onConditionEnabledChange,
  onLogicChange,
  onItemsChange
}: ConditionSectionProps): React.ReactElement {
  const isIfElse = stepType === 'if_else'

  return (
    <Section title={isIfElse ? '判断条件' : '执行条件'}>
      {!isIfElse && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#b6bdca',
            fontSize: 12
          }}
        >
          <input
            type="checkbox"
            checked={conditionEnabled}
            onChange={(e) => onConditionEnabledChange(e.target.checked)}
          />
          启用条件
        </label>
      )}
      {(conditionEnabled || isIfElse) && (
        <ConditionEditor
          logic={conditionLogic}
          items={conditionItems}
          variables={availableVariables}
          parallelWinnerOptions={parallelWinnerOptions}
          parallelWinnerLabelOptions={parallelWinnerLabelOptions}
          onLogicChange={onLogicChange}
          onItemsChange={onItemsChange}
        />
      )}
    </Section>
  )
}
