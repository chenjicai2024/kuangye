import { forwardRef, useImperativeHandle, useState } from 'react'
import type { FlowNode, Region, StepParams, WindowAnchor } from '../../../../../core/action-chain/types'
import { Section } from '../Section'
import { RegionSelector } from '../RegionSelector'
import { inputStyle, labelStyle } from '../../styles'
import { displayStepToIndex } from '../shared'
import type { StepFormHandle, StepFormProps } from './SimpleForms'

// DragForm
interface DragFormProps extends StepFormProps {
  regions: Region[]
  regionNames: string[]
  onEditRegion?: (
    name: string,
    rect: { x: number; y: number; width: number; height: number }
  ) => Promise<string | null>
}

export const DragForm = forwardRef<StepFormHandle, DragFormProps>(function DragForm(
  { markDirty, params, regions, regionNames, onEditRegion },
  ref
) {
  const [dragEndRegion, setDragEndRegion] = useState(params?.dragEndRegion ?? '')

  useImperativeHandle(ref, () => ({
    collectParams: () => ({ dragEndRegion: dragEndRegion || undefined })
  }))

  return (
    <Section title="拖动终点">
      <RegionSelector
        value={dragEndRegion}
        onChange={(v) => {
          setDragEndRegion(v)
          markDirty()
        }}
        regions={regions}
        regionNames={regionNames}
        onEditRegion={onEditRegion}
        label="终点区域"
      />
    </Section>
  )
})

// CallChainForm
interface CallChainFormProps extends StepFormProps {
  chainNames: string[]
}

export const CallChainForm = forwardRef<StepFormHandle, CallChainFormProps>(function CallChainForm(
  { markDirty, params, chainNames },
  ref
) {
  const [callChainName, setCallChainName] = useState(params?.callChainName ?? '')

  useImperativeHandle(ref, () => ({ collectParams: () => ({ callChainName }) }))

  return (
    <Section title="调用动作链">
      <select
        value={callChainName}
        onChange={(e) => {
          setCallChainName(e.target.value)
          markDirty()
        }}
        style={inputStyle}
      >
        <option value="">选择动作链</option>
        {chainNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </Section>
  )
})

// JumpToForm
interface JumpToFormProps extends StepFormProps {
  nodes: FlowNode[]
  currentNodeId: string
}

export const JumpToForm = forwardRef<StepFormHandle, JumpToFormProps>(function JumpToForm(
  { markDirty, params, nodes, currentNodeId },
  ref
) {
  const [jumpToNodeId, setJumpToNodeId] = useState(params?.jumpToNodeId ?? '')
  const [jumpToStep, setJumpToStep] = useState(
    params?.jumpToStep !== undefined ? String(params.jumpToStep + 1) : ''
  )

  useImperativeHandle(ref, () => ({
    collectParams: () => {
      const params: Partial<StepParams> = {}
      const legacyIndex = displayStepToIndex(jumpToStep)
      if (legacyIndex !== undefined) params.jumpToStep = legacyIndex
      if (jumpToNodeId) params.jumpToNodeId = jumpToNodeId
      return params
    }
  }))

  return (
    <Section title="跳转">
      <div style={labelStyle}>目标节点</div>
      <select
        value={jumpToNodeId}
        onChange={(e) => {
          setJumpToNodeId(e.target.value)
          markDirty()
        }}
        style={inputStyle}
      >
        <option value="">按旧步骤编号跳转</option>
        {nodes
          .filter((item) => item.id !== currentNodeId)
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.data.type} · {item.label ?? item.id}
            </option>
          ))}
      </select>
      <div style={{ ...labelStyle, marginTop: 10 }}>旧步骤编号</div>
      <input
        value={jumpToStep}
        onChange={(e) => {
          setJumpToStep(e.target.value)
          markDirty()
        }}
        inputMode="numeric"
        style={inputStyle}
      />
    </Section>
  )
})

// ParallelProcessForm
export const ParallelProcessForm = forwardRef<StepFormHandle, StepFormProps>(
  function ParallelProcessForm({ markDirty, params }, ref) {
    const [parallelMode, setParallelMode] = useState<'race' | 'gather'>(
      params?.parallelMode ?? 'gather'
    )
    const [parallelTimeoutMs, setParallelTimeoutMs] = useState(
      String(params?.parallelTimeoutMs ?? '')
    )

    useImperativeHandle(ref, () => ({
      collectParams: () => {
        const params: Partial<StepParams> = { parallelMode }
        if (parallelTimeoutMs) {
          const ms = parseInt(parallelTimeoutMs, 10)
          if (Number.isFinite(ms) && ms > 0) params.parallelTimeoutMs = ms
        }
        return params
      }
    }))

    return (
      <Section title="并行处理">
        <div style={labelStyle}>处理模式</div>
        <select
          value={parallelMode}
          onChange={(e) => {
            setParallelMode(e.target.value as 'race' | 'gather')
            markDirty()
          }}
          style={inputStyle}
        >
          <option value="gather">采集模式（等待全部完成）</option>
          <option value="race">竞争模式（第一个到达即继续）</option>
        </select>
        <div style={{ ...labelStyle, marginTop: 10 }}>超时时间（毫秒，留空=不限）</div>
        <input
          value={parallelTimeoutMs}
          onChange={(e) => {
            setParallelTimeoutMs(e.target.value)
            markDirty()
          }}
          inputMode="numeric"
          style={inputStyle}
          placeholder="例如：30000"
        />
        {parallelMode === 'race' && (
          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              background: 'rgba(56,189,248,0.08)',
              border: '1px solid rgba(56,189,248,0.2)',
              borderRadius: 6,
              fontSize: 11,
              color: '#7dd3fc',
              lineHeight: 1.6
            }}
          >
            竞争模式下，先到达的分支会记录到变量：
            <br />
            <b>parallel_winner</b>：分支索引（0、1、2...）
            <br />
            <b>parallel_winner_label</b>：分支起始节点名称
            <br />
            后续可用条件判断：parallel_winner 等于 0
          </div>
        )}
      </Section>
    )
  }
)

// TriggerForm
interface TriggerFormProps extends StepFormProps {
  nodes: FlowNode[]
  currentNodeId: string
}

export const TriggerForm = forwardRef<StepFormHandle, TriggerFormProps>(function TriggerForm(
  { markDirty, params, nodes, currentNodeId },
  ref
) {
  const [triggerMode, setTriggerMode] = useState<'start' | 'stop'>(params?.triggerMode ?? 'start')
  const [triggerTargetNodeId, setTriggerTargetNodeId] = useState(
    params?.triggerTargetNodeId ?? ''
  )

  useImperativeHandle(ref, () => ({
    collectParams: () => {
      const params: Partial<StepParams> = { triggerMode }
      if (triggerTargetNodeId) params.triggerTargetNodeId = triggerTargetNodeId
      return params
    }
  }))

  return (
    <Section title="触发节点">
      <div style={labelStyle}>触发模式</div>
      <select
        value={triggerMode}
        onChange={(e) => {
          setTriggerMode(e.target.value as 'start' | 'stop')
          markDirty()
        }}
        style={inputStyle}
      >
        <option value="start">启动（让目标节点重新执行）</option>
        <option value="stop">停止（中断目标节点的执行）</option>
      </select>
      <div style={{ ...labelStyle, marginTop: 10 }}>目标节点</div>
      <select
        value={triggerTargetNodeId}
        onChange={(e) => {
          setTriggerTargetNodeId(e.target.value)
          markDirty()
        }}
        style={inputStyle}
      >
        <option value="">请选择目标节点</option>
        {nodes
          .filter((item) => item.id !== currentNodeId)
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.data.type} · {item.label ?? item.id}
            </option>
          ))}
      </select>
    </Section>
  )
})

// WindowAnchorForm (refresh + relocate)
interface WindowAnchorFormProps extends StepFormProps {
  windowAnchors: WindowAnchor[]
  isRelocate: boolean
}

export const WindowAnchorForm = forwardRef<StepFormHandle, WindowAnchorFormProps>(
  function WindowAnchorForm({ markDirty, params, windowAnchors, isRelocate }, ref) {
    const [target, setTarget] = useState(
      params?.refreshAllWindowAnchors ? '__all__' : (params?.windowAnchorId ?? '')
    )

    useImperativeHandle(ref, () => ({
      collectParams: () => ({
        refreshAllWindowAnchors: target === '__all__',
        windowAnchorId: target && target !== '__all__' ? target : undefined
      })
    }))

    return (
      <Section title={isRelocate ? '重新定位窗口' : '窗口校准'}>
        <div style={labelStyle}>{isRelocate ? '要重新定位的窗口锚点' : '要校准的窗口锚点'}</div>
        <select
          value={target}
          onChange={(event) => {
            setTarget(event.target.value)
            markDirty()
          }}
          style={inputStyle}
        >
          {windowAnchors.length === 0 && <option value="">尚未捕获窗口</option>}
          {windowAnchors.map((anchor) => (
            <option key={anchor.id} value={anchor.id}>
              {anchor.name} · {anchor.ownerName || anchor.title}
            </option>
          ))}
          {windowAnchors.length > 1 && <option value="__all__">全部窗口锚点</option>}
        </select>
        <div style={{ color: '#737b8c', fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
          {isRelocate
            ? '只重新读取窗口当前的位置和尺寸，并更新后续相对区域坐标。不会恢复窗口大小，也不会执行鼠标校准，适合放在循环执行的队列中。'
            : '将窗口恢复为捕获时保存的尺寸，并重新读取宽高进行确认。校准成功后，后续相对区域会使用更新后的窗口坐标；如果尺寸无法恢复，节点会停止并报告错误。'}
        </div>
      </Section>
    )
  }
)
