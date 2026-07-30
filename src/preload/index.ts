import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export type InvokeChannel =
  | 'agent-assistant:cancel'
  | 'agent-assistant:createSession'
  | 'agent-assistant:deleteSession'
  | 'agent-assistant:listSessions'
  | 'agent-assistant:loadSession'
  | 'agent-assistant:send'
  | 'agent-assistant:updateProposalStatus'
  | 'action-chain:createProject'
  | 'action-chain:deleteProject'
  | 'action-chain:detectTaskbar'
  | 'action-chain:editRegion'
  | 'action-chain:enterCompactMode'
  | 'action-chain:exitCompactMode'
  | 'action-chain:getProjectChains'
  | 'action-chain:listProjects'
  | 'action-chain:loadProjectWorkspace'
  | 'action-chain:open'
  | 'action-chain:openOverlay'
  | 'action-chain:renameProject'
  | 'action-chain:save'
  | 'action-chain:selectProject'
  | 'action-chain:start'
  | 'action-chain:stop'
  | 'capture-screen'
  | 'data:listChatMessages'
  | 'data:listConversations'
  | 'data:listExecutionSteps'
  | 'data:listExecutions'
  | 'data:listExperienceCards'
  | 'data:migrate'
  | 'data:openWindow'
  | 'engine:testConnection'
  | 'models:list'
  | 'memory:addCard'
  | 'memory:cleanupSessions'
  | 'memory:deleteCard'
  | 'memory:deleteSession'
  | 'memory:extractFromSession'
  | 'memory:getSession'
  | 'memory:getScreenshot'
  | 'memory:listCards'
  | 'memory:listSessions'
  | 'chat-history:listConversations'
  | 'chat-history:getConversation'
  | 'chat-history:deleteConversation'
  | 'memory:setCardEnabled'
  | 'memory:updateCard'
  | 'provider:getInstalled'
  | 'provider:installFromUrl'
  | 'providerHub:getCatalog'
  | 'providerHub:update'
  | 'settings:getAll'
  | 'settings:open'
  | 'tokenUsage:get'
  | 'workmemory:open'
  | 'settings:set'
  | 'template:export'
  | 'template:import'

export type ReceiveChannel =
  | 'agent-assistant:event'
  | 'action-chain-capture-toolbar:candidate'
  | 'action-chain-capture-toolbar:init'
  | 'action-chain-overlay:init'
  | 'action-chain-overlay:restored'
  | 'action-chain-overlay:windowCaptureCandidate'
  | 'action-chain-overlay:windowCaptured'
  | 'action-chain:editorClosed'
  | 'action-chain:compactInit'
  | 'action-chain:projectsChanged'
  | 'settings:navigate'
  | 'action-chain:log'
  | 'action-chain:state'
  | 'action-chain:stepLog'

export type SendChannel =
  | 'action-chain-capture-toolbar:cancel'
  | 'action-chain-capture-toolbar:confirm'
  | 'action-chain-capture-toolbar:ready'
  | 'action-chain-capture-toolbar:retry'
  | 'action-chain-overlay:cancel'
  | 'action-chain-overlay:complete'
  | 'action-chain-overlay:ready'
  | 'action-chain-overlay:startWindowCapture'
  | 'action-chain-overlay:toggleMousePassthrough'

const INVOKE_CHANNELS = new Set<InvokeChannel>([
  'agent-assistant:cancel',
  'agent-assistant:createSession',
  'agent-assistant:deleteSession',
  'agent-assistant:listSessions',
  'agent-assistant:loadSession',
  'agent-assistant:send',
  'agent-assistant:updateProposalStatus',
  'action-chain:createProject',
  'action-chain:deleteProject',
  'action-chain:detectTaskbar',
  'action-chain:editRegion',
  'action-chain:enterCompactMode',
  'action-chain:exitCompactMode',
  'action-chain:getProjectChains',
  'action-chain:listProjects',
  'action-chain:loadProjectWorkspace',
  'action-chain:open',
  'action-chain:openOverlay',
  'action-chain:renameProject',
  'action-chain:save',
  'action-chain:selectProject',
  'action-chain:start',
  'action-chain:stop',
  'capture-screen',
  'data:listChatMessages',
  'data:listConversations',
  'data:listExecutionSteps',
  'data:listExecutions',
  'data:listExperienceCards',
  'data:migrate',
  'data:openWindow',
  'engine:testConnection',
  'models:list',
  'memory:addCard',
  'memory:cleanupSessions',
  'memory:deleteCard',
  'memory:deleteSession',
  'memory:extractFromSession',
  'memory:getSession',
  'memory:getScreenshot',
  'memory:listCards',
  'memory:listSessions',
  'chat-history:listConversations',
  'chat-history:getConversation',
  'chat-history:deleteConversation',
  'memory:setCardEnabled',
  'memory:updateCard',
  'provider:getInstalled',
  'provider:installFromUrl',
  'providerHub:getCatalog',
  'providerHub:update',
  'settings:getAll',
  'settings:open',
  'tokenUsage:get',
  'workmemory:open',
  'settings:set',
  'template:export',
  'template:import'
])

const RECEIVE_CHANNELS = new Set<ReceiveChannel>([
  'agent-assistant:event',
  'action-chain-capture-toolbar:candidate',
  'action-chain-capture-toolbar:init',
  'action-chain-overlay:init',
  'action-chain-overlay:restored',
  'action-chain-overlay:windowCaptureCandidate',
  'action-chain-overlay:windowCaptured',
  'action-chain:editorClosed',
  'action-chain:compactInit',
  'action-chain:projectsChanged',
  'settings:navigate',
  'action-chain:log',
  'action-chain:state',
  'action-chain:stepLog'
])

const SEND_CHANNELS = new Set<SendChannel>([
  'action-chain-capture-toolbar:cancel',
  'action-chain-capture-toolbar:confirm',
  'action-chain-capture-toolbar:ready',
  'action-chain-capture-toolbar:retry',
  'action-chain-overlay:cancel',
  'action-chain-overlay:complete',
  'action-chain-overlay:ready',
  'action-chain-overlay:startWindowCapture',
  'action-chain-overlay:toggleMousePassthrough'
])

function assertAllowed<T extends string>(
  channel: string,
  allowed: ReadonlySet<T>
): asserts channel is T {
  if (!allowed.has(channel as T)) throw new Error(`Blocked IPC channel: ${channel}`)
}

export interface ElectronHandler {
  invoke: <T = unknown>(channel: InvokeChannel, ...args: unknown[]) => Promise<T>
  on: <TArgs extends unknown[]>(
    channel: ReceiveChannel,
    callback: (...args: TArgs) => void
  ) => () => void
  send: (channel: SendChannel, ...args: unknown[]) => void
}

const electronHandler: ElectronHandler = {
  invoke: async <T = unknown>(channel: InvokeChannel, ...args: unknown[]): Promise<T> => {
    assertAllowed(channel, INVOKE_CHANNELS)
    return (await ipcRenderer.invoke(channel, ...args)) as T
  },
  on: <TArgs extends unknown[]>(
    channel: ReceiveChannel,
    callback: (...args: TArgs) => void
  ): (() => void) => {
    assertAllowed(channel, RECEIVE_CHANNELS)
    const handler = (_event: IpcRendererEvent, ...args: unknown[]): void => {
      callback(...(args as TArgs))
    }
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  send: (channel: SendChannel, ...args: unknown[]): void => {
    assertAllowed(channel, SEND_CHANNELS)
    ipcRenderer.send(channel, ...args)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronHandler)
    contextBridge.exposeInMainWorld('osInfo', { platform: process.platform })
  } catch (error) {
    console.error(error)
  }
} else {
  const exposedWindow = window as typeof window & {
    electron: ElectronHandler
    osInfo: { platform: NodeJS.Platform }
  }
  exposedWindow.electron = electronHandler
  exposedWindow.osInfo = { platform: process.platform }
}
