// src/core/rpa/vision-utils.ts
// VLM 视觉检测工具
//
// 用 AIClient.detectVision() 调视觉模型，解析返回的 bbox/point 坐标
// 用于区域定位和布局检测

import { AppType, ScreenRect } from './types'
import { getWindowInfoSync } from './window-utils'
import { BBox, bboxToScreenCoords, pointToScreenCoords, bboxToCropBounds } from './coord-utils'

export type { BBox }
export { bboxToScreenCoords, pointToScreenCoords, bboxToCropBounds }

export interface LayoutAreaItem {
  bbox?: BBox
  rect?: ScreenRect
  coordinates: [number, number] // 屏幕绝对坐标
  source?: 'vlm' | 'box-select' | 'derived'
}

export interface LayoutCache {
  // ── 未读检测区域（detectUnreadArea） ──
  chatEntranceArea: LayoutAreaItem | null // 聊天入口按钮（粗检测红点）
  firstContact: LayoutAreaItem | null // 联系人列表第一行（细检测红点）

  // ── 主布局区域（detectWechatLayout） ──
  searchInputBox: LayoutAreaItem | null // 搜索输入框
  headerArea: LayoutAreaItem | null // 对话窗口 header
  chatMainArea: LayoutAreaItem | null // 聊天记录区（diff 检测用）

  // ── 输入框区域（从 chatMainArea 反推） ──
  messageInputArea: LayoutAreaItem | null // 文字输入框（chatMainArea 底边 → 窗口底边）

  timestamp: number
  appType: AppType
}

// ── 布局缓存（内存） ──

const layoutCacheMemory = new Map<AppType, LayoutCache>()

export function getLayoutCache(appType: AppType): LayoutCache | null {
  return layoutCacheMemory.get(appType) || null
}

export function setLayoutCache(appType: AppType, cache: LayoutCache): void {
  layoutCacheMemory.set(appType, cache)
}

// ── BBox / Point 解析 ──

/**
 * 从 VLM 返回文本中解析所有 <bbox> 标签
 * 支持格式:
 *   - <bbox>x1,y1,x2,y2</bbox>  (逗号分隔)
 *   - <bbox>x1 y1 x2 y2</bbox>  (空格分隔)
 * 坐标为归一化 0-1000
 */
export function parseBBoxes(text: string): BBox[] {
  if (!text) return []
  const bboxes: BBox[] = []

  // 1. 先尝试逗号分隔格式（标准格式）
  let regex = /<bbox>\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*<\/bbox>/gi
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const x1 = Number(match[1])
    const y1 = Number(match[2])
    const x2 = Number(match[3])
    const y2 = Number(match[4])
    if ([x1, y1, x2, y2].every((v) => Number.isFinite(v))) {
      bboxes.push([Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)])
    }
  }

  // 2. 如果没有找到逗号分隔的格式，尝试空格分隔
  if (bboxes.length === 0) {
    regex = /<bbox>\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*<\/bbox>/gi

    while ((match = regex.exec(text)) !== null) {
      const x1 = Number(match[1])
      const y1 = Number(match[2])
      const x2 = Number(match[3])
      const y2 = Number(match[4])
      if ([x1, y1, x2, y2].every((v) => Number.isFinite(v))) {
        bboxes.push([Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)])
      }
    }
  }

  return bboxes
}

// ── 核心检测函数 ──

/**
 * 从 chatMainArea 反推输入框区域（纯计算，无外部调用）
 *
 * 原理：
 * - 窗口右侧 = chatMainArea（聊天记录区）+ InputArea（文字输入区）上下排列
 * - InputArea.x1 = chatMainArea.x1（同宽左边）
 * - InputArea.x2 = chatMainArea.x2（同宽右边）
 * - InputArea.y1 = chatMainArea.y2（chatMainArea 底边 = InputArea 顶边）
 * - InputArea.y2 = 1000（窗口底边）
 */
export function getInputAreaFromCache(appType: AppType): LayoutAreaItem | null {
  const cache = getLayoutCache(appType)

  // 已有 messageInputArea 直接返回
  if (cache?.messageInputArea) {
    return cache.messageInputArea
  }

  // 从 chatMainArea 反推
  if (!cache?.chatMainArea) {
    console.warn('[VisionUtils] chatMainArea 不存在，无法反推 inputArea')
    return null
  }

  if (!cache.chatMainArea.bbox) {
    console.warn('[VisionUtils] chatMainArea 没有 bbox，无法反推 inputArea')
    return null
  }

  const [x1, , x2, y2] = cache.chatMainArea.bbox
  const inputBbox: BBox = [x1, y2, x2, 1000] // chatMainArea 底边 → 窗口底边

  // 需要窗口信息来转换坐标
  // 这里用 chatMainArea 的坐标来估算：inputArea 中心 = (x1+x2)/2, (y2+1000)/2
  // 但更精确的方式是拿窗口 bounds 转换
  const windowInfo = getWindowInfoSync(appType)
  if (!windowInfo?.bounds) {
    console.warn('[VisionUtils] 窗口信息不可用，使用粗略坐标估算')
    return null
  }

  const { bounds, scaleFactor } = windowInfo
  const coordinates = bboxToScreenCoords(inputBbox, bounds, scaleFactor)
  const messageInputArea: LayoutAreaItem = { bbox: inputBbox, coordinates }

  // 写入缓存
  setLayoutCache(appType, {
    ...cache,
    messageInputArea,
    timestamp: Date.now()
  })

  console.log('[VisionUtils] 从 chatMainArea 反推 inputArea:', {
    chatMainArea: cache.chatMainArea.bbox,
    inputArea: inputBbox,
    coordinates
  })

  return messageInputArea
}


