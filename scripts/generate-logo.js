// scripts/generate-logo.ts
// 生成 Kuangye "K" 图标
// 几何设计：深色背景 + 绿色粗笔画 K
// 用 pngjs 逐像素绘制，无需图像库依赖

const { PNG } = require('pngjs')
const fs = require('fs')
const path = require('path')

const BG_COLOR = [0x0a, 0x0b, 0x10, 0xff] // 深色背景
const K_COLOR = [0x10, 0xb9, 0x81, 0xff] // 亮绿（emerald-500）
/**
 * 在像素坐标 (px, py) 写一个颜色
 */
function setPixel(png, size, px, py, color) {
  if (px < 0 || py < 0 || px >= size || py >= size) return
  const idx = (size * py + px) << 2
  png.data[idx] = color[0]
  png.data[idx + 1] = color[1]
  png.data[idx + 2] = color[2]
  png.data[idx + 3] = color[3]
}

/**
 * 实心填充矩形
 */
function fillRect(png, size, x, y, w, h, color) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      setPixel(png, size, px, py, color)
    }
  }
}

/**
 * 实心填充圆
 */
function fillCircle(png, size, cx, cy, radius, color) {
  const r2 = radius * radius
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(size - 1, Math.ceil(cx + radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(size - 1, Math.ceil(cy + radius))
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px + 0.5 - cx
      const dy = py + 0.5 - cy
      if (dx * dx + dy * dy <= r2) {
        setPixel(png, size, px, py, color)
      }
    }
  }
}

/**
 * Bresenham 直线，附加 thickness 半径（圆形端点）
 */
function drawLine(png, size, x0, y0, x1, y1, thickness, color) {
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = Math.round(x0)
  let y = Math.round(y0)
  // safety bound
  let steps = 0
  const maxSteps = size * 4 + 10
  while (steps++ < maxSteps) {
    fillCircle(png, size, x, y, thickness / 2, color)
    if (x === Math.round(x1) && y === Math.round(y1)) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}

/**
 * 圆角遮罩（让四个角变透明）
 */
function applyRoundedCorners(png, size, radius) {
  if (radius <= 0) return
  const r2 = radius * radius
  // 左上
  for (let py = 0; py < radius; py++) {
    for (let px = 0; px < radius; px++) {
      const dx = px + 0.5 - radius
      const dy = py + 0.5 - radius
      if (dx * dx + dy * dy > r2) {
        const idx = (size * py + px) << 2
        png.data[idx + 3] = 0 // alpha = 0
      }
    }
  }
  // 右上
  for (let py = 0; py < radius; py++) {
    for (let px = size - radius; px < size; px++) {
      const dx = px + 0.5 - (size - radius)
      const dy = py + 0.5 - radius
      if (dx * dx + dy * dy > r2) {
        const idx = (size * py + px) << 2
        png.data[idx + 3] = 0
      }
    }
  }
  // 左下
  for (let py = size - radius; py < size; py++) {
    for (let px = 0; px < radius; px++) {
      const dx = px + 0.5 - radius
      const dy = py + 0.5 - (size - radius)
      if (dx * dx + dy * dy > r2) {
        const idx = (size * py + px) << 2
        png.data[idx + 3] = 0
      }
    }
  }
  // 右下
  for (let py = size - radius; py < size; py++) {
    for (let px = size - radius; px < size; px++) {
      const dx = px + 0.5 - (size - radius)
      const dy = py + 0.5 - (size - radius)
      if (dx * dx + dy * dy > r2) {
        const idx = (size * py + px) << 2
        png.data[idx + 3] = 0
      }
    }
  }
}

/**
 * 绘制 "K" 字形
 */
function drawK(png, size) {
  // 几何参数（按 size 比例缩放）
  const margin = Math.round(size * 0.18) // 边距
  const stroke = Math.round(size * 0.14) // 笔画粗细
  const radius = Math.round(size * 0.22) // 圆角半径

  // 圆角背景
  fillRect(png, size, 0, 0, size, size, BG_COLOR)
  applyRoundedCorners(png, size, radius)

  // K 的左竖
  const barX = margin
  const barY = margin
  const barW = stroke
  const barH = size - 2 * margin
  fillRect(png, size, barX, barY, barW, barH, K_COLOR)

  // K 的两条斜线
  const joinX = barX + barW // 竖条右边
  const joinY = size / 2 // 中点
  const endX = size - margin
  const topY = margin
  const bottomY = size - margin

  drawLine(png, size, joinX, joinY, endX, topY, stroke, K_COLOR)
  drawLine(png, size, joinX, joinY, endX, bottomY, stroke, K_COLOR)
}

/**
 * 生成单个图标
 */
function generateIcon(size, outPath) {
  const png = new PNG({ width: size, height: size })
  drawK(png, size)
  fs.writeFileSync(outPath, PNG.sync.write(png))
  console.log(`[OK] ${path.basename(outPath)} (${size}x${size})`)
}

function main() {
  const root = path.resolve(__dirname, '..')
  generateIcon(256, path.join(root, 'resources', 'icon.png'))
  generateIcon(512, path.join(root, 'build', 'icon.png'))
  // 多尺寸（用于 ICO 拼接，后续可用 png-to-ico 工具生成 .ico）
  ;[16, 32, 48, 64, 128].forEach((s) => {
    generateIcon(s, path.join(root, 'build', `icon-${s}.png`))
  })
  console.log('[DONE]')
}

main()
