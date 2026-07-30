import { clipboard } from 'electron'

import {
  splitTextForProgressiveInput,
  type ProgressiveTextChunkStrategy
} from './text-input-chunks'
const IS_WINDOWS = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

import { delay, randomDelayIn, getRobot } from './util'

type MouseButton = 'left' | 'right'
type RobotInstance = NonNullable<ReturnType<typeof getRobot>>

/** 只记录由本程序主动按下、尚未抬起的鼠标键。 */
const pressedMouseButtons = new Set<MouseButton>()

function pressTrackedMouseButton(robot: RobotInstance, button: MouseButton): void {
  robot.mouseToggle('down', button)
  pressedMouseButtons.add(button)
}

function releaseTrackedMouseButton(robot: RobotInstance, button: MouseButton): void {
  if (!pressedMouseButtons.has(button)) return
  try {
    robot.mouseToggle('up', button)
  } finally {
    pressedMouseButtons.delete(button)
  }
}

// 原版 whatsapp-agent-demo 的贝塞尔曲线仿人滑动
export async function humanLikeMove(
  targetX: number,
  targetY: number,
  options: {
    minSteps?: number
    maxSteps?: number
    baseDelay?: number
  } = {}
): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const { minSteps = 5, maxSteps = 15, baseDelay = 2 } = options

  const startPos = robot.getMousePos()
  const dx = targetX - startPos.x
  const dy = targetY - startPos.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  if (distance < 1) {
    robot.moveMouse(Math.round(targetX), Math.round(targetY))
    return
  }

  // 根据距离决定步数
  const steps = Math.min(
    maxSteps,
    Math.max(minSteps, Math.floor(distance / 40) + Math.floor(Math.random() * 3))
  )

  // 生成贝塞尔曲线控制点 (Cubic Bezier)
  const ctrl1X = startPos.x + dx * Math.random() * 0.5 + (Math.random() - 0.5) * distance * 0.2
  const ctrl1Y = startPos.y + dy * Math.random() * 0.5 + (Math.random() - 0.5) * distance * 0.2
  const ctrl2X =
    startPos.x + dx * (0.5 + Math.random() * 0.5) + (Math.random() - 0.5) * distance * 0.2
  const ctrl2Y =
    startPos.y + dy * (0.5 + Math.random() * 0.5) + (Math.random() - 0.5) * distance * 0.2

  for (let i = 1; i <= steps; i++) {
    const t = i / steps

    // 匀速转非线性 (Ease Out)
    const easeT = t * (2 - t)

    const mt = 1 - easeT
    const mt2 = mt * mt
    const mt3 = mt2 * mt
    const easeT2 = easeT * easeT
    const easeT3 = easeT2 * easeT

    // 贝塞尔曲线公式计算
    const x =
      mt3 * startPos.x + 3 * mt2 * easeT * ctrl1X + 3 * mt * easeT2 * ctrl2X + easeT3 * targetX
    const y =
      mt3 * startPos.y + 3 * mt2 * easeT * ctrl1Y + 3 * mt * easeT2 * ctrl2Y + easeT3 * targetY

    // 加入随机细微抖动 (±1像素)
    const jitterX = i === steps ? 0 : (Math.random() - 0.5) * 2
    const jitterY = i === steps ? 0 : (Math.random() - 0.5) * 2

    robot.moveMouse(Math.round(x + jitterX), Math.round(y + jitterY))

    // 变频延迟，模拟人类微停顿
    let stepDelay = baseDelay + Math.random() * 2
    if (i > steps * 0.8) stepDelay += 2

    await delay(stepDelay)
  }
}

/**
 * 仿人化的鼠标点击函数
 * 将点击分解为按下和抬起，并加入随机物理按压延迟
 * @param button 鼠标按键，默认 'left'
 */
export async function humanLikeClick(button: MouseButton = 'left'): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  try {
    // 模拟按下
    pressTrackedMouseButton(robot, button)

    // 模拟物理按压耗时 (50ms - 150ms)
    const pressDuration = 120 + Math.random() * 100
    await delay(Math.round(pressDuration))

    // 模拟抬起
    releaseTrackedMouseButton(robot, button)

    // 点击后的随机微小停顿，模拟人类反应
    const afterClickDelay = 50 + Math.random() * 100
    await delay(Math.round(afterClickDelay))
  } catch (error) {
    console.error('【拟人化点击】执行失败:', error)
    try {
      releaseTrackedMouseButton(robot, button)
    } catch {
      /* 继续执行下面的降级点击 */
    }
    // 降级处理：如果异常，确保至少尝试点击
    robot.mouseClick(button)
  }
}

/** 紧急停止时只释放本程序确实按住的鼠标键，避免制造虚假的右键事件。 */
export function releasePressedMouseButtons(): void {
  const robot = getRobot()
  if (!robot) return

  for (const button of [...pressedMouseButtons]) {
    try {
      releaseTrackedMouseButton(robot, button)
    } catch {
      /* 退出或紧急停止阶段不再向外抛出鼠标驱动异常 */
    }
  }
}

/** 按给定坐标聚焦输入框并粘贴文字，不触发 Enter。 */
export async function typeTextByCoordsAction(x: number, y: number, text: string): Promise<boolean> {
  const robot = getRobot()
  if (!robot) {
    console.error('[typeTextByCoordsAction] RobotJS 缺失')
    return false
  }

  try {
    await humanLikeMove(x, y)
    await randomDelayIn(100, 200)

    robot.mouseClick('left')
    await randomDelayIn(200, 300)

    clipboard.writeText(text)
    await randomDelayIn(50, 100)

    if (IS_MAC) {
      robot.keyTap('v', ['command'])
    } else {
      robot.keyTap('v', ['control'])
    }

    await randomDelayIn(300, 500)

    return true
  } catch (error: unknown) {
    console.error('[typeTextByCoordsAction] Failed:', error)
    return false
  }
}

export interface ProgressiveTextInputOptions {
  strategy?: ProgressiveTextChunkStrategy
  minChunkSize?: number
  maxChunkSize?: number
  minDelayMs?: number
  maxDelayMs?: number
}

/** 聚焦输入框后分段粘贴文字，不触发 Enter。 */
export async function typeTextProgressivelyByCoordsAction(
  x: number,
  y: number,
  text: string,
  options: ProgressiveTextInputOptions = {}
): Promise<boolean> {
  const robot = getRobot()
  if (!robot) {
    console.error('[typeTextProgressivelyByCoordsAction] RobotJS 缺失')
    return false
  }

  const minDelayMs = Math.max(0, Math.floor(options.minDelayMs ?? 200))
  const maxDelayMs = Math.max(minDelayMs, Math.floor(options.maxDelayMs ?? 500))

  try {
    await humanLikeMove(x, y)
    await randomDelayIn(100, 200)
    robot.mouseClick('left')
    await randomDelayIn(200, 300)

    const chunks = splitTextForProgressiveInput(text, {
      strategy: options.strategy ?? 'random',
      minSize: options.minChunkSize,
      maxSize: options.maxChunkSize
    })
    for (const [index, chunk] of chunks.entries()) {
      clipboard.writeText(chunk)
      await randomDelayIn(50, 100)
      if (IS_MAC) {
        robot.keyTap('v', ['command'])
      } else {
        robot.keyTap('v', ['control'])
      }
      if (index < chunks.length - 1) await randomDelayIn(minDelayMs, maxDelayMs)
    }

    return true
  } catch (error: unknown) {
    console.error('[typeTextProgressivelyByCoordsAction] Failed:', error)
    return false
  }
}

/**
 * 业务原子 2 — 核心实现：按给定坐标发送消息（不依赖 VLM 缓存）。
 * `sendReplyAction`（VLM 路线）与 overlay wizard（框选路线）共用此函数。
 *
 * 1. 聚焦输入框并粘贴文字
 * 2. Enter 发送
 */
export async function sendReplyByCoordsAction(
  x: number,
  y: number,
  text: string
): Promise<boolean> {
  const typed = await typeTextByCoordsAction(x, y, text)
  if (!typed) return false

  const robot = getRobot()
  if (!robot) return false

  try {
    robot.keyTap('enter')

    if (IS_WINDOWS) {
      robot.keyTap('enter', ['control'])
      await randomDelayIn(40, 60)
      robot.keyTap('backspace')
    } else {
      robot.keyTap('enter', ['command'])
      await randomDelayIn(20, 40)
      robot.keyToggle('command', 'up')
      await randomDelayIn(20, 40)
      robot.keyTap('backspace')
    }

    return true
  } catch (error: unknown) {
    console.error('[sendReplyByCoordsAction] Failed:', error)
    return false
  }
}

/**
 * 通用右键点击：移动到坐标后执行右键
 */
export async function rightClickAction(coordinates: [number, number]): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const [x, y] = coordinates
  await humanLikeMove(x, y)
  await randomDelayIn(150, 250)
  await humanLikeClick('right')
  await randomDelayIn(100, 200)
}

/**
 * 通用拖拽：从起点坐标按住左键，移动到终点坐标后松开
 * 适用于拖文件、拖窗口、拖扑克牌等
 */
export async function dragAction(
  startCoordinates: [number, number],
  endCoordinates: [number, number]
): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const [sx, sy] = startCoordinates
  const [ex, ey] = endCoordinates

  // 移动到起点并按下
  await humanLikeMove(sx, sy)
  await randomDelayIn(150, 250)
  pressTrackedMouseButton(robot, 'left')
  try {
    await randomDelayIn(100, 200)

    // 移动到终点并松开
    await humanLikeMove(ex, ey)
    await randomDelayIn(150, 250)
  } finally {
    releaseTrackedMouseButton(robot, 'left')
  }
  await randomDelayIn(100, 200)
}

// 把 UI 常用的键名转成 RobotJS 能识别的名字
function normalizeRobotKey(name: string): string {
  const map: Record<string, string> = {
    esc: 'escape',
    escape: 'escape',
    space: 'space',
    tab: 'tab',
    backspace: 'backspace',
    delete: 'delete',
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right'
  }
  const lower = name.trim().toLowerCase()
  return map[lower] ?? lower
}

// 把 UI 常用的修饰键写法转成 RobotJS 修饰键名
function normalizeModifiers(modifiers: string[] = []): string[] {
  return modifiers.map((m) => {
    const lower = m.trim().toLowerCase()
    if (lower === 'ctrl' || lower === 'control') return 'control'
    if (lower === 'cmd' || lower === 'command' || lower === 'win')
      return IS_MAC ? 'command' : 'control'
    if (lower === 'alt' || lower === 'option') return 'alt'
    if (lower === 'shift') return 'shift'
    return lower
  })
}

/**
 * 按单个键
 */
export async function keyPressAction(keyName: string): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const key = normalizeRobotKey(keyName)
  robot.keyTap(key)
  await randomDelayIn(80, 150)
}

/**
 * 按组合键
 */
export async function hotkeyAction(keyName: string, modifiers: string[] = []): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const key = normalizeRobotKey(keyName)
  const mods = normalizeModifiers(modifiers)
  robot.keyTap(key, mods)
  await randomDelayIn(80, 150)
}
