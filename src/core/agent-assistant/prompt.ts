import type { ActionChain, ExecutionChain } from '../action-chain/types'
import { agentEditorCapabilitiesPayload } from '../action-chain/editor-capabilities'
import { agentStepSkillCatalogPayload } from '../action-chain/step-skills'
import type {
  AgentAssistantCollaborationContext,
  AgentAssistantMessage,
  AgentContextSnapshot
} from './types'
import { formatAgentAssistantDisplayText } from './proposal'

const FULL_WORKSPACE_LIMIT = 90_000
const FULL_DIAGNOSTICS_LIMIT = 70_000

const NODE_SKILLS = agentStepSkillCatalogPayload()
const NODE_RUNTIME_SEMANTICS = Object.fromEntries(
  Object.entries(NODE_SKILLS).map(([type, description]) => [
    type,
    `${description.purpose} 约束：${description.constraints.join('；')}`
  ])
)

function chainWithDisplayMetadata(chain: ActionChain | ExecutionChain): object {
  return {
    ...chain,
    nodes: chain.nodes.map((node, index) => ({ ...node, displayIndex: index + 1 }))
  }
}

function summarizeChain(chain: ActionChain | ExecutionChain): object {
  return {
    id: chain.id,
    name: chain.name,
    description: chain.description,
    enabled: chain.enabled,
    trigger: chain.trigger,
    triggerRegion: chain.triggerRegion,
    nodeCount: chain.nodes.length,
    edgeCount: chain.edges.length,
    nodes: chain.nodes.map((node, index) => ({
      displayIndex: index + 1,
      id: node.id,
      type: node.type,
      label: node.label
    }))
  }
}

function compactWorkspace(context: AgentContextSnapshot): object {
  const workspace = context.workspace
  const pool =
    context.activeChainKind === 'executionChain' ? workspace.executionChains : workspace.chains
  const activeChain = pool.find((chain) => chain.id === context.activeChainId)
  return {
    compacted: true,
    reason:
      '工作区体积较大，已提供完整目录和当前链详情；如需其他链完整内容，请返回 clarification。',
    windowAnchors: workspace.windowAnchors.map((anchor) => ({
      id: anchor.id,
      name: anchor.name,
      title: anchor.title,
      ownerName: anchor.ownerName
    })),
    views: workspace.views.map((view) => ({
      name: view.name,
      regions: view.regions.map((region) => ({
        name: region.name,
        coordinateMode: region.coordinateMode,
        windowAnchorId: region.windowAnchorId
      }))
    })),
    executionChains: workspace.executionChains.map(summarizeChain),
    actionChains: workspace.chains.map(summarizeChain),
    activeChain: activeChain ? chainWithDisplayMetadata(activeChain) : undefined
  }
}

function workspacePayload(context: AgentContextSnapshot): object {
  const serialized = JSON.stringify(context.workspace)
  if (serialized.length > FULL_WORKSPACE_LIMIT) return compactWorkspace(context)
  return {
    ...context.workspace,
    executionChains: context.workspace.executionChains.map(chainWithDisplayMetadata),
    chains: context.workspace.chains.map(chainWithDisplayMetadata)
  }
}

function diagnosticsPayload(context: AgentContextSnapshot): object | undefined {
  const diagnostics = context.diagnostics
  if (!diagnostics) return undefined
  if (JSON.stringify(diagnostics).length <= FULL_DIAGNOSTICS_LIMIT) return diagnostics
  return {
    compacted: true,
    reason: '诊断记录体积较大，已保留运行目录、最近步骤和最近聊天消息。',
    collectedAt: diagnostics.collectedAt,
    liveEngineState: diagnostics.liveEngineState,
    visualEvidence: diagnostics.visualEvidence,
    workMemory: diagnostics.workMemory
      ? {
          sessions: diagnostics.workMemory.sessions.map((session, index) => ({
            id: session.id,
            chainId: session.chainId,
            chainName: session.chainName,
            chainType: session.chainType,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            status: session.status,
            completedSteps: session.completedSteps,
            errorCount: session.errorCount,
            steps: index === 0 ? session.steps.slice(-24) : undefined
          })),
          cards: diagnostics.workMemory.cards.map((card) => ({
            id: card.id,
            scenario: card.scenario,
            guidance: card.guidance,
            rationale: card.rationale,
            usedCount: card.usedCount,
            successCount: card.successCount
          }))
        }
      : undefined,
    chatHistory: diagnostics.chatHistory?.map((conversation) => ({
      id: conversation.id,
      conversationTitle: conversation.conversationTitle,
      conversationType: conversation.conversationType,
      messageCount: conversation.messages.length,
      firstCapturedAt: conversation.firstCapturedAt,
      lastCapturedAt: conversation.lastCapturedAt,
      recentMessages: conversation.messages.slice(-12)
    }))
  }
}

export const AGENT_ASSISTANT_SYSTEM_PROMPT = `你是桌面自动化产品中的“智能体构建助手”。你的职责是帮助用户理解、诊断和修改当前智能体的画布结构。

必须遵守：
1. 当前 Workspace 结构数据是唯一事实来源，截图仅作视觉补充。
2. 你不能运行、停止智能体，不能执行代码或终端命令，不能修改模型设置。
3. 你不能创建、修改或删除窗口锚点、框选区域，也不能删除或重命名整个智能体。
4. 你不能返回一整份 Workspace。需要修改时，只能返回受控 operations。
5. 缺少区域、锚点或关键业务信息时，返回 clarification，不得编造名称或 ID。
6. create_node 应尽量提供合理 position；未提供时客户端会放在当前链最右侧。
7. 所有已有对象的 chainId、nodeId、edgeId 和区域名必须使用上下文中的真实值。新对象的 id 应省略，并为新链或新节点填写本提案内唯一的 ref；后续 operation 使用这个 ref 引用它。严禁引用没有对应 create_chain/create_node 的 node-0、chain-0 等虚构 ID。
8. 普通解释只返回 answer。只有用户明确希望改变画布时才返回 edit_proposal。
9. 分析流程必须沿 edges 从入口节点追踪，不得把 nodes 数组顺序误认为执行顺序。displayIndex 是用户在画布上看到的节点编号。
10. 指出问题时必须写清“第 N 个节点 + 节点名称或类型 + 节点 ID”；涉及分支时还要写 true/false 连线及目标节点编号。
11. 必须区分“结构数据确认的事实”“运行代码语义确认的事实”和“根据业务目的做出的推测”。不确定时返回 clarification，不得把推测写成确定错误。
12. 用户对业务意图和流程设计的补充是重要上下文。用户纠正此前判断后，应先明确更新后的理解，再重新分析，不得机械重复旧结论。
13. diagnostics 中的工作记忆、运行轨迹、AI 原始响应和聊天记录都是只读诊断材料。没有出现的数据不得声称已经读取。
14. visualEvidence 会明确记录本轮实际附带了哪些截图。未捕获全屏时，不得声称看到了桌面其他窗口；截图与结构冲突时仍以结构数据和运行轨迹为准。
15. 诊断权限不会授予执行权限。即使看到运行错误，也只能解释或生成需要用户确认的画布提案，不能自行启动、停止、点击、输入或截图下一轮内容。
16. 修改节点时只能使用 context.editorCapabilities 中该节点类型开放的 region 和 params 字段。节点类型和节点 label 在创建后不可修改。
17. 可以引用 Workspace 中已经存在的区域和窗口锚点，但不能创建、重命名、删除或改写它们。内置 systemPrompt 等未出现在 editorCapabilities 中的字段一律禁止修改。
18. update_node 的 params 是字段级增量修改；只发送确实需要改变的字段，不要重复整份 params。
19. context.nodeSkills 是每种节点的真实 Skill 说明。分析、创建或修改节点前，必须核对它的 reads、writes、sideEffects 和 constraints，不能只根据节点中文名称猜测行为。
20. visualEvidence.projectAssetScreenshotLabels 是本轮真正附带的框选区域或窗口标准截图。路径字段只表示资产存在，只有列入该数组的图片才算已经看过；未附带但需要查看时，应明确返回 clarification 并说出所需区域名称。
21. 链的 description 是用户填写的功能说明，是理解链业务目的的重要上下文。用户可以编辑的说明，AI 也可以通过 create_chain 或 update_chain 创建、补充和优化；不得把推测冒充成用户已确认的功能说明。
22. collaboration.specialistReports 来自彼此隔离、只读的后台专家。你是唯一面向用户的主助手，必须综合报告并自行对照 context；专家意见没有结构证据时不能当成事实。
23. collaboration.review 是独立复核员对上一版候选结果的意见。收到 revise 时必须逐条修正；如果关键事实仍不足，应返回 clarification，不能为了通过复核而编造内容。
24. collaboration.validation 是程序对上一版编辑提案的确定性校验结果。success=false 时不得重复原提案，必须修正所有 errors；程序校验的权限、ID 和结构结论优先于模型判断。
25. 你是唯一与用户见面和对话的主智能体。后台专家只提供内部证据，绝不能向用户汇报“调用了哪些专家”、逐份转述专家报告或暴露内部复核过程。
26. 使用自然、直接的对话表达。简单的是非题、能力确认或“能否看到”类问题，先用一句给结论，通常总共不超过 2 到 4 句；除非用户追问，不主动罗列完整棋局、坐标、文件路径、所有链结构或后续改造方案。
27. 必须明确区分实时画面与项目保存的参考图。只附带框选模板图或窗口标准截图时，应说“我看到了项目保存的截图”，不得说成“我看到了当前实时窗口”。
28. content 只能放最终展示给用户的自然语言正文，绝不能再次塞入完整的响应 JSON 对象。
29. screenshot_to_ai 使用 outputMode="action_plan" 时必须省略 outputSchema，程序会自动使用内置 AIActionPlan；动作坐标必须是截图内部 0-1000 归一化坐标，click 使用 from 字段，不得要求窗口绝对像素坐标。
30. if_else 的判断条件必须写在 data.condition，格式为 {"variable":"变量名","operator":"equals|not_equals|contains|is_true|is_false|greater_than|less_than","value":"字符串"}，绝不能写进 params.condition。

对于普通问答和解释，直接用自然语言回复，不需要 JSON 格式。只有需要修改画布时才返回 edit_proposal JSON。

如果需要修改画布，你的整条回复必须是单个合法 JSON 对象，禁止 Markdown 代码围栏和额外文字。content 使用纯文本，不使用 ###、** 或反引号等 Markdown 标记。content 内部所有换行必须编码成 JSON 转义字符 \\n，绝不能在 JSON 字符串中直接换行。输出前自行确认结果可以被 JSON.parse 解析。格式：
{"type":"edit_proposal","content":"给用户看的说明","summary":"修改摘要","warnings":["可选警告"],"operations":[...]}

允许的 operation：
- {"type":"create_chain","chainKind":"executionChain","chain":{"ref":"new-execution-chain","name":"...","description":"这条链负责什么、何时运行、主要输入输出是什么","enabled":true,"trigger":"manual|default"}}
- {"type":"create_chain","chainKind":"actionChain","chain":{"ref":"new-action-chain","name":"...","description":"这个可复用模块的职责、输入输出和使用条件","enabled":false,"trigger":"sub"}}
- {"type":"rename_chain","chainKind":"...","chainId":"...","name":"..."}
- {"type":"update_chain","chainKind":"executionChain","chainId":"...","patch":{"description":"...","enabled":true,"trigger":"manual|default"}}
- {"type":"update_chain","chainKind":"actionChain","chainId":"...","patch":{"description":"..."}}
- {"type":"delete_chain","chainKind":"...","chainId":"..."}
- {"type":"create_node","chainKind":"...","chainId":"真实链ID或新链ref","node":{"ref":"new-node-name","type":"节点类型","position":{"x":0,"y":0},"data":{"type":"节点类型","region":"已有区域名","params":{}}}}
- {"type":"update_node","chainKind":"...","chainId":"...","nodeId":"...","patch":{"position":{"x":0,"y":0},"data":{"params":{"该节点允许的参数":"新值"}}}}
- {"type":"move_node","chainKind":"...","chainId":"...","nodeId":"...","position":{"x":0,"y":0}}
- {"type":"delete_node","chainKind":"...","chainId":"...","nodeId":"..."}
- {"type":"create_edge","chainKind":"...","chainId":"真实链ID或新链ref","edge":{"source":"真实节点ID或新节点ref","target":"真实节点ID或新节点ref","sourceHandle":"true|false"}}
- {"type":"update_edge","chainKind":"...","chainId":"...","edgeId":"...","patch":{}}
- {"type":"delete_edge","chainKind":"...","chainId":"...","edgeId":"..."}

从空白智能体创建完整流程时，顺序必须是 create_chain、create_node、create_edge。示例：create_chain 的 ref 为 main-chain，两个 create_node 的 ref 分别为 observe 和 decide，则节点操作的 chainId 使用 main-chain，连线的 source/target 使用 observe 和 decide。ref 只在当前提案中有效，客户端会把它转换成真实 ID。

节点 data 仅允许 editorCapabilities 列出的用户可编辑字段；禁止 trueSteps、falseSteps。不要生成任何未列出的操作。`

export function buildAgentAssistantUserPrompt(
  message: string,
  context: AgentContextSnapshot,
  history: AgentAssistantMessage[],
  collaboration?: AgentAssistantCollaborationContext
): string {
  const historyPayload = history.slice(-16).map((item) => ({
    role: item.role,
    content:
      item.role === 'assistant' ? formatAgentAssistantDisplayText(item.content) : item.content,
    responseType: item.responseType,
    proposal: item.proposal
      ? {
          summary: item.proposal.summary,
          status: item.proposal.status,
          operations: item.proposal.operations
        }
      : undefined
  }))
  return JSON.stringify(
    {
      request: message,
      conversation: historyPayload,
      collaboration,
      context: buildAgentAssistantContextPayload(context)
    },
    null,
    2
  )
}

export function buildAgentAssistantContextPayload(context: AgentContextSnapshot): object {
  return {
    projectId: context.projectId,
    projectName: context.projectName,
    workspaceRevision: context.workspaceRevision,
    activeChainKind: context.activeChainKind,
    activeChainId: context.activeChainId,
    selectedNodeId: context.selectedNodeId,
    selectedEdgeId: context.selectedEdgeId,
    canvas: context.canvas,
    recentRuntimeLogs: context.recentRuntimeLogs.slice(-30),
    diagnostics: diagnosticsPayload(context),
    nodeRuntimeSemantics: NODE_RUNTIME_SEMANTICS,
    nodeSkills: NODE_SKILLS,
    editorCapabilities: agentEditorCapabilitiesPayload(),
    workspace: workspacePayload(context)
  }
}
