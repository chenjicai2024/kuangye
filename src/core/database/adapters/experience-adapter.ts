// src/core/database/adapters/experience-adapter.ts
// 经验卡片双写适配器

import { ExperienceRepository, type ExperienceCard } from '../repositories/experience-repository'
import { dualWrite, dualRead, getDualWriteConfig } from '../dual-write'

let _repo: ExperienceRepository | null = null

function getRepo(): ExperienceRepository {
  if (!_repo) {
    _repo = new ExperienceRepository()
  }
  return _repo
}

/**
 * 创建经验卡片（双写）
 */
export async function createExperienceCard(
  cardData: {
    projectId?: string
    scenario: string
    guidance: string
    rationale?: string
    evidence?: string[]
    source?: 'agent_summary' | 'human_takeover' | 'manual'
  },
  jsonWriter: () => Promise<void>
): Promise<void> {
  const config = getDualWriteConfig()

  await dualWrite(
    jsonWriter,
    async () => {
      const repo = getRepo()
      repo.createCard(cardData)
    },
    { enableDatabase: config.enableDatabase }
  )
}

/**
 * 增加卡片使用次数（双写）
 */
export async function incrementCardUsage(
  cardId: string,
  success: boolean,
  jsonWriter: () => Promise<void>
): Promise<void> {
  const config = getDualWriteConfig()

  await dualWrite(
    jsonWriter,
    async () => {
      const repo = getRepo()
      repo.incrementUsed(cardId)
      if (success) {
        repo.incrementSuccess(cardId)
      }
    },
    { enableDatabase: config.enableDatabase }
  )
}

/**
 * 启用/禁用卡片（双写）
 */
export async function setCardEnabled(
  cardId: string,
  enabled: boolean,
  jsonWriter: () => Promise<void>
): Promise<void> {
  const config = getDualWriteConfig()

  await dualWrite(
    jsonWriter,
    async () => {
      const repo = getRepo()
      repo.setEnabled(cardId, enabled)
    },
    { enableDatabase: config.enableDatabase }
  )
}

/**
 * 列出经验卡片
 */
export async function listExperienceCards(
  projectId: string,
  jsonReader: () => Promise<unknown[]>
): Promise<unknown[]> {
  return dualRead(jsonReader, async () => {
    const repo = getRepo()
    return repo.findByProjectId(projectId)
  })
}

/**
 * 搜索经验卡片
 */
export async function searchExperienceCards(
  query: string,
  projectId?: string
): Promise<ExperienceCard[]> {
  const repo = getRepo()
  return repo.search(query, projectId)
}
