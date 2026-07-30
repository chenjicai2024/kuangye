import { Jimp } from 'jimp'

export interface TemplateMatchResult {
  x: number
  y: number
  width: number
  height: number
  score: number
}

interface MatchCandidate extends TemplateMatchResult {}

function scoreAt(
  searchData: Buffer,
  searchWidth: number,
  templateData: Buffer,
  templateWidth: number,
  templateHeight: number,
  offsetX: number,
  offsetY: number
): number {
  const sampleStep = Math.max(1, Math.floor(Math.min(templateWidth, templateHeight) / 18))
  let difference = 0
  let maxDifference = 0

  for (let y = 0; y < templateHeight; y += sampleStep) {
    for (let x = 0; x < templateWidth; x += sampleStep) {
      const templateOffset = (y * templateWidth + x) * 4
      const searchOffset = ((offsetY + y) * searchWidth + offsetX + x) * 4
      const alpha = templateData[templateOffset + 3] / 255
      if (alpha < 0.1) continue
      difference +=
        (Math.abs(templateData[templateOffset] - searchData[searchOffset]) +
          Math.abs(templateData[templateOffset + 1] - searchData[searchOffset + 1]) +
          Math.abs(templateData[templateOffset + 2] - searchData[searchOffset + 2])) *
        alpha
      maxDifference += 765 * alpha
    }
  }

  return maxDifference > 0 ? 1 - difference / maxDifference : 0
}

function findAtScale(
  searchData: Buffer,
  searchWidth: number,
  searchHeight: number,
  templateData: Buffer,
  templateWidth: number,
  templateHeight: number
): MatchCandidate | null {
  const maxX = searchWidth - templateWidth
  const maxY = searchHeight - templateHeight
  if (maxX < 0 || maxY < 0) return null

  const coarseStep = Math.max(1, Math.floor(Math.min(templateWidth, templateHeight) / 14))
  let best: MatchCandidate | null = null

  for (let y = 0; y <= maxY; y += coarseStep) {
    for (let x = 0; x <= maxX; x += coarseStep) {
      const score = scoreAt(
        searchData,
        searchWidth,
        templateData,
        templateWidth,
        templateHeight,
        x,
        y
      )
      if (!best || score > best.score) {
        best = { x, y, width: templateWidth, height: templateHeight, score }
      }
    }
  }

  if (!best || coarseStep === 1) return best
  const startX = Math.max(0, best.x - coarseStep)
  const endX = Math.min(maxX, best.x + coarseStep)
  const startY = Math.max(0, best.y - coarseStep)
  const endY = Math.min(maxY, best.y + coarseStep)
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const score = scoreAt(
        searchData,
        searchWidth,
        templateData,
        templateWidth,
        templateHeight,
        x,
        y
      )
      if (score > best.score) {
        best = { x, y, width: templateWidth, height: templateHeight, score }
      }
    }
  }
  return best
}

export async function findTemplateMatch(
  searchPng: Buffer,
  templatePng: Buffer,
  preferredScale = 1,
  threshold = 0.82
): Promise<TemplateMatchResult | null> {
  const searchImage = await Jimp.read(searchPng)
  const sourceTemplate = await Jimp.read(templatePng)
  const scales = [preferredScale]
  if (preferredScale * 0.9 > 0.1) scales.push(preferredScale * 0.9)
  scales.push(preferredScale * 1.1)

  let best: MatchCandidate | null = null
  for (const scale of scales) {
    const width = Math.max(2, Math.round(sourceTemplate.bitmap.width * scale))
    const height = Math.max(2, Math.round(sourceTemplate.bitmap.height * scale))
    const template =
      width === sourceTemplate.bitmap.width && height === sourceTemplate.bitmap.height
        ? sourceTemplate
        : sourceTemplate.clone().resize({ w: width, h: height })
    const candidate = findAtScale(
      searchImage.bitmap.data,
      searchImage.bitmap.width,
      searchImage.bitmap.height,
      template.bitmap.data,
      template.bitmap.width,
      template.bitmap.height
    )
    if (candidate && (!best || candidate.score > best.score)) best = candidate
    if (best && best.score >= threshold) break
  }

  return best && best.score >= threshold ? best : null
}
