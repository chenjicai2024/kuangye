import type {
  ActionStep,
  EngineState,
  FlowEdge,
  FlowNode,
  FlowPortSide,
  StepType,
  TriggerType,
  Workspace
} from '../action-chain/types'
import type { ChatConversation } from '../chat-history/types'
import type { ExperienceCard, RunSession } from '../work-memory/types'

export type AgentChainKind = 'executionChain' | 'actionChain'
export type AgentAssistantResponseType = 'answer' | 'clarification' | 'edit_proposal'
export type AgentEditProposalStatus = 'pending' | 'applied' | 'rejected' | 'expired'
export type AgentAssistantSpecialistRole =
  | 'project_architect'
  | 'workflow_engineer'
  | 'runtime_diagnostician'
  | 'visual_inspector'

export interface AgentCanvasContext {
  pan: { x: number; y: number }
  zoom: number
  width: number
  height: number
}

export interface AgentAssistantPermissions {
  includeProjectAssets: boolean
  includeWorkMemory: boolean
  includeChatHistory: boolean
  captureFullScreen: boolean
}

export interface AgentDiagnosticContext {
  collectedAt: number
  liveEngineState?: EngineState
  workMemory?: {
    sessions: RunSession[]
    cards: ExperienceCard[]
  }
  chatHistory?: ChatConversation[]
  visualEvidence: {
    canvasCaptured: boolean
    fullScreenCaptured: boolean
    workMemoryScreenshotCount: number
    projectAssetAvailableCount: number
    projectAssetScreenshotCount: number
    projectAssetScreenshotLabels: string[]
    projectAssetOmittedCount: number
  }
}

export interface AgentContextSnapshot {
  projectId: string
  projectName: string
  workspace: Workspace
  workspaceRevision: number
  activeChainKind: AgentChainKind
  activeChainId?: string
  selectedNodeId?: string
  selectedEdgeId?: string
  canvas: AgentCanvasContext
  recentRuntimeLogs: string[]
  diagnostics?: AgentDiagnosticContext
}

export interface AgentAssistantMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  responseType?: AgentAssistantResponseType
  proposal?: AgentEditProposal
}

export interface AgentAssistantSession {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AgentAssistantMessage[]
  checkpoint?: AgentAssistantCheckpoint
}

export interface CreateChainOperation {
  type: 'create_chain'
  chainKind: AgentChainKind
  chain: {
    id?: string
    /** Proposal-local reference used by later operations before the real id is known. */
    ref?: string
    name: string
    description?: string
    enabled?: boolean
    trigger?: TriggerType
    triggerRegion?: string
  }
}

export interface RenameChainOperation {
  type: 'rename_chain'
  chainKind: AgentChainKind
  chainId: string
  name: string
}

export interface UpdateChainOperation {
  type: 'update_chain'
  chainKind: AgentChainKind
  chainId: string
  patch: {
    description?: string
    enabled?: boolean
    trigger?: 'manual' | 'default'
  }
}

export interface DeleteChainOperation {
  type: 'delete_chain'
  chainKind: AgentChainKind
  chainId: string
}

export interface CreateNodeOperation {
  type: 'create_node'
  chainKind: AgentChainKind
  chainId: string
  node: {
    id?: string
    /** Proposal-local reference used by later operations before the real id is known. */
    ref?: string
    type: StepType
    position?: { x: number; y: number }
    data?: Partial<ActionStep>
  }
}

export interface UpdateNodeOperation {
  type: 'update_node'
  chainKind: AgentChainKind
  chainId: string
  nodeId: string
  patch: {
    position?: { x: number; y: number }
    data?: Omit<Partial<ActionStep>, 'type' | 'trueSteps' | 'falseSteps'>
  }
}

export interface MoveNodeOperation {
  type: 'move_node'
  chainKind: AgentChainKind
  chainId: string
  nodeId: string
  position: { x: number; y: number }
}

export interface DeleteNodeOperation {
  type: 'delete_node'
  chainKind: AgentChainKind
  chainId: string
  nodeId: string
}

export interface CreateEdgeOperation {
  type: 'create_edge'
  chainKind: AgentChainKind
  chainId: string
  edge: {
    id?: string
    source: string
    target: string
    sourceHandle?: 'true' | 'false' | 'start' | 'stop' | 'continue' | 'exit'
    sourcePort?: FlowPortSide
    targetPort?: FlowPortSide
    probabilityWeight?: number
  }
}

export interface UpdateEdgeOperation {
  type: 'update_edge'
  chainKind: AgentChainKind
  chainId: string
  edgeId: string
  patch: Partial<Omit<FlowEdge, 'id'>>
}

export interface DeleteEdgeOperation {
  type: 'delete_edge'
  chainKind: AgentChainKind
  chainId: string
  edgeId: string
}

export type AgentEditOperation =
  | CreateChainOperation
  | RenameChainOperation
  | UpdateChainOperation
  | DeleteChainOperation
  | CreateNodeOperation
  | UpdateNodeOperation
  | MoveNodeOperation
  | DeleteNodeOperation
  | CreateEdgeOperation
  | UpdateEdgeOperation
  | DeleteEdgeOperation

export interface AgentEditProposal {
  id: string
  projectId: string
  baseRevision: number
  summary: string
  operations: AgentEditOperation[]
  warnings: string[]
  status: AgentEditProposalStatus
  createdAt: number
}

export interface AgentAssistantResponse {
  type: AgentAssistantResponseType
  content: string
  proposal?: AgentEditProposal
}

export interface AgentAssistantSpecialistReport {
  role: AgentAssistantSpecialistRole
  summary: string
  facts: string[]
  evidence: string[]
  risks: string[]
  recommendations: string[]
  unknowns: string[]
  confidence: number
  available: boolean
}

export interface AgentAssistantReview {
  verdict: 'pass' | 'revise'
  issues: string[]
  instructions: string
  confidence: number
}

export interface AgentAssistantValidationReport {
  applicable: boolean
  success: boolean
  errors: string[]
  warnings: string[]
}

export interface AgentAssistantCollaborationContext {
  specialistReports: AgentAssistantSpecialistReport[]
  revisionRound: number
  previousResponse?: AgentAssistantResponse
  validation?: AgentAssistantValidationReport
  review?: AgentAssistantReview
}

export type AgentAssistantCheckpointStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface AgentAssistantCheckpoint {
  requestId: string
  request: string
  status: AgentAssistantCheckpointStatus
  collaboration: AgentAssistantCollaborationContext
  createdAt: number
  updatedAt: number
  error?: string
}

export type AgentAssistantStage =
  | 'preparing_context'
  | 'consulting_specialists'
  | 'drafting'
  | 'thinking'
  | 'validating'
  | 'reviewing'
  | 'revising'
  | 'completed'

export type AgentAssistantEvent =
  | {
      type: 'status'
      requestId: string
      sessionId: string
      stage: AgentAssistantStage
      message: string
    }
  | {
      type: 'message'
      requestId: string
      sessionId: string
      message: AgentAssistantMessage
    }
  | {
      type: 'error'
      requestId: string
      sessionId: string
      error: string
    }
  | {
      type: 'done'
      requestId: string
      sessionId: string
    }

export interface AgentAssistantSendPayload {
  projectId: string
  sessionId: string
  message: string
  context: AgentContextSnapshot
  permissions?: Partial<AgentAssistantPermissions>
  canvasCaptureRect?: { x: number; y: number; width: number; height: number }
}

export interface AgentProposalDiff {
  addedNodeIds: string[]
  updatedNodeIds: string[]
  deletedNodes: FlowNode[]
  addedEdgeIds: string[]
  updatedEdgeIds: string[]
  deletedEdges: FlowEdge[]
  affectedChains: Array<{ chainKind: AgentChainKind; chainId: string; chainName: string }>
}

export interface AgentProposalSimulation {
  success: boolean
  workspace: Workspace
  errors: string[]
  warnings: string[]
  diff: AgentProposalDiff
}
