import activeWin from 'active-win'
import { screen } from 'electron'
import type { Window as NativeWindow } from 'node-window-manager'
import type { WindowAnchor } from '../action-chain/types'
import type { ScreenRect } from './types'

type OpenWindow = Awaited<ReturnType<typeof activeWin.getOpenWindows>>[number]

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeNativeBounds(bounds: {
  x?: number
  y?: number
  width?: number
  height?: number
}): ScreenRect | null {
  const { x, y, width, height } = bounds
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null

  return {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.max(1, Math.round(width as number)),
    height: Math.max(1, Math.round(height as number))
  }
}

function nativeWindowScore(window: NativeWindow, anchor: WindowAnchor): number {
  const title = normalized(window.getTitle())
  const path = normalized(window.path)
  const anchorPath = normalized(anchor.ownerPath)
  const anchorTitle = normalized(anchor.title)
  const anchorOwner = normalized(anchor.ownerName).replace(/\.exe$/, '')
  const executableName =
    path
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.exe$/, '') ?? ''
  const bounds = normalizeNativeBounds(window.getBounds())
  if (!bounds) return Number.NEGATIVE_INFINITY

  let score = 0
  if (anchorPath && path === anchorPath) score += 2000
  if (anchorOwner && executableName === anchorOwner) score += 1000
  if (anchorTitle && title === anchorTitle) score += 500
  else if (anchorTitle && (title.includes(anchorTitle) || anchorTitle.includes(title))) score += 200

  const sizeDelta =
    Math.abs(bounds.width - anchor.capturedBounds.width) +
    Math.abs(bounds.height - anchor.capturedBounds.height)
  return score - Math.min(sizeDelta, 1000)
}

export interface WindowCalibrationResult {
  before: ScreenRect
  expected: ScreenRect
  actual: ScreenRect
  calibrated: boolean
}

/** 将外部窗口恢复到锚点捕获时的尺寸，并读取实际结果进行确认。 */
export async function calibrateWindowAnchor(
  anchor: WindowAnchor,
  tolerance = 2
): Promise<WindowCalibrationResult | null> {
  const { windowManager } = await import('node-window-manager')
  const target = windowManager
    .getWindows()
    .filter((window) => window.isWindow())
    .map((window) => ({ window, score: nativeWindowScore(window, anchor) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.window
  if (!target) return null

  const before = normalizeNativeBounds(target.getBounds())
  if (!before) return null
  target.restore()
  await wait(120)

  const restored = normalizeNativeBounds(target.getBounds())
  if (!restored) return null
  const expectedWidth = anchor.capturedBounds.width
  const expectedHeight = anchor.capturedBounds.height
  const workArea = screen.getDisplayMatching(restored).workArea
  const expected: ScreenRect = {
    x: Math.min(Math.max(restored.x, workArea.x), workArea.x + workArea.width - expectedWidth),
    y: Math.min(Math.max(restored.y, workArea.y), workArea.y + workArea.height - expectedHeight),
    width: expectedWidth,
    height: expectedHeight
  }

  target.setBounds(expected)
  await wait(220)
  const actual = normalizeNativeBounds(target.getBounds())
  if (!actual) return null
  const calibrated =
    Math.abs(actual.width - expected.width) <= tolerance &&
    Math.abs(actual.height - expected.height) <= tolerance

  return { before, expected, actual, calibrated }
}

/** Convert Win32 physical-pixel bounds to Electron DIP bounds. */
export function nativeWindowBoundsToDip(rect: ScreenRect): ScreenRect {
  if (process.platform !== 'win32') {
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  }

  const topLeft = screen.screenToDipPoint({ x: rect.x, y: rect.y })
  const bottomRight = screen.screenToDipPoint({
    x: rect.x + rect.width,
    y: rect.y + rect.height
  })
  return {
    x: Math.round(topLeft.x),
    y: Math.round(topLeft.y),
    width: Math.max(1, Math.round(bottomRight.x - topLeft.x)),
    height: Math.max(1, Math.round(bottomRight.y - topLeft.y))
  }
}

function candidateScore(window: OpenWindow, anchor: WindowAnchor, bounds: ScreenRect): number {
  const ownerPath = normalized(window.owner.path)
  const ownerName = normalized(window.owner.name)
  const title = normalized(window.title)
  const anchorPath = normalized(anchor.ownerPath)
  const anchorOwner = normalized(anchor.ownerName)
  const anchorTitle = normalized(anchor.title)

  let score = 0
  if (anchorPath && ownerPath === anchorPath) score += 2000
  if (anchorOwner && ownerName === anchorOwner) score += 1000
  if (anchorTitle && title === anchorTitle) score += 500
  else if (anchorTitle && (title.includes(anchorTitle) || anchorTitle.includes(title))) score += 200

  const sizeDelta =
    Math.abs(bounds.width - anchor.capturedBounds.width) +
    Math.abs(bounds.height - anchor.capturedBounds.height)
  return score - Math.min(sizeDelta, 1000)
}

export async function resolveWindowAnchorBounds(anchor: WindowAnchor): Promise<ScreenRect | null> {
  const windows = await activeWin.getOpenWindows()
  const anchorPath = normalized(anchor.ownerPath)
  const anchorOwner = normalized(anchor.ownerName)

  let candidates = windows.filter(
    (window) => window.bounds && window.bounds.width > 100 && window.bounds.height > 100
  )
  if (anchorPath) {
    const pathMatches = candidates.filter((window) => normalized(window.owner.path) === anchorPath)
    if (pathMatches.length > 0) candidates = pathMatches
  }
  if (anchorOwner) {
    const ownerMatches = candidates.filter(
      (window) => normalized(window.owner.name) === anchorOwner
    )
    if (ownerMatches.length > 0) candidates = ownerMatches
  }

  const ranked = candidates
    .map((window) => {
      const bounds = nativeWindowBoundsToDip(window.bounds)
      return { bounds, score: candidateScore(window, anchor, bounds) }
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)

  return ranked[0]?.bounds ?? null
}
