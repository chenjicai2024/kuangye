import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { app } from 'electron'
import {
  ActionChain,
  ExecutionChain,
  FlowNode,
  FlowEdge,
  Project,
  ProjectsStore,
  Region,
  TriggerType,
  WindowAnchor,
  Workspace,
  ActionStep
} from './types'
import { migrateChainIfNeeded, repairWorkspaceFlow } from './flow-migration'
import { isRecord } from '../error-utils'
import { removeActionChainProjectAssets } from './assets'
import { deleteSessionsByProject } from '../work-memory/session-store'

const OLD_WORKSPACE_FILE = 'action-chain-workspace.json'
const PROJECTS_FILE = 'action-chain-projects.json'
const PROJECTS_BACKUP_PREFIX = 'action-chain-projects.backup-'
const MAX_PROJECT_BACKUPS = 10
let projectsMutationQueue: Promise<void> = Promise.resolve()
let storeWriteCounter = 0

function enqueueProjectsMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = projectsMutationQueue.then(mutation)
  projectsMutationQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function userDataDir(): string {
  return app.getPath('userData')
}

function projectsPath(): string {
  return join(userDataDir(), PROJECTS_FILE)
}

function projectsBackupPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(userDataDir(), `${PROJECTS_BACKUP_PREFIX}${stamp}.json`)
}

function oldWorkspacePath(): string {
  return join(userDataDir(), OLD_WORKSPACE_FILE)
}

function createDefaultWorkspace(): Workspace {
  return {
    windowAnchors: [],
    views: [{ name: '默认视图', regions: [] }],
    executionChains: [],
    chains: []
  }
}

function isValidRect(rect: unknown): boolean {
  if (!isRecord(rect)) return false
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    Number(rect.width) > 0 &&
    Number(rect.height) > 0
  )
}

function normalizeWindowAnchors(value: unknown): WindowAnchor[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((anchor): anchor is Record<string, unknown> => isRecord(anchor))
    .filter(
      (anchor) =>
        typeof anchor.id === 'string' &&
        anchor.id.trim() &&
        typeof anchor.name === 'string' &&
        anchor.name.trim() &&
        isValidRect(anchor.capturedBounds)
    )
    .map((anchor) => {
      const bounds = anchor.capturedBounds as Record<string, number>
      return {
        id: String(anchor.id),
        name: String(anchor.name),
        title: typeof anchor.title === 'string' ? anchor.title : '',
        ownerName: typeof anchor.ownerName === 'string' ? anchor.ownerName : '',
        ownerPath: typeof anchor.ownerPath === 'string' ? anchor.ownerPath : undefined,
        capturedImagePath:
          typeof anchor.capturedImagePath === 'string' && anchor.capturedImagePath.trim()
            ? anchor.capturedImagePath
            : undefined,
        capturedImageScaleFactor:
          Number.isFinite(anchor.capturedImageScaleFactor) &&
          Number(anchor.capturedImageScaleFactor) > 0
            ? Number(anchor.capturedImageScaleFactor)
            : undefined,
        capturedBounds: {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height)
        }
      }
    })
}

function normalizeRegions(regions: unknown): Region[] {
  if (!Array.isArray(regions)) return []
  return regions
    .filter((region): region is Record<string, unknown> => isRecord(region))
    .filter(
      (region) => typeof region.name === 'string' && region.name.trim() && isValidRect(region.rect)
    )
    .map((region) => {
      const rect = region.rect as Record<string, number>
      return {
        name: String(region.name),
        coordinateMode: region.coordinateMode === 'window' ? 'window' : 'screen',
        windowAnchorId:
          region.coordinateMode === 'window' && typeof region.windowAnchorId === 'string'
            ? region.windowAnchorId
            : undefined,
        templateImagePath:
          typeof region.templateImagePath === 'string' && region.templateImagePath.trim()
            ? region.templateImagePath
            : undefined,
        templateScaleFactor:
          Number.isFinite(region.templateScaleFactor) && Number(region.templateScaleFactor) > 0
            ? Number(region.templateScaleFactor)
            : undefined,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      }
    })
}

function generateId(): string {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function generateChainId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeTrigger(trigger: unknown): TriggerType {
  if (
    trigger === 'default' ||
    trigger === 'manual' ||
    trigger === 'none' ||
    trigger === 'sub' ||
    trigger === 'red_dot' ||
    trigger === 'pixel_change'
  ) {
    return trigger
  }
  return 'manual'
}

function triggerParticipatesInListening(trigger: TriggerType): boolean {
  return trigger === 'default' || trigger === 'red_dot' || trigger === 'pixel_change'
}

function normalizeActionChains(chains: unknown, prefix = 'chain'): ActionChain[] {
  if (!Array.isArray(chains)) return []
  return chains
    .filter((chain): chain is Record<string, unknown> => isRecord(chain))
    .map((chain, index) => {
      const isExecutionChain = prefix === 'exec'
      const trigger: TriggerType = isExecutionChain ? normalizeTrigger(chain.trigger) : 'sub'
      const result: Record<string, unknown> = {
        id: typeof chain.id === 'string' && chain.id.trim() ? chain.id : generateChainId(prefix),
        name:
          typeof chain.name === 'string' && chain.name.trim() ? chain.name : `动作链${index + 1}`,
        description:
          typeof chain.description === 'string'
            ? chain.description.trim().slice(0, 4000)
            : undefined,
        enabled: isExecutionChain
          ? typeof chain.enabled === 'boolean'
            ? chain.enabled
            : triggerParticipatesInListening(trigger)
          : false,
        trigger,
        triggerRegion: typeof chain.triggerRegion === 'string' ? chain.triggerRegion : undefined,
        steps: Array.isArray(chain.steps) ? chain.steps : undefined,
        nodes: Array.isArray(chain.nodes) ? chain.nodes : undefined,
        edges: Array.isArray(chain.edges) ? chain.edges : undefined
      }
      migrateChainIfNeeded(
        result as { steps?: ActionStep[]; nodes?: FlowNode[]; edges?: FlowEdge[] },
        index,
        prefix === 'exec' ? 'exec' : 'chain'
      )
      return result as unknown as ActionChain
    })
}

function normalizeExecutionChains(chains: unknown): ExecutionChain[] {
  return normalizeActionChains(chains, 'exec').map((chain, index) => ({
    ...chain,
    name: chain.name || `执行链${index + 1}`
  }))
}

async function projectsFileExists(): Promise<boolean> {
  try {
    await readFile(projectsPath(), 'utf-8')
    return true
  } catch {
    return false
  }
}

async function readProjectsStoreRaw(): Promise<ProjectsStore> {
  try {
    const raw = await readFile(projectsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.projects)) {
      return parsed as ProjectsStore
    }
  } catch {
    // 文件不存在或损坏，继续迁移或默认
  }
  return { projects: [] }
}

async function migrateFromOldWorkspace(): Promise<ProjectsStore | null> {
  try {
    const raw = await readFile(oldWorkspacePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.regions) && Array.isArray(parsed.chains)) {
      const now = Date.now()
      const project: Project = {
        id: generateId(),
        name: '默认项目',
        workspace: {
          windowAnchors: [],
          views: [{ name: '默认视图', regions: normalizeRegions(parsed.regions) }],
          executionChains: [],
          chains: normalizeActionChains(parsed.chains)
        },
        createdAt: now,
        updatedAt: now
      }
      return { projects: [project], lastSelectedProjectId: project.id }
    }
  } catch {
    // 旧文件不存在或损坏
  }
  return null
}

function migrateWorkspaceIfNeeded(workspace: unknown): Workspace {
  const workspaceRecord = isRecord(workspace) ? workspace : null
  // 旧格式：{ regions: [...], chains: [...] }
  if (workspaceRecord && Array.isArray(workspaceRecord.regions) && !workspaceRecord.views) {
    return {
      windowAnchors: [],
      views: [{ name: '默认视图', regions: normalizeRegions(workspaceRecord.regions) }],
      executionChains: normalizeExecutionChains(workspaceRecord.executionChains),
      chains: normalizeActionChains(workspaceRecord.chains)
    }
  }

  const views = Array.isArray(workspaceRecord?.views)
    ? workspaceRecord.views.map((view, index: number) => {
        const viewRecord = isRecord(view) ? view : null
        return {
          name:
            typeof viewRecord?.name === 'string' && viewRecord.name.trim()
              ? viewRecord.name
              : `视图${index + 1}`,
          regions: normalizeRegions(viewRecord?.regions)
        }
      })
    : createDefaultWorkspace().views

  return {
    windowAnchors: normalizeWindowAnchors(workspaceRecord?.windowAnchors),
    views: views.length > 0 ? views : createDefaultWorkspace().views,
    executionChains: normalizeExecutionChains(workspaceRecord?.executionChains),
    chains: normalizeActionChains(workspaceRecord?.chains)
  }
}

async function backupProjectsStoreIfExists(): Promise<void> {
  try {
    await copyFile(projectsPath(), projectsBackupPath())
    await pruneProjectBackups()
  } catch {
    // 首次启动或文件不存在时不需要备份
  }
}

async function pruneProjectBackups(): Promise<void> {
  const entries = await readdir(userDataDir())
  const backups = entries
    .filter((name) => name.startsWith(PROJECTS_BACKUP_PREFIX) && name.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a))
  await Promise.all(
    backups.slice(MAX_PROJECT_BACKUPS).map((name) => rm(join(userDataDir(), name), { force: true }))
  )
}

function isSameJsonValue(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)))
}

export async function loadProjectsStore(): Promise<ProjectsStore> {
  const fileExists = await projectsFileExists()
  const store = await readProjectsStoreRaw()

  let changed = false
  for (const project of store.projects) {
    const before = project.workspace
    const migrated = migrateWorkspaceIfNeeded(project.workspace)
    repairWorkspaceFlow(migrated)
    project.workspace = migrated
    changed = changed || !isSameJsonValue(before, migrated)
  }
  if (changed) {
    await backupProjectsStoreIfExists()
    await saveProjectsStore(store)
  }

  if (store.projects.length > 0) {
    return store
  }

  // 只有 projects.json 文件完全不存在时才允许从老格式迁移
  // 如果文件存在但 projects=[]，说明用户已经删除过所有项目或者数据被损坏，绝不覆盖
  if (!fileExists) {
    const migrated = await migrateFromOldWorkspace()
    if (migrated) {
      await saveProjectsStore(migrated)
      return migrated
    }
  }

  return { projects: [] }
}

export async function saveProjectsStore(store: ProjectsStore): Promise<void> {
  const dir = userDataDir()
  await mkdir(dir, { recursive: true })
  const finalPath = projectsPath()
  storeWriteCounter += 1
  const tempPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${storeWriteCounter}`
  // 原子写入：先写临时文件，再 rename，避免进程中断导致文件损坏
  try {
    await writeFile(tempPath, JSON.stringify(store, null, 2), 'utf-8')
    await rename(tempPath, finalPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function createProject(name: string): Promise<Project> {
  return enqueueProjectsMutation(async () => {
    const store = await loadProjectsStore()
    const now = Date.now()
    const project: Project = {
      id: generateId(),
      name: name.trim() || '未命名项目',
      workspace: createDefaultWorkspace(),
      createdAt: now,
      updatedAt: now
    }
    store.projects.push(project)
    store.lastSelectedProjectId = project.id
    await saveProjectsStore(store)
    return project
  })
}

export async function getProject(id: string): Promise<Project | null> {
  const store = await loadProjectsStore()
  return store.projects.find((p) => p.id === id) || null
}

export async function updateProjectWorkspace(
  id: string,
  workspace: Workspace
): Promise<Project | null> {
  return enqueueProjectsMutation(async () => {
    const store = await loadProjectsStore()
    const project = store.projects.find((p) => p.id === id)
    if (!project) return null
    project.workspace = workspace
    project.updatedAt = Date.now()
    await saveProjectsStore(store)
    return project
  })
}

export async function renameProject(id: string, name: string): Promise<Project | null> {
  return enqueueProjectsMutation(async () => {
    const store = await loadProjectsStore()
    const project = store.projects.find((p) => p.id === id)
    if (!project) return null
    project.name = name.trim() || project.name
    project.updatedAt = Date.now()
    await saveProjectsStore(store)
    return project
  })
}

export async function deleteProject(id: string): Promise<boolean> {
  return enqueueProjectsMutation(async () => {
    const store = await loadProjectsStore()
    const idx = store.projects.findIndex((p) => p.id === id)
    if (idx === -1) return false
    store.projects.splice(idx, 1)
    if (store.lastSelectedProjectId === id) {
      store.lastSelectedProjectId = store.projects[0]?.id
    }
    await saveProjectsStore(store)
    await removeActionChainProjectAssets(id)
    await deleteSessionsByProject(id)
    return true
  })
}

export async function selectProject(id: string): Promise<boolean> {
  return enqueueProjectsMutation(async () => {
    const store = await loadProjectsStore()
    const exists = store.projects.some((p) => p.id === id)
    if (!exists) return false
    store.lastSelectedProjectId = id
    await saveProjectsStore(store)
    return true
  })
}

export async function getLastSelectedProjectId(): Promise<string | undefined> {
  const store = await loadProjectsStore()
  return store.lastSelectedProjectId
}

// 兼容旧 loadWorkspace 接口：返回当前选中项目的 workspace
export async function loadWorkspace(): Promise<Workspace> {
  const store = await loadProjectsStore()
  const selectedId = store.lastSelectedProjectId
  if (selectedId) {
    const project = store.projects.find((p) => p.id === selectedId)
    if (project) return project.workspace
  }
  if (store.projects.length > 0) {
    return store.projects[0].workspace
  }
  return createDefaultWorkspace()
}

// 兼容旧 saveWorkspace 接口：保存到指定项目
export async function saveWorkspace(
  workspace: Workspace,
  projectId: string
): Promise<Project | null> {
  if (!projectId) {
    console.error('[action-chain] saveWorkspace: 缺少 projectId，拒绝保存以防误写到错误项目')
    return null
  }
  return enqueueProjectsMutation(async () => {
    const store = await loadProjectsStore()
    const project = store.projects.find((p) => p.id === projectId)
    if (!project) {
      console.error(
        `[action-chain] saveWorkspace: 找不到项目 "${projectId}"（现有项目: ${store.projects.map((p) => p.id).join(', ')}），拒绝保存以防误写`
      )
      return null
    }
    project.workspace = workspace
    project.updatedAt = Date.now()
    await saveProjectsStore(store)
    return project
  })
}

// 兼容旧 loadProjectWorkspace 接口：加载指定项目，未指定则回退到当前选中项目
export async function loadProjectWorkspace(
  projectId?: string
): Promise<{ workspace: Workspace; projectId: string; projectName: string }> {
  const store = await loadProjectsStore()
  let project = projectId ? store.projects.find((p) => p.id === projectId) : undefined
  if (!project) {
    const selectedId = store.lastSelectedProjectId
    project = selectedId ? store.projects.find((p) => p.id === selectedId) : undefined
  }
  if (!project && store.projects.length > 0) {
    project = store.projects[0]
  }
  if (!project) {
    return {
      workspace: {
        windowAnchors: [],
        views: [{ name: '默认视图', regions: [] }],
        executionChains: [],
        chains: []
      } as Workspace,
      projectId: '',
      projectName: ''
    }
  }
  return { workspace: project.workspace, projectId: project.id, projectName: project.name }
}
