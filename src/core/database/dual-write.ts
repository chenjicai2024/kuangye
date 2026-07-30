// src/core/database/dual-write.ts
// 双写模式管理器
//
// 默认只写入数据库，不写入 JSON 文件

export interface DualWriteConfig {
  /** 是否启用数据库写入 */
  enableDatabase: boolean
  /** 是否保留 JSON 文件写入（用于回滚） */
  enableJsonFile: boolean
  /** 是否从数据库读取（优先） */
  readFromDatabase: boolean
}

const DEFAULT_CONFIG: DualWriteConfig = {
  enableDatabase: true,
  enableJsonFile: false, // 默认不写入 JSON，只写数据库
  readFromDatabase: true // 默认从数据库读取
}

let _config: DualWriteConfig = { ...DEFAULT_CONFIG }

/**
 * 获取当前双写配置
 */
export function getDualWriteConfig(): DualWriteConfig {
  return { ..._config }
}

/**
 * 更新双写配置
 */
export function setDualWriteConfig(config: Partial<DualWriteConfig>): void {
  _config = { ..._config, ...config }
  console.log('[DualWrite] 配置已更新:', _config)
}

/**
 * 重置为默认配置
 */
export function resetDualWriteConfig(): void {
  _config = { ...DEFAULT_CONFIG }
}

/**
 * 双写执行器
 * 用于在写入时同时操作 JSON 和数据库
 */
export async function dualWrite<T>(
  jsonWriter: () => Promise<T>,
  dbWriter: () => Promise<T>,
  config?: Partial<DualWriteConfig>
): Promise<T> {
  const cfg = { ..._config, ...config }
  let jsonResult: T | undefined
  let dbResult: T | undefined
  let jsonError: Error | undefined
  let dbError: Error | undefined

  // 并行写入
  const promises: Promise<void>[] = []

  if (cfg.enableJsonFile) {
    promises.push(
      jsonWriter()
        .then((result) => {
          jsonResult = result
        })
        .catch((error) => {
          jsonError = error
          console.error('[DualWrite] JSON 写入失败:', error)
        })
    )
  }

  if (cfg.enableDatabase) {
    promises.push(
      dbWriter()
        .then((result) => {
          dbResult = result
        })
        .catch((error) => {
          dbError = error
          console.error('[DualWrite] 数据库写入失败:', error)
        })
    )
  }

  await Promise.all(promises)

  // 处理结果
  if (cfg.enableDatabase && cfg.enableJsonFile) {
    // 双写模式：任一成功即可
    if (dbError && jsonError) {
      throw new Error(`双写均失败: JSON=${jsonError.message}, DB=${dbError.message}`)
    }
    return (dbResult ?? jsonResult) as T
  }

  if (cfg.enableDatabase) {
    if (dbError) throw dbError
    return dbResult as T
  }

  if (cfg.enableJsonFile) {
    if (jsonError) throw jsonError
    return jsonResult as T
  }

  throw new Error('双写均已禁用')
}

/**
 * 双写读取器
 * 根据配置从 JSON 或数据库读取
 */
export async function dualRead<T>(
  jsonReader: () => Promise<T>,
  dbReader: () => Promise<T>,
  config?: Partial<DualWriteConfig>
): Promise<T> {
  const cfg = { ..._config, ...config }

  if (cfg.readFromDatabase) {
    try {
      return await dbReader()
    } catch (error) {
      console.warn('[DualWrite] 数据库读取失败，回退到 JSON:', error)
      return jsonReader()
    }
  }

  return jsonReader()
}
