import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentAssistantEvent,
  AgentAssistantPermissions,
  AgentAssistantSendPayload,
  AgentAssistantSession,
  AgentEditProposal,
  AgentEditProposalStatus
} from '../../../core/agent-assistant/types'
import { formatAgentAssistantDisplayText } from '../../../core/agent-assistant/proposal'

interface AgentAssistantPanelProps {
  projectId: string
  projectName: string
  workspaceRevision: number
  interactionMode?: 'editor' | 'library'
  buildSendPayload: (
    message: string,
    sessionId: string,
    permissions: AgentAssistantPermissions
  ) => AgentAssistantSendPayload
  onPreview?: (proposal: AgentEditProposal) => { success: boolean; error?: string }
  onApply?: (proposal: AgentEditProposal) => Promise<{ success: boolean; error?: string }>
  onClearPreview?: (proposalId?: string) => void
  onOpenEditor?: (proposal: AgentEditProposal) => Promise<void>
}

interface SessionListResult {
  sessions?: AgentAssistantSession[]
}

interface SessionResult {
  success?: boolean
  session?: AgentAssistantSession | null
  error?: string
}

function proposalCounts(proposal: AgentEditProposal): {
  chains: number
  nodes: number
  edges: number
} {
  const chains = new Set<string>()
  let nodes = 0
  let edges = 0
  for (const operation of proposal.operations) {
    if ('chainId' in operation) chains.add(`${operation.chainKind}:${operation.chainId}`)
    if (operation.type.endsWith('_chain')) chains.add(`${operation.chainKind}:new`)
    if (operation.type.endsWith('_node')) nodes += 1
    if (operation.type.endsWith('_edge')) edges += 1
  }
  return { chains: chains.size, nodes, edges }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

async function copyAssistantText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Electron/Chromium 未授予 Clipboard API 时使用下方兼容方案。
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

export function AgentAssistantPanel({
  projectId,
  projectName,
  workspaceRevision,
  interactionMode = 'editor',
  buildSendPayload,
  onPreview,
  onApply,
  onClearPreview,
  onOpenEditor
}: AgentAssistantPanelProps): React.ReactElement {
  const [sessions, setSessions] = useState<AgentAssistantSession[]>([])
  const [activeSession, setActiveSession] = useState<AgentAssistantSession | null>(null)
  const [draft, setDraft] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [stageText, setStageText] = useState('准备就绪')
  const [error, setError] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [previewedProposalId, setPreviewedProposalId] = useState<string | null>(null)
  const [applyingProposalId, setApplyingProposalId] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<AgentAssistantPermissions>({
    includeProjectAssets: true,
    includeWorkMemory: true,
    includeChatHistory: true,
    captureFullScreen: false
  })
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const onClearPreviewRef = useRef(onClearPreview)
  const expiredProposalIdsRef = useRef(new Set<string>())
  const finishedRequestIdsRef = useRef(new Set<string>())
  const activeRequestIdRef = useRef<string | null>(null)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const activeSessionId = activeSession?.id ?? ''

  useEffect(() => {
    onClearPreviewRef.current = onClearPreview
  }, [onClearPreview])

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
      if (activeRequestIdRef.current) {
        void window.electron?.invoke('agent-assistant:cancel', {
          requestId: activeRequestIdRef.current
        })
      }
    }
  }, [])

  const copyMessage = useCallback(async (messageId: string, content: string): Promise<void> => {
    const copied = await copyAssistantText(content)
    if (!copied) {
      setError('复制失败，请手动选择消息文字复制')
      return
    }
    setError('')
    setCopiedMessageId(messageId)
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopiedMessageId((current) => (current === messageId ? null : current))
      copyFeedbackTimerRef.current = null
    }, 1600)
  }, [])

  const loadSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const result = (await window.electron?.invoke('agent-assistant:loadSession', {
        projectId,
        sessionId
      })) as SessionResult | undefined
      setActiveSession(result?.session ?? null)
      setPreviewedProposalId(null)
      onClearPreviewRef.current?.()
    },
    [projectId]
  )

  const refreshSessions = useCallback(
    async (preferredSessionId?: string): Promise<void> => {
      if (!projectId) return
      const result = (await window.electron?.invoke('agent-assistant:listSessions', projectId)) as
        | SessionListResult
        | undefined
      let list = result?.sessions ?? []
      if (list.length === 0) {
        const created = (await window.electron?.invoke(
          'agent-assistant:createSession',
          projectId
        )) as SessionResult | undefined
        if (created?.session) list = [created.session]
      }
      setSessions(list)
      const nextId =
        preferredSessionId && list.some((session) => session.id === preferredSessionId)
          ? preferredSessionId
          : list[0]?.id
      if (nextId) await loadSession(nextId)
      else setActiveSession(null)
    },
    [loadSession, projectId]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshSessions(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshSessions])

  useEffect(() => {
    const cleanup = window.electron?.on('agent-assistant:event', (rawEvent: unknown) => {
      const event = rawEvent as AgentAssistantEvent
      if (!activeSessionId || event.sessionId !== activeSessionId) return
      if (requestId && event.requestId !== requestId) return
      if (event.type === 'status') {
        setStageText(event.message)
      } else if (event.type === 'message') {
        void loadSession(event.sessionId).then(() => refreshSessions(event.sessionId))
      } else if (event.type === 'error') {
        setError(event.error)
        setStageText('生成失败')
      } else if (event.type === 'done') {
        finishedRequestIdsRef.current.add(event.requestId)
        window.setTimeout(() => finishedRequestIdsRef.current.delete(event.requestId), 5000)
        if (activeRequestIdRef.current === event.requestId) activeRequestIdRef.current = null
        setRequestId((current) => (current === event.requestId ? null : current))
      }
    })
    return cleanup
  }, [activeSessionId, loadSession, refreshSessions, requestId])

  useEffect(() => {
    const element = messagesRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [activeSession?.messages, stageText])

  useEffect(() => {
    if (interactionMode !== 'editor' || !activeSession) return
    const staleProposals = activeSession.messages
      .map((message) => message.proposal)
      .filter(
        (proposal): proposal is AgentEditProposal =>
          proposal?.status === 'pending' &&
          proposal.baseRevision !== workspaceRevision &&
          !expiredProposalIdsRef.current.has(proposal.id)
      )
    for (const proposal of staleProposals) {
      expiredProposalIdsRef.current.add(proposal.id)
      void window.electron?.invoke('agent-assistant:updateProposalStatus', {
        projectId,
        sessionId: activeSession.id,
        proposalId: proposal.id,
        status: 'expired'
      })
    }
  }, [activeSession, interactionMode, projectId, workspaceRevision])

  async function createSession(): Promise<void> {
    if (requestId) return
    const result = (await window.electron?.invoke('agent-assistant:createSession', projectId)) as
      | SessionResult
      | undefined
    if (!result?.session) {
      setError(result?.error ?? '新建会话失败')
      return
    }
    await refreshSessions(result.session.id)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  async function deleteSession(): Promise<void> {
    if (!activeSession || requestId) return
    if (!window.confirm('确定删除当前 AI 助手会话吗？此操作无法撤销。')) return
    await window.electron?.invoke('agent-assistant:deleteSession', {
      projectId,
      sessionId: activeSession.id
    })
    onClearPreview?.()
    await refreshSessions()
  }

  async function sendMessage(): Promise<void> {
    const message = draft.trim()
    if (!message || !activeSession || requestId) return
    setDraft('')
    setError('')
    setStageText('正在提交问题')
    const optimisticMessage = {
      id: `local-${Date.now()}`,
      role: 'user' as const,
      content: message,
      createdAt: Date.now()
    }
    setActiveSession((previous) =>
      previous ? { ...previous, messages: [...previous.messages, optimisticMessage] } : previous
    )
    const result = (await window.electron?.invoke(
      'agent-assistant:send',
      buildSendPayload(message, activeSession.id, permissions)
    )) as { accepted?: boolean; requestId?: string; error?: string } | undefined
    if (!result?.accepted || !result.requestId) {
      setError(result?.error ?? '发送失败')
      setStageText('发送失败')
      await loadSession(activeSession.id)
      return
    }
    if (finishedRequestIdsRef.current.has(result.requestId)) {
      finishedRequestIdsRef.current.delete(result.requestId)
      setRequestId(null)
    } else {
      activeRequestIdRef.current = result.requestId
      setRequestId(result.requestId)
    }
  }

  async function stopGeneration(): Promise<void> {
    if (!requestId) return
    await window.electron?.invoke('agent-assistant:cancel', { requestId })
    activeRequestIdRef.current = null
    setRequestId(null)
    setStageText('已停止生成')
  }

  async function setProposalStatus(
    proposal: AgentEditProposal,
    status: AgentEditProposalStatus
  ): Promise<void> {
    if (!activeSession) return
    await window.electron?.invoke('agent-assistant:updateProposalStatus', {
      projectId,
      sessionId: activeSession.id,
      proposalId: proposal.id,
      status
    })
    await loadSession(activeSession.id)
  }

  function previewProposal(proposal: AgentEditProposal): void {
    setError('')
    if (!onPreview) {
      setError('请进入编辑器后再预览这份提案')
      return
    }
    const result = onPreview(proposal)
    if (!result.success) {
      setError(result.error ?? '提案无法预览')
      return
    }
    setPreviewedProposalId(proposal.id)
    setStageText('提案已显示在画布上')
  }

  async function applyProposal(proposal: AgentEditProposal): Promise<void> {
    if (previewedProposalId !== proposal.id || !onApply) return
    setApplyingProposalId(proposal.id)
    setError('')
    const result = await onApply(proposal)
    setApplyingProposalId(null)
    if (!result.success) {
      setError(result.error ?? '应用修改失败，画布未发生变化')
      return
    }
    await setProposalStatus(proposal, 'applied')
    setPreviewedProposalId(null)
    setStageText('修改已保存，可使用撤销恢复')
  }

  async function rejectProposal(proposal: AgentEditProposal): Promise<void> {
    onClearPreview?.(proposal.id)
    setPreviewedProposalId(null)
    await setProposalStatus(proposal, 'rejected')
    setStageText('已拒绝修改提案')
  }

  async function openEditorForProposal(proposal: AgentEditProposal): Promise<void> {
    if (!onOpenEditor || applyingProposalId) return
    setApplyingProposalId(proposal.id)
    setError('')
    try {
      await onOpenEditor(proposal)
      setStageText('编辑器已打开，请在画布中预览并确认提案')
    } catch (openError) {
      console.error('打开智能体编辑器失败:', openError)
      setError('打开编辑器失败，请重试')
    } finally {
      setApplyingProposalId(null)
    }
  }

  const busy = Boolean(requestId)
  const statusLabel = useMemo(() => {
    if (busy) return stageText
    return `${projectName || '当前智能体'} · ${stageText}`
  }, [busy, projectName, stageText])

  return (
    <div className="agent-assistant-panel">
      <div className="agent-assistant-session-bar">
        <div className="agent-assistant-session-row">
          <label htmlFor="agent-assistant-session">会话</label>
          <select
            id="agent-assistant-session"
            value={activeSessionId}
            disabled={busy}
            onChange={(event) => void loadSession(event.target.value)}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void createSession()} disabled={busy}>
            ＋ 新会话
          </button>
          <button
            type="button"
            className="agent-assistant-danger-button"
            onClick={() => void deleteSession()}
            disabled={busy || !activeSession}
            title="删除当前会话"
          >
            删除
          </button>
        </div>
        <div className="agent-assistant-context-row">
          <span className="agent-assistant-stage" aria-live="polite">
            {statusLabel}
          </span>
          <details className="agent-assistant-permissions">
            <summary>诊断权限</summary>
            <div className="agent-assistant-permission-popover">
              <strong>本轮只读上下文</strong>
              <span>
                {interactionMode === 'editor'
                  ? '画布结构与当前画布截图始终可见，不授予运行或点击权限。'
                  : '智能体结构始终可见；项目中心不截取画布，也不授予运行或点击权限。'}
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={permissions.includeProjectAssets}
                  onChange={(event) =>
                    setPermissions((current) => ({
                      ...current,
                      includeProjectAssets: event.target.checked
                    }))
                  }
                />
                框选区域与窗口标准截图
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={permissions.includeWorkMemory}
                  onChange={(event) =>
                    setPermissions((current) => ({
                      ...current,
                      includeWorkMemory: event.target.checked
                    }))
                  }
                />
                工作记忆、运行轨迹与 AI 响应
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={permissions.includeChatHistory}
                  onChange={(event) =>
                    setPermissions((current) => ({
                      ...current,
                      includeChatHistory: event.target.checked
                    }))
                  }
                />
                当前智能体的聊天记录
              </label>
              <label className="agent-assistant-sensitive-permission">
                <input
                  type="checkbox"
                  checked={permissions.captureFullScreen}
                  onChange={(event) =>
                    setPermissions((current) => ({
                      ...current,
                      captureFullScreen: event.target.checked
                    }))
                  }
                />
                每次发送时截取当前屏幕
              </label>
              <small>屏幕截图仅发送给当前模型，不写入助手历史或智能体文件。</small>
            </div>
          </details>
        </div>
        <div className="agent-assistant-context-badges" aria-label="当前诊断上下文">
          <span>{interactionMode === 'editor' ? '当前画布' : '智能体结构'}</span>
          {permissions.includeProjectAssets && <span>框选截图</span>}
          {permissions.includeWorkMemory && <span>工作记忆</span>}
          {permissions.includeChatHistory && <span>聊天记录</span>}
          {permissions.captureFullScreen && <span className="is-sensitive">当前屏幕</span>}
        </div>
      </div>

      <div ref={messagesRef} className="agent-assistant-messages" aria-live="polite">
        {activeSession?.messages.length === 0 && (
          <div className="agent-assistant-empty">
            <strong>告诉 AI 你想理解或修改什么</strong>
            <span>
              {interactionMode === 'editor'
                ? '例如：检查当前链为什么无法运行，或在链尾增加等待 2 秒的节点。'
                : '例如：解释整个智能体的流程，或生成一份节点和连线修改提案。'}
            </span>
          </div>
        )}
        {activeSession?.messages.map((message) => {
          const proposal = message.proposal
          const displayContent =
            message.role === 'assistant'
              ? formatAgentAssistantDisplayText(message.content)
              : message.content
          const counts = proposal ? proposalCounts(proposal) : null
          const stale =
            interactionMode === 'editor' &&
            proposal?.status === 'pending' &&
            proposal.baseRevision !== workspaceRevision
          const effectiveStatus = stale ? 'expired' : proposal?.status
          return (
            <article
              key={message.id}
              className={`agent-assistant-message agent-assistant-message-${message.role}`}
            >
              <div className="agent-assistant-message-meta">
                <span>{message.role === 'user' ? '你' : 'AI 助手'}</span>
                <div className="agent-assistant-message-meta-actions">
                  <time>{formatTime(message.createdAt)}</time>
                  <button
                    type="button"
                    className="agent-assistant-copy-message"
                    aria-label={`复制${message.role === 'user' ? '你的消息' : 'AI 回复'}`}
                    onClick={() => void copyMessage(message.id, displayContent)}
                  >
                    {copiedMessageId === message.id ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
              <div className="agent-assistant-message-content">{displayContent}</div>
              {proposal && counts && (
                <div className={`agent-proposal-card agent-proposal-${effectiveStatus}`}>
                  <div className="agent-proposal-heading">
                    <strong>画布修改提案</strong>
                    <span>
                      {effectiveStatus === 'pending'
                        ? '待确认'
                        : effectiveStatus === 'applied'
                          ? '已应用'
                          : effectiveStatus === 'rejected'
                            ? '已拒绝'
                            : '已失效'}
                    </span>
                  </div>
                  <p>{proposal.summary}</p>
                  <div className="agent-proposal-counts">
                    <span>{counts.chains} 条链</span>
                    <span>{counts.nodes} 个节点操作</span>
                    <span>{counts.edges} 个连线操作</span>
                  </div>
                  {proposal.warnings.length > 0 && (
                    <details>
                      <summary>{proposal.warnings.length} 条校验提示</summary>
                      <ul>
                        {proposal.warnings.map((warning, index) => (
                          <li key={`${index}-${warning}`}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {stale && (
                    <div className="agent-proposal-stale">画布已经变化，请让 AI 重新生成提案。</div>
                  )}
                  {effectiveStatus === 'pending' && (
                    <div className="agent-proposal-actions">
                      {interactionMode === 'editor' ? (
                        <>
                          <button type="button" onClick={() => previewProposal(proposal)}>
                            在画布预览
                          </button>
                          <button
                            type="button"
                            className="agent-proposal-apply"
                            disabled={
                              previewedProposalId !== proposal.id || applyingProposalId !== null
                            }
                            onClick={() => void applyProposal(proposal)}
                          >
                            {applyingProposalId === proposal.id ? '正在保存' : '应用修改'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="agent-proposal-apply"
                          disabled={applyingProposalId !== null}
                          onClick={() => void openEditorForProposal(proposal)}
                        >
                          {applyingProposalId === proposal.id ? '正在打开…' : '进入编辑器预览'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="agent-assistant-danger-button"
                        disabled={applyingProposalId !== null}
                        onClick={() => void rejectProposal(proposal)}
                      >
                        拒绝修改
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}
        {busy && <div className="agent-assistant-thinking">{stageText}</div>}
      </div>

      {error && (
        <div className="agent-assistant-error" role="alert">
          {error}
        </div>
      )}
      <div className="agent-assistant-composer">
        <textarea
          ref={inputRef}
          value={draft}
          placeholder="向 AI 询问当前智能体，或描述希望修改的流程……"
          aria-label="给 AI 助手发送消息"
          disabled={!activeSession}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendMessage()
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            className="agent-assistant-stop"
            onClick={() => void stopGeneration()}
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            className="agent-assistant-send"
            disabled={!draft.trim() || !activeSession}
            onClick={() => void sendMessage()}
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}
