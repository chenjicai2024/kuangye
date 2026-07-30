import {
  AGENT_ASSISTANT_SYSTEM_PROMPT,
  buildAgentAssistantContextPayload,
  buildAgentAssistantUserPrompt
} from './prompt'
import { isRecord } from '../error-utils'
import {
  AgentAssistantJsonFormatError,
  formatAgentAssistantDisplayText,
  parseAgentAssistantResponse,
  simulateAgentEditProposal
} from './proposal'
import type {
  AgentAssistantCollaborationContext,
  AgentAssistantMessage,
  AgentAssistantResponse,
  AgentAssistantReview,
  AgentAssistantSpecialistReport,
  AgentAssistantSpecialistRole,
  AgentAssistantStage,
  AgentAssistantValidationReport,
  AgentContextSnapshot
} from './types'

export type AgentAssistantActor = 'manager' | 'reviewer' | AgentAssistantSpecialistRole

export type AgentAssistantOrchestrationMode = 'direct' | 'focused' | 'diagnostic' | 'edit'

export interface AgentAssistantOrchestrationPlan {
  mode: AgentAssistantOrchestrationMode
  roles: AgentAssistantSpecialistRole[]
  reviewRequired: boolean
}

export interface AgentAssistantModelRequest {
  actor: AgentAssistantActor
  systemPrompt: string
  userPrompt: string
  includeImages: boolean
}

export interface AgentAssistantModelResult {
  text: string
  finishReason?: string
}

export interface AgentAssistantOrchestrationInput {
  request: string
  context: AgentContextSnapshot
  history: AgentAssistantMessage[]
  hasImages: boolean
  resume?: {
    request: string
    collaboration: AgentAssistantCollaborationContext
  }
}

export interface AgentAssistantOrchestrationDependencies {
  callModel: (request: AgentAssistantModelRequest) => Promise<AgentAssistantModelResult>
  onStage?: (stage: AgentAssistantStage, message: string) => void
  onCheckpoint?: (context: AgentAssistantCollaborationContext) => Promise<void> | void
  onFormatFailure?: (input: {
    actor: AgentAssistantActor
    rawResponse: string
    error: unknown
    attempt: number
    finishReason?: string
  }) => Promise<void> | void
}

interface SpecialistDefinition {
  label: string
  systemPrompt: string
}

// 复杂诊断和编辑允许根据真实校验结果持续修正；上限只用于防止模型陷入死循环。
const MAX_REVISION_ROUNDS = 4
const MAX_MODEL_ATTEMPTS = 3

const REPORT_FORMAT = `只返回一个合法 JSON 对象，不要 Markdown：
{"summary":"一句话结论","facts":["已确认事实"],"evidence":["对应证据"],"risks":["风险"],"recommendations":["建议"],"unknowns":["无法确认的信息"],"confidence":0.8}`

const SPECIALISTS: Record<AgentAssistantSpecialistRole, SpecialistDefinition> = {
  project_architect: {
    label: '项目理解员',
    systemPrompt: `你是桌面自动化智能体的项目理解员，是后台只读子智能体，不直接与用户对话。
你的职责是理解当前智能体的业务目标、执行链与动作链分工、链说明、工作记忆以及跨链关系。必须区分结构事实、用户已确认意图和推测。不要生成正式编辑提案，不要编造项目目的、对象 ID 或运行结果。${REPORT_FORMAT}`
  },
  workflow_engineer: {
    label: '流程工程师',
    systemPrompt: `你是桌面自动化智能体的流程工程师，是后台只读子智能体，不直接与用户对话。
你的职责是沿 edges 检查当前流程，核对节点 Skill、用户可编辑字段、节点参数、连线、分支和链引用，并给主助手提供可执行的设计建议。必须用“第 N 个节点 + 名称或类型 + 真实 ID”定位已有节点。不要直接输出 edit_proposal，不要虚构 node-0、chain-0 或区域名。${REPORT_FORMAT}`
  },
  runtime_diagnostician: {
    label: '运行诊断员',
    systemPrompt: `你是桌面自动化智能体的运行诊断员，是后台只读子智能体，不直接与用户对话。
你的职责是依据最近日志、运行状态、工作记忆、节点输入输出、AI 原始响应和聊天记录定位失败阶段。没有出现的运行数据不得声称已经读取；success 只代表没有抛出异常时，仍要核对业务输出。不要启动、停止或修改智能体。${REPORT_FORMAT}`
  },
  visual_inspector: {
    label: '视觉检查员',
    systemPrompt: `你是桌面自动化智能体的视觉检查员，是后台只读子智能体，不直接与用户对话。
你的职责是检查本轮明确附带的画布、框选区域、窗口标准图、运行证据或全屏截图，并把观察结果映射回结构中的区域和节点。只能声称看过实际附带的图片；看不到或无法确定时写入 unknowns。不得点击、输入、创建区域或要求程序自动执行。${REPORT_FORMAT}`
  }
}

const REVIEWER_SYSTEM_PROMPT = `你是桌面自动化智能体构建助手的独立复核员。你不直接回答用户，也不修改 Workspace。
请独立检查候选回答或编辑提案是否：准确回应用户意图；引用真实链、节点、连线和区域；区分事实与推测；遵守用户可编辑权限；通过程序确定性校验；没有遗漏专家报告中的关键风险。普通问答还必须像自然对话一样先直接回答，不能暴露后台专家分工，也不能在用户没要求时扩展成冗长的项目诊断报告。
只返回一个合法 JSON 对象，不要 Markdown：
{"verdict":"pass|revise","issues":["具体问题"],"instructions":"给主助手的修正要求","confidence":0.9}
只要 deterministicValidation.success=false，verdict 必须是 revise。不要自己重写最终答案。`

const SMALL_TALK_PATTERN =
  /^(你好|您好|嗨|hi|hello|在吗|你是谁|你能做什么|谢谢|好的|明白了)[！!。.？?\s]*$/i
const WORKFLOW_PATTERN = /(节点|连线|链|流程|分支|参数|阈值|提示词|画布|自动化)/
const PROJECT_PATTERN = /(智能体|项目|业务|目标|目的|架构|整体|规划|设计)/
const RUNTIME_PATTERN =
  /(运行|执行|日志|报错|错误|失败|异常|卡住|没反应|不生效|没有回复|诊断|阶段|轨迹|记录)/
const VISUAL_PATTERN = /(截图|图像|图片|视觉|框选|区域|窗口|界面|红点|像素|棋盘|坐标|识别)/
const EDIT_ACTION_PATTERN =
  /(创建|新建|增加|添加|修改|改成|改为|调整|删除|移除|移动|重命名|编辑|优化|修复|更新|替换|设置为|帮我做|直接做)/
const DIAGNOSTIC_PATTERN =
  /(诊断|排查|查明|定位|为什么|原因|报错|错误|失败|异常|卡住|没反应|不生效|没有回复|解决问题)/
const FOCUSED_PATTERN = /(详细|深入|全面|仔细|分析|检查|审查|评估|梳理|对比|规划|设计|建议)/

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(0, 30)
    : []
}

function normalizedConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  const unfenced = trimmed
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  const candidates = [unfenced]
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(unfenced.slice(start, end + 1))
  let lastError: unknown
  for (const candidate of Array.from(new Set(candidates))) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (isRecord(parsed)) return parsed
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('模型没有返回 JSON 对象')
}

function hasRuntimeEvidence(context: AgentContextSnapshot): boolean {
  const diagnostics = context.diagnostics
  return Boolean(
    context.recentRuntimeLogs.length > 0 ||
    diagnostics?.liveEngineState ||
    diagnostics?.workMemory?.sessions.length ||
    diagnostics?.workMemory?.cards.length ||
    diagnostics?.chatHistory?.length
  )
}

function hasVisualEvidence(context: AgentContextSnapshot, hasImages: boolean): boolean {
  const evidence = context.diagnostics?.visualEvidence
  return Boolean(
    hasImages ||
    evidence?.canvasCaptured ||
    evidence?.fullScreenCaptured ||
    evidence?.workMemoryScreenshotCount ||
    evidence?.projectAssetScreenshotCount
  )
}

function isEditRequest(request: string): boolean {
  if (!EDIT_ACTION_PATTERN.test(request)) return false
  if (
    /(请|帮我|麻烦|直接|现在|立即|需要你|我要你|给我|我想).{0,24}(创建|新建|增加|添加|修改|改成|改为|调整|删除|移除|移动|重命名|编辑|优化|修复|更新|替换|设置为)/.test(
      request
    )
  ) {
    return true
  }
  if (
    /(把|将).{0,48}(创建|新建|增加|添加|修改|改成|改为|调整|删除|移除|移动|重命名|编辑|优化|修复|更新|替换|设置为)/.test(
      request
    )
  ) {
    return true
  }
  if (
    /^(创建|新建|增加|添加|修改|调整|删除|移除|移动|重命名|编辑|优化|修复|更新|替换)/.test(request)
  ) {
    return !/(了吗|好了没|完成没|是否|能否|能不能|可以吗|可不可以)/.test(request)
  }
  return false
}

export function isAgentAssistantContinuation(message: string): boolean {
  return /(继续|接着|往下|刚才|上面|前面|上一轮|未完成|再试|重试|恢复)/.test(message)
}

export function planAgentAssistantOrchestration(
  request: string,
  context: AgentContextSnapshot,
  hasImages: boolean
): AgentAssistantOrchestrationPlan {
  const trimmed = request.trim()
  if (!trimmed || SMALL_TALK_PATTERN.test(trimmed)) {
    return { mode: 'direct', roles: [], reviewRequired: false }
  }

  const mode: AgentAssistantOrchestrationMode = isEditRequest(trimmed)
    ? 'edit'
    : DIAGNOSTIC_PATTERN.test(trimmed)
      ? 'diagnostic'
      : FOCUSED_PATTERN.test(trimmed)
        ? 'focused'
        : 'direct'

  // 主智能体本身已经获得完整结构化上下文和本轮图片。普通事实、能力确认、
  // 简短解释不委派，避免子智能体把直接问题扩写成后台诊断报告。
  if (mode === 'direct') return { mode, roles: [], reviewRequired: false }

  const roles: AgentAssistantSpecialistRole[] = []
  const hasChains = context.workspace.executionChains.length + context.workspace.chains.length > 0
  const asksAboutWorkflow = WORKFLOW_PATTERN.test(trimmed)
  const asksAboutRuntime = RUNTIME_PATTERN.test(trimmed)
  const asksAboutProject = PROJECT_PATTERN.test(trimmed)

  if (asksAboutProject) roles.push('project_architect')
  if (asksAboutWorkflow || ((mode === 'diagnostic' || mode === 'edit') && hasChains)) {
    roles.push('workflow_engineer')
  }
  if (asksAboutRuntime && hasRuntimeEvidence(context)) {
    roles.push('runtime_diagnostician')
  }
  if (VISUAL_PATTERN.test(trimmed) && hasVisualEvidence(context, hasImages)) {
    roles.push('visual_inspector')
  }
  return {
    mode,
    roles: Array.from(new Set(roles)),
    reviewRequired: mode === 'diagnostic' || mode === 'edit'
  }
}

export function selectAgentAssistantSpecialists(
  request: string,
  context: AgentContextSnapshot,
  hasImages: boolean
): AgentAssistantSpecialistRole[] {
  return planAgentAssistantOrchestration(request, context, hasImages).roles
}

function selectedContextForRole(
  role: AgentAssistantSpecialistRole,
  context: AgentContextSnapshot
): Record<string, unknown> {
  const payload = buildAgentAssistantContextPayload(context) as Record<string, unknown>
  const diagnostics = isRecord(payload.diagnostics) ? payload.diagnostics : undefined
  const common = {
    projectId: payload.projectId,
    projectName: payload.projectName,
    workspaceRevision: payload.workspaceRevision,
    activeChainKind: payload.activeChainKind,
    activeChainId: payload.activeChainId,
    selectedNodeId: payload.selectedNodeId,
    selectedEdgeId: payload.selectedEdgeId
  }
  if (role === 'project_architect') {
    return {
      ...common,
      workspace: payload.workspace,
      workMemory: diagnostics?.workMemory
    }
  }
  if (role === 'workflow_engineer') {
    return {
      ...common,
      canvas: payload.canvas,
      workspace: payload.workspace,
      nodeRuntimeSemantics: payload.nodeRuntimeSemantics,
      nodeSkills: payload.nodeSkills,
      editorCapabilities: payload.editorCapabilities
    }
  }
  if (role === 'runtime_diagnostician') {
    return {
      ...common,
      workspace: payload.workspace,
      recentRuntimeLogs: payload.recentRuntimeLogs,
      diagnostics,
      nodeRuntimeSemantics: payload.nodeRuntimeSemantics,
      nodeSkills: payload.nodeSkills
    }
  }
  return {
    ...common,
    canvas: payload.canvas,
    workspace: payload.workspace,
    visualEvidence: diagnostics?.visualEvidence
  }
}

function conversationHints(history: AgentAssistantMessage[]): object[] {
  return history.slice(-6).map((message) => ({
    role: message.role,
    content:
      message.role === 'assistant'
        ? formatAgentAssistantDisplayText(message.content)
        : message.content
  }))
}

export function buildAgentAssistantSpecialistPrompt(
  role: AgentAssistantSpecialistRole,
  request: string,
  context: AgentContextSnapshot,
  history: AgentAssistantMessage[]
): string {
  return JSON.stringify(
    {
      delegatedTask: request,
      conversationHints: conversationHints(history),
      context: selectedContextForRole(role, context)
    },
    null,
    2
  )
}

export function parseAgentAssistantSpecialistReport(
  raw: string,
  role: AgentAssistantSpecialistRole
): AgentAssistantSpecialistReport {
  try {
    const parsed = parseJsonObject(raw)
    return {
      role,
      summary:
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : '子智能体没有提供摘要。',
      facts: stringArray(parsed.facts),
      evidence: stringArray(parsed.evidence),
      risks: stringArray(parsed.risks),
      recommendations: stringArray(parsed.recommendations),
      unknowns: stringArray(parsed.unknowns),
      confidence: normalizedConfidence(parsed.confidence, 0.5),
      available: true
    }
  } catch {
    const summary = formatAgentAssistantDisplayText(raw).trim()
    return {
      role,
      summary: summary || '子智能体没有返回可用内容。',
      facts: [],
      evidence: [],
      risks: [],
      recommendations: [],
      unknowns: ['返回结果不是结构化报告，主助手只能把它作为低置信度参考。'],
      confidence: summary ? 0.35 : 0,
      available: Boolean(summary)
    }
  }
}

function reportUsedLooseFallback(report: AgentAssistantSpecialistReport): boolean {
  return report.unknowns.some((item) => item.includes('返回结果不是结构化报告'))
}

function unavailableSpecialistReport(
  role: AgentAssistantSpecialistRole,
  error: unknown
): AgentAssistantSpecialistReport {
  return {
    role,
    summary: `${SPECIALISTS[role].label}本轮未完成分析。`,
    facts: [],
    evidence: [],
    risks: [],
    recommendations: [],
    unknowns: [error instanceof Error ? error.message : String(error)],
    confidence: 0,
    available: false
  }
}

function validationForResponse(
  response: AgentAssistantResponse,
  context: AgentContextSnapshot
): AgentAssistantValidationReport {
  if (response.type !== 'edit_proposal' || !response.proposal) {
    return { applicable: false, success: true, errors: [], warnings: [] }
  }
  const simulation = simulateAgentEditProposal(context.workspace, response.proposal)
  if (simulation.success) response.proposal.warnings = simulation.warnings
  return {
    applicable: true,
    success: simulation.success,
    errors: simulation.errors,
    warnings: simulation.warnings
  }
}

function buildReviewerPrompt(
  request: string,
  context: AgentContextSnapshot,
  reports: AgentAssistantSpecialistReport[],
  response: AgentAssistantResponse,
  validation: AgentAssistantValidationReport
): string {
  return JSON.stringify(
    {
      userRequest: request,
      context: buildAgentAssistantContextPayload(context),
      specialistReports: reports,
      candidateResponse: response,
      deterministicValidation: validation
    },
    null,
    2
  )
}

export function parseAgentAssistantReview(raw: string): AgentAssistantReview {
  const parsed = parseJsonObject(raw)
  if (parsed.verdict !== 'pass' && parsed.verdict !== 'revise') {
    throw new Error('复核员没有返回 pass 或 revise')
  }
  return {
    verdict: parsed.verdict,
    issues: stringArray(parsed.issues),
    instructions: typeof parsed.instructions === 'string' ? parsed.instructions.trim() : '',
    confidence: normalizedConfidence(parsed.confidence, 0.5)
  }
}

async function generateManagerResponse(
  input: AgentAssistantOrchestrationInput,
  collaboration: AgentAssistantCollaborationContext,
  dependencies: AgentAssistantOrchestrationDependencies
): Promise<AgentAssistantResponse> {
  const basePrompt = buildAgentAssistantUserPrompt(
    input.request,
    input.context,
    input.history,
    collaboration
  )
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
    const userPrompt =
      attempt === 1
        ? basePrompt
        : `${basePrompt}\n\n【自动重试】上一轮模型调用或输出失败：${lastError instanceof Error ? lastError.message : String(lastError)}。请重新生成同一目的的完整合法 JSON。不要解释重试过程。`
    let result: AgentAssistantModelResult | undefined
    try {
      result = await dependencies.callModel({
        actor: 'manager',
        systemPrompt: AGENT_ASSISTANT_SYSTEM_PROMPT,
        userPrompt,
        includeImages: input.hasImages
      })
      return parseAgentAssistantResponse(
        result.text,
        input.context.projectId,
        input.context.workspaceRevision
      )
    } catch (error) {
      if (isAbortError(error)) throw error
      lastError = error
      await dependencies.onFormatFailure?.({
        actor: 'manager',
        rawResponse: result?.text || '',
        error,
        attempt,
        finishReason: result?.finishReason
      })
      if (!(error instanceof AgentAssistantJsonFormatError) && attempt < MAX_MODEL_ATTEMPTS) {
        dependencies.onStage?.(
          'thinking',
          `本次模型调用失败，主助手正在进行第 ${attempt + 1} 次尝试`
        )
      }
    }
  }
  // 所有重试都失败，返回降级回复
  return {
    type: 'answer',
    content: `抱歉，我遇到了一些技术问题，无法生成完整的回复。请稍后再试，或者简化你的问题。\n\n错误信息：${lastError instanceof Error ? lastError.message : String(lastError)}`
  }
}

async function generateReview(
  input: AgentAssistantOrchestrationInput,
  reports: AgentAssistantSpecialistReport[],
  response: AgentAssistantResponse,
  validation: AgentAssistantValidationReport,
  dependencies: AgentAssistantOrchestrationDependencies
): Promise<AgentAssistantReview> {
  const basePrompt = buildReviewerPrompt(
    input.request,
    input.context,
    reports,
    response,
    validation
  )
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
    let result: AgentAssistantModelResult | undefined
    try {
      result = await dependencies.callModel({
        actor: 'reviewer',
        systemPrompt: REVIEWER_SYSTEM_PROMPT,
        userPrompt:
          attempt === 1
            ? basePrompt
            : `${basePrompt}\n\n上一版复核输出无法解析或请求失败。只重新输出规定的 reviewer JSON。`,
        includeImages: input.hasImages
      })
      return parseAgentAssistantReview(result.text)
    } catch (error) {
      if (isAbortError(error)) throw error
      lastError = error
      await dependencies.onFormatFailure?.({
        actor: 'reviewer',
        rawResponse: result?.text || '',
        error,
        attempt,
        finishReason: result?.finishReason
      })
      if (attempt < MAX_MODEL_ATTEMPTS) {
        dependencies.onStage?.('reviewing', `复核调用失败，正在进行第 ${attempt + 1} 次尝试`)
      }
    }
  }
  return {
    verdict: 'revise',
    issues: [
      `独立复核没有返回可解析结果：${lastError instanceof Error ? lastError.message : String(lastError)}`
    ],
    instructions: '不要提交未经独立复核的结论或编辑提案。',
    confidence: 0
  }
}

function forceRevisionForValidation(
  review: AgentAssistantReview,
  validation: AgentAssistantValidationReport
): AgentAssistantReview {
  if (validation.success) return review
  return {
    verdict: 'revise',
    issues: Array.from(new Set([...review.issues, ...validation.errors])),
    instructions: [review.instructions, '修正全部程序校验错误后重新生成完整结果。']
      .filter(Boolean)
      .join(' '),
    confidence: review.confidence
  }
}

function exhaustedResponse(
  review: AgentAssistantReview,
  validation: AgentAssistantValidationReport
): AgentAssistantResponse {
  const issues = Array.from(new Set([...validation.errors, ...review.issues])).filter(Boolean)
  return {
    type: 'clarification',
    content: `这次结果经过 ${MAX_REVISION_ROUNDS} 轮修正后仍未通过独立复核，因此没有提交不可靠的修改。${
      issues.length > 0 ? `\n需要确认或解决：\n${issues.map((item) => `- ${item}`).join('\n')}` : ''
    }`
  }
}

export async function orchestrateAgentAssistant(
  input: AgentAssistantOrchestrationInput,
  dependencies: AgentAssistantOrchestrationDependencies
): Promise<AgentAssistantResponse> {
  const routingRequest = input.resume
    ? `${input.resume.request}\n用户要求继续处理：${input.request}`
    : input.request
  const plan = planAgentAssistantOrchestration(routingRequest, input.context, input.hasImages)
  const roles = plan.roles
  let reports = (input.resume?.collaboration.specialistReports || []).filter(
    (report) => roles.includes(report.role) && report.available
  )
  const pendingRoles = roles.filter((role) => !reports.some((report) => report.role === role))
  if (pendingRoles.length > 0) {
    dependencies.onStage?.(
      'consulting_specialists',
      `后台专家正在并行分析：${pendingRoles.map((role) => SPECIALISTS[role].label).join('、')}`
    )
    const newReports = await Promise.all(
      pendingRoles.map(async (role) => {
        const definition = SPECIALISTS[role]
        const basePrompt = buildAgentAssistantSpecialistPrompt(
          role,
          input.request,
          input.context,
          input.history
        )
        let lastError: unknown
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            // 给 specialist 调用加超时控制（30秒）
            const result = await Promise.race([
              dependencies.callModel({
                actor: role,
                systemPrompt: definition.systemPrompt,
                userPrompt:
                  attempt === 1
                    ? basePrompt
                    : `${basePrompt}\n\n上一版不是规定的结构化报告。只重新输出完整合法 JSON。`,
                includeImages:
                  input.hasImages && (role === 'runtime_diagnostician' || role === 'visual_inspector')
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('子智能体调用超时（30秒）')), 30_000)
              )
            ])
            const report = parseAgentAssistantSpecialistReport(result.text, role)
            if (!reportUsedLooseFallback(report)) return report
            lastError = new Error('子智能体返回结果不是结构化报告')
            await dependencies.onFormatFailure?.({
              actor: role,
              rawResponse: result.text,
              error: lastError,
              attempt,
              finishReason: result.finishReason
            })
            if (attempt === 2) return report
          } catch (error) {
            if (isAbortError(error)) throw error
            lastError = error
            // 如果是超时错误，直接跳过，不再重试
            if (error instanceof Error && error.message.includes('超时')) {
              break
            }
          }
        }
        return unavailableSpecialistReport(role, lastError)
      })
    )
    reports = [...reports, ...newReports]
  }

  let collaboration: AgentAssistantCollaborationContext = input.resume
    ? { ...input.resume.collaboration, specialistReports: reports }
    : {
        specialistReports: reports,
        revisionRound: 0
      }
  await dependencies.onCheckpoint?.(collaboration)
  let lastReview: AgentAssistantReview = {
    verdict: 'revise',
    issues: ['尚未完成独立复核。'],
    instructions: '',
    confidence: 0
  }
  let lastValidation: AgentAssistantValidationReport = {
    applicable: false,
    success: true,
    errors: [],
    warnings: []
  }

  for (let revisionRound = 0; revisionRound <= MAX_REVISION_ROUNDS; revisionRound += 1) {
    dependencies.onStage?.(
      revisionRound === 0 ? 'drafting' : 'revising',
      revisionRound === 0
        ? reports.length > 0
          ? `已收到 ${reports.length} 份专家报告，主助手正在汇总结论`
          : '主助手正在生成回复'
        : `主助手正在根据复核意见进行第 ${revisionRound} 轮修正`
    )
    const response = await generateManagerResponse(input, collaboration, dependencies)

    const validation = validationForResponse(response, input.context)
    if (validation.applicable) {
      dependencies.onStage?.('validating', '程序正在校验权限、对象 ID 和画布结构')
    }

    // 普通问答和只读解释由主智能体直接完成。若模型意外生成编辑提案，仍强制进入
    // 确定性校验和独立复核，不能因为路由判断而绕过编辑安全边界。
    const shouldReview = plan.reviewRequired || response.type === 'edit_proposal'
    if (!shouldReview && validation.success) {
      collaboration = {
        specialistReports: reports,
        revisionRound,
        previousResponse: response,
        validation
      }
      await dependencies.onCheckpoint?.(collaboration)
      return response
    }

    dependencies.onStage?.('reviewing', '独立复核员正在核对结论和修改提案')
    const review = forceRevisionForValidation(
      await generateReview(input, reports, response, validation, dependencies),
      validation
    )
    if (review.verdict === 'pass' && validation.success) {
      collaboration = {
        specialistReports: reports,
        revisionRound,
        previousResponse: response,
        validation,
        review
      }
      await dependencies.onCheckpoint?.(collaboration)
      return response
    }

    lastReview = review
    lastValidation = validation
    collaboration = {
      specialistReports: reports,
      revisionRound: revisionRound + 1,
      previousResponse: response,
      validation,
      review
    }
    await dependencies.onCheckpoint?.(collaboration)
  }

  return exhaustedResponse(lastReview, lastValidation)
}
