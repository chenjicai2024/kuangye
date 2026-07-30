// src/core/work-memory/experience-store.ts
// 经验卡片持久化存储

import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { ExperienceCard, CardsFile } from './types'

function getBaseDir(): string {
  return join(app.getPath('userData'), 'workmemory')
}

function getCardsPath(): string {
  return join(getBaseDir(), 'cards.json')
}

async function readCardsFile(): Promise<CardsFile> {
  try {
    const data = await readFile(getCardsPath(), 'utf-8')
    return JSON.parse(data) as CardsFile
  } catch {
    return { cards: [] }
  }
}

async function writeCardsFile(file: CardsFile): Promise<void> {
  await mkdir(getBaseDir(), { recursive: true })
  await writeFile(getCardsPath(), JSON.stringify(file, null, 2), 'utf-8')
}

/** 列出指定智能体的卡片。旧版未标记智能体的卡片不会混入任何智能体。 */
export async function listCards(projectId: string): Promise<ExperienceCard[]> {
  const file = await readCardsFile()
  return file.cards.filter((card) => card.projectId === projectId)
}

/** 添加卡片 */
export async function addCard(
  input: Omit<ExperienceCard, 'id' | 'createdAt' | 'usedCount' | 'successCount' | 'enabled'>
): Promise<ExperienceCard> {
  const file = await readCardsFile()

  const card: ExperienceCard = {
    id: randomUUID(),
    ...input,
    createdAt: Date.now(),
    usedCount: 0,
    successCount: 0,
    enabled: true
  }

  file.cards.unshift(card)
  await writeCardsFile(file)
  return card
}

/** 批量添加卡片 */
export async function addCards(
  inputs: Array<Omit<ExperienceCard, 'id' | 'createdAt' | 'usedCount' | 'successCount' | 'enabled'>>
): Promise<ExperienceCard[]> {
  const file = await readCardsFile()
  const now = Date.now()

  const cards: ExperienceCard[] = inputs.map((input) => ({
    id: randomUUID(),
    ...input,
    createdAt: now,
    usedCount: 0,
    successCount: 0,
    enabled: true
  }))

  file.cards.unshift(...cards)
  await writeCardsFile(file)
  return cards
}

/** 更新卡片 */
export async function updateCard(
  projectId: string,
  id: string,
  patch: Partial<Pick<ExperienceCard, 'scenario' | 'guidance' | 'rationale' | 'chainTemplate'>>
): Promise<boolean> {
  const file = await readCardsFile()
  const card = file.cards.find((c) => c.id === id && c.projectId === projectId)
  if (!card) return false

  Object.assign(card, patch)
  await writeCardsFile(file)
  return true
}

/** 删除卡片 */
export async function deleteCard(projectId: string, id: string): Promise<boolean> {
  const file = await readCardsFile()
  const before = file.cards.length
  file.cards = file.cards.filter((c) => c.id !== id || c.projectId !== projectId)
  if (file.cards.length === before) return false

  await writeCardsFile(file)
  return true
}

/** 启用/禁用卡片 */
export async function setEnabled(
  projectId: string,
  id: string,
  enabled: boolean
): Promise<boolean> {
  const file = await readCardsFile()
  const card = file.cards.find((c) => c.id === id && c.projectId === projectId)
  if (!card) return false

  card.enabled = enabled
  await writeCardsFile(file)
  return true
}

/** 记录使用结果 */
export async function recordUsage(projectId: string, id: string, success: boolean): Promise<void> {
  const file = await readCardsFile()
  const card = file.cards.find((c) => c.id === id && c.projectId === projectId)
  if (!card) return

  card.usedCount++
  if (success) card.successCount++
  await writeCardsFile(file)
}

/** 获取启用的卡片（用于注入 AI prompt） */
export async function getActiveCards(projectId: string): Promise<ExperienceCard[]> {
  const file = await readCardsFile()
  return file.cards.filter((c) => c.projectId === projectId && c.enabled)
}

/**
 * 把项目化之前留下的无归属经验卡片迁入一个明确的智能体。
 * 调用方应先确认目标智能体确实没有自己的卡片，避免跨智能体误归属。
 */
export async function adoptLegacyCards(projectId: string): Promise<number> {
  const file = await readCardsFile()
  let adopted = 0
  for (const card of file.cards) {
    if (!card.projectId) {
      card.projectId = projectId
      adopted += 1
    }
  }
  if (adopted > 0) await writeCardsFile(file)
  return adopted
}
