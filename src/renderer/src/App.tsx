import { useState, useCallback, useEffect } from 'react'
import { FlowEditor } from './flow-editor/FlowEditor'
import WorkMemoryWindow from './WorkMemoryWindow'
import { ControlPanel, BottomBar } from './app/ControlPanel'
import { SettingsPanel } from './app/SettingsPanel'
import { TokenUsagePanel } from './app/TokenUsagePanel'
import { ProjectPanel } from './app/ProjectPanel'
import { Toast } from './app/Toast'
import type { SettingsSection } from './app/types'
import './index.css'
import './storage-settings.css'
import './flow-editor/flow-editor.css'

function App(): React.JSX.Element {
  const windowKind = new URLSearchParams(window.location.search).get('window')
  const [projectListKey, setProjectListKey] = useState(0)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedProjectName, setSelectedProjectName] = useState('')
  const [runningChain, setRunningChain] = useState(false)
  const [chains, setChains] = useState<
    Array<{ id: string; name: string; kind: 'actionChain' | 'executionChain'; nodes: number }>
  >([])
  const [selectedChainId, setSelectedChainId] = useState('')
  const [loadingChains, setLoadingChains] = useState(false)

  // 监听动作链编辑器窗口关闭，刷新项目列表
  useEffect(() => {
    const cleanup = window.electron?.on('action-chain:editorClosed', () => {
      setProjectListKey((k) => k + 1)
    })
    return cleanup
  }, [])

  // 监听项目列表变化（创建/删除），刷新下拉选择器
  useEffect(() => {
    const cleanup = window.electron?.on('action-chain:projectsChanged', () => {
      setProjectListKey((k) => k + 1)
    })
    return cleanup
  }, [])

  // 选项目后加载链列表
  useEffect(() => {
    if (!selectedProjectId) return
    let cancelled = false
    setLoadingChains(true)
    void (async () => {
      try {
        const result = (await window.electron?.invoke(
          'action-chain:getProjectChains',
          selectedProjectId
        )) as { chains: typeof chains } | undefined
        if (cancelled) return
        const list = result?.chains ?? []
        setChains(list)
        setSelectedChainId((current) =>
          list.some((chain) => chain.id === current) ? current : (list[0]?.id ?? '')
        )
      } finally {
        if (!cancelled) setLoadingChains(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedProjectId])

  // 监听 action-chain 引擎状态
  useEffect(() => {
    const cleanup = window.electron?.on('action-chain:state', (state: unknown) => {
      const s = state as { running?: boolean }
      setRunningChain(s?.running === true)
    })
    return cleanup
  }, [])

  const handleSelectProject = useCallback((id: string | null, name: string): void => {
    setSelectedProjectId(id)
    setSelectedProjectName(name)
    if (!id) {
      setChains([])
      setSelectedChainId('')
      setRunningChain(false)
      setLoadingChains(false)
      return
    }
    void window.electron?.invoke('action-chain:selectProject', id)
  }, [])

  const handleEnterActionChain = useCallback((): void => {
    void window.electron?.invoke('settings:open', 'projects')
  }, [])

  if (windowKind === 'settings') {
    return (
      <div className="app settings-window">
        <SettingsWindow />
        <Toast />
      </div>
    )
  }

  if (windowKind === 'workmemory') {
    const params = new URLSearchParams(window.location.search)
    const projectId = params.get('projectId') ?? ''
    const projectName = params.get('projectName') ?? ''
    return (
      <div className="app">
        <WorkMemoryWindow projectId={projectId} projectName={projectName} />
        <Toast />
      </div>
    )
  }

  if (windowKind === 'actionchain') {
    const params = new URLSearchParams(window.location.search)
    const projectId = params.get('projectId')
    const showProjectLibrary = params.get('projects') === '1' || params.get('new') === '1'
    return (
      <div className="app">
        <FlowEditor
          initialProjectId={projectId}
          showProjectLibrary={showProjectLibrary}
          onBack={() => {
            window.close()
          }}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="app-content">
        <ControlPanel
          projectListKey={projectListKey}
          selectedProjectId={selectedProjectId}
          selectedProjectName={selectedProjectName}
          chains={chains}
          selectedChainId={selectedChainId}
          setSelectedChainId={setSelectedChainId}
          loadingChains={loadingChains}
          onSelectProject={handleSelectProject}
          onEnterActionChain={handleEnterActionChain}
        />
      </div>

      <BottomBar
        runningChain={runningChain}
        setRunningChain={setRunningChain}
        chains={chains}
        selectedChainId={selectedChainId}
        selectedProjectId={selectedProjectId}
      />

      <Toast />
    </div>
  )
}

function SettingsWindow(): React.JSX.Element {
  const initialSection = new URLSearchParams(window.location.search).get('section')
  const [section, setSection] = useState<SettingsSection>(
    initialSection === 'base' ? 'base' : 'projects'
  )

  useEffect(() => {
    return window.electron?.on('settings:navigate', (nextSection: unknown) => {
      if (nextSection === 'projects') setSection('projects')
    })
  }, [])

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-brand">
          <span>设置</span>
        </div>
        <button
          className={`settings-nav-item ${section === 'projects' ? 'active' : ''}`}
          onClick={() => setSection('projects')}
        >
          智能体
        </button>
        <button
          className={`settings-nav-item ${section === 'base' ? 'active' : ''}`}
          onClick={() => setSection('base')}
        >
          模型供应商
        </button>
        <button
          className={`settings-nav-item ${section === 'tokenUsage' ? 'active' : ''}`}
          onClick={() => setSection('tokenUsage')}
        >
          Token 用量
        </button>
      </aside>
      <main className="settings-main">
        {section === 'base' ? (
          <SettingsPanel />
        ) : section === 'projects' ? (
          <ProjectPanel onBack={() => setSection('base')} />
        ) : (
          <TokenUsagePanel />
        )}
      </main>
    </div>
  )
}

export default App
