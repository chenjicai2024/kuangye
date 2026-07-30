import type { ActionChain, ExecutionChain, FlowNode } from '../action-chain/types'
import type { AgentContextSnapshot } from './types'

export const MAX_AGENT_PROJECT_ASSET_IMAGES = 12

export interface AgentProjectAssetReference {
  kind: 'region' | 'window'
  label: string
  assetPath: string
  regionName?: string
  windowAnchorId?: string
}

export interface AgentProjectAssetSelection {
  availableCount: number
  selected: AgentProjectAssetReference[]
  omittedCount: number
}

function nodeRegionNames(node: FlowNode | undefined): string[] {
  if (!node) return []
  const params = node.data.params
  return [
    node.data.region,
    params?.dragEndRegion,
    params?.uiReferenceRegion,
    params?.uiSearchRegion,
    params?.uiReferenceImageRegion
  ].filter((value): value is string => Boolean(value?.trim()))
}

function activeChain(context: AgentContextSnapshot): ActionChain | ExecutionChain | undefined {
  const chains =
    context.activeChainKind === 'executionChain'
      ? context.workspace.executionChains
      : context.workspace.chains
  return chains.find((chain) => chain.id === context.activeChainId)
}

/**
 * 为本轮助手请求选择项目视觉资产。
 * 优先级：用户点名 > 当前节点引用 > 当前链引用 > 其他框选区域 > 窗口标准图。
 */
export function selectAgentProjectAssetReferences(
  context: AgentContextSnapshot,
  message: string,
  limit = MAX_AGENT_PROJECT_ASSET_IMAGES
): AgentProjectAssetSelection {
  const chain = activeChain(context)
  const selectedNode = chain?.nodes.find((node) => node.id === context.selectedNodeId)
  const selectedRegionNames = new Set(nodeRegionNames(selectedNode))
  const activeRegionNames = new Set(chain?.nodes.flatMap((node) => nodeRegionNames(node)) ?? [])
  const normalizedMessage = message.toLocaleLowerCase('zh-CN')
  const regionAnchorIds = new Map<string, string | undefined>()
  const candidates: Array<AgentProjectAssetReference & { priority: number; order: number }> = []
  let order = 0

  for (const view of context.workspace.views) {
    for (const region of view.regions) {
      regionAnchorIds.set(region.name, region.windowAnchorId)
      if (!region.templateImagePath) continue
      const mentioned = normalizedMessage.includes(region.name.toLocaleLowerCase('zh-CN'))
      const priority = mentioned
        ? 400
        : selectedRegionNames.has(region.name)
          ? 300
          : activeRegionNames.has(region.name)
            ? 200
            : 100
      candidates.push({
        kind: 'region',
        label: `框选区域：${view.name} / ${region.name}`,
        assetPath: region.templateImagePath,
        regionName: region.name,
        windowAnchorId: region.windowAnchorId,
        priority,
        order: order++
      })
    }
  }

  const relevantAnchorIds = new Set(
    [...selectedRegionNames, ...activeRegionNames]
      .map((regionName) => regionAnchorIds.get(regionName))
      .filter((value): value is string => Boolean(value))
  )
  for (const anchor of context.workspace.windowAnchors) {
    if (!anchor.capturedImagePath) continue
    const mentioned = normalizedMessage.includes(anchor.name.toLocaleLowerCase('zh-CN'))
    candidates.push({
      kind: 'window',
      label: `窗口标准截图：${anchor.name}`,
      assetPath: anchor.capturedImagePath,
      windowAnchorId: anchor.id,
      priority: mentioned ? 390 : relevantAnchorIds.has(anchor.id) ? 190 : 50,
      order: order++
    })
  }

  const deduplicated = [...candidates]
    .sort((left, right) => right.priority - left.priority || left.order - right.order)
    .filter(
      (candidate, index, items) =>
        items.findIndex((item) => item.assetPath === candidate.assetPath) === index
    )
    .map((candidate) => ({
      kind: candidate.kind,
      label: candidate.label,
      assetPath: candidate.assetPath,
      regionName: candidate.regionName,
      windowAnchorId: candidate.windowAnchorId
    }))
  const safeLimit = Math.max(0, Math.floor(limit))
  return {
    availableCount: deduplicated.length,
    selected: deduplicated.slice(0, safeLimit),
    omittedCount: Math.max(0, deduplicated.length - safeLimit)
  }
}
