// src/core/action-chain/template-pack.ts
// 智能体模板导出/导入：将项目定义 + 所有截图打包为单文件 JSON

import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import {
  Project,
  Workspace,
  WindowAnchor,
  Region,
  View,
  ExecutionChain,
  ActionChain
} from './types'
import { readActionChainAsset, saveActionChainRegionTemplate, saveActionChainWindowCapture } from './assets'

// ============================================================
// 类型定义
// ============================================================

/** 模板文件结构 */
export interface TemplatePack {
  /** 格式版本，未来兼容性用 */
  version: 1
  /** 导出时间戳 */
  exportedAt: number
  /** 导出方程序版本 */
  appVersion: string
  /** 智能体名称（导入时可改名） */
  projectName: string
  /** 窗口锚点（含截图 base64） */
  windowAnchors: TemplateWindowAnchor[]
  /** 视图 + 区域（含模板截图 base64） */
  views: TemplateView[]
  /** 执行链 */
  executionChains: ExecutionChain[]
  /** 动作链 */
  chains: ActionChain[]
}

interface TemplateWindowAnchor {
  id: string
  name: string
  title: string
  ownerName: string
  ownerPath?: string
  capturedBounds: { x: number; y: number; width: number; height: number }
  capturedImageScaleFactor?: number
  /** 截图 base64（不含 data: 前缀） */
  capturedImageBase64?: string
}

interface TemplateView {
  name: string
  regions: TemplateRegion[]
}

interface TemplateRegion {
  name: string
  rect: { x: number; y: number; width: number; height: number }
  coordinateMode?: 'screen' | 'window'
  windowAnchorId?: string
  templateScaleFactor?: number
  /** 模板截图 base64（不含 data: 前缀） */
  templateImageBase64?: string
}

// ============================================================
// 导出
// ============================================================

/**
 * 将项目导出为模板包。
 * 收集项目定义 + 所有截图（base64 内嵌），返回可直接序列化的对象。
 */
export async function exportProjectToTemplate(project: Project): Promise<TemplatePack> {
  const ws = project.workspace
  const imageMap = new Map<string, string>() // assetPath -> base64

  // 收集所有需要导出的图片路径
  const windowAnchors: TemplateWindowAnchor[] = []
  for (const anchor of ws.windowAnchors ?? []) {
    let capturedImageBase64: string | undefined
    if (anchor.capturedImagePath) {
      capturedImageBase64 = await readImageToBase64(anchor.capturedImagePath, imageMap)
    }
    windowAnchors.push({
      id: anchor.id,
      name: anchor.name,
      title: anchor.title,
      ownerName: anchor.ownerName,
      ownerPath: anchor.ownerPath,
      capturedBounds: anchor.capturedBounds,
      capturedImageScaleFactor: anchor.capturedImageScaleFactor,
      capturedImageBase64
    })
  }

  const views: TemplateView[] = []
  for (const view of ws.views ?? []) {
    const regions: TemplateRegion[] = []
    for (const region of view.regions ?? []) {
      let templateImageBase64: string | undefined
      if (region.templateImagePath) {
        templateImageBase64 = await readImageToBase64(region.templateImagePath, imageMap)
      }
      regions.push({
        name: region.name,
        rect: region.rect,
        coordinateMode: region.coordinateMode,
        windowAnchorId: region.windowAnchorId,
        templateScaleFactor: region.templateScaleFactor,
        templateImageBase64
      })
    }
    views.push({ name: view.name, regions })
  }

  return {
    version: 1,
    exportedAt: Date.now(),
    appVersion: app.getVersion(),
    projectName: project.name,
    windowAnchors,
    views,
    executionChains: ws.executionChains ?? [],
    chains: ws.chains ?? []
  }
}

async function readImageToBase64(
  assetPath: string,
  cache: Map<string, string>
): Promise<string | undefined> {
  try {
    if (cache.has(assetPath)) return cache.get(assetPath)
    const buf = await readActionChainAsset(assetPath)
    const base64 = buf.toString('base64')
    cache.set(assetPath, base64)
    return base64
  } catch {
    return undefined
  }
}

// ============================================================
// 导入
// ============================================================

/**
 * 将模板包导入到指定项目。
 * 将截图存到本地，路径重写为本地路径，更新项目 workspace。
 */
export async function importTemplateToProject(
  projectId: string,
  template: TemplatePack
): Promise<Workspace> {
  // 导入窗口锚点（含截图）
  const windowAnchors: WindowAnchor[] = []
  for (const tAnchor of template.windowAnchors) {
    let capturedImagePath: string | undefined
    if (tAnchor.capturedImageBase64) {
      const png = Buffer.from(tAnchor.capturedImageBase64, 'base64')
      capturedImagePath = await saveActionChainWindowCapture(projectId, png)
    }
    windowAnchors.push({
      id: tAnchor.id,
      name: tAnchor.name,
      title: tAnchor.title,
      ownerName: tAnchor.ownerName,
      ownerPath: tAnchor.ownerPath,
      capturedBounds: tAnchor.capturedBounds,
      capturedImagePath,
      capturedImageScaleFactor: tAnchor.capturedImageScaleFactor
    })
  }

  // 导入视图 + 区域（含模板截图）
  const views: View[] = []
  for (const tView of template.views) {
    const regions: Region[] = []
    for (const tRegion of tView.regions) {
      let templateImagePath: string | undefined
      if (tRegion.templateImageBase64) {
        const png = Buffer.from(tRegion.templateImageBase64, 'base64')
        templateImagePath = await saveActionChainRegionTemplate(projectId, png)
      }
      regions.push({
        name: tRegion.name,
        rect: tRegion.rect,
        coordinateMode: tRegion.coordinateMode,
        windowAnchorId: tRegion.windowAnchorId,
        templateImagePath,
        templateScaleFactor: tRegion.templateScaleFactor
      })
    }
    views.push({ name: tView.name, regions })
  }

  return {
    windowAnchors,
    views,
    executionChains: template.executionChains ?? [],
    chains: template.chains ?? []
  }
}

// ============================================================
// 文件读写
// ============================================================

/** 导出模板到 JSON 文件 */
export async function writeTemplateFile(filePath: string, template: TemplatePack): Promise<void> {
  await writeFile(filePath, JSON.stringify(template, null, 2), 'utf-8')
}

/** 从 JSON 文件读取模板 */
export async function readTemplateFile(filePath: string): Promise<TemplatePack> {
  const data = await readFile(filePath, 'utf-8')
  const parsed = JSON.parse(data) as TemplatePack
  if (!parsed || parsed.version !== 1) {
    throw new Error('模板文件格式不正确或版本不受支持')
  }
  if (!Array.isArray(parsed.windowAnchors) || !Array.isArray(parsed.views)) {
    throw new Error('模板文件数据不完整')
  }
  return parsed
}
