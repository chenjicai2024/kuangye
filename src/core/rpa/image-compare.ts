// src/core/rpa/image-compare.ts
// 像素级图片对比 — 用 pixelmatch 检测聊天区域是否有变化
//
// 用途：
// - diff 预筛：chatMainArea 没变化就不触发后续检测
// - 快捷键验证：切换未读后 diff 确认是否生效

import _pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

// pixelmatch v7 是纯 ESM 包，Rollup CJS interop 可能把 module 对象当 default export
// 运行时 fallback：如果不是函数就取 .default
const pixelmatch: typeof _pixelmatch =
  typeof _pixelmatch === 'function'
    ? _pixelmatch
    : (_pixelmatch as unknown as { default: typeof _pixelmatch }).default

export interface CompareResult {
  /** 是否有变化 */
  hasChanged: boolean
  /** 差异像素占比 (0-100) */
  diffPercentage: number
  /** 完全相同？ */
  identical: boolean
  /** 差异像素数 */
  diffPixelCount: number
  /** 总像素数 */
  totalPixels: number
}

export interface CompareOptions {
  /** pixelmatch 阈值 (0-1)，越小越敏感。默认 0.1 */
  threshold?: number
  /** 判定"有变化"的最低 diffPercentage。默认 0.5% */
  changeThreshold?: number
}

/**
 * 底层：直接对两段 PNG buffer 做 pixelmatch 对比。
 * 解耦了 Electron NativeImage，overlay wizard 用这个版本，避免引 NativeImage。
 */
export function comparePngBuffers(
  buf1: Buffer,
  buf2: Buffer,
  options: CompareOptions = {}
): CompareResult {
  const { threshold = 0.1, changeThreshold = 0.5 } = options

  const png1 = PNG.sync.read(buf1)
  const png2 = PNG.sync.read(buf2)

  // 尺寸不同直接判定有变化
  if (png1.width !== png2.width || png1.height !== png2.height) {
    const totalPixels = Math.max(png1.width * png1.height, png2.width * png2.height)
    return {
      hasChanged: true,
      diffPercentage: 100,
      identical: false,
      diffPixelCount: totalPixels,
      totalPixels
    }
  }

  const { width, height } = png1
  const totalPixels = width * height

  if (totalPixels === 0) {
    return {
      hasChanged: false,
      diffPercentage: 0,
      identical: true,
      diffPixelCount: 0,
      totalPixels: 0
    }
  }

  const diffPixelCount = pixelmatch(
    png1.data as unknown as Uint8Array,
    png2.data as unknown as Uint8Array,
    undefined,
    width,
    height,
    { threshold }
  )

  const diffPercentage = (diffPixelCount / totalPixels) * 100
  const identical = diffPixelCount === 0
  const hasChanged = diffPercentage > changeThreshold

  return {
    hasChanged,
    diffPercentage: Math.round(diffPercentage * 100) / 100,
    identical,
    diffPixelCount,
    totalPixels
  }
}


