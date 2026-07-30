import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef
} from 'react'
import React from 'react'
import type {
  ActionStep,
  FlowEdge,
  FlowNode,
  Region,
  SingleCondition,
  StepParams,
  Variable,
  WindowAnchor
} from '../../../core/action-chain/types'
import { STEP_TYPE_LABELS, STEP_TYPE_CATEGORIES } from '../../../core/action-chain/types'
import { stepHasPrimaryRegionEditor } from '../../../core/action-chain/editor-capabilities'
import { buildCondition } from './condition-utils'
import {
  smallButtonStyle,
  primaryButtonStyle,
  dangerButtonStyle
} from './styles'
import { Section } from './inspector/Section'
import { RegionSelector } from './inspector/RegionSelector'
import { ConditionSection } from './inspector/ConditionSection'
import { ErrorRetrySection } from './inspector/ErrorRetrySection'
import {
  stepIndexToDisplay,
  displayStepToIndex,
  conditionItemsFrom,
  type SaveStatus
} from './inspector/shared'
import {
  ScreenshotToAiForm,
  ExecuteAiActionsForm,
  TypeTextForm,
  AdjustUiLayoutForm,
  LocateUiRegionForm,
  AiLocateUiRegionForm,
  SIMPLE_FORM_REGISTRY,
  type StepFormHandle
} from './inspector/forms'
import {
  ExtractChatDetailsForm,
  RecordChatHistoryForm,
  GenerateChatReplyForm
} from './inspector/forms/ChatForms'

export interface StepInspectorHandle {
  save: () => Promise<boolean>
}

interface StepInspectorProps {
  node: FlowNode
  nodes: FlowNode[]
  edges: FlowEdge[]
  regions: Region[]
  regionNames: string[]
  availableVariables: Variable[]
  chainNames: string[]
  windowAnchors: WindowAnchor[]
  onSave: (step: ActionStep) => Promise<boolean>
  onDelete: () => void
  onClose: () => void
  onEditRegion?: (
    name: string,
    rect: { x: number; y: number; width: number; height: number }
  ) => Promise<string | null>
}

function StepInspectorContent(
  {
    node,
    nodes,
    edges,
    regions,
    regionNames,
    availableVariables,
    chainNames,
    windowAnchors,
    onSave,
    onDelete,
    onClose,
    onEditRegion
  }: StepInspectorProps,
  ref: ForwardedRef<StepInspectorHandle>
): React.ReactElement {
  const step = node.data
  const formRef = useRef<StepFormHandle>(null)

  const initialCondition = conditionItemsFrom(step.condition)
  const [region, setRegion] = useState(step.region ?? '')
  const [onError, setOnError] = useState<NonNullable<ActionStep['onError']>>(
    step.onError ?? 'continue'
  )
  const [errorJumpStep, setErrorJumpStep] = useState(stepIndexToDisplay(step.errorJumpStep))
  const [timeoutMs, setTimeoutMs] = useState(String(step.timeoutMs ?? ''))
  const [retryCount, setRetryCount] = useState(String(step.retryCount ?? ''))
  const [retryDelayMs, setRetryDelayMs] = useState(String(step.retryDelayMs ?? '1000'))
  const [maxFailures, setMaxFailures] = useState(String(step.maxFailures ?? ''))
  const [conditionEnabled, setConditionEnabled] = useState(
    step.type === 'if_else' || initialCondition.enabled
  )
  const [conditionLogic, setConditionLogic] = useState<'and' | 'or'>(initialCondition.logic)
  const [conditionItems, setConditionItems] = useState<SingleCondition[]>(initialCondition.items)
  const [chatIncludeScreenshot, setChatIncludeScreenshot] = useState(
    step.params?.chatIncludeScreenshot === true
  )

  // 竞争模式的分支选项：找到链中所有竞争模式的并行处理节点，
  // 追溯到对应的并行节点，收集分支索引和标签
  const parallelWinnerOptions = useMemo(() => {
    const indexOptions: Array<{ value: string; label: string }> = []
    const labelOptions: Array<{ value: string; label: string }> = []
    const parallelProcessNodes = nodes.filter(
      (n) => n.data.type === 'parallel_process' && n.data.params?.parallelMode === 'race'
    )
    for (const ppNode of parallelProcessNodes) {
      for (const pNode of nodes) {
        if (pNode.data.type !== 'parallel') continue
        const outEdges = edges.filter((e) => e.source === pNode.id)
        if (outEdges.length === 0) continue
        const reachesPP = (nodeId: string, visited = new Set<string>()): boolean => {
          if (nodeId === ppNode.id) return true
          if (visited.has(nodeId)) return false
          visited.add(nodeId)
          return edges.filter((e) => e.source === nodeId).some((e) => reachesPP(e.target, visited))
        }
        if (!reachesPP(pNode.id)) continue
        outEdges.forEach((edge, i) => {
          const targetNode = nodes.find((n) => n.id === edge.target)
          const stepType = targetNode?.data.type
          const typeLabel = stepType ? (STEP_TYPE_LABELS[stepType] ?? stepType) : ''
          const nodeLabel = targetNode?.label ?? typeLabel
          // 当多个分支有相同节点标签时，加上类型标签区分
          const hasDuplicateLabel = outEdges.some(
            (e, j) =>
              j !== i &&
              (nodes.find((n) => n.id === e.target)?.label ?? '') === (targetNode?.label ?? '')
          )
          const displayLabel =
            hasDuplicateLabel && typeLabel ? `${typeLabel}(${nodeLabel})` : nodeLabel
          indexOptions.push({ value: String(i), label: `${i} · ${displayLabel}` })
          labelOptions.push({ value: displayLabel, label: `${i} · ${displayLabel}` })
        })
      }
    }
    return { indexOptions, labelOptions }
  }, [nodes, edges])
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  async function handleSave(): Promise<boolean> {
    const params: StepParams = {}
    if (step.type === 'right_click') params.clickPolicy = 'single'
    // 所有挂载的表单（简单表单 + 复杂表单 + 聊天表单）通过 formRef 收集参数
    const formParams = formRef.current?.collectParams()
    if (formParams) Object.assign(params, formParams)

    const timeout = Number(timeoutMs)
    const retries = Number(retryCount)
    const retryDelay = Number(retryDelayMs)
    const maxFailureCount = Number(maxFailures)

    const saved = await onSave({
      ...step,
      region: region || undefined,
      params: Object.keys(params).length > 0 ? params : undefined,
      condition: buildCondition(
        step.type === 'if_else' || conditionEnabled,
        conditionLogic,
        conditionItems,
        availableVariables
      ),
      onError,
      errorJumpStep: onError === 'jump' ? displayStepToIndex(errorJumpStep) : undefined,
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
      retryCount: Number.isFinite(retries) && retries > 0 ? retries : undefined,
      retryDelayMs: Number.isFinite(retryDelay) && retryDelay > 0 ? retryDelay : undefined,
      maxFailures:
        Number.isFinite(maxFailureCount) && maxFailureCount > 0 ? maxFailureCount : undefined
    })

    setSaveStatus(saved ? 'saved' : 'error')
    if (saved) {
      window.setTimeout(() => setSaveStatus('idle'), 2000)
    }
    return saved
  }

  useImperativeHandle(ref, () => ({ save: handleSave }))

  const needsRegion =
    stepHasPrimaryRegionEditor(step.type) ||
    (step.type === 'generate_chat_reply' && chatIncludeScreenshot)

  return (
    <aside
      data-flow-editor-interactive
      role="dialog"
      aria-label="节点属性"
      onKeyDown={(event) => event.stopPropagation()}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        background: '#11131a',
        padding: 14
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <div>
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>节点属性</div>
          <div style={{ color: '#737b8c', fontSize: 11, marginTop: 2 }}>{node.id}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onDelete}
            style={{ ...dangerButtonStyle, padding: '5px 10px', fontSize: 11 }}
          >
            删除
          </button>
          <button onClick={onClose} style={{ ...smallButtonStyle, color: '#9ca3af' }}>
            关闭
          </button>
        </div>
      </div>

      <Section title={STEP_TYPE_CATEGORIES.find((cat) => cat.types.includes(step.type))?.label ?? '节点'}>
        {needsRegion && (
          <RegionSelector
            value={region}
            onChange={setRegion}
            regions={regions}
            regionNames={regionNames}
            onEditRegion={onEditRegion}
            label={step.type === 'random_mouse' ? '鼠标活动区域' : '目标区域'}
          />
        )}
      </Section>

      {step.type === 'screenshot_to_ai' && (
        <ScreenshotToAiForm
          key={node.id}
          ref={formRef}
          markDirty={() => setSaveStatus('idle')}
          params={step.params}
        />
      )}

      {step.type === 'extract_chat_details' && (
        <ExtractChatDetailsForm
          key={node.id}
          ref={formRef}
          markDirty={() => setSaveStatus('idle')}
          params={step.params}
        />
      )}

      {step.type === 'record_chat_history' && (
        <RecordChatHistoryForm
          key={node.id}
          ref={formRef}
          markDirty={() => setSaveStatus('idle')}
          params={step.params}
        />
      )}

      {step.type === 'generate_chat_reply' && (
        <GenerateChatReplyForm
          key={node.id}
          ref={formRef}
          markDirty={() => setSaveStatus('idle')}
          params={step.params}
          chatIncludeScreenshot={chatIncludeScreenshot}
          onChatIncludeScreenshotChange={setChatIncludeScreenshot}
        />
      )}

      {step.type === 'execute_ai_actions' && (
        <ExecuteAiActionsForm
          key={node.id}
          ref={formRef}
          markDirty={() => setSaveStatus('idle')}
          params={step.params}
          region={region}
          setRegion={setRegion}
          regions={regions}
          regionNames={regionNames}
          onEditRegion={onEditRegion}
        />
      )}

      {step.type === 'type_text' && (
        <TypeTextForm
          key={node.id}
          ref={formRef}
          markDirty={() => setSaveStatus('idle')}
          params={step.params}
          availableVariables={availableVariables}
        />
      )}

      {(() => {
        const FormComponent = SIMPLE_FORM_REGISTRY[step.type]
        if (!FormComponent) return null
        const extraProps: Record<string, unknown> = {}
        if (step.type === 'hotkey' || step.type === 'key_press')
          extraProps.isHotkey = step.type === 'hotkey'
        if (step.type === 'drag') {
          extraProps.regions = regions
          extraProps.regionNames = regionNames
          extraProps.onEditRegion = onEditRegion
        }
        if (step.type === 'call_chain') extraProps.chainNames = chainNames
        if (step.type === 'jump_to' || step.type === 'trigger') {
          extraProps.nodes = nodes
          extraProps.currentNodeId = node.id
        }
        if (step.type === 'refresh_window_anchor' || step.type === 'relocate_window_anchor') {
          extraProps.windowAnchors = windowAnchors
          extraProps.isRelocate = step.type === 'relocate_window_anchor'
        }
        return (
          <FormComponent
            key={node.id}
            ref={formRef}
            markDirty={() => setSaveStatus('idle')}
            params={step.params}
            {...extraProps}
          />
        )
      })()}

      {step.type === 'adjust_ui_layout' && (
        <AdjustUiLayoutForm
          key={node.id}
          ref={formRef}
          markDirty={() => setSaveStatus('idle')}
          params={step.params}
          windowAnchors={windowAnchors}
        />
      )}

      {step.type === 'locate_ui_region' && (
        <LocateUiRegionForm
          key={node.id}
          ref={formRef}
          markDirty={() => setSaveStatus('idle')}
          params={step.params}
          region={region}
          regions={regions}
          regionNames={regionNames}
          windowAnchors={windowAnchors}
          onEditRegion={onEditRegion}
        />
      )}

      {step.type === 'ai_locate_ui_region' && (
        <AiLocateUiRegionForm
          key={node.id}
          ref={formRef}
          markDirty={() => setSaveStatus('idle')}
          params={step.params}
          region={region}
          regions={regions}
          regionNames={regionNames}
          windowAnchors={windowAnchors}
        />
      )}

      <ConditionSection
        stepType={step.type}
        conditionEnabled={conditionEnabled}
        conditionLogic={conditionLogic}
        conditionItems={conditionItems}
        availableVariables={availableVariables}
        parallelWinnerOptions={parallelWinnerOptions.indexOptions}
        parallelWinnerLabelOptions={parallelWinnerOptions.labelOptions}
        onConditionEnabledChange={setConditionEnabled}
        onLogicChange={setConditionLogic}
        onItemsChange={setConditionItems}
      />

      <ErrorRetrySection
        onError={onError}
        errorJumpStep={errorJumpStep}
        timeoutMs={timeoutMs}
        retryCount={retryCount}
        retryDelayMs={retryDelayMs}
        maxFailures={maxFailures}
        onErrorChange={setOnError}
        onErrorJumpStepChange={setErrorJumpStep}
        setTimeoutMs={setTimeoutMs}
        setRetryCount={setRetryCount}
        setRetryDelayMs={setRetryDelayMs}
        setMaxFailures={setMaxFailures}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <button
          disabled={saveStatus === 'saving'}
          aria-busy={saveStatus === 'saving'}
          onClick={() => {
            setSaveStatus('saving')
            void handleSave().catch((error: unknown) => {
              console.error('保存节点失败:', error)
              setSaveStatus('error')
            })
          }}
          style={{
            ...primaryButtonStyle,
            background:
              saveStatus === 'saved' ? '#059669' : saveStatus === 'error' ? '#dc2626' : '#10b981',
            cursor: saveStatus === 'saving' ? 'wait' : 'pointer',
            opacity: saveStatus === 'saving' ? 0.72 : 1
          }}
        >
          {saveStatus === 'saving'
            ? '正在保存…'
            : saveStatus === 'saved'
              ? '已保存'
              : saveStatus === 'error'
                ? '保存失败，点击重试'
                : '保存节点'}
        </button>
        {saveStatus === 'error' && (
          <span role="alert" style={{ color: '#fca5a5', fontSize: 11 }}>
            没有写入磁盘，请重试
          </span>
        )}
      </div>
    </aside>
  )
}

export const StepInspector = forwardRef<StepInspectorHandle, StepInspectorProps>(
  StepInspectorContent
)
