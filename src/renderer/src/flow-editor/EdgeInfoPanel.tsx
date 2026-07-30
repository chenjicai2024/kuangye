import React from 'react'
import type { FlowEdge, FlowNode } from '../../../core/action-chain/types'
import { STEP_TYPE_LABELS } from '../../../core/action-chain/types'
import { inputStyle } from './styles'
import { FLOW_PORT_LABELS } from './flow-utils'

export interface EdgeInfoPanelProps {
  selectedEdge: FlowEdge
  selectedEdgeSource: FlowNode
  selectedEdgeTarget: FlowNode
  selectedRandomBranchIndex: number
  selectedRandomBranchTotalWeight: number
  selectedRandomBranchWeight: number
  onUpdateBranch: (sourceHandle: 'true' | 'false' | 'start' | 'stop') => void
  onUpdateProbabilityWeight: (value: string) => void
  onClose: () => void
  onDelete: () => void
}

export function EdgeInfoPanel({
  selectedEdge,
  selectedEdgeSource,
  selectedEdgeTarget,
  selectedRandomBranchIndex,
  selectedRandomBranchTotalWeight,
  selectedRandomBranchWeight,
  onUpdateBranch,
  onUpdateProbabilityWeight,
  onClose,
  onDelete
}: EdgeInfoPanelProps): React.ReactElement {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10
        }}
      >
        <div style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>连线</div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 5,
            color: '#9ca3af',
            padding: '3px 8px',
            fontSize: 10,
            cursor: 'pointer'
          }}
        >
          取消
        </button>
      </div>
      <div style={{ color: '#8b93a3', fontSize: 11, marginBottom: 8 }}>
        {selectedEdgeSource.data.type === 'random_branch'
          ? `随机路线 ${selectedRandomBranchIndex + 1}`
          : selectedEdge.sourceHandle === 'true'
            ? '条件分支（true）'
            : selectedEdge.sourceHandle === 'false'
              ? '条件分支（false）'
              : selectedEdge.sourceHandle === 'start'
                ? '触发（启动）'
                : selectedEdge.sourceHandle === 'stop'
                  ? '触发（停止）'
                  : '普通连线'}
      </div>
      {selectedEdgeSource.data.type === 'if_else' && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: '#8b93a3', fontSize: 10, marginBottom: 5 }}>条件分支</div>
          <select
            value={selectedEdge.sourceHandle ?? 'true'}
            onChange={(event) =>
              onUpdateBranch(event.target.value as 'true' | 'false')
            }
            style={{ ...inputStyle, width: '100%' }}
          >
            <option value="true">true 分支</option>
            <option value="false">false 分支</option>
          </select>
        </div>
      )}
      {selectedEdgeSource.data.type === 'trigger' && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: '#8b93a3', fontSize: 10, marginBottom: 5 }}>触发动作</div>
          <select
            value={selectedEdge.sourceHandle ?? 'start'}
            onChange={(event) =>
              onUpdateBranch(event.target.value as 'start' | 'stop')
            }
            style={{ ...inputStyle, width: '100%' }}
          >
            <option value="start">启动</option>
            <option value="stop">停止</option>
          </select>
        </div>
      )}
      {selectedEdgeSource.data.type === 'random_branch' && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: '#8b93a3', fontSize: 10, marginBottom: 5 }}>路线权重</div>
          <input
            type="number"
            min="0"
            step="1"
            value={selectedEdge.probabilityWeight ?? 1}
            onChange={(event) => onUpdateProbabilityWeight(event.target.value)}
            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ color: '#737b8c', fontSize: 10, marginTop: 6, lineHeight: 1.5 }}>
            当前实际概率：
            {selectedRandomBranchTotalWeight > 0
              ? `${((selectedRandomBranchWeight / selectedRandomBranchTotalWeight) * 100).toFixed(1)}%`
              : '0%'}
            。权重不必凑成100，系统会自动按比例换算。
          </div>
        </div>
      )}
      <div style={{ color: '#64748b', fontSize: 10, marginBottom: 8 }}>
        {FLOW_PORT_LABELS[selectedEdge.sourcePort ?? 'right']}出 ·{' '}
        {FLOW_PORT_LABELS[selectedEdge.targetPort ?? 'left']}进
      </div>
      <div
        style={{
          padding: 10,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          marginBottom: 10
        }}
      >
        <div style={{ color: '#8b93a3', fontSize: 10, marginBottom: 4 }}>从</div>
        <div style={{ color: '#e5e7eb', fontSize: 12, fontWeight: 600 }}>
          {selectedEdgeSource.label ??
            selectedEdgeSource.data.region ??
            STEP_TYPE_LABELS[selectedEdgeSource.data.type]}
        </div>
        <div style={{ color: '#8b93a3', fontSize: 10, margin: '6px 0 4px' }}>到</div>
        <div style={{ color: '#e5e7eb', fontSize: 12, fontWeight: 600 }}>
          {selectedEdgeTarget.label ??
            selectedEdgeTarget.data.region ??
            STEP_TYPE_LABELS[selectedEdgeTarget.data.type]}
        </div>
      </div>
      <button
        onClick={onDelete}
        style={{
          width: '100%',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.26)',
          borderRadius: 6,
          color: '#ef4444',
          padding: '8px 10px',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer'
        }}
      >
        删除连线
      </button>
    </div>
  )
}
