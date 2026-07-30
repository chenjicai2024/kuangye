import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import React from 'react'
import './flow-editor.css'
import { StepInspector, type StepInspectorHandle } from './StepInspector'
import type {
  ActionChain,
  ActionStep,
  EngineState,
  ExecutionChain,
  FlowNode,
  FlowPortSide,
  Project,
  Region,
  StepType,
  TriggerType,
  Workspace
} from '../../../core/action-chain/types'
import type { ChatConversation, ChatHistorySummary } from '../../../core/chat-history/types'
import { formatChatMessage } from '../../../core/chat-history/context'
import { STEP_TYPE_LABELS } from '../../../core/action-chain/types'
import { closestPortSide, edgePath, nodePortPoint, targetSideFacingPoint } from './flow-geometry'
import { SerialTaskQueue } from './serial-task-queue'
import { useUndoRedo } from './undo-redo'
import { ProjectLibrary } from './ProjectLibrary'
import { normalizedBranchWeight } from '../../../core/action-chain/random-branch'
import { AgentAssistantPanel } from './AgentAssistantPanel'
import { simulateAgentEditProposal } from '../../../core/agent-assistant/proposal'
import type {
  AgentAssistantPermissions,
  AgentAssistantSendPayload,
  AgentContextSnapshot,
  AgentEditProposal,
  AgentProposalSimulation
} from '../../../core/agent-assistant/types'
import {
  inputStyle,
  sidebarButtonStyle,
  tabButtonStyle,
  smallAccentButtonStyle,
  emptyTextStyle,
  runButtonStyle,
  stopButtonStyle
} from './styles'
import {
  TRIGGER_LABELS,
  EXECUTION_TRIGGER_TYPES,
  VISIBLE_NODE_WIDTH,
  FLOW_PORT_SIDES,
  FLOW_PORT_LABELS,
  type VisibleSourceHandle,
  type KeyboardActions,
  genId,
  defaultWorkspace,
  chainKindLabel,
  chainKindHint,
  edgeColor,
  visibleNodeHeight,
  flowPortPosition,
  isInteractiveTarget,
  collectVariables
} from './flow-utils'
import { StepPalette } from './StepPalette'
import { LogPanel } from './LogPanel'
import { EdgeInfoPanel } from './EdgeInfoPanel'

export function FlowEditor({
  initialProjectId,
  showProjectLibrary,
  onBack
}: {
  initialProjectId?: string | null
  showProjectLibrary?: boolean
  onBack: () => void
}): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([])
  const [screen, setScreen] = useState<'library' | 'editor'>(
    showProjectLibrary ? 'library' : 'editor'
  )
  const [currentProjectId, setCurrentProjectId] = useState('')
  const [currentProjectName, setCurrentProjectName] = useState('')
  const [workspace, setWorkspace] = useState<Workspace>(defaultWorkspace)
  const [tab, setTab] = useState<'executionChains' | 'chains'>('executionChains')
  const [selectedChainIdx, setSelectedChainIdx] = useState(0)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [clipboard, setClipboard] = useState<FlowNode[]>([])
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [engineState, setEngineState] = useState<EngineState | null>(null)
  const [runtimeLogs, setRuntimeLogs] = useState<string[]>([])
  const [logPanelHeight, setLogPanelHeight] = useState(72)
  const [logPanelExpanded, setLogPanelExpanded] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantFrame, setAssistantFrame] = useState({
    x: 20,
    y: 72,
    width: 420,
    height: 520
  })
  const [logCopyStatus, setLogCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const [assistantPreview, setAssistantPreview] = useState<{
    proposal: AgentEditProposal
    simulation: AgentProposalSimulation
  } | null>(null)
  const [isApplyingAssistantProposal, setIsApplyingAssistantProposal] = useState(false)
  const [chatConversations, setChatConversations] = useState<ChatHistorySummary[]>([])
  const [selectedChatConversation, setSelectedChatConversation] = useState<ChatConversation | null>(
    null
  )
  const [renamingRegionName, setRenamingRegionName] = useState<string | null>(null)
  const [regionRenameValue, setRegionRenameValue] = useState('')
  const [regionRenameError, setRegionRenameError] = useState('')
  const [renamingWindowAnchorId, setRenamingWindowAnchorId] = useState<string | null>(null)
  const [windowAnchorRenameValue, setWindowAnchorRenameValue] = useState('')
  const [windowAnchorRenameError, setWindowAnchorRenameError] = useState('')
  const [renamingChainIndex, setRenamingChainIndex] = useState<number | null>(null)
  const [chainRenameValue, setChainRenameValue] = useState('')
  const [chainRenameError, setChainRenameError] = useState('')
  const [creatingChain, setCreatingChain] = useState(false)
  const [newChainName, setNewChainName] = useState('')
  const [newChainError, setNewChainError] = useState('')
  const [chainDescriptionDraft, setChainDescriptionDraft] = useState('')
  const regionRenameInputRef = useRef<HTMLInputElement>(null)
  const windowAnchorRenameInputRef = useRef<HTMLInputElement>(null)
  const chainRenameInputRef = useRef<HTMLInputElement>(null)
  const mainColumnRef = useRef<HTMLElement>(null)
  const assistantWindowRef = useRef<HTMLDivElement>(null)
  const logBodyRef = useRef<HTMLDivElement>(null)
  const logCopyResetTimerRef = useRef<number | null>(null)
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [dragPreview, setDragPreview] = useState<{
    nodeId: string
    x: number
    y: number
  } | null>(null)
  const { pushSnapshot, undo, redo } = useUndoRedo()
  const [isPanning, setIsPanning] = useState(false)
  const [conditionBranchByNode, setConditionBranchByNode] = useState<
    Record<string, 'true' | 'false' | 'start' | 'stop' | 'continue' | 'exit'>
  >({})
  const [edgePreview, setEdgePreview] = useState<{
    fromX: number
    fromY: number
    toX: number
    toY: number
    sourceHandle?: 'true' | 'false' | 'start' | 'stop' | 'continue' | 'exit'
    sourcePort: FlowPortSide
    targetPort: FlowPortSide
  } | null>(null)
  const canvasSurfaceRef = useRef<HTMLDivElement>(null)
  const stepInspectorRef = useRef<StepInspectorHandle>(null)
  const workspaceRef = useRef(workspace)
  const workspaceRevisionRef = useRef(0)
  const isApplyingAssistantProposalRef = useRef(false)
  const screenRef = useRef(screen)
  const workspaceSaveQueue = useMemo(() => new SerialTaskQueue(), [])
  const edgeDragRef = useRef<{
    sourceId: string
    sourceHandle?: 'true' | 'false' | 'start' | 'stop' | 'continue' | 'exit'
    sourcePort: FlowPortSide
    fromX: number
    fromY: number
  } | null>(null)
  const dragStateRef = useRef<{
    nodeId: string
    startClientX: number
    startClientY: number
    startX: number
    startY: number
    finalX: number
    finalY: number
    moved: boolean
  } | null>(null)
  const dragAnimationFrameRef = useRef<number | null>(null)
  // 标记"刚结束一次节点拖动或连线"，用于抑制随后的 click 事件。
  // 节点拖动：浏览器在小幅度拖动后仍会触发 click，调 onClick 会误开属性面板。
  // 连线：释放后 click 从 + 按钮冒泡到源节点，也会误开属性面板。
  // 在两个 drag handler 的 onUp 里设为 true，下一次 pointerdown 重置为 false。
  const suppressClickRef = useRef(false)

  async function refreshChatHistory(): Promise<void> {
    if (!currentProjectId) return
    const list = await window.electron?.invoke<ChatHistorySummary[]>(
      'chat-history:listConversations',
      currentProjectId
    )
    setChatConversations(list ?? [])
    if (selectedChatConversation) {
      const current = await window.electron?.invoke<ChatConversation | null>(
        'chat-history:getConversation',
        { projectId: currentProjectId, id: selectedChatConversation.id }
      )
      setSelectedChatConversation(current ?? null)
    }
  }

  async function openChatConversation(id: string): Promise<void> {
    const conversation = await window.electron?.invoke<ChatConversation | null>(
      'chat-history:getConversation',
      { projectId: currentProjectId, id }
    )
    setSelectedChatConversation(conversation ?? null)
  }

  async function clearChatConversation(id: string): Promise<void> {
    await window.electron?.invoke('chat-history:deleteConversation', {
      projectId: currentProjectId,
      id
    })
    setSelectedChatConversation(null)
    await refreshChatHistory()
  }
  const panStateRef = useRef<{
    startClientX: number
    startClientY: number
    startPanX: number
    startPanY: number
  } | null>(null)
  const activeInteractionCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      activeInteractionCleanupRef.current?.()
      if (logCopyResetTimerRef.current !== null) {
        window.clearTimeout(logCopyResetTimerRef.current)
      }
    }
  }, [])

  function cancelActiveInteraction(): void {
    activeInteractionCleanupRef.current?.()
    activeInteractionCleanupRef.current = null
    edgeDragRef.current = null
    dragStateRef.current = null
    panStateRef.current = null
    if (dragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAnimationFrameRef.current)
      dragAnimationFrameRef.current = null
    }
    setEdgePreview(null)
    setDragPreview(null)
    setIsPanning(false)
  }

  const clampAssistantFrame = useCallback(
    (frame: typeof assistantFrame): typeof assistantFrame => {
      const rect = mainColumnRef.current?.getBoundingClientRect()
      if (!rect) return frame
      const margin = 12
      const availableWidth = Math.max(280, rect.width - margin * 2)
      const availableHeight = Math.max(260, rect.height - logPanelHeight - margin * 2)
      const width = Math.min(availableWidth, Math.max(Math.min(360, availableWidth), frame.width))
      const height = Math.min(
        availableHeight,
        Math.max(Math.min(360, availableHeight), frame.height)
      )
      return {
        x: Math.min(Math.max(margin, frame.x), Math.max(margin, rect.width - width - margin)),
        y: Math.min(
          Math.max(margin, frame.y),
          Math.max(margin, rect.height - logPanelHeight - height - margin)
        ),
        width,
        height
      }
    },
    [logPanelHeight]
  )

  function openAssistantWindow(): void {
    const rect = mainColumnRef.current?.getBoundingClientRect()
    setAssistantFrame((current) => {
      const fitted = clampAssistantFrame(current)
      if (!rect) return fitted
      return {
        ...fitted,
        x: Math.max(12, rect.width - fitted.width - 16),
        y: Math.max(12, rect.height - logPanelHeight - fitted.height - 16)
      }
    })
    setAssistantOpen(true)
  }

  function startAssistantWindowDrag(event: React.PointerEvent<HTMLElement>): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select')) return
    cancelActiveInteraction()
    event.preventDefault()
    const start = { ...assistantFrame }
    const startX = event.clientX
    const startY = event.clientY
    const onMove = (moveEvent: PointerEvent): void => {
      setAssistantFrame(
        clampAssistantFrame({
          ...start,
          x: start.x + moveEvent.clientX - startX,
          y: start.y + moveEvent.clientY - startY
        })
      )
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      if (activeInteractionCleanupRef.current === cleanup)
        activeInteractionCleanupRef.current = null
    }
    const finish = (): void => cleanup()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
    activeInteractionCleanupRef.current = cleanup
  }

  function startAssistantWindowResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    cancelActiveInteraction()
    event.preventDefault()
    event.stopPropagation()
    const start = { ...assistantFrame }
    const startX = event.clientX
    const startY = event.clientY
    const onMove = (moveEvent: PointerEvent): void => {
      setAssistantFrame(
        clampAssistantFrame({
          ...start,
          width: start.width + moveEvent.clientX - startX,
          height: start.height + moveEvent.clientY - startY
        })
      )
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      if (activeInteractionCleanupRef.current === cleanup)
        activeInteractionCleanupRef.current = null
    }
    const finish = (): void => cleanup()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
    activeInteractionCleanupRef.current = cleanup
  }

  useLayoutEffect(() => {
    if (!assistantOpen) return
    setAssistantFrame((current) => clampAssistantFrame(current))
  }, [assistantOpen, clampAssistantFrame])

  useEffect(() => {
    if (!assistantOpen) return
    const fit = (): void => setAssistantFrame((current) => clampAssistantFrame(current))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [assistantOpen, clampAssistantFrame])

  const kbRef = useRef<KeyboardActions>({
    edgeId: '',
    nodeId: '',
    multiSize: 0,
    clearSelection: () => undefined,
    copySelectedNodes: () => undefined,
    pasteNodes: () => undefined,
    selectAllNodes: () => undefined,
    deleteSelectedEdge: () => undefined,
    deleteSelectedNode: () => undefined,
    undo: () => undefined,
    redo: () => undefined
  })

  const chains = useMemo(
    () =>
      tab === 'executionChains' ? (workspace.executionChains ?? []) : (workspace.chains ?? []),
    [tab, workspace.chains, workspace.executionChains]
  )
  const activeChainIdx = Math.min(selectedChainIdx, Math.max(0, chains.length - 1))
  const currentChain = chains[activeChainIdx]
  const currentChainKind = tab === 'executionChains' ? 'executionChain' : 'actionChain'
  const assistantPreviewChain = assistantPreview
    ? (currentChainKind === 'executionChain'
        ? assistantPreview.simulation.workspace.executionChains
        : assistantPreview.simulation.workspace.chains
      ).find((chain) => chain.id === currentChain?.id)
    : undefined
  const assistantPreviewAddedNodeIds = new Set(assistantPreview?.simulation.diff.addedNodeIds ?? [])
  const assistantPreviewUpdatedNodeIds = new Set(
    assistantPreview?.simulation.diff.updatedNodeIds ?? []
  )
  const assistantPreviewDeletedNodeIds = new Set(
    assistantPreview?.simulation.diff.deletedNodes.map((node) => node.id) ?? []
  )
  const assistantPreviewAddedEdgeIds = new Set(assistantPreview?.simulation.diff.addedEdgeIds ?? [])
  const assistantPreviewUpdatedEdgeIds = new Set(
    assistantPreview?.simulation.diff.updatedEdgeIds ?? []
  )
  const assistantPreviewDeletedEdgeIds = new Set(
    assistantPreview?.simulation.diff.deletedEdges.map((edge) => edge.id) ?? []
  )
  const entryNodeId = currentChain
    ? (currentChain.nodes.find(
        (node) => !(currentChain.edges ?? []).some((edge) => edge.target === node.id)
      )?.id ?? currentChain.nodes[0]?.id)
    : undefined
  const selectedNode = currentChain?.nodes.find((node) => node.id === selectedNodeId)
  const selectedEdge = selectedEdgeId
    ? currentChain?.edges.find((edge) => edge.id === selectedEdgeId)
    : undefined
  const selectedEdgeSource = selectedEdge
    ? currentChain?.nodes.find((node) => node.id === selectedEdge.source)
    : undefined
  const selectedEdgeTarget = selectedEdge
    ? currentChain?.nodes.find((node) => node.id === selectedEdge.target)
    : undefined
  const selectedRandomBranchEdges =
    selectedEdgeSource?.data.type === 'random_branch'
      ? (currentChain?.edges.filter((edge) => edge.source === selectedEdgeSource.id) ?? [])
      : []
  const selectedRandomBranchTotalWeight = selectedRandomBranchEdges.reduce(
    (sum, edge) => sum + normalizedBranchWeight(edge),
    0
  )
  const selectedRandomBranchWeight = selectedEdge ? normalizedBranchWeight(selectedEdge) : 0
  const selectedRandomBranchIndex = selectedEdge
    ? selectedRandomBranchEdges.findIndex((edge) => edge.id === selectedEdge.id)
    : -1

  const allRegions = useMemo(
    () => (workspace.views ?? []).flatMap((view) => view.regions ?? []),
    [workspace.views]
  )
  const regionNames = useMemo(() => allRegions.map((region) => region.name), [allRegions])
  const availableVariables = useMemo(() => collectVariables(currentChain), [currentChain])
  const running = engineState?.running ?? false
  const currentTargetType = tab === 'executionChains' ? 'executionChain' : 'actionChain'
  const currentIsRunning =
    running &&
    engineState?.targetChainType === currentTargetType &&
    engineState?.targetChainId === currentChain?.id

  useEffect(() => {
    workspaceRef.current = workspace
  }, [workspace])

  useEffect(() => {
    isApplyingAssistantProposalRef.current = isApplyingAssistantProposal
  }, [isApplyingAssistantProposal])

  useEffect(() => {
    screenRef.current = screen
  }, [screen])

  useEffect(() => {
    const cleanup = window.electron?.on('action-chain:editorClosed', () => {
      if (screenRef.current !== 'library') return
      void (async () => {
        const result = (await window.electron?.invoke('action-chain:listProjects')) as
          | { projects?: Project[] }
          | undefined
        setProjects(result?.projects ?? [])
      })()
    })
    return cleanup
  }, [])

  useEffect(() => {
    if (!renamingRegionName) return
    const frame = window.requestAnimationFrame(() => regionRenameInputRef.current?.select())
    return () => window.cancelAnimationFrame(frame)
  }, [renamingRegionName])

  useEffect(() => {
    if (!renamingWindowAnchorId) return
    const frame = window.requestAnimationFrame(() => windowAnchorRenameInputRef.current?.select())
    return () => window.cancelAnimationFrame(frame)
  }, [renamingWindowAnchorId])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setCanvasPan({ x: 0, y: 0 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [currentChain?.id, tab])

  useEffect(() => {
    setChainDescriptionDraft(currentChain?.description ?? '')
  }, [currentChain?.id, currentChain?.description])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = (await window.electron?.invoke('action-chain:listProjects')) as
        | { projects?: Project[]; lastSelectedProjectId?: string }
        | undefined
      const list = result?.projects ?? []
      if (cancelled) return
      setProjects(list)

      // 主界面的“编辑项目”进入项目中心；已有项目的编辑按钮仍可直接打开编辑器。
      const selectedId = showProjectLibrary
        ? null
        : (initialProjectId ?? result?.lastSelectedProjectId ?? list[0]?.id)
      if (showProjectLibrary || !selectedId) {
        const emptyWorkspace = defaultWorkspace()
        workspaceRef.current = emptyWorkspace
        setWorkspace(emptyWorkspace)
        workspaceRevisionRef.current = 0
        setWorkspaceRevision(0)
        setAssistantPreview(null)
        setCurrentProjectId('')
        setCurrentProjectName('')
        setScreen('library')
        return
      }

      await window.electron?.invoke('action-chain:selectProject', selectedId)
      const response = (await window.electron?.invoke(
        'action-chain:loadProjectWorkspace',
        selectedId
      )) as { workspace: Workspace; projectId: string; projectName: string } | undefined
      if (cancelled) return
      const loadedWorkspace = response?.workspace ?? defaultWorkspace()
      workspaceRef.current = loadedWorkspace
      setWorkspace(loadedWorkspace)
      workspaceRevisionRef.current = 0
      setWorkspaceRevision(0)
      setAssistantPreview(null)
      pushSnapshot(loadedWorkspace)
      setCurrentProjectId(response?.projectId ?? selectedId)
      setCurrentProjectName(
        response?.projectName ?? list.find((project) => project.id === selectedId)?.name ?? ''
      )
      setScreen('editor')
      setSelectedChainIdx(0)
      setSelectedNodeId(null)
    })()
    return () => {
      cancelled = true
    }
  }, [initialProjectId, showProjectLibrary, pushSnapshot])

  // 重命名框只在创建后的下一帧聚焦一次。延迟重复聚焦会抢走用户随后点击的输入框。
  useEffect(() => {
    if (renamingChainIndex === null) return
    const frame = window.requestAnimationFrame(() => chainRenameInputRef.current?.select())
    return () => window.cancelAnimationFrame(frame)
  }, [renamingChainIndex])

  useEffect(() => {
    const stateCleanup = window.electron?.on('action-chain:state', (state: unknown) => {
      setEngineState(state as EngineState)
    })
    const logCleanup = window.electron?.on('action-chain:log', (message: unknown) => {
      setRuntimeLogs((prev) => [...prev, String(message)])
    })
    const stepCleanup = window.electron?.on('action-chain:stepLog', (log: unknown) => {
      const item = log as {
        chainName?: string
        stepType?: string
        status?: string
        message?: string
      }
      setRuntimeLogs((prev) => [
        ...prev,
        `${item.chainName ?? '链'} · ${STEP_TYPE_LABELS[item.stepType as StepType] ?? item.stepType ?? '步骤'} · ${item.status ?? ''} · ${item.message ?? ''}`
      ])
    })
    return () => {
      stateCleanup?.()
      logCleanup?.()
      stepCleanup?.()
    }
  }, [])

  useEffect(() => {
    const element = logBodyRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [runtimeLogs])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (screenRef.current !== 'editor') return
      if (isApplyingAssistantProposalRef.current) return
      if (isInteractiveTarget(event.target)) return

      const k = kbRef.current
      if (event.key === 'Escape') {
        if (k.edgeId) {
          setSelectedEdgeId(null)
          return
        }
        if (k.nodeId || k.multiSize > 0) {
          k.clearSelection()
          return
        }
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault()
        k.undo()
        return
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key === 'y' || (event.key === 'z' && event.shiftKey))
      ) {
        event.preventDefault()
        k.redo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'c' && !event.shiftKey) {
        event.preventDefault()
        k.copySelectedNodes()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'v' && !event.shiftKey) {
        event.preventDefault()
        k.pasteNodes()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'a' && !event.shiftKey) {
        event.preventDefault()
        k.selectAllNodes()
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (k.edgeId) {
          event.preventDefault()
          k.deleteSelectedEdge()
          return
        }
        if (k.nodeId || k.multiSize > 0) {
          event.preventDefault()
          k.deleteSelectedNode()
          return
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  async function createProject(name: string): Promise<boolean> {
    if (!name.trim()) return false
    const result = (await window.electron?.invoke('action-chain:createProject', name.trim())) as
      | { success?: boolean; project?: Project }
      | undefined
    const createdProject = result?.project
    if (result?.success && createdProject) {
      setProjects((prev) => [
        ...prev.filter((project) => project.id !== createdProject.id),
        createdProject
      ])
      return true
    }
    return false
  }

  async function renameProject(id: string, name: string): Promise<boolean> {
    if (!name.trim()) return false
    const result = (await window.electron?.invoke('action-chain:renameProject', {
      id,
      name: name.trim()
    })) as { success?: boolean; project?: Project } | undefined
    const renamedProject = result?.project
    if (!result?.success || !renamedProject) return false
    setProjects((prev) => prev.map((project) => (project.id === id ? renamedProject : project)))
    if (currentProjectId === id) setCurrentProjectName(renamedProject.name)
    return true
  }

  async function deleteProject(id: string): Promise<boolean> {
    const result = (await window.electron?.invoke('action-chain:deleteProject', id)) as
      | { success?: boolean }
      | undefined
    if (!result?.success) return false
    if (currentProjectId === id) {
      const emptyWorkspace = defaultWorkspace()
      workspaceRef.current = emptyWorkspace
      setWorkspace(emptyWorkspace)
      workspaceRevisionRef.current = 0
      setWorkspaceRevision(0)
      setAssistantPreview(null)
      setCurrentProjectId('')
      setCurrentProjectName('')
    }
    setProjects((prev) => prev.filter((p) => p.id !== id))
    return true
  }

  async function saveWorkspace(
    nextWorkspace: Workspace,
    options: {
      recordHistory?: boolean
      commitAfterPersist?: boolean
      expectedRevision?: number
    } = {}
  ): Promise<boolean> {
    const projectId = currentProjectId
    const commitWorkspace = (): void => {
      if (workspaceRef.current !== nextWorkspace) {
        workspaceRevisionRef.current += 1
        setWorkspaceRevision(workspaceRevisionRef.current)
      }
      workspaceRef.current = nextWorkspace
      setWorkspace(nextWorkspace)
      setAssistantPreview(null)
      if (options.recordHistory !== false) pushSnapshot(nextWorkspace)
    }
    if (!options.commitAfterPersist) commitWorkspace()

    if (!projectId) {
      console.error('保存工作区失败:', 'missing projectId')
      return false
    }

    return workspaceSaveQueue.enqueue(async () => {
      if (
        options.expectedRevision !== undefined &&
        workspaceRevisionRef.current !== options.expectedRevision
      ) {
        return false
      }
      try {
        const result = (await window.electron?.invoke('action-chain:save', {
          projectId,
          workspace: nextWorkspace
        })) as { success: boolean; error?: string } | undefined
        if (result?.success !== true) {
          console.error('保存工作区失败:', result?.error || '未知错误')
          return false
        }
        if (
          options.commitAfterPersist &&
          options.expectedRevision !== undefined &&
          workspaceRevisionRef.current !== options.expectedRevision
        ) {
          await window.electron?.invoke('action-chain:save', {
            projectId,
            workspace: workspaceRef.current
          })
          return false
        }
      } catch (err) {
        console.error('保存工作区失败:', err)
        return false
      }

      if (options.commitAfterPersist) commitWorkspace()

      const savedAt = Date.now()
      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId
            ? { ...project, workspace: nextWorkspace, updatedAt: savedAt }
            : project
        )
      )
      return true
    })
  }

  async function flushCurrentProjectSave(): Promise<boolean> {
    return saveWorkspace(workspaceRef.current, { recordHistory: false })
  }

  async function prepareCurrentChainRun(): Promise<boolean> {
    cancelActiveInteraction()
    try {
      if (stepInspectorRef.current && !(await stepInspectorRef.current.save())) {
        setRuntimeLogs((prev) => [...prev, '当前节点保存失败，未执行后续操作'])
        return false
      }
      if (!(await flushCurrentProjectSave())) {
        setRuntimeLogs((prev) => [...prev, '项目保存失败，未执行后续操作'])
        return false
      }
      return true
    } catch (error) {
      console.error('运行前保存失败:', error)
      setRuntimeLogs((prev) => [...prev, error instanceof Error ? error.message : '运行前保存失败'])
      return false
    }
  }

  async function openProjectLibrary(): Promise<void> {
    cancelActiveInteraction()
    setSelectedNodeId(null)
    setSelectedNodeIds(new Set())
    setSelectedEdgeId(null)
    if (currentProjectId) {
      const saved = await flushCurrentProjectSave()
      if (!saved) return
    }
    try {
      await window.electron?.invoke('action-chain:open')
      onBack()
    } catch (error) {
      console.error('打开项目列表失败:', error)
    }
  }

  async function addRegions(): Promise<void> {
    const viewsToSend = (workspace.views ?? []).map((view) => ({
      name: view.name,
      regions: (view.regions ?? []).map((region) => ({
        name: region.name,
        rect: region.rect,
        coordinateMode: region.coordinateMode ?? 'screen',
        windowAnchorId: region.windowAnchorId,
        templateImagePath: region.templateImagePath,
        templateScaleFactor: region.templateScaleFactor
      }))
    }))
    const result = (await window.electron?.invoke('action-chain:openOverlay', {
      projectId: currentProjectId,
      projectName: currentProjectName,
      windowAnchors: workspace.windowAnchors ?? [],
      views: viewsToSend
    })) as
      | {
          ok: boolean
          windowAnchors?: Workspace['windowAnchors']
          views?: Array<{ name: string; regions: Region[] }>
        }
      | undefined

    if (!result?.ok || !result.views) return

    const mergedViews = [...(workspace.views ?? [])]
    for (const returnedView of result.views) {
      const existingIdx = mergedViews.findIndex((view) => view.name === returnedView.name)
      if (existingIdx >= 0) {
        mergedViews[existingIdx] = {
          ...mergedViews[existingIdx],
          regions: returnedView.regions
        }
      } else {
        mergedViews.push({ name: returnedView.name, regions: returnedView.regions })
      }
    }
    await saveWorkspace({
      ...workspaceRef.current,
      windowAnchors: result.windowAnchors ?? workspaceRef.current.windowAnchors ?? [],
      views: mergedViews
    })
  }

  async function removeRegion(name: string): Promise<void> {
    const current = workspaceRef.current
    const views = (current.views ?? []).map((view) => ({
      ...view,
      regions: (view.regions ?? []).filter((r) => r.name !== name)
    }))
    await saveWorkspace({ ...current, views })
  }

  async function renameRegion(oldName: string, newName: string): Promise<void> {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) {
      setRenamingRegionName(null)
      return
    }
    const allNames = allRegionNames(oldName)
    if (allNames.includes(trimmed)) {
      setRegionRenameError(`名称"${trimmed}"已存在`)
      return
    }
    const current = workspaceRef.current
    const views = (current.views ?? []).map((view) => ({
      ...view,
      regions: (view.regions ?? []).map((r) => (r.name === oldName ? { ...r, name: trimmed } : r))
    }))
    await saveWorkspace({ ...current, views })
    setRenamingRegionName(null)
  }

  async function renameWindowAnchor(anchorId: string, newName: string): Promise<void> {
    const trimmed = newName.trim()
    const current = workspaceRef.current
    const anchor = (current.windowAnchors ?? []).find((item) => item.id === anchorId)
    if (!anchor) {
      setRenamingWindowAnchorId(null)
      return
    }
    if (!trimmed) {
      setWindowAnchorRenameError('名称不能为空')
      return
    }
    if (trimmed === anchor.name) {
      setRenamingWindowAnchorId(null)
      return
    }
    if (
      (current.windowAnchors ?? []).some((item) => item.id !== anchorId && item.name === trimmed)
    ) {
      setWindowAnchorRenameError(`名称"${trimmed}"已存在`)
      return
    }
    const windowAnchors = (current.windowAnchors ?? []).map((item) =>
      item.id === anchorId ? { ...item, name: trimmed } : item
    )
    await saveWorkspace({ ...current, windowAnchors })
    setRenamingWindowAnchorId(null)
    setWindowAnchorRenameValue('')
    setWindowAnchorRenameError('')
  }

  function renameChain(index: number, newName: string): void {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === chains[index]?.name) {
      setRenamingChainIndex(null)
      return
    }
    const conflict = chains.some((c, i) => i !== index && c.name === trimmed)
    if (conflict) {
      setChainRenameError(`名称"${trimmed}"已存在`)
      return
    }
    const nextChains = chains.map((c, i) => (i === index ? { ...c, name: trimmed } : c))
    saveChains(nextChains)
    setRenamingChainIndex(null)
  }

  function deleteChain(index: number): void {
    const target = chains[index]
    if (!target) return
    if (!window.confirm(`确定删除"${target.name}"吗？这个操作不能自动恢复。`)) return
    const nextChains = chains.filter((_, i) => i !== index)
    saveChains(nextChains)
    if (index < activeChainIdx) {
      setSelectedChainIdx(activeChainIdx - 1)
    } else if (index === activeChainIdx) {
      setSelectedChainIdx(index > 0 ? index - 1 : 0)
    }
    setSelectedNodeId(null)
    setRenamingChainIndex(null)
  }

  function allRegionNames(excludeName?: string): string[] {
    return (workspace.views ?? []).flatMap((view) =>
      view.regions.map((r) => r.name).filter((n) => n !== excludeName)
    )
  }

  function saveChains(chains: Array<ActionChain | ExecutionChain>): void {
    const current = workspaceRef.current
    if (tab === 'executionChains') {
      void saveWorkspace({ ...current, executionChains: chains as ExecutionChain[] })
    } else {
      void saveWorkspace({ ...current, chains: chains as ActionChain[] })
    }
  }

  function updateCurrentChain(patch: Partial<ActionChain | ExecutionChain>): void {
    if (!chains[activeChainIdx]) return
    saveChains(
      chains.map((chain, index) => (index === activeChainIdx ? { ...chain, ...patch } : chain))
    )
  }

  function commitCurrentChainDescription(): void {
    if (!currentChain) return
    const description = chainDescriptionDraft.trim()
    if (description === (currentChain.description ?? '')) {
      if (description !== chainDescriptionDraft) setChainDescriptionDraft(description)
      return
    }
    setChainDescriptionDraft(description)
    updateCurrentChain({ description })
  }

  function handleAddNode(type: StepType, x: number, y: number): void {
    const canvasX = x / zoom - canvasPan.x - VISIBLE_NODE_WIDTH / 2
    const canvasY = y / zoom - canvasPan.y - visibleNodeHeight(type) / 2
    const current = currentChain
    if (!current) {
      const chain = createEmptyChain()
      const node = createNode(chain, type, canvasX, canvasY, 0)
      saveChains([...chains, { ...chain, nodes: [node] }])
      setSelectedChainIdx(chains.length)
      // 拖入新节点不自动打开属性面板 — 用户明确点击节点才打开
      return
    }
    const node = createNode(current, type, canvasX, canvasY, current.nodes.length)
    updateCurrentChain({ nodes: [...current.nodes, node] })
    // 拖入新节点不自动打开属性面板 — 用户明确点击节点才打开
  }

  function createNode(
    chain: ActionChain | ExecutionChain,
    type: StepType,
    x: number,
    y: number,
    legacyStepIndex: number
  ): FlowNode {
    const snapX = Number.isFinite(x) ? x : legacyStepIndex * 180
    const snapY = Number.isFinite(y) ? y : legacyStepIndex * 120
    const data: ActionStep = { type }
    if (type === 'relocate_window_anchor' || type === 'refresh_window_anchor') {
      data.params = {
        refreshAllWindowAnchors: false,
        windowAnchorId: workspace.windowAnchors[0]?.id ?? ''
      }
    }
    const node: FlowNode = {
      id: genId(`node-${chain.id ?? tab}`),
      type,
      position: { x: snapX, y: snapY },
      data,
      label: STEP_TYPE_LABELS[type],
      legacyStepIndex
    }
    return node
  }

  function createEmptyChain(): ActionChain | ExecutionChain {
    const prefix = tab === 'executionChains' ? 'exec' : 'chain'
    return {
      id: genId(prefix),
      name: `${chainKindLabel(tab)}${chains.length + 1}`,
      description: '',
      enabled: tab === 'executionChains',
      trigger: tab === 'executionChains' ? 'manual' : 'sub',
      nodes: [],
      edges: []
    }
  }

  function handleConnectEdge(
    source: string,
    target: string,
    sourceHandle: VisibleSourceHandle,
    sourcePort: FlowPortSide,
    targetPort: FlowPortSide
  ): void {
    const current = currentChain
    if (!current || source === target) return
    const sourceNode = current.nodes.find((node) => node.id === source)
    const sourceType = sourceNode?.data.type
    const handle =
      sourceType === 'if_else'
        ? sourceHandle === 'false'
          ? 'false'
          : 'true'
        : sourceType === 'trigger'
          ? sourceHandle === 'stop'
            ? 'stop'
            : 'start'
          : sourceType === 'loop_counter'
            ? sourceHandle === 'exit'
              ? 'exit'
              : 'continue'
            : undefined
    const duplicate = current.edges.find(
      (edge) => edge.source === source && edge.target === target && edge.sourceHandle === handle
    )
    if (duplicate) {
      updateCurrentChain({
        edges: current.edges.map((edge) =>
          edge.id === duplicate.id ? { ...edge, sourcePort, targetPort } : edge
        )
      })
      return
    }
    // 普通节点只能有一个下一节点；条件节点每个真假出口一条；随机/并行/触发节点允许任意数量出线。
    const retainedEdges = current.edges.filter((edge) => {
      if (edge.source !== source) return true
      if (sourceType === 'if_else') return edge.sourceHandle !== handle
      if (sourceType === 'random_branch') return true
      if (sourceType === 'parallel') return true
      if (sourceType === 'trigger') return edge.sourceHandle !== handle
      if (sourceType === 'loop_counter') return edge.sourceHandle !== handle
      return false
    })
    updateCurrentChain({
      edges: [
        ...retainedEdges,
        {
          id: genId(`edge-${current.id ?? tab}`),
          source,
          target,
          sourceHandle: handle,
          sourcePort,
          targetPort,
          probabilityWeight: sourceNode?.data.type === 'random_branch' ? 1 : undefined
        }
      ]
    })
  }

  function updateSelectedEdgeBranch(sourceHandle: 'true' | 'false' | 'start' | 'stop'): void {
    const current = currentChain
    if (!current || !selectedEdgeId) return
    updateCurrentChain({
      edges: current.edges.map((edge) =>
        edge.id === selectedEdgeId ? { ...edge, sourceHandle } : edge
      )
    })
  }

  function updateSelectedEdgeProbabilityWeight(value: string): void {
    const current = currentChain
    if (!current || !selectedEdgeId) return
    const probabilityWeight = Math.max(0, Number(value) || 0)
    updateCurrentChain({
      edges: current.edges.map((edge) =>
        edge.id === selectedEdgeId ? { ...edge, probabilityWeight } : edge
      )
    })
  }

  function addChain(): void {
    setCreatingChain(true)
    setNewChainName('')
    setNewChainError('')
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('[data-new-chain-input]')
      input?.focus()
    })
  }

  function confirmNewChain(): void {
    const name = newChainName.trim() || `智能体${chains.length + 1}`
    const conflict = chains.some((c) => c.name === name)
    if (conflict) {
      setNewChainError('名称已存在')
      return
    }
    const chain = createEmptyChain()
    chain.name = name
    saveChains([...chains, chain])
    setSelectedChainIdx(chains.length)
    setSelectedNodeId(null)
    setCreatingChain(false)
    setNewChainName('')
    setNewChainError('')
  }

  async function updateSelectedNode(step: ActionStep): Promise<boolean> {
    if (!currentChain?.id || !selectedNodeId) return false

    const chainId = currentChain.id
    let nodeFound = false
    const patchChains = <T extends ActionChain | ExecutionChain>(items: T[]): T[] =>
      items.map((chain) => {
        if (chain.id !== chainId) return chain
        return {
          ...chain,
          nodes: chain.nodes.map((node) => {
            if (node.id !== selectedNodeId) return node
            nodeFound = true
            return {
              ...node,
              type: step.type,
              data: step,
              label: step.region || STEP_TYPE_LABELS[step.type]
            }
          })
        }
      })

    const current = workspaceRef.current
    const nextWorkspace =
      tab === 'executionChains'
        ? { ...current, executionChains: patchChains(current.executionChains ?? []) }
        : { ...current, chains: patchChains(current.chains ?? []) }

    if (!nodeFound) return false
    return saveWorkspace(nextWorkspace)
  }

  function workspaceWithNodePosition(
    prev: Workspace,
    nodeId: string,
    x: number,
    y: number
  ): Workspace {
    const patchChains = <T extends ActionChain | ExecutionChain>(items: T[]): T[] =>
      items.map((chain, index) => {
        if (tab === 'executionChains' && index !== activeChainIdx) return chain
        if (tab === 'chains' && index !== activeChainIdx) return chain
        return {
          ...chain,
          nodes: chain.nodes.map((node) =>
            node.id === nodeId ? { ...node, position: { x, y } } : node
          )
        }
      })

    return tab === 'executionChains'
      ? { ...prev, executionChains: patchChains(prev.executionChains ?? []) }
      : { ...prev, chains: patchChains(prev.chains ?? []) }
  }

  function commitNodePosition(nodeId: string, x: number, y: number): void {
    const next = workspaceWithNodePosition(workspaceRef.current, nodeId, x, y)
    void saveWorkspace(next, { recordHistory: false })
  }

  function toggleNodeSelection(nodeId: string): void {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
  }

  function clearSelection(): void {
    setSelectedNodeIds(new Set())
    setSelectedNodeId(null)
  }

  function copySelectedNodes(): void {
    const current = currentChain
    if (!current) return
    const idsToCopy =
      selectedNodeIds.size > 0
        ? selectedNodeIds
        : selectedNodeId
          ? new Set([selectedNodeId])
          : new Set()
    if (idsToCopy.size === 0) return
    const copied = current.nodes.filter((n) => idsToCopy.has(n.id))
    setClipboard(copied)
  }

  function pasteNodes(): void {
    if (clipboard.length === 0) return
    const current = currentChain
    if (!current) return
    const rect = canvasSurfaceRef.current?.getBoundingClientRect()
    const centerX = rect ? rect.width / 2 / zoom - canvasPan.x - VISIBLE_NODE_WIDTH / 2 : 200
    const centerY = rect
      ? rect.height / 2 / zoom - canvasPan.y - visibleNodeHeight(clipboard[0].data.type) / 2
      : 200

    const newNodes: FlowNode[] = clipboard.map((node) => {
      const newId = genId(`paste-${current?.id ?? tab}`)
      return {
        ...node,
        id: newId,
        position: {
          x: node.position.x + centerX - clipboard[0].position.x,
          y: node.position.y + centerY - clipboard[0].position.y
        }
      }
    })

    updateCurrentChain({ nodes: [...current.nodes, ...newNodes] })
    setSelectedNodeIds(new Set(newNodes.map((n) => n.id)))
    setSelectedNodeId(newNodes[0].id)
  }

  function selectAllNodes(): void {
    const current = currentChain
    if (!current) return
    setSelectedNodeIds(new Set(current.nodes.map((n) => n.id)))
    setSelectedNodeId(current.nodes[0]?.id ?? null)
    setSelectedEdgeId(null)
  }

  function visibleNodePortPoint(node: FlowNode, side: FlowPortSide): { x: number; y: number } {
    const position = renderedNodePosition(node)
    return nodePortPoint(
      { x: canvasPan.x + position.x, y: canvasPan.y + position.y },
      VISIBLE_NODE_WIDTH,
      visibleNodeHeight(node.data.type),
      side
    )
  }

  function renderedNodePosition(node: FlowNode): { x: number; y: number } {
    if (dragPreview?.nodeId === node.id) {
      return { x: dragPreview.x, y: dragPreview.y }
    }
    return node.position
  }

  function startEdgeDrag(
    node: FlowNode,
    sourcePort: FlowPortSide,
    event: React.PointerEvent<HTMLButtonElement>
  ): void {
    cancelActiveInteraction()
    event.stopPropagation()
    suppressClickRef.current = false
    const rect = canvasSurfaceRef.current?.getBoundingClientRect()
    if (!rect) return

    const sourceHandle: VisibleSourceHandle =
      node.data.type === 'if_else'
        ? (conditionBranchByNode[node.id] ?? 'true')
        : node.data.type === 'trigger'
          ? (conditionBranchByNode[node.id] ?? 'start')
          : node.data.type === 'loop_counter'
            ? (conditionBranchByNode[node.id] ?? 'continue')
            : undefined
    const sourcePoint = visibleNodePortPoint(node, sourcePort)
    const initialTarget = {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom
    }
    edgeDragRef.current = {
      sourceId: node.id,
      sourceHandle,
      sourcePort,
      fromX: sourcePoint.x,
      fromY: sourcePoint.y
    }
    setEdgePreview({
      fromX: sourcePoint.x,
      fromY: sourcePoint.y,
      toX: initialTarget.x,
      toY: initialTarget.y,
      sourceHandle,
      sourcePort,
      targetPort: targetSideFacingPoint(sourcePoint, initialTarget)
    })

    const onMove = (moveEvent: PointerEvent): void => {
      const drag = edgeDragRef.current
      const bounds = canvasSurfaceRef.current?.getBoundingClientRect()
      if (!drag || !bounds) return
      moveEvent.preventDefault()
      const targetPoint = {
        x: (moveEvent.clientX - bounds.left) / zoom,
        y: (moveEvent.clientY - bounds.top) / zoom
      }
      setEdgePreview({
        fromX: drag.fromX,
        fromY: drag.fromY,
        toX: targetPoint.x,
        toY: targetPoint.y,
        sourceHandle: drag.sourceHandle,
        sourcePort: drag.sourcePort,
        targetPort: targetSideFacingPoint({ x: drag.fromX, y: drag.fromY }, targetPoint)
      })
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      if (activeInteractionCleanupRef.current === cleanup) {
        activeInteractionCleanupRef.current = null
      }
    }

    const finish = (upEvent?: PointerEvent): void => {
      const drag = edgeDragRef.current
      edgeDragRef.current = null
      setEdgePreview(null)
      cleanup()
      if (!drag) return

      // 任何连线动作（成功/失败/取消）结束后，抑制后续冒泡到源节点的 click
      suppressClickRef.current = true

      if (!upEvent) return

      const element = document.elementFromPoint(
        upEvent.clientX,
        upEvent.clientY
      ) as HTMLElement | null
      const targetElement = element?.closest<HTMLElement>('[data-flow-node-id]')
      const targetId = targetElement?.dataset.flowNodeId
      if (!targetId || targetId === drag.sourceId) return
      const targetRect = targetElement.getBoundingClientRect()
      const targetPort = closestPortSide(
        { x: upEvent.clientX, y: upEvent.clientY },
        {
          left: targetRect.left,
          top: targetRect.top,
          width: targetRect.width,
          height: targetRect.height
        }
      )
      handleConnectEdge(drag.sourceId, targetId, drag.sourceHandle, drag.sourcePort, targetPort)
    }

    const onUp = (upEvent: PointerEvent): void => finish(upEvent)
    const onCancel = (): void => finish()

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    activeInteractionCleanupRef.current = cleanup
  }

  function startVisibleNodeDrag(node: FlowNode, event: React.PointerEvent<HTMLDivElement>): void {
    cancelActiveInteraction()
    event.stopPropagation()
    suppressClickRef.current = false
    setDragPreview(null)
    dragStateRef.current = {
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.position.x,
      startY: node.position.y,
      finalX: node.position.x,
      finalY: node.position.y,
      moved: false
    }

    const onMove = (moveEvent: PointerEvent): void => {
      const drag = dragStateRef.current
      if (!drag) return
      const dx = moveEvent.clientX - drag.startClientX
      const dy = moveEvent.clientY - drag.startClientY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true
      moveEvent.preventDefault()
      drag.finalX = drag.startX + dx / zoom
      drag.finalY = drag.startY + dy / zoom
      if (dragAnimationFrameRef.current === null) {
        dragAnimationFrameRef.current = window.requestAnimationFrame(() => {
          dragAnimationFrameRef.current = null
          const latest = dragStateRef.current
          if (!latest) return
          setDragPreview({ nodeId: latest.nodeId, x: latest.finalX, y: latest.finalY })
        })
      }
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      if (dragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAnimationFrameRef.current)
        dragAnimationFrameRef.current = null
      }
      if (activeInteractionCleanupRef.current === cleanup) {
        activeInteractionCleanupRef.current = null
      }
    }

    const finish = (commit: boolean): void => {
      const drag = dragStateRef.current
      dragStateRef.current = null
      cleanup()
      setDragPreview(null)
      if (!drag) return
      if (drag.moved && commit) {
        commitNodePosition(drag.nodeId, drag.finalX, drag.finalY)
        // 拖动结束：抑制随后由 pointerup 触发的 click（避免误开属性面板）
        suppressClickRef.current = true
      } else if (drag.moved) {
        suppressClickRef.current = true
      }
    }

    const onUp = (): void => finish(true)
    const onCancel = (): void => finish(false)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    activeInteractionCleanupRef.current = cleanup
  }

  function handleCanvasDragOver(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function handleCanvasDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/reactflow-type') as StepType | ''
    const rect = canvasSurfaceRef.current?.getBoundingClientRect()
    if (!type || !rect) return
    handleAddNode(type, event.clientX - rect.left, event.clientY - rect.top)
  }

  function startCanvasPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    cancelActiveInteraction()
    setSelectedEdgeId(null)
    event.preventDefault()
    panStateRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: canvasPan.x,
      startPanY: canvasPan.y
    }
    setIsPanning(true)

    let panMoved = false
    const onMove = (moveEvent: PointerEvent): void => {
      panMoved = true
      const pan = panStateRef.current
      if (!pan) return
      setCanvasPan({
        x: pan.startPanX + (moveEvent.clientX - pan.startClientX) / zoom,
        y: pan.startPanY + (moveEvent.clientY - pan.startClientY) / zoom
      })
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      if (activeInteractionCleanupRef.current === cleanup) {
        activeInteractionCleanupRef.current = null
      }
    }

    const finish = (commit: boolean): void => {
      if (commit && !panMoved && !event.shiftKey) clearSelection()
      panStateRef.current = null
      setIsPanning(false)
      cleanup()
    }

    const onUp = (): void => finish(true)
    const onCancel = (): void => finish(false)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    activeInteractionCleanupRef.current = cleanup
  }

  function startLogPanelResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    cancelActiveInteraction()
    event.preventDefault()
    event.stopPropagation()
    const startClientY = event.clientY
    const startHeight = logPanelHeight
    const mainHeight = mainColumnRef.current?.getBoundingClientRect().height ?? window.innerHeight
    const maxHeight = Math.max(120, mainHeight - 180)

    const onMove = (moveEvent: PointerEvent): void => {
      const nextHeight = startHeight + startClientY - moveEvent.clientY
      setLogPanelExpanded(nextHeight > 100)
      setLogPanelHeight(Math.min(maxHeight, Math.max(72, nextHeight)))
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      if (activeInteractionCleanupRef.current === cleanup) {
        activeInteractionCleanupRef.current = null
      }
    }
    const finish = (): void => cleanup()

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
    activeInteractionCleanupRef.current = cleanup
  }

  function toggleLogPanel(): void {
    if (logPanelExpanded) {
      setLogPanelExpanded(false)
      setLogPanelHeight(72)
      return
    }

    const mainHeight = mainColumnRef.current?.getBoundingClientRect().height ?? window.innerHeight
    const maxHeight = Math.max(180, mainHeight - 180)
    const targetHeight = Math.round(mainHeight * 0.24)
    setLogPanelHeight(Math.min(maxHeight, Math.max(180, targetHeight)))
    setLogPanelExpanded(true)
  }

  function handleZoomIn(): void {
    setZoom((z) => Math.min(z + 0.15, 2))
  }

  function handleZoomOut(): void {
    setZoom((z) => Math.max(z - 0.15, 0.25))
  }

  function handleFitView(): void {
    const nodes = currentChain?.nodes ?? []
    if (nodes.length === 0) return
    const rect = canvasSurfaceRef.current?.getBoundingClientRect()
    if (!rect) return

    const minX = Math.min(...nodes.map((n) => n.position.x))
    const minY = Math.min(...nodes.map((n) => n.position.y))
    const maxX = Math.max(...nodes.map((n) => n.position.x + VISIBLE_NODE_WIDTH))
    const maxY = Math.max(...nodes.map((n) => n.position.y + visibleNodeHeight(n.data.type)))

    const contentW = maxX - minX + 120
    const contentH = maxY - minY + 120
    const newZoom = Math.min(rect.width / contentW, rect.height / contentH, 1.5)

    const centerX = minX + (maxX - minX) / 2
    const centerY = minY + (maxY - minY) / 2

    setZoom(newZoom)
    setCanvasPan({
      x: rect.width / 2 - centerX * newZoom,
      y: rect.height / 2 - centerY * newZoom
    })
  }

  function deleteSelectedNode(): void {
    const current = currentChain
    if (!current) return
    const idsToDelete =
      selectedNodeIds.size > 0
        ? selectedNodeIds
        : selectedNodeId
          ? new Set([selectedNodeId])
          : new Set()
    if (idsToDelete.size === 0) return
    const count = idsToDelete.size
    if (!window.confirm(`确定删除 ${count} 个节点吗？`)) return
    const nodes = current.nodes.filter((item) => !idsToDelete.has(item.id))
    const edges = current.edges.filter(
      (edge) => !idsToDelete.has(edge.source) && !idsToDelete.has(edge.target)
    )
    updateCurrentChain({ nodes, edges })
    clearSelection()
  }

  function deleteSelectedEdge(): void {
    const current = currentChain
    if (!current || !selectedEdgeId) return
    updateCurrentChain({ edges: current.edges.filter((edge) => edge.id !== selectedEdgeId) })
    setSelectedEdgeId(null)
  }

  useLayoutEffect(() => {
    kbRef.current = {
      edgeId: selectedEdgeId ?? '',
      nodeId: selectedNodeId ?? '',
      multiSize: selectedNodeIds.size,
      clearSelection,
      copySelectedNodes,
      pasteNodes,
      selectAllNodes,
      deleteSelectedEdge,
      deleteSelectedNode,
      undo: () => {
        const previous = undo()
        if (!previous) return
        void saveWorkspace(previous, { recordHistory: false })
      },
      redo: () => {
        const next = redo()
        if (!next) return
        void saveWorkspace(next, { recordHistory: false })
      }
    }
  })

  async function runCurrentChain(): Promise<void> {
    if (!currentChain?.id || !currentProjectId) return
    const targetType = tab === 'executionChains' ? 'executionChain' : 'actionChain'
    // 必须检查 running — engine.stop() 后 runMode/targets 不会清零，
    // 没有 running 判断的话按钮会"看起来按下去"实际重复调 stop
    const isRunning =
      engineState?.running === true &&
      engineState.runMode === 'single' &&
      engineState.targetChainType === targetType &&
      engineState.targetChainId === currentChain.id
    if (isRunning) {
      await window.electron?.invoke('action-chain:stop')
      return
    }
    if (!(await prepareCurrentChainRun())) return
    const result = (await window.electron?.invoke('action-chain:start', {
      targetType,
      targetId: currentChain.id,
      projectId: currentProjectId
    })) as { success: boolean; error?: string } | undefined
    if (!result?.success) {
      setRuntimeLogs((prev) => [...prev, result?.error ?? '启动失败'])
    }
  }

  async function enterCompactMode(): Promise<void> {
    if (!currentChain?.id || !currentProjectId) return
    if (!(await prepareCurrentChainRun())) return
    const result = (await window.electron?.invoke('action-chain:enterCompactMode', {
      projectId: currentProjectId,
      targetType: tab === 'executionChains' ? 'executionChain' : 'actionChain',
      targetId: currentChain.id,
      chainName: currentChain.name
    })) as { success: boolean; error?: string } | undefined
    if (!result?.success) {
      setRuntimeLogs((prev) => [...prev, result?.error ?? '进入悬浮模式失败'])
    }
  }

  async function copyRuntimeLogs(): Promise<void> {
    if (runtimeLogs.length === 0) return
    try {
      await navigator.clipboard.writeText(runtimeLogs.join('\n'))
      setLogCopyStatus('copied')
    } catch (error) {
      console.error('复制运行日志失败:', error)
      setLogCopyStatus('error')
    }
    if (logCopyResetTimerRef.current !== null) {
      window.clearTimeout(logCopyResetTimerRef.current)
    }
    logCopyResetTimerRef.current = window.setTimeout(() => {
      setLogCopyStatus('idle')
      logCopyResetTimerRef.current = null
    }, 1800)
  }

  function buildAgentAssistantSendPayload(
    message: string,
    sessionId: string,
    permissions: AgentAssistantPermissions
  ): AgentAssistantSendPayload {
    const canvasRect = canvasSurfaceRef.current?.getBoundingClientRect()
    const context: AgentContextSnapshot = {
      projectId: currentProjectId,
      projectName: currentProjectName,
      workspace: workspaceRef.current,
      workspaceRevision: workspaceRevisionRef.current,
      activeChainKind: tab === 'executionChains' ? 'executionChain' : 'actionChain',
      activeChainId: currentChain?.id,
      selectedNodeId: selectedNodeId ?? undefined,
      selectedEdgeId: selectedEdgeId ?? undefined,
      canvas: {
        pan: canvasPan,
        zoom,
        width: canvasRect?.width ?? 0,
        height: canvasRect?.height ?? 0
      },
      recentRuntimeLogs: runtimeLogs.slice(-30)
    }
    return {
      projectId: currentProjectId,
      sessionId,
      message,
      context,
      permissions,
      canvasCaptureRect: canvasRect
        ? {
            x: canvasRect.x,
            y: canvasRect.y,
            width: canvasRect.width,
            height: canvasRect.height
          }
        : undefined
    }
  }

  function previewAgentProposal(proposal: AgentEditProposal): { success: boolean; error?: string } {
    if (proposal.projectId !== currentProjectId) {
      return { success: false, error: '这份提案不属于当前智能体' }
    }
    if (proposal.baseRevision !== workspaceRevisionRef.current) {
      return { success: false, error: '画布已经变化，请让 AI 重新生成提案' }
    }
    const simulation = simulateAgentEditProposal(workspaceRef.current, proposal)
    if (!simulation.success) {
      return { success: false, error: simulation.errors.join('\n') }
    }
    setAssistantPreview({ proposal, simulation })
    const visibleAffected = simulation.diff.affectedChains.find((affected) => {
      const pool =
        affected.chainKind === 'executionChain'
          ? workspaceRef.current.executionChains
          : workspaceRef.current.chains
      return pool.some((chain) => chain.id === affected.chainId)
    })
    if (visibleAffected) {
      const nextTab = visibleAffected.chainKind === 'executionChain' ? 'executionChains' : 'chains'
      const pool =
        nextTab === 'executionChains'
          ? workspaceRef.current.executionChains
          : workspaceRef.current.chains
      setTab(nextTab)
      setSelectedChainIdx(
        Math.max(
          0,
          pool.findIndex((chain) => chain.id === visibleAffected.chainId)
        )
      )
      setSelectedNodeId(null)
      setSelectedNodeIds(new Set())
      setSelectedEdgeId(null)
    }
    return { success: true }
  }

  async function applyAgentProposal(
    proposal: AgentEditProposal
  ): Promise<{ success: boolean; error?: string }> {
    if (proposal.projectId !== currentProjectId) {
      return { success: false, error: '这份提案不属于当前智能体' }
    }
    if (proposal.baseRevision !== workspaceRevisionRef.current) {
      return { success: false, error: '画布已经变化，旧提案不能继续应用' }
    }
    const simulation = simulateAgentEditProposal(workspaceRef.current, proposal)
    if (!simulation.success) {
      return { success: false, error: simulation.errors.join('\n') }
    }
    isApplyingAssistantProposalRef.current = true
    setIsApplyingAssistantProposal(true)
    const saved = await saveWorkspace(simulation.workspace, {
      commitAfterPersist: true,
      expectedRevision: proposal.baseRevision
    })
    isApplyingAssistantProposalRef.current = false
    setIsApplyingAssistantProposal(false)
    if (!saved) return { success: false, error: '保存失败，真实画布没有发生变化' }

    const affected = simulation.diff.affectedChains[0]
    if (affected) {
      const nextTab = affected.chainKind === 'executionChain' ? 'executionChains' : 'chains'
      const pool =
        nextTab === 'executionChains'
          ? simulation.workspace.executionChains
          : simulation.workspace.chains
      const nextIndex = pool.findIndex((chain) => chain.id === affected.chainId)
      setTab(nextTab)
      setSelectedChainIdx(Math.max(0, nextIndex))
      const chain = pool[nextIndex]
      const preferredNodeId =
        simulation.diff.addedNodeIds.find((id) => chain?.nodes.some((node) => node.id === id)) ??
        simulation.diff.updatedNodeIds.find((id) => chain?.nodes.some((node) => node.id === id))
      setSelectedNodeId(preferredNodeId ?? null)
      setSelectedNodeIds(preferredNodeId ? new Set([preferredNodeId]) : new Set())
      setSelectedEdgeId(null)
    }
    setAssistantPreview(null)
    return { success: true }
  }

  function clearAgentProposalPreview(proposalId?: string): void {
    setAssistantPreview((current) =>
      !proposalId || current?.proposal.id === proposalId ? null : current
    )
  }

  if (screen === 'library') {
    return (
      <ProjectLibrary
        projects={projects}
        onBack={onBack}
        onOpenProject={async (projectId) => {
          await window.electron?.invoke('action-chain:open', projectId)
        }}
        onOpenMemory={async (projectId) => {
          const result = (await window.electron?.invoke('workmemory:open', projectId)) as
            | { success?: boolean; error?: string }
            | undefined
          if (!result?.success) throw new Error(result?.error || '打开工作记忆失败')
        }}
        onCreateProject={createProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
      />
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        height: '100vh',
        background: '#0d0d12',
        color: '#e5e7eb'
      }}
    >
      {/* 左侧：项目信息 + 步骤面板 */}
      <aside
        style={{
          width: 210,
          minWidth: 210,
          borderRight: '1px solid rgba(255,255,255,0.08)',
          padding: 12,
          overflow: 'auto',
          background: '#101318'
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
            聊天记录
          </div>
          <button onClick={() => void refreshChatHistory()} style={sidebarButtonStyle}>
            刷新记录
          </button>
          {chatConversations.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 8 }}>
              运行“记录聊天”节点后，这里会显示已保存的会话。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
              {chatConversations.map((item) => (
                <div key={item.id} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <button
                    onClick={() => void openChatConversation(item.id)}
                    style={{
                      ...sidebarButtonStyle,
                      flex: 1,
                      textAlign: 'left',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={`${item.conversationTitle}（${item.conversationType === 'group' ? '群聊' : item.conversationType === 'direct' ? '私聊' : '未知'} · ${item.messageCount} 条）`}
                  >
                    {item.conversationTitle} ·{' '}
                    {item.conversationType === 'group'
                      ? '群'
                      : item.conversationType === 'direct'
                        ? '私'
                        : '?'}{' '}
                    · {item.messageCount}
                  </button>
                  <button
                    onClick={() => void clearChatConversation(item.id)}
                    style={{
                      background: 'rgba(239,68,68,0.1)',
                      border: '1px solid rgba(239,68,68,0.2)',
                      borderRadius: 4,
                      color: '#f87171',
                      padding: '4px 6px',
                      fontSize: 10,
                      cursor: 'pointer'
                    }}
                    title="清空会话"
                  >
                    清空
                  </button>
                </div>
              ))}
            </div>
          )}
          {selectedChatConversation && (
            <div
              style={{
                marginTop: 8,
                maxHeight: 220,
                overflow: 'auto',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 6,
                padding: 8
              }}
            >
              {selectedChatConversation.messages.map((message) => (
                <div
                  key={message.id}
                  style={{ color: '#cbd5e1', fontSize: 11, lineHeight: 1.5, marginBottom: 7 }}
                >
                  <span style={{ color: message.senderRole === 'self' ? '#34d399' : '#93c5fd' }}>
                    {formatChatMessage(message)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => void openProjectLibrary()} style={sidebarButtonStyle}>
          返回项目列表
        </button>

        <div style={{ color: '#8b93a3', fontSize: 11, margin: '12px 0 6px' }}>项目</div>
        <div className="flow-project-summary">
          <div className="flow-project-name" title={currentProjectName}>
            {currentProjectName || '未选择项目'}
          </div>
        </div>

        <StepPalette />
      </aside>

      <main
        ref={mainColumnRef}
        style={{
          position: 'relative',
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div className="flow-chain-toolbar">
          {currentChain ? (
            <>
              <div className="flow-chain-toolbar-config">
                <span className="flow-chain-name-label" title={currentChain.name}>
                  {currentChain.name}
                </span>
                {tab === 'executionChains' ? (
                  <>
                    <label className="flow-chain-enable-toggle">
                      <input
                        type="checkbox"
                        checked={currentChain.enabled === true}
                        onChange={(event) => updateCurrentChain({ enabled: event.target.checked })}
                      />
                      启用
                    </label>
                    <select
                      className="flow-chain-toolbar-select"
                      value={currentChain.trigger}
                      onChange={(event) =>
                        updateCurrentChain({ trigger: event.target.value as TriggerType })
                      }
                      style={inputStyle}
                    >
                      {EXECUTION_TRIGGER_TYPES.map((value) => (
                        <option key={value} value={value}>
                          {TRIGGER_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="flow-chain-enable-toggle">仅供执行链调用</span>
                )}
              </div>
              <div className="flow-chain-toolbar-actions">
                <button
                  onClick={() => void runCurrentChain()}
                  style={currentIsRunning ? stopButtonStyle : runButtonStyle}
                >
                  {currentIsRunning ? '停止本链' : '运行本链'}
                </button>
                <button
                  onClick={() => void enterCompactMode()}
                  disabled={!currentChain?.id || !currentProjectId}
                  style={{
                    ...sidebarButtonStyle,
                    width: 'auto',
                    padding: '8px 14px',
                    opacity: currentChain?.id && currentProjectId ? 1 : 0.5
                  }}
                >
                  最小化
                </button>
              </div>
            </>
          ) : (
            <div className="flow-chain-toolbar-empty">
              拖拽左侧步骤到画布，会自动创建{chainKindLabel(tab)}。
            </div>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {currentChain && (
            <div
              ref={canvasSurfaceRef}
              onDragOver={handleCanvasDragOver}
              onDrop={handleCanvasDrop}
              onPointerDown={startCanvasPan}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 20,
                pointerEvents: 'auto',
                cursor: isPanning ? 'grabbing' : 'default',
                overflow: 'hidden',
                backgroundColor: '#0d0d12',
                backgroundImage: 'radial-gradient(rgba(148,163,184,0.13) 1px, transparent 1px)',
                backgroundSize: '20px 20px'
              }}
            >
              {currentChain.nodes.length === 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 28,
                    left: 28,
                    color: '#7b8494',
                    fontSize: 13,
                    pointerEvents: 'none'
                  }}
                >
                  空链：从左侧拖拽步骤到画布开始编排。
                </div>
              )}
              {currentChain.nodes.length >= 2 && (currentChain.edges ?? []).length === 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'rgba(16,185,129,0.1)',
                    border: '1px solid rgba(16,185,129,0.25)',
                    borderRadius: 10,
                    padding: '12px 24px',
                    color: '#10b981',
                    fontSize: 14,
                    fontWeight: 600,
                    textAlign: 'center',
                    pointerEvents: 'none'
                  }}
                >
                  拖拽节点右侧的 + 到另一个节点来连线
                </div>
              )}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  transform: `scale(${zoom})`,
                  transformOrigin: '0 0',
                  overflow: 'visible',
                  pointerEvents: 'none'
                }}
              >
                <svg
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    overflow: 'visible'
                  }}
                >
                  <defs>
                    <marker
                      id="arrow-blue"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
                    </marker>
                    <marker
                      id="arrow-green"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                    </marker>
                    <marker
                      id="arrow-red"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                    </marker>
                  </defs>
                  {currentChain.edges.map((edge) => {
                    const source = currentChain.nodes.find((node) => node.id === edge.source)
                    const target = currentChain.nodes.find((node) => node.id === edge.target)
                    if (!source || !target) return null
                    const sourcePort = edge.sourcePort ?? 'right'
                    const targetPort = edge.targetPort ?? 'left'
                    const from = visibleNodePortPoint(source, sourcePort)
                    const to = visibleNodePortPoint(target, targetPort)
                    const color = edgeColor(edge.sourceHandle)
                    const markerId =
                      edge.sourceHandle === 'true' || edge.sourceHandle === 'start'
                        ? 'url(#arrow-green)'
                        : edge.sourceHandle === 'false' || edge.sourceHandle === 'stop'
                          ? 'url(#arrow-red)'
                          : 'url(#arrow-blue)'
                    const pathD = edgePath(from, sourcePort, to, targetPort)
                    const isSelected = selectedEdgeId === edge.id
                    const isPreviewDeleted = assistantPreviewDeletedEdgeIds.has(edge.id)
                    const isPreviewUpdated = assistantPreviewUpdatedEdgeIds.has(edge.id)
                    const randomSourceEdges =
                      source.data.type === 'random_branch'
                        ? currentChain.edges.filter((item) => item.source === source.id)
                        : []
                    const randomRouteIndex = randomSourceEdges.findIndex(
                      (item) => item.id === edge.id
                    )
                    const randomTotalWeight = randomSourceEdges.reduce(
                      (sum, item) => sum + normalizedBranchWeight(item),
                      0
                    )
                    const randomProbability =
                      randomTotalWeight > 0
                        ? (normalizedBranchWeight(edge) / randomTotalWeight) * 100
                        : 0
                    return (
                      <React.Fragment key={edge.id}>
                        {/* Hit-test path：透明加宽，沿着整条曲线都能点中。
                          SVG 父级 pointerEvents: 'none'，子级用 'stroke' 显式覆盖。 */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={20}
                          strokeLinecap="round"
                          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedEdgeId(edge.id)
                            setSelectedNodeId(null)
                          }}
                        />
                        {/* Visible path：用户实际看到的细线，由 onClick 之外的 hit-test path 负责捕获点击 */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke={
                            isPreviewDeleted
                              ? '#f87171'
                              : isPreviewUpdated
                                ? '#fbbf24'
                                : isSelected
                                  ? '#fbbf24'
                                  : color
                          }
                          strokeWidth={
                            isSelected || isPreviewDeleted || isPreviewUpdated ? 3.5 : 2.5
                          }
                          strokeDasharray={isPreviewDeleted ? '7 6' : undefined}
                          strokeLinecap="round"
                          markerEnd={markerId}
                          style={{
                            pointerEvents: 'none',
                            opacity: isPreviewDeleted ? 0.62 : 1,
                            filter: isSelected
                              ? 'drop-shadow(0 0 4px rgba(251,191,36,0.6))'
                              : undefined,
                            transition: 'stroke 0.15s, stroke-width 0.15s'
                          }}
                        />
                        <path
                          className="flow-edge-direction-flow"
                          d={pathD}
                          fill="none"
                          stroke={isSelected ? '#fde68a' : color}
                          strokeWidth={isSelected ? 2.4 : 1.8}
                          strokeLinecap="round"
                          strokeDasharray="3 15"
                          style={{
                            pointerEvents: 'none',
                            color: isSelected ? '#fde68a' : color,
                            display: isPreviewDeleted || isPreviewUpdated ? 'none' : undefined
                          }}
                        />
                        {source.data.type === 'random_branch' && (
                          <g
                            transform={`translate(${(from.x + to.x) / 2}, ${(from.y + to.y) / 2})`}
                            style={{ pointerEvents: 'none' }}
                          >
                            <rect
                              x={-36}
                              y={-10}
                              width={72}
                              height={20}
                              rx={6}
                              fill="rgba(15,23,42,0.94)"
                              stroke={isSelected ? '#fbbf24' : '#38bdf8'}
                            />
                            <text
                              x={0}
                              y={4}
                              textAnchor="middle"
                              fill={isSelected ? '#fde68a' : '#bae6fd'}
                              fontSize={10}
                              fontWeight={700}
                            >
                              {`路线${randomRouteIndex + 1} · ${randomProbability.toFixed(0)}%`}
                            </text>
                          </g>
                        )}
                      </React.Fragment>
                    )
                  })}
                  {assistantPreviewChain?.edges
                    .filter(
                      (edge) =>
                        assistantPreviewAddedEdgeIds.has(edge.id) ||
                        assistantPreviewUpdatedEdgeIds.has(edge.id)
                    )
                    .map((edge) => {
                      const source = assistantPreviewChain.nodes.find(
                        (node) => node.id === edge.source
                      )
                      const target = assistantPreviewChain.nodes.find(
                        (node) => node.id === edge.target
                      )
                      if (!source || !target) return null
                      const sourcePort = edge.sourcePort ?? 'right'
                      const targetPort = edge.targetPort ?? 'left'
                      const from = nodePortPoint(
                        { x: canvasPan.x + source.position.x, y: canvasPan.y + source.position.y },
                        VISIBLE_NODE_WIDTH,
                        visibleNodeHeight(source.data.type),
                        sourcePort
                      )
                      const to = nodePortPoint(
                        { x: canvasPan.x + target.position.x, y: canvasPan.y + target.position.y },
                        VISIBLE_NODE_WIDTH,
                        visibleNodeHeight(target.data.type),
                        targetPort
                      )
                      const added = assistantPreviewAddedEdgeIds.has(edge.id)
                      const color = added ? '#34d399' : '#fbbf24'
                      return (
                        <g key={`assistant-preview-${edge.id}`} style={{ pointerEvents: 'none' }}>
                          <path
                            d={edgePath(from, sourcePort, to, targetPort)}
                            fill="none"
                            stroke={color}
                            strokeWidth={4}
                            strokeDasharray="7 5"
                            strokeLinecap="round"
                          />
                          <text
                            x={(from.x + to.x) / 2}
                            y={(from.y + to.y) / 2 - 7}
                            textAnchor="middle"
                            fill={color}
                            fontSize={10}
                            fontWeight={700}
                          >
                            {added ? '新增连线' : '修改连线'}
                          </text>
                        </g>
                      )
                    })}
                  {edgePreview && (
                    <path
                      d={edgePath(
                        { x: edgePreview.fromX, y: edgePreview.fromY },
                        edgePreview.sourcePort,
                        { x: edgePreview.toX, y: edgePreview.toY },
                        edgePreview.targetPort
                      )}
                      fill="none"
                      stroke={edgeColor(edgePreview.sourceHandle)}
                      strokeWidth={2.5}
                      strokeDasharray="6 6"
                      strokeLinecap="round"
                    />
                  )}
                </svg>
                {currentChain.nodes.map((node, index) => {
                  const isEntry = node.id === entryNodeId
                  const position = renderedNodePosition(node)
                  const nodeHeight = visibleNodeHeight(node.data.type)
                  const isConditionNode = node.data.type === 'if_else'
                  const isTriggerNode = node.data.type === 'trigger'
                  const isLoopCounterNode = node.data.type === 'loop_counter'
                  const isPreviewDeleted = assistantPreviewDeletedNodeIds.has(node.id)
                  const isPreviewUpdated = assistantPreviewUpdatedNodeIds.has(node.id)
                  return (
                    <React.Fragment key={node.id}>
                      {isEntry && (
                        <div
                          style={{
                            position: 'absolute',
                            left: canvasPan.x + position.x - 58,
                            top: canvasPan.y + position.y + nodeHeight / 2,
                            transform: 'translateY(-50%)',
                            background: 'rgba(16,185,129,0.18)',
                            border: '1px solid rgba(16,185,129,0.35)',
                            borderRadius: 6,
                            color: '#10b981',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '3px 8px',
                            whiteSpace: 'nowrap',
                            pointerEvents: 'none'
                          }}
                        >
                          ▶ 开始
                        </div>
                      )}
                      <div
                        key={node.id}
                        data-flow-node-id={node.id}
                        role="button"
                        tabIndex={0}
                        onPointerDown={(event) => startVisibleNodeDrag(node, event)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(e) => {
                          if (suppressClickRef.current) return
                          if (e.shiftKey) {
                            toggleNodeSelection(node.id)
                          } else {
                            setSelectedNodeIds(new Set([node.id]))
                            setSelectedNodeId(node.id)
                          }
                          setSelectedEdgeId(null)
                        }}
                        style={{
                          position: 'absolute',
                          left: canvasPan.x + position.x,
                          top: canvasPan.y + position.y,
                          width: VISIBLE_NODE_WIDTH,
                          height: nodeHeight,
                          boxSizing: 'border-box',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: isConditionNode ? '8px 34px 8px 10px' : '8px 10px',
                          borderRadius: 6,
                          border: isPreviewDeleted
                            ? '2px dashed rgba(248,113,113,0.9)'
                            : isPreviewUpdated
                              ? '2px solid rgba(251,191,36,0.9)'
                              : selectedNodeIds.has(node.id) || node.id === selectedNodeId
                                ? '1px solid rgba(251,191,36,0.72)'
                                : '1px solid rgba(16,185,129,0.38)',
                          background: isPreviewDeleted
                            ? 'rgba(127,29,29,0.22)'
                            : isPreviewUpdated
                              ? 'rgba(120,83,10,0.2)'
                              : selectedNodeIds.has(node.id) || node.id === selectedNodeId
                                ? 'rgba(251,191,36,0.16)'
                                : 'rgba(15,23,42,0.9)',
                          color: '#e5e7eb',
                          boxShadow: '0 8px 20px rgba(0,0,0,0.26)',
                          cursor: 'grab',
                          textAlign: 'left',
                          userSelect: 'none',
                          pointerEvents: 'auto',
                          touchAction: 'none',
                          overflow: 'visible'
                        }}
                      >
                        {(isPreviewDeleted || isPreviewUpdated) && (
                          <span
                            style={{
                              position: 'absolute',
                              top: -10,
                              right: 6,
                              padding: '2px 5px',
                              borderRadius: 4,
                              background: isPreviewDeleted ? '#7f1d1d' : '#78350f',
                              color: isPreviewDeleted ? '#fecaca' : '#fde68a',
                              fontSize: 9,
                              fontWeight: 700,
                              pointerEvents: 'none'
                            }}
                          >
                            {isPreviewDeleted ? '将删除' : '将修改'}
                          </span>
                        )}
                        {FLOW_PORT_SIDES.map((side) => (
                          <button
                            key={side}
                            type="button"
                            className="flow-node-port"
                            data-flow-port-side={side}
                            aria-label={`从节点${FLOW_PORT_LABELS[side]}开始连线`}
                            title={`从${FLOW_PORT_LABELS[side]}开始连线；拖到目标节点任意位置`}
                            onPointerDown={(event) => startEdgeDrag(node, side, event)}
                            onMouseDown={(event) => event.preventDefault()}
                            style={{
                              position: 'absolute',
                              ...flowPortPosition(side),
                              width: 36,
                              height: 36,
                              borderRadius: 999,
                              border: 'none',
                              background: 'transparent',
                              padding: 0,
                              cursor: 'crosshair',
                              pointerEvents: 'auto',
                              touchAction: 'none',
                              zIndex: 3,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <span className="flow-node-port-dot" aria-hidden="true" />
                          </button>
                        ))}
                        {isConditionNode && (
                          <div
                            aria-label="选择下一条连线的条件分支"
                            style={{
                              position: 'absolute',
                              right: 6,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                              zIndex: 2
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            {(['true', 'false'] as const).map((branch) => {
                              const active = (conditionBranchByNode[node.id] ?? 'true') === branch
                              const color = edgeColor(branch)
                              return (
                                <button
                                  key={branch}
                                  type="button"
                                  aria-pressed={active}
                                  title={`下一条连线使用${branch === 'true' ? 'true' : 'false'}分支`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setConditionBranchByNode((previous) => ({
                                      ...previous,
                                      [node.id]: branch
                                    }))
                                  }}
                                  style={{
                                    width: 24,
                                    height: 20,
                                    borderRadius: 5,
                                    border: `1px solid ${active ? color : `${color}55`}`,
                                    background: active ? `${color}2b` : 'rgba(15,23,42,0.8)',
                                    color,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    padding: 0,
                                    cursor: 'pointer',
                                    opacity: active ? 1 : 0.62
                                  }}
                                >
                                  {branch}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {isTriggerNode && (
                          <div
                            aria-label="选择下一条连线的触发动作"
                            style={{
                              position: 'absolute',
                              right: 6,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                              zIndex: 2
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            {(['start', 'stop'] as const).map((mode) => {
                              const active = (conditionBranchByNode[node.id] ?? 'start') === mode
                              const color = edgeColor(mode)
                              return (
                                <button
                                  key={mode}
                                  type="button"
                                  aria-pressed={active}
                                  title={`下一条连线使用${mode === 'start' ? '启动' : '停止'}动作`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setConditionBranchByNode((previous) => ({
                                      ...previous,
                                      [node.id]: mode
                                    }))
                                  }}
                                  style={{
                                    width: 28,
                                    height: 20,
                                    borderRadius: 5,
                                    border: `1px solid ${active ? color : `${color}55`}`,
                                    background: active ? `${color}2b` : 'rgba(15,23,42,0.8)',
                                    color,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    padding: 0,
                                    cursor: 'pointer',
                                    opacity: active ? 1 : 0.62
                                  }}
                                >
                                  {mode === 'start' ? '启动' : '停止'}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {isLoopCounterNode && (
                          <div
                            aria-label="选择循环计数器出口"
                            style={{
                              position: 'absolute',
                              right: 6,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                              zIndex: 2
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            {(['continue', 'exit'] as const).map((branch) => {
                              const active = (conditionBranchByNode[node.id] ?? 'continue') === branch
                              const color = edgeColor(branch)
                              return (
                                <button
                                  key={branch}
                                  type="button"
                                  aria-pressed={active}
                                  title={`下一条连线使用${branch === 'continue' ? '继续' : '退出'}出口`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setConditionBranchByNode((previous) => ({
                                      ...previous,
                                      [node.id]: branch
                                    }))
                                  }}
                                  style={{
                                    width: 28,
                                    height: 20,
                                    borderRadius: 5,
                                    border: `1px solid ${active ? color : `${color}55`}`,
                                    background: active ? `${color}2b` : 'rgba(15,23,42,0.8)',
                                    color,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    padding: 0,
                                    cursor: 'pointer',
                                    opacity: active ? 1 : 0.62
                                  }}
                                >
                                  {branch === 'continue' ? '继续' : '退出'}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 999,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(16,185,129,0.18)',
                            color: '#10b981',
                            fontSize: 11,
                            flex: '0 0 auto'
                          }}
                        >
                          {index + 1}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 12, fontWeight: 700 }}>
                            {STEP_TYPE_LABELS[node.data.type]}
                          </span>
                          <span
                            style={{
                              display: 'block',
                              fontSize: 10,
                              color: '#94a3b8',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {node.label ?? node.data.region ?? node.id}
                          </span>
                        </span>
                      </div>
                    </React.Fragment>
                  )
                })}
                {assistantPreviewChain?.nodes
                  .filter(
                    (node) =>
                      assistantPreviewAddedNodeIds.has(node.id) ||
                      assistantPreviewUpdatedNodeIds.has(node.id)
                  )
                  .map((node) => {
                    const added = assistantPreviewAddedNodeIds.has(node.id)
                    const color = added ? '#34d399' : '#fbbf24'
                    return (
                      <div
                        key={`assistant-preview-${node.id}`}
                        style={{
                          position: 'absolute',
                          left: canvasPan.x + node.position.x,
                          top: canvasPan.y + node.position.y,
                          width: VISIBLE_NODE_WIDTH,
                          height: visibleNodeHeight(node.data.type),
                          boxSizing: 'border-box',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '8px 10px',
                          border: `2px dashed ${color}`,
                          borderRadius: 6,
                          background: added ? 'rgba(6,78,59,0.82)' : 'rgba(120,83,10,0.78)',
                          color: '#f8fafc',
                          boxShadow: `0 0 18px ${added ? 'rgba(52,211,153,0.24)' : 'rgba(251,191,36,0.24)'}`,
                          pointerEvents: 'none',
                          zIndex: 8
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            top: -11,
                            right: 6,
                            padding: '2px 5px',
                            borderRadius: 4,
                            background: added ? '#065f46' : '#78350f',
                            color,
                            fontSize: 9,
                            fontWeight: 700
                          }}
                        >
                          {added ? '将新增' : '修改后'}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 12, fontWeight: 700 }}>
                            {STEP_TYPE_LABELS[node.data.type]}
                          </span>
                          <span
                            style={{
                              display: 'block',
                              overflow: 'hidden',
                              color: '#d1fae5',
                              fontSize: 10,
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {node.label ?? node.data.region ?? node.id}
                          </span>
                        </span>
                      </div>
                    )
                  })}
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: 10,
                  left: 10,
                  display: 'flex',
                  gap: 4,
                  background: 'rgba(10,11,16,0.85)',
                  backdropFilter: 'blur(8px)',
                  borderRadius: 8,
                  padding: 4,
                  border: '1px solid rgba(255,255,255,0.1)',
                  pointerEvents: 'auto'
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={handleZoomIn}
                  title="放大"
                  style={{
                    width: 30,
                    height: 30,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 6,
                    color: '#cbd5e1',
                    fontSize: 16,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  +
                </button>
                <button
                  onClick={handleZoomOut}
                  title="缩小"
                  style={{
                    width: 30,
                    height: 30,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 6,
                    color: '#cbd5e1',
                    fontSize: 16,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  −
                </button>
                <button
                  onClick={handleFitView}
                  title="显示全部"
                  style={{
                    width: 30,
                    height: 30,
                    background: 'rgba(16,185,129,0.14)',
                    border: '1px solid rgba(16,185,129,0.25)',
                    borderRadius: 6,
                    color: '#10b981',
                    fontSize: 14,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ⊡
                </button>
              </div>
            </div>
          )}
          {!currentChain && (
            <div
              style={{
                position: 'absolute',
                top: 28,
                left: 28,
                color: '#7b8494',
                fontSize: 13,
                pointerEvents: 'none'
              }}
            >
              空链：从左侧拖拽步骤到画布开始编排。
            </div>
          )}
        </div>

        <LogPanel
          logPanelHeight={logPanelHeight}
          logPanelExpanded={logPanelExpanded}
          engineState={engineState}
          runtimeLogs={runtimeLogs}
          logCopyStatus={logCopyStatus}
          logBodyRef={logBodyRef}
          onStartResize={startLogPanelResize}
          onCopyLogs={() => void copyRuntimeLogs()}
          onClearLogs={() => {
            setRuntimeLogs([])
            setLogCopyStatus('idle')
          }}
          onTogglePanel={toggleLogPanel}
        />

        <button
          type="button"
          className={`agent-assistant-launcher${assistantPreview ? ' has-preview' : ''}`}
          style={{ bottom: logPanelHeight + 16, display: assistantOpen ? 'none' : 'flex' }}
          aria-expanded={assistantOpen}
          onClick={openAssistantWindow}
        >
          <span className="agent-assistant-launcher-icon" aria-hidden="true">
            AI
          </span>
          <span>
            <strong>构建助手</strong>
            <small>{assistantPreview ? '提案正在预览' : '理解、诊断和修改智能体'}</small>
          </span>
        </button>

        <div
          ref={assistantWindowRef}
          data-flow-editor-interactive
          className={`agent-assistant-floating-window${assistantOpen ? ' is-open' : ' is-hidden'}`}
          style={{
            left: assistantFrame.x,
            top: assistantFrame.y,
            width: assistantFrame.width,
            height: assistantFrame.height
          }}
          aria-hidden={!assistantOpen}
        >
          <header
            className="agent-assistant-floating-header"
            onPointerDown={startAssistantWindowDrag}
          >
            <div className="agent-assistant-floating-title">
              <span className="agent-assistant-floating-mark" aria-hidden="true">
                AI
              </span>
              <span>
                <strong>智能体构建助手</strong>
                <small>{currentProjectName || '当前智能体'}</small>
              </span>
            </div>
            <div className="agent-assistant-floating-actions">
              <button type="button" title="最小化" onClick={() => setAssistantOpen(false)}>
                —
              </button>
              <button
                type="button"
                title="关闭并取消画布预览"
                onClick={() => {
                  setAssistantOpen(false)
                  clearAgentProposalPreview()
                }}
              >
                ×
              </button>
            </div>
          </header>
          <AgentAssistantPanel
            key={currentProjectId}
            projectId={currentProjectId}
            projectName={currentProjectName}
            workspaceRevision={workspaceRevision}
            buildSendPayload={buildAgentAssistantSendPayload}
            onPreview={previewAgentProposal}
            onApply={applyAgentProposal}
            onClearPreview={clearAgentProposalPreview}
          />
          <div
            className="agent-assistant-resize-handle"
            title="拖动调整助手窗口大小"
            onPointerDown={startAssistantWindowResize}
          />
        </div>
      </main>

      {/* 右侧固定面板：区域管理 + 链设计 */}
      <aside
        data-flow-editor-interactive={selectedNode ? true : undefined}
        onPointerDownCapture={() => {
          if (activeInteractionCleanupRef.current) cancelActiveInteraction()
        }}
        style={{
          width: selectedNode ? 400 : 210,
          minWidth: selectedNode ? 360 : 210,
          height: '100vh',
          overflow: 'auto',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          background: '#11131a',
          padding: selectedNode ? 0 : 14
        }}
      >
        {selectedNode && currentChain ? (
          <StepInspector
            ref={stepInspectorRef}
            key={selectedNode.id}
            node={selectedNode}
            nodes={currentChain.nodes}
            edges={currentChain.edges ?? []}
            regions={allRegions}
            regionNames={regionNames}
            availableVariables={availableVariables}
            chainNames={[
              ...(workspace.executionChains ?? []).map((chain) => chain.name),
              ...(workspace.chains ?? []).map((chain) => chain.name)
            ]}
            windowAnchors={workspace.windowAnchors ?? []}
            onSave={updateSelectedNode}
            onDelete={deleteSelectedNode}
            onClose={() => setSelectedNodeId(null)}
            onEditRegion={async (name, defaultRect) => {
              const current = workspaceRef.current
              let regionName = name
              if (!regionName) {
                const existing = (current.views ?? []).flatMap((v) => v.regions).map((r) => r.name)
                let i = 1
                while (existing.includes(`区域${i}`)) i++
                regionName = `区域${i}`
              }
              const existingRegion = (current.views ?? [])
                .flatMap((v) => v.regions)
                .find((r) => r.name === regionName)
              const regionRect =
                existingRegion?.rect ?? defaultRect ?? { x: 0, y: 0, width: 200, height: 200 }
              const result = (await window.electron?.invoke('action-chain:editRegion', {
                projectId: currentProjectId,
                projectName: currentProjectName,
                windowAnchors: current.windowAnchors ?? [],
                regionName,
                regionRect
              })) as {
                ok: boolean
                rect?: { x: number; y: number; width: number; height: number }
              } | undefined
              if (!result?.ok || !result.rect) return null
              const views = [...(current.views ?? [])]
              if (views.length === 0) {
                views.push({ name: '默认视图', regions: [] })
              }
              const firstView = views[0]
              const idx = firstView.regions.findIndex((r) => r.name === regionName)
              const newRegion = {
                name: regionName,
                rect: result.rect,
                coordinateMode: 'screen' as const
              }
              if (idx >= 0) {
                firstView.regions[idx] = newRegion
              } else {
                firstView.regions = [...firstView.regions, newRegion]
              }
              await saveWorkspace({ ...current, views })
              return regionName
            }}
          />
        ) : (
          <>
            {/* 框选区域 */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
                框选区域
              </div>
              <button
                onClick={() => void addRegions()}
                disabled={!currentProjectId}
                style={{
                  ...sidebarButtonStyle,
                  color: currentProjectId ? '#10b981' : '#64748b',
                  borderColor: currentProjectId
                    ? 'rgba(16,185,129,0.28)'
                    : 'rgba(255,255,255,0.08)',
                  cursor: currentProjectId ? 'pointer' : 'default',
                  textAlign: 'center'
                }}
              >
                + 框选区域
              </button>
              <button
                onClick={async () => {
                  if (!currentProjectId) return
                  const taskbarRect = (await window.electron?.invoke(
                    'action-chain:detectTaskbar'
                  )) as { x: number; y: number; width: number; height: number } | null
                  if (!taskbarRect) {
                    alert('未检测到任务栏区域')
                    return
                  }
                  const taskbarName = '任务栏'
                  const current = workspaceRef.current
                  const views = [...(current.views ?? [])]
                  if (views.length === 0) {
                    views.push({ name: '默认视图', regions: [] })
                  }
                  const firstView = views[0]
                  const existingIdx = firstView.regions.findIndex((r) => r.name === taskbarName)
                  const newRegion = {
                    name: taskbarName,
                    rect: taskbarRect,
                    coordinateMode: 'screen' as const
                  }
                  if (existingIdx >= 0) {
                    firstView.regions[existingIdx] = newRegion
                  } else {
                    firstView.regions = [...firstView.regions, newRegion]
                  }
                  await saveWorkspace({ ...current, views })
                }}
                disabled={!currentProjectId}
                style={{
                  ...sidebarButtonStyle,
                  color: currentProjectId ? '#38bdf8' : '#64748b',
                  borderColor: currentProjectId
                    ? 'rgba(56,189,248,0.28)'
                    : 'rgba(255,255,255,0.08)',
                  cursor: currentProjectId ? 'pointer' : 'default',
                  textAlign: 'center',
                  marginTop: 6
                }}
              >
                自动检测任务栏
              </button>
              <div style={{ color: '#64748b', fontSize: 10, marginTop: 6 }}>
                区域 {regionNames.length} · 模板{' '}
                {allRegions.filter((region) => Boolean(region.templateImagePath)).length} · 窗口锚点{' '}
                {(workspace.windowAnchors ?? []).length}
              </div>
              {regionNames.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4
                  }}
                >
                  {regionNames.map((name) => (
                    <div key={name} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {renamingRegionName === name ? (
                        <>
                          <input
                            ref={regionRenameInputRef}
                            value={regionRenameValue}
                            onChange={(e) => {
                              setRegionRenameValue(e.target.value)
                              setRegionRenameError('')
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void renameRegion(name, regionRenameValue)
                              if (e.key === 'Escape') setRenamingRegionName(null)
                            }}
                            style={{
                              ...inputStyle,
                              flex: 1,
                              fontSize: 12,
                              height: 28,
                              boxSizing: 'border-box',
                              minWidth: 0,
                              borderColor: regionRenameError
                                ? 'rgba(239,68,68,0.5)'
                                : 'rgba(255,255,255,0.15)'
                            }}
                          />
                          {regionRenameError && (
                            <span style={{ color: '#ef4444', fontSize: 10, whiteSpace: 'nowrap' }}>
                              {regionRenameError}
                            </span>
                          )}
                          <button
                            onClick={() => void renameRegion(name, regionRenameValue)}
                            style={{
                              ...smallAccentButtonStyle,
                              fontSize: 11,
                              padding: '4px 7px',
                              flexShrink: 0
                            }}
                          >
                            确认
                          </button>
                          <button
                            onClick={() => setRenamingRegionName(null)}
                            style={{
                              ...smallAccentButtonStyle,
                              background: 'rgba(255,255,255,0.06)',
                              borderColor: 'rgba(255,255,255,0.1)',
                              color: '#94a3b8',
                              fontSize: 11,
                              padding: '4px 7px',
                              flexShrink: 0
                            }}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <span
                            onClick={() => {
                              setRenamingRegionName(name)
                              setRegionRenameValue(name)
                              setRegionRenameError('')
                              requestAnimationFrame(() => regionRenameInputRef.current?.focus())
                            }}
                            title="点击重命名"
                            style={{
                              ...inputStyle,
                              flex: 1,
                              fontSize: 12,
                              cursor: 'pointer',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              minWidth: 0
                            }}
                          >
                            {name}
                          </span>
                          <button
                            onClick={() => {
                              setRenamingRegionName(name)
                              setRegionRenameValue(name)
                              setRegionRenameError('')
                              requestAnimationFrame(() => regionRenameInputRef.current?.focus())
                            }}
                            title="重命名"
                            style={{
                              background: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.15)',
                              borderRadius: 4,
                              color: '#94a3b8',
                              padding: '2px 6px',
                              fontSize: 11,
                              cursor: 'pointer',
                              flexShrink: 0
                            }}
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => void removeRegion(name)}
                            title="删除区域"
                            style={{
                              background: 'rgba(239,68,68,0.1)',
                              border: '1px solid rgba(239,68,68,0.2)',
                              borderRadius: 4,
                              color: '#ef4444',
                              padding: '2px 6px',
                              fontSize: 11,
                              cursor: 'pointer',
                              flexShrink: 0
                            }}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {(workspace.windowAnchors ?? []).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      color: '#8b93a3',
                      fontSize: 11,
                      fontWeight: 600,
                      marginBottom: 6
                    }}
                  >
                    窗口锚点
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {(workspace.windowAnchors ?? []).map((anchor) => (
                      <div
                        key={anchor.id}
                        title={`${anchor.title}\n${anchor.ownerPath ?? anchor.ownerName}`}
                        style={{
                          border: '1px solid rgba(16,185,129,0.24)',
                          borderRadius: 6,
                          background: 'rgba(16,185,129,0.07)',
                          padding: '7px 9px',
                          minWidth: 0
                        }}
                      >
                        {renamingWindowAnchorId === anchor.id ? (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <input
                                ref={windowAnchorRenameInputRef}
                                value={windowAnchorRenameValue}
                                onChange={(event) => {
                                  setWindowAnchorRenameValue(event.target.value)
                                  setWindowAnchorRenameError('')
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    void renameWindowAnchor(anchor.id, windowAnchorRenameValue)
                                  }
                                  if (event.key === 'Escape') setRenamingWindowAnchorId(null)
                                }}
                                aria-label={`重命名窗口锚点${anchor.name}`}
                                style={{
                                  ...inputStyle,
                                  flex: 1,
                                  minWidth: 0,
                                  height: 28,
                                  boxSizing: 'border-box',
                                  fontSize: 12,
                                  borderColor: windowAnchorRenameError
                                    ? 'rgba(239,68,68,0.5)'
                                    : 'rgba(16,185,129,0.4)'
                                }}
                              />
                              <button
                                onClick={() =>
                                  void renameWindowAnchor(anchor.id, windowAnchorRenameValue)
                                }
                                style={{
                                  ...smallAccentButtonStyle,
                                  fontSize: 11,
                                  padding: '4px 7px',
                                  flexShrink: 0
                                }}
                              >
                                确认
                              </button>
                              <button
                                onClick={() => setRenamingWindowAnchorId(null)}
                                style={{
                                  ...smallAccentButtonStyle,
                                  background: 'rgba(255,255,255,0.06)',
                                  borderColor: 'rgba(255,255,255,0.1)',
                                  color: '#94a3b8',
                                  fontSize: 11,
                                  padding: '4px 7px',
                                  flexShrink: 0
                                }}
                              >
                                取消
                              </button>
                            </div>
                            {windowAnchorRenameError && (
                              <div style={{ color: '#ef4444', fontSize: 10, marginTop: 4 }}>
                                {windowAnchorRenameError}
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div
                              onDoubleClick={() => {
                                setRenamingWindowAnchorId(anchor.id)
                                setWindowAnchorRenameValue(anchor.name)
                                setWindowAnchorRenameError('')
                              }}
                              title="双击重命名窗口锚点"
                              style={{
                                color: '#34d399',
                                fontSize: 12,
                                fontWeight: 600,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                flex: 1,
                                minWidth: 0,
                                cursor: 'text'
                              }}
                            >
                              {anchor.name}
                            </div>
                            <button
                              onClick={() => {
                                setRenamingWindowAnchorId(anchor.id)
                                setWindowAnchorRenameValue(anchor.name)
                                setWindowAnchorRenameError('')
                              }}
                              title="重命名窗口锚点"
                              style={{
                                background: 'rgba(255,255,255,0.08)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                borderRadius: 4,
                                color: '#94a3b8',
                                padding: '2px 6px',
                                fontSize: 11,
                                cursor: 'pointer',
                                flexShrink: 0
                              }}
                            >
                              ✎
                            </button>
                          </div>
                        )}
                        <div
                          style={{
                            color: '#7c8799',
                            fontSize: 10,
                            marginTop: 3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {anchor.ownerName || anchor.title} · {anchor.capturedBounds.width}×
                          {anchor.capturedBounds.height} · 主窗截图
                          {anchor.capturedImagePath ? '已保存' : '未保存'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 链设计 */}
            <div>
              <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
                链设计
              </div>
              <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
                {(['executionChains', 'chains'] as const).map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      setTab(item)
                      setSelectedChainIdx(0)
                      setSelectedNodeId(null)
                      setSelectedEdgeId(null)
                      setRenamingChainIndex(null)
                    }}
                    style={{
                      ...tabButtonStyle,
                      background: tab === item ? '#10b981' : 'rgba(255,255,255,0.06)',
                      color: tab === item ? '#fff' : '#94a3b8'
                    }}
                  >
                    {chainKindLabel(item)}
                  </button>
                ))}
              </div>
              <div style={{ color: '#64748b', fontSize: 10, marginBottom: 10, lineHeight: 1.5 }}>
                {chainKindHint(tab)}
              </div>

              {currentChain && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 10,
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.025)'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginBottom: 7
                    }}
                  >
                    <span style={{ color: '#cbd5e1', fontSize: 11, fontWeight: 700 }}>
                      当前链功能说明
                    </span>
                    <span style={{ color: '#64748b', fontSize: 9 }}>
                      {chainDescriptionDraft.length}/4000
                    </span>
                  </div>
                  <textarea
                    value={chainDescriptionDraft}
                    maxLength={4000}
                    rows={4}
                    onChange={(event) => setChainDescriptionDraft(event.target.value)}
                    onBlur={commitCurrentChainDescription}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault()
                        commitCurrentChainDescription()
                        event.currentTarget.blur()
                      }
                    }}
                    placeholder={
                      tab === 'executionChains'
                        ? '说明这条主流程解决什么问题、何时运行，以及主要输入和结果。'
                        : '说明这个可复用模块负责什么、由谁调用，以及主要输入和结果。'
                    }
                    style={{
                      ...inputStyle,
                      display: 'block',
                      width: '100%',
                      minHeight: 82,
                      resize: 'vertical',
                      lineHeight: 1.55,
                      fontSize: 11,
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{ color: '#64748b', fontSize: 9, marginTop: 6, lineHeight: 1.45 }}>
                    失焦自动保存，Ctrl+Enter 也可保存；AI 助手会读取这段说明。
                  </div>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8
                }}
              >
                <span style={{ color: '#8b93a3', fontSize: 11 }}>链列表</span>
                <button onClick={addChain} style={smallAccentButtonStyle} disabled={creatingChain}>
                  + 新建
                </button>
              </div>
              {creatingChain && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    data-new-chain-input
                    value={newChainName}
                    onChange={(e) => {
                      setNewChainName(e.target.value)
                      setNewChainError('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmNewChain()
                      if (e.key === 'Escape') {
                        setCreatingChain(false)
                        setNewChainName('')
                        setNewChainError('')
                      }
                    }}
                    placeholder={`智能体${chains.length + 1}`}
                    style={{
                      ...inputStyle,
                      flex: 1,
                      fontSize: 11,
                      height: 28,
                      boxSizing: 'border-box',
                      minWidth: 0,
                      borderColor: newChainError
                        ? 'rgba(239,68,68,0.5)'
                        : 'rgba(16,185,129,0.3)'
                    }}
                  />
                  {newChainError && (
                    <span style={{ color: '#ef4444', fontSize: 10, whiteSpace: 'nowrap' }}>
                      {newChainError}
                    </span>
                  )}
                  <button
                    onClick={confirmNewChain}
                    style={{
                      ...smallAccentButtonStyle,
                      fontSize: 11,
                      padding: '4px 8px',
                      flexShrink: 0
                    }}
                  >
                    确定
                  </button>
                  <button
                    onClick={() => {
                      setCreatingChain(false)
                      setNewChainName('')
                      setNewChainError('')
                    }}
                    style={{
                      ...smallAccentButtonStyle,
                      background: 'rgba(255,255,255,0.06)',
                      borderColor: 'rgba(255,255,255,0.1)',
                      color: '#94a3b8',
                      fontSize: 11,
                      padding: '4px 8px',
                      flexShrink: 0
                    }}
                  >
                    取消
                  </button>
                </div>
              )}
              {chains.length === 0 && !creatingChain && (
                <div style={emptyTextStyle}>暂无{chainKindLabel(tab)}，拖拽步骤到画布创建。</div>
              )}
              {chains.map((chain, index) => {
                const isActive = index === activeChainIdx
                return (
                  <div
                    key={chain.id ?? index}
                    style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}
                  >
                    {renamingChainIndex === index ? (
                      <>
                        <input
                          ref={chainRenameInputRef}
                          value={chainRenameValue}
                          onChange={(e) => {
                            setChainRenameValue(e.target.value)
                            setChainRenameError('')
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') renameChain(index, chainRenameValue)
                            if (e.key === 'Escape') setRenamingChainIndex(null)
                          }}
                          style={{
                            ...inputStyle,
                            flex: 1,
                            fontSize: 11,
                            height: 28,
                            boxSizing: 'border-box',
                            minWidth: 0,
                            borderColor: chainRenameError
                              ? 'rgba(239,68,68,0.5)'
                              : 'rgba(255,255,255,0.15)'
                          }}
                        />
                        {chainRenameError && (
                          <span style={{ color: '#ef4444', fontSize: 10, whiteSpace: 'nowrap' }}>
                            {chainRenameError}
                          </span>
                        )}
                        <button
                          onClick={() => renameChain(index, chainRenameValue)}
                          style={{
                            ...smallAccentButtonStyle,
                            fontSize: 11,
                            padding: '4px 7px',
                            flexShrink: 0
                          }}
                        >
                          确认
                        </button>
                        <button
                          onClick={() => setRenamingChainIndex(null)}
                          style={{
                            ...smallAccentButtonStyle,
                            background: 'rgba(255,255,255,0.06)',
                            borderColor: 'rgba(255,255,255,0.1)',
                            color: '#94a3b8',
                            fontSize: 11,
                            padding: '4px 7px',
                            flexShrink: 0
                          }}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setSelectedChainIdx(index)
                            setSelectedNodeId(null)
                            setSelectedEdgeId(null)
                          }}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '8px 10px',
                            border: `1px solid ${isActive ? 'rgba(16,185,129,0.32)' : 'rgba(255,255,255,0.07)'}`,
                            background: isActive
                              ? 'rgba(16,185,129,0.13)'
                              : 'rgba(255,255,255,0.035)',
                            color: isActive ? '#10b981' : '#d1d5db',
                            borderRadius: 6,
                            fontSize: 12,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            textAlign: 'left',
                            minWidth: 0
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                              alignItems: 'flex-start'
                            }}
                          >
                            <span
                              style={{
                                width: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {chain.name}
                            </span>
                            <span
                              title={chain.description || '尚未填写功能说明'}
                              style={{
                                width: '100%',
                                color: '#64748b',
                                fontSize: 9,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {chain.description || '尚未填写功能说明'}
                            </span>
                          </span>
                          <span style={{ color: '#64748b', fontSize: 10, flexShrink: 0 }}>
                            {chain.nodes.length} 节点
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setRenamingChainIndex(index)
                            setChainRenameValue(chain.name)
                            setChainRenameError('')
                            requestAnimationFrame(() => chainRenameInputRef.current?.focus())
                          }}
                          title="重命名"
                          style={{
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: 4,
                            color: '#94a3b8',
                            padding: '2px 6px',
                            fontSize: 11,
                            cursor: 'pointer',
                            flexShrink: 0
                          }}
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => deleteChain(index)}
                          title="删除链"
                          style={{
                            background: 'rgba(239,68,68,0.1)',
                            border: '1px solid rgba(239,68,68,0.2)',
                            borderRadius: 4,
                            color: '#ef4444',
                            padding: '2px 6px',
                            fontSize: 11,
                            cursor: 'pointer',
                            flexShrink: 0
                          }}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                )
              })}

              {chains.length > 0 && (
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 10, lineHeight: 1.5 }}>
                  点击画布中连线可选中，按 Backspace 或右侧删除连线
                </div>
              )}

              {/* 连线信息（选中连线时显示） */}
              {selectedEdge && selectedEdgeSource && selectedEdgeTarget && (
                <EdgeInfoPanel
                  selectedEdge={selectedEdge}
                  selectedEdgeSource={selectedEdgeSource}
                  selectedEdgeTarget={selectedEdgeTarget}
                  selectedRandomBranchIndex={selectedRandomBranchIndex}
                  selectedRandomBranchTotalWeight={selectedRandomBranchTotalWeight}
                  selectedRandomBranchWeight={selectedRandomBranchWeight}
                  onUpdateBranch={updateSelectedEdgeBranch}
                  onUpdateProbabilityWeight={updateSelectedEdgeProbabilityWeight}
                  onClose={() => setSelectedEdgeId(null)}
                  onDelete={deleteSelectedEdge}
                />
              )}
            </div>
          </>
        )}
      </aside>
      {isApplyingAssistantProposal && (
        <div
          role="status"
          aria-live="assertive"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1000,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(6,8,12,0.56)',
            backdropFilter: 'blur(2px)',
            cursor: 'wait'
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              border: '1px solid rgba(52,211,153,0.35)',
              borderRadius: 8,
              background: '#151821',
              color: '#d1fae5',
              fontSize: 12,
              fontWeight: 600,
              boxShadow: '0 12px 36px rgba(0,0,0,0.4)'
            }}
          >
            正在原子保存 AI 修改，请稍候
          </div>
        </div>
      )}
    </div>
  )
}
