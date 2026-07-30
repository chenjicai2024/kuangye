import { useState, useCallback, useEffect } from 'react'
import { RefreshIcon } from './icons'
import { AgentPanel } from './AgentPanel'
import { ProjectLibrary } from '../flow-editor/ProjectLibrary'
import type { Project } from '../../../core/action-chain/types'

export function ProjectPanel({ onBack }: { onBack: () => void }): React.JSX.Element {
  // 保留旧的 provider 配置组件代码，避免与现有设置数据结构产生无关迁移。
  void AgentPanel
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const loadProjects = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = (await window.electron?.invoke('action-chain:listProjects')) as
        | { projects?: Project[] }
        | undefined
      setProjects(result?.projects ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  // 监听其他窗口的项目列表变化，同步刷新
  useEffect(() => {
    const cleanup = window.electron?.on('action-chain:projectsChanged', () => {
      void loadProjects()
    })
    return cleanup
  }, [loadProjects])

  async function createProject(name: string): Promise<boolean> {
    const result = (await window.electron?.invoke('action-chain:createProject', name)) as
      | { success?: boolean; project?: Project }
      | undefined
    if (!result?.success) return false
    await loadProjects()
    return true
  }

  async function renameProject(projectId: string, name: string): Promise<boolean> {
    const result = (await window.electron?.invoke(
      'action-chain:renameProject',
      projectId,
      name
    )) as { success?: boolean } | undefined
    if (!result?.success) return false
    await loadProjects()
    return true
  }

  async function deleteProject(projectId: string): Promise<boolean> {
    const result = (await window.electron?.invoke('action-chain:deleteProject', projectId)) as
      | { success?: boolean }
      | undefined
    if (!result?.success) return false
    await loadProjects()
    return true
  }

  return (
    <div className="settings-page project-settings-page slide-up">
      <div className="settings-page-header">
        <div>
          <div className="settings-title-row">
            <h1>智能体</h1>
            <button
              className="icon-action refresh-action"
              onClick={() => void loadProjects()}
              disabled={loading}
              title={loading ? '加载中…' : '刷新智能体列表'}
              aria-label="刷新智能体列表"
            >
              <span className={loading ? 'refresh-icon spinning' : 'refresh-icon'}>
                <RefreshIcon />
              </span>
            </button>
          </div>
          <p>选择一个智能体查看概况，进入后继续编辑区域、动作链和执行流程。</p>
        </div>
      </div>
      {loading ? (
        <div className="provider-hub-meta">
          <span className="spinner" />
          正在加载智能体列表
        </div>
      ) : null}
      <ProjectLibrary
        projects={projects}
        onBack={onBack}
        embedded
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
    </div>
  )
}
