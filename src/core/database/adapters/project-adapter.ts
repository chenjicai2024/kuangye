// src/core/database/adapters/project-adapter.ts
// 项目存储双写适配器

import { ProjectRepository } from '../repositories/project-repository'
import { dualWrite, dualRead, getDualWriteConfig } from '../dual-write'

let _repo: ProjectRepository | null = null

function getRepo(): ProjectRepository {
  if (!_repo) {
    _repo = new ProjectRepository()
  }
  return _repo
}

/**
 * 保存项目（双写）
 */
export async function saveProject(
  projectData: {
    id: string
    name: string
    workspace?: unknown
    regions?: unknown[]
  },
  jsonWriter: () => Promise<void>
): Promise<void> {
  const config = getDualWriteConfig()

  await dualWrite(
    jsonWriter,
    async () => {
      const repo = getRepo()
      const existing = repo.findById(projectData.id)

      if (existing) {
        repo.update(projectData.id, {
          name: projectData.name,
          workspace: projectData.workspace ? JSON.stringify(projectData.workspace) : undefined
        })
      } else {
        const now = Date.now()
        repo.create({
          name: projectData.name,
          created_at: now,
          updated_at: now,
          workspace: projectData.workspace ? JSON.stringify(projectData.workspace) : undefined
        })
      }
    },
    { enableDatabase: config.enableDatabase }
  )
}

/**
 * 加载项目（优先从数据库读取）
 */
export async function loadProject(
  projectId: string,
  jsonReader: () => Promise<unknown>
): Promise<unknown> {
  return dualRead(jsonReader, async () => {
    const repo = getRepo()
    const project = repo.findById(projectId)
    if (!project) return null

    // 解析 workspace
    if (project.workspace) {
      try {
        return JSON.parse(project.workspace)
      } catch {
        return null
      }
    }
    return null
  })
}

/**
 * 列出所有项目
 */
export async function listProjects(
  jsonReader: () => Promise<Array<{ id: string; name: string }>>
): Promise<Array<{ id: string; name: string }>> {
  return dualRead(jsonReader, async () => {
    const repo = getRepo()
    return repo.findAllProjects().map((p) => ({
      id: p.id,
      name: p.name
    }))
  })
}

/**
 * 删除项目
 */
export async function deleteProject(
  projectId: string,
  jsonDeleter: () => Promise<void>
): Promise<void> {
  const config = getDualWriteConfig()

  await dualWrite(
    jsonDeleter,
    async () => {
      const repo = getRepo()
      repo.delete(projectId)
    },
    { enableDatabase: config.enableDatabase }
  )
}
