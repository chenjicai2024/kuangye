import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentAssistantPermissions,
  AgentAssistantSendPayload,
  AgentContextSnapshot
} from '../../../core/agent-assistant/types'
import type { Project } from '../../../core/action-chain/types'
import { AgentAssistantPanel } from './AgentAssistantPanel'

interface ProjectLibraryProps {
  projects: Project[]
  onBack: () => void
  embedded?: boolean
  onOpenProject: (projectId: string) => Promise<void>
  onOpenMemory: (projectId: string) => Promise<void>
  onCreateProject: (name: string) => Promise<boolean>
  onRenameProject: (projectId: string, name: string) => Promise<boolean>
  onDeleteProject: (projectId: string) => Promise<boolean>
}

function getProjectStats(project: Project): [number, number, number, number] {
  const executionChains = project.workspace.executionChains ?? []
  const actionChains = project.workspace.chains ?? []
  const nodes = [...executionChains, ...actionChains].reduce(
    (total, chain) => total + (chain.nodes?.length ?? 0),
    0
  )
  const regions = (project.workspace.views ?? []).reduce(
    (total, view) => total + (view.regions?.length ?? 0),
    0
  )
  return [executionChains.length, actionChains.length, nodes, regions]
}

function formatSavedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '尚未保存'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp))
}

function buildProjectAssistantPayload(
  project: Project,
  message: string,
  sessionId: string,
  permissions: AgentAssistantPermissions
): AgentAssistantSendPayload {
  const activeExecutionChain = project.workspace.executionChains.find((chain) => chain.id)
  const activeActionChain = project.workspace.chains.find((chain) => chain.id)
  const activeChainKind: AgentContextSnapshot['activeChainKind'] = activeExecutionChain
    ? 'executionChain'
    : 'actionChain'

  return {
    projectId: project.id,
    sessionId,
    message,
    permissions,
    context: {
      projectId: project.id,
      projectName: project.name,
      workspace: project.workspace,
      workspaceRevision: 0,
      activeChainKind,
      activeChainId: activeExecutionChain?.id ?? activeActionChain?.id,
      canvas: {
        pan: { x: 0, y: 0 },
        zoom: 1,
        width: 0,
        height: 0
      },
      recentRuntimeLogs: []
    }
  }
}

export function ProjectLibrary({
  projects,
  onBack,
  embedded = false,
  onOpenProject,
  onOpenMemory,
  onCreateProject,
  onRenameProject,
  onDeleteProject
}: ProjectLibraryProps): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null)
  const [showCreate, setShowCreate] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [assistantProjectId, setAssistantProjectId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [formError, setFormError] = useState('')
  const assistantCloseButtonRef = useRef<HTMLButtonElement>(null)

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects]
  )
  const selectedProject =
    sortedProjects.find((project) => project.id === selectedId) ?? sortedProjects[0] ?? null
  const assistantProject = projects.find((project) => project.id === assistantProjectId) ?? null

  useEffect(() => {
    if (!selectedProject) {
      setSelectedId(null)
      return
    }
    if (selectedProject.id !== selectedId) setSelectedId(selectedProject.id)
  }, [selectedId, selectedProject])

  useEffect(() => {
    if (!deleteTarget) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busyAction) setDeleteTarget(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busyAction, deleteTarget])

  useEffect(() => {
    if (!assistantProjectId) return
    if (!assistantProject) {
      setAssistantProjectId(null)
      return
    }
    const focusFrame = window.requestAnimationFrame(() => assistantCloseButtonRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAssistantProjectId(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [assistantProject, assistantProjectId])

  function beginCreate(): void {
    setNewProjectName(`智能体${projects.length + 1}`)
    setFormError('')
    setShowCreate(true)
  }

  async function commitCreate(): Promise<void> {
    const name = newProjectName.trim()
    if (!name || busyAction) return
    setBusyAction('create')
    setFormError('')
    try {
      const success = await onCreateProject(name)
      if (!success) setFormError('创建失败，请重试。')
      else {
        setShowCreate(false)
        setNewProjectName('')
      }
    } catch (error) {
      console.error('创建智能体失败:', error)
      setFormError('创建失败，请重试。')
    } finally {
      setBusyAction(null)
    }
  }

  async function commitRename(): Promise<void> {
    if (!selectedProject || !renameValue.trim() || busyAction) return
    setBusyAction(`rename:${selectedProject.id}`)
    setFormError('')
    try {
      const success = await onRenameProject(selectedProject.id, renameValue.trim())
      if (!success) setFormError('重命名失败，请重试。')
      else setRenaming(false)
    } catch (error) {
      console.error('重命名智能体失败:', error)
      setFormError('重命名失败，请重试。')
    } finally {
      setBusyAction(null)
    }
  }

  async function openProject(): Promise<void> {
    if (!selectedProject || busyAction) return
    setBusyAction(`open:${selectedProject.id}`)
    setFormError('')
    try {
      await onOpenProject(selectedProject.id)
    } catch (error) {
      console.error('打开智能体失败:', error)
      setFormError('打开智能体失败，请重试。')
    } finally {
      setBusyAction(null)
    }
  }

  async function openMemory(): Promise<void> {
    if (!selectedProject || busyAction) return
    setBusyAction(`memory:${selectedProject.id}`)
    setFormError('')
    try {
      await onOpenMemory(selectedProject.id)
    } catch (error) {
      console.error('打开智能体工作记忆失败:', error)
      setFormError('打开工作记忆失败，请重试。')
    } finally {
      setBusyAction(null)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || busyAction) return
    setBusyAction(`delete:${deleteTarget.id}`)
    try {
      const success = await onDeleteProject(deleteTarget.id)
      if (!success) setFormError('删除失败，请重试。')
      else setDeleteTarget(null)
    } catch (error) {
      console.error('删除智能体失败:', error)
      setFormError('删除失败，请重试。')
    } finally {
      setBusyAction(null)
    }
  }

  async function exportTemplate(): Promise<void> {
    if (!selectedProject || busyAction) return
    setBusyAction(`export:${selectedProject.id}`)
    setFormError('')
    try {
      const result = (await window.electron?.invoke(
        'template:export',
        selectedProject.id
      )) as { success?: boolean; canceled?: boolean; error?: string } | undefined
      if (!result?.success && !result?.canceled) {
        setFormError(result?.error || '导出失败，请重试。')
      }
    } catch (error) {
      console.error('导出模板失败:', error)
      setFormError('导出失败，请重试。')
    } finally {
      setBusyAction(null)
    }
  }

  async function importTemplate(): Promise<void> {
    if (!selectedProject || busyAction) return
    setBusyAction(`import:${selectedProject.id}`)
    setFormError('')
    try {
      const result = (await window.electron?.invoke('template:import', {
        projectId: selectedProject.id
      })) as {
        success?: boolean
        canceled?: boolean
        error?: string
        project?: Project
      } | undefined
      if (result?.success && result.project) {
        // 刷新本地列表中的项目数据
        onRenameProject(result.project.id, result.project.name)
      } else if (!result?.success && !result?.canceled) {
        setFormError(result?.error || '导入失败，请重试。')
      }
    } catch (error) {
      console.error('导入模板失败:', error)
      setFormError('导入失败，请重试。')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <main className={`project-library-shell ${embedded ? 'embedded' : ''}`}>
      <header className="project-library-header">
        <button type="button" className="project-library-back" onClick={onBack}>
          返回主界面
        </button>
        <div className="project-library-heading">
          <div className="project-library-eyebrow">智能体工作区</div>
          <h1>智能体</h1>
          <p>选择一个智能体查看概况，进入后继续编辑它的区域、动作链和执行流程。</p>
        </div>
        <button
          type="button"
          className="project-library-create-button"
          onClick={beginCreate}
          disabled={showCreate || Boolean(busyAction)}
        >
          <span aria-hidden>＋</span>
          新建智能体
        </button>
      </header>

      <section className="project-library-content" aria-label="智能体列表和详情">
        <div className="project-library-summary">
          <div>
            <strong>{projects.length}</strong>
            <span>个智能体</span>
          </div>
          <p>智能体内容保存在本机，进入编辑器后会自动保存。</p>
        </div>

        {formError ? (
          <div className="project-library-error" role="alert">
            {formError}
          </div>
        ) : null}

        <div className="project-library-layout">
          <div className="project-library-list-column">
            {showCreate ? (
              <div className="project-create-panel">
                <label className="project-create-field">
                  <span>智能体名称</span>
                  <input
                    autoFocus
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitCreate()
                      if (event.key === 'Escape') setShowCreate(false)
                    }}
                    placeholder="例如：微信客服自动回复智能体"
                    disabled={busyAction === 'create'}
                  />
                </label>
                <div className="project-create-actions">
                  <button
                    type="button"
                    className="project-library-secondary-button"
                    onClick={() => setShowCreate(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="project-library-primary-button"
                    onClick={() => void commitCreate()}
                    disabled={!newProjectName.trim() || busyAction === 'create'}
                  >
                    {busyAction === 'create' ? '创建中…' : '确定'}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="project-library-list">
              {sortedProjects.map((project) => {
                const active = project.id === selectedProject?.id
                const stats = getProjectStats(project)
                return (
                  <div
                    key={project.id}
                    className={`project-library-list-item ${active ? 'selected' : ''}`}
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(project.id)}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer', minWidth: 0 }}
                    >
                      <ProjectIcon />
                      <span className="project-library-list-copy">
                        <strong title={project.name}>{project.name}</strong>
                        <span>
                          {stats[0] + stats[1]} 条链 · {formatSavedAt(project.updatedAt)}
                        </span>
                      </span>
                      {active ? (
                        <span className="project-library-active-dot" aria-label="已选中" />
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedId(project.id)
                        setRenaming(true)
                        setRenameValue(project.name)
                        setFormError('')
                      }}
                      title="重命名"
                      style={{
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 4,
                        color: '#9ca3af',
                        padding: '4px 6px',
                        fontSize: 11,
                        cursor: 'pointer',
                        flexShrink: 0,
                        marginRight: 4
                      }}
                    >
                      ✎
                    </button>
                  </div>
                )
              })}
              {sortedProjects.length === 0 ? (
                <div className="project-library-empty-list">还没有智能体，点击右上角新建。</div>
              ) : null}
            </div>
          </div>

          <div className="card project-detail-card">
            {selectedProject ? (
              <>
                <div className="project-detail-header">
                  <div className="project-detail-title-wrap">
                    <ProjectIcon />
                    <div>
                      <div className="card-title">智能体概况</div>
                      {renaming ? (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            className="project-detail-name-input"
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void commitRename()
                              if (event.key === 'Escape') setRenaming(false)
                            }}
                            autoFocus
                            aria-label="智能体名称"
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => void commitRename()}
                            disabled={!renameValue.trim() || Boolean(busyAction)}
                            style={{ padding: '6px 12px', fontSize: 12 }}
                          >
                            确定
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setRenaming(false)}
                            style={{ padding: '6px 12px', fontSize: 12 }}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <h2 title={selectedProject.name} style={{ margin: 0 }}>{selectedProject.name}</h2>
                      )}
                    </div>
                  </div>
                  <span className="project-detail-status">
                    <span />
                    已保存
                  </span>
                </div>

                <p className="project-detail-description">
                  这个智能体包含独立的窗口区域、执行链、动作链和节点配置。进入编辑器后可以继续完善自动化流程。
                </p>

                <div className="project-detail-stats">
                  {['执行链', '动作链', '节点', '区域'].map((label, index) => (
                    <div key={label}>
                      <strong>{getProjectStats(selectedProject)[index]}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>

                <div className="project-detail-meta">
                  <span>最近保存</span>
                  <strong>{formatSavedAt(selectedProject.updatedAt)}</strong>
                </div>

                <div className="project-detail-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void openProject()}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === `open:${selectedProject.id}` ? '打开中…' : '进入编辑'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary project-detail-assistant-button"
                    onClick={() => setAssistantProjectId(selectedProject.id)}
                    disabled={Boolean(busyAction)}
                  >
                    <AssistantIcon />
                    AI 助手
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void openMemory()}
                    disabled={Boolean(busyAction)}
                  >
                    <MemoryIcon />
                    {busyAction === `memory:${selectedProject.id}` ? '打开中…' : '工作记忆'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void exportTemplate()}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === `export:${selectedProject.id}` ? '导出中…' : '导出模板'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void importTemplate()}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === `import:${selectedProject.id}` ? '导入中…' : '导入模板'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setDeleteTarget(selectedProject)}
                    disabled={Boolean(busyAction)}
                  >
                    删除智能体
                  </button>
                </div>
              </>
            ) : (
              <div className="project-detail-empty">
                <ProjectIcon />
                <h2>选择一个智能体</h2>
                <p>左侧列表中选择智能体，查看它的功能和配置概况。</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {assistantProject ? (
        <div
          className="project-assistant-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAssistantProjectId(null)
          }}
        >
          <section
            className="project-assistant-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-assistant-title"
          >
            <header className="project-assistant-header">
              <div className="project-assistant-heading">
                <span className="project-assistant-mark" aria-hidden>
                  AI
                </span>
                <span>
                  <strong id="project-assistant-title">AI 助手</strong>
                  <small title={assistantProject.name}>{assistantProject.name}</small>
                </span>
              </div>
              <button
                ref={assistantCloseButtonRef}
                type="button"
                className="project-assistant-close"
                onClick={() => setAssistantProjectId(null)}
                aria-label="关闭 AI 助手"
                title="关闭"
              >
                ×
              </button>
            </header>
            <div className="project-assistant-body">
              <AgentAssistantPanel
                key={assistantProject.id}
                projectId={assistantProject.id}
                projectName={assistantProject.name}
                workspaceRevision={0}
                interactionMode="library"
                buildSendPayload={(message, sessionId, permissions) =>
                  buildProjectAssistantPayload(assistantProject, message, sessionId, permissions)
                }
                onOpenEditor={async () => {
                  await onOpenProject(assistantProject.id)
                }}
              />
            </div>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="project-library-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busyAction) setDeleteTarget(null)
          }}
        >
          <div
            className="project-library-delete-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
          >
            <div className="project-library-delete-icon" aria-hidden>
              <TrashIcon />
            </div>
            <h2 id="delete-project-title">删除智能体“{deleteTarget.name}”？</h2>
            <p>智能体中的区域、执行链、动作链和节点配置都会被删除，此操作不能撤销。</p>
            <div className="project-library-modal-actions">
              <button
                type="button"
                className="project-library-secondary-button"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="project-library-danger-confirm"
                onClick={() => void confirmDelete()}
              >
                {busyAction ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

function ProjectIcon(): React.JSX.Element {
  return (
    <span className="project-library-card-icon" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 7.5h6l1.8 2H20v9.5H4z" />
        <path d="M4 7.5V5h6l1.8 2" />
      </svg>
    </span>
  )
}

function TrashIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16M9 7V4h6v3M8 10v7M12 10v7M16 10v7M6 7l1 14h10l1-14" />
    </svg>
  )
}

function MemoryIcon(): React.JSX.Element {
  return (
    <svg
      className="project-library-action-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 3" />
    </svg>
  )
}

function AssistantIcon(): React.JSX.Element {
  return (
    <svg
      className="project-library-action-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18 12h3M16.3 7.7l2.1-2.1" />
      <rect x="6" y="8" width="12" height="10" rx="3" />
      <path d="M9 13h.01M15 13h.01M9.5 16h5" />
    </svg>
  )
}
