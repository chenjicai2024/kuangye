import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { app } from 'electron'

const ACTION_CHAIN_ASSET_DIR = 'action-chain-assets'

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '_')
  return cleaned || 'unknown-project'
}

async function saveActionChainPng(
  projectId: string,
  filePrefix: 'region' | 'window',
  png: Buffer
): Promise<string> {
  const fileName = `${filePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  const assetPath = join(ACTION_CHAIN_ASSET_DIR, safeSegment(projectId), fileName).replace(
    /\\/g,
    '/'
  )
  const absolutePath = resolveActionChainAssetPath(assetPath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, png)
  return assetPath
}

function resolveActionChainAssetPath(assetPath: string): string {
  const userDataRoot = resolve(app.getPath('userData'))
  const assetRoot = resolve(userDataRoot, ACTION_CHAIN_ASSET_DIR)
  const absolutePath = resolve(userDataRoot, assetPath.replace(/[\\/]+/g, sep))
  const relativeToRoot = relative(assetRoot, absolutePath)
  if (relativeToRoot.startsWith('..') || resolve(assetRoot, relativeToRoot) !== absolutePath) {
    throw new Error('动作链资源路径不合法')
  }
  return absolutePath
}

export async function saveActionChainRegionTemplate(
  projectId: string,
  png: Buffer
): Promise<string> {
  return saveActionChainPng(projectId, 'region', png)
}

export async function saveActionChainWindowCapture(
  projectId: string,
  png: Buffer
): Promise<string> {
  return saveActionChainPng(projectId, 'window', png)
}

export async function readActionChainAsset(assetPath: string): Promise<Buffer> {
  return readFile(resolveActionChainAssetPath(assetPath))
}

/** 只允许读取指定智能体自己的资源，防止 Workspace 路径引用到其他智能体。 */
export async function readActionChainProjectAsset(
  projectId: string,
  assetPath: string
): Promise<Buffer> {
  const projectAssetRoot = resolve(
    app.getPath('userData'),
    ACTION_CHAIN_ASSET_DIR,
    safeSegment(projectId)
  )
  const absolutePath = resolveActionChainAssetPath(assetPath)
  const relativeToProject = relative(projectAssetRoot, absolutePath)
  if (
    !relativeToProject ||
    relativeToProject.startsWith('..') ||
    resolve(projectAssetRoot, relativeToProject) !== absolutePath
  ) {
    throw new Error('动作链资源不属于当前智能体')
  }
  return readFile(absolutePath)
}

export async function removeActionChainProjectAssets(projectId: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error('项目资源目录名称不合法')
  }

  const userDataRoot = resolve(app.getPath('userData'))
  const assetRoot = resolve(userDataRoot, ACTION_CHAIN_ASSET_DIR)
  const projectAssetDir = resolve(assetRoot, projectId)
  const relativeToRoot = relative(assetRoot, projectAssetDir)
  if (
    !relativeToRoot ||
    relativeToRoot.startsWith('..') ||
    dirname(projectAssetDir) !== assetRoot
  ) {
    throw new Error('拒绝删除项目资源目录：目标路径超出动作链资源目录')
  }

  await rm(projectAssetDir, { recursive: true, force: true })
}
