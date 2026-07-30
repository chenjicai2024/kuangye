import Store from 'electron-store'
import type { AITokenUsageReport } from '../core/token-usage'
import { isRecord } from '../core/error-utils'

const StoreImport = Store as typeof Store & { default?: typeof Store }
const StoreClass = typeof Store === 'function' ? Store : StoreImport.default!

export interface ModelTokenUsage {
  key: string
  model: string
  provider: string
  sources: string[]
  requestCount: number
  reportedRequestCount: number
  unreportedRequestCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  reasoningTokens: number
  lastUsedAt: string
}

export type TokenUsageRange = 'today' | '7d' | '30d' | 'all'

interface TokenUsageCounters {
  requestCount: number
  reportedRequestCount: number
  unreportedRequestCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  reasoningTokens: number
}

interface DailyTokenUsage extends TokenUsageCounters {
  date: string
  lastUsedAt: string
}

interface StoredModelTokenUsage extends ModelTokenUsage {
  daily: Record<string, DailyTokenUsage>
}

export interface TokenUsageSnapshot {
  records: ModelTokenUsage[]
  totals: {
    requestCount: number
    reportedRequestCount: number
    unreportedRequestCount: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedTokens: number
    reasoningTokens: number
  }
  updatedAt: string | null
}

const tokenUsageStore = new StoreClass<Record<string, unknown>>({
  name: 'token-usage',
  defaults: { records: {}, updatedAt: null }
})

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
}

function emptyCounters(): TokenUsageCounters {
  return {
    requestCount: 0,
    reportedRequestCount: 0,
    unreportedRequestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0
  }
}

function normalizeDailyBucket(date: string, raw: unknown): DailyTokenUsage | null {
  if (!isRecord(raw)) return null
  return {
    date,
    requestCount: nonNegativeInt(raw.requestCount),
    reportedRequestCount: nonNegativeInt(raw.reportedRequestCount),
    unreportedRequestCount: nonNegativeInt(raw.unreportedRequestCount),
    inputTokens: nonNegativeInt(raw.inputTokens),
    outputTokens: nonNegativeInt(raw.outputTokens),
    totalTokens: nonNegativeInt(raw.totalTokens),
    cachedTokens: nonNegativeInt(raw.cachedTokens),
    reasoningTokens: nonNegativeInt(raw.reasoningTokens),
    lastUsedAt: typeof raw.lastUsedAt === 'string' ? raw.lastUsedAt : ''
  }
}

function normalizeRecord(key: string, raw: unknown): StoredModelTokenUsage | null {
  if (!isRecord(raw)) return null
  const model = typeof raw.model === 'string' && raw.model ? raw.model : 'unknown'
  const provider = typeof raw.provider === 'string' && raw.provider ? raw.provider : 'unknown'
  const rawDaily = isRecord(raw.daily) ? raw.daily : {}
  const daily = Object.fromEntries(
    Object.entries(rawDaily)
      .map(([date, value]) => [date, normalizeDailyBucket(date, value)] as const)
      .filter((entry): entry is [string, DailyTokenUsage] => entry[1] !== null)
  )
  return {
    key,
    model,
    provider,
    sources: Array.isArray(raw.sources)
      ? raw.sources.filter((value): value is string => typeof value === 'string')
      : [],
    requestCount: nonNegativeInt(raw.requestCount),
    reportedRequestCount: nonNegativeInt(raw.reportedRequestCount),
    unreportedRequestCount: nonNegativeInt(raw.unreportedRequestCount),
    inputTokens: nonNegativeInt(raw.inputTokens),
    outputTokens: nonNegativeInt(raw.outputTokens),
    totalTokens: nonNegativeInt(raw.totalTokens),
    cachedTokens: nonNegativeInt(raw.cachedTokens),
    reasoningTokens: nonNegativeInt(raw.reasoningTokens),
    lastUsedAt: typeof raw.lastUsedAt === 'string' ? raw.lastUsedAt : '',
    daily
  }
}

function localDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function legacyDailyBuckets(record: StoredModelTokenUsage): Record<string, DailyTokenUsage> {
  if (Object.keys(record.daily).length > 0 || !record.lastUsedAt || record.requestCount === 0) {
    return record.daily
  }
  const date = localDateKey(record.lastUsedAt)
  return {
    [date]: {
      date,
      requestCount: record.requestCount,
      reportedRequestCount: record.reportedRequestCount,
      unreportedRequestCount: record.unreportedRequestCount,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      totalTokens: record.totalTokens,
      cachedTokens: record.cachedTokens,
      reasoningTokens: record.reasoningTokens,
      lastUsedAt: record.lastUsedAt
    }
  }
}

function toVisibleRecord(record: StoredModelTokenUsage): ModelTokenUsage {
  return {
    key: record.key,
    model: record.model,
    provider: record.provider,
    sources: record.sources,
    requestCount: record.requestCount,
    reportedRequestCount: record.reportedRequestCount,
    unreportedRequestCount: record.unreportedRequestCount,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens: record.totalTokens,
    cachedTokens: record.cachedTokens,
    reasoningTokens: record.reasoningTokens,
    lastUsedAt: record.lastUsedAt
  }
}

function recordKey(report: AITokenUsageReport): string {
  return `${encodeURIComponent(report.provider)}::${encodeURIComponent(report.model)}`
}

export function recordTokenUsage(report: AITokenUsageReport): void {
  const rawRecords = tokenUsageStore.get('records')
  const records = isRecord(rawRecords) ? { ...rawRecords } : {}
  const key = recordKey(report)
  const current: StoredModelTokenUsage = normalizeRecord(key, records[key]) ?? {
    key,
    model: report.model,
    provider: report.provider,
    sources: [],
    requestCount: 0,
    reportedRequestCount: 0,
    unreportedRequestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    lastUsedAt: '',
    daily: {}
  }

  const daily = legacyDailyBuckets(current)
  const date = localDateKey(report.occurredAt)
  const currentDay = daily[date] ?? { date, ...emptyCounters(), lastUsedAt: '' }

  records[key] = {
    ...current,
    sources: Array.from(new Set([...current.sources, report.source])),
    requestCount: current.requestCount + 1,
    reportedRequestCount: current.reportedRequestCount + (report.reported ? 1 : 0),
    unreportedRequestCount: current.unreportedRequestCount + (report.reported ? 0 : 1),
    inputTokens: current.inputTokens + report.inputTokens,
    outputTokens: current.outputTokens + report.outputTokens,
    totalTokens: current.totalTokens + report.totalTokens,
    cachedTokens: current.cachedTokens + report.cachedTokens,
    reasoningTokens: current.reasoningTokens + report.reasoningTokens,
    lastUsedAt: report.occurredAt,
    daily: {
      ...daily,
      [date]: {
        ...currentDay,
        requestCount: currentDay.requestCount + 1,
        reportedRequestCount: currentDay.reportedRequestCount + (report.reported ? 1 : 0),
        unreportedRequestCount: currentDay.unreportedRequestCount + (report.reported ? 0 : 1),
        inputTokens: currentDay.inputTokens + report.inputTokens,
        outputTokens: currentDay.outputTokens + report.outputTokens,
        totalTokens: currentDay.totalTokens + report.totalTokens,
        cachedTokens: currentDay.cachedTokens + report.cachedTokens,
        reasoningTokens: currentDay.reasoningTokens + report.reasoningTokens,
        lastUsedAt: report.occurredAt
      }
    }
  }
  tokenUsageStore.set('records', records)
  tokenUsageStore.set('updatedAt', report.occurredAt)
}

function startDateKey(range: Exclude<TokenUsageRange, 'all'>): string {
  const date = new Date()
  const dayOffset = range === 'today' ? 0 : range === '7d' ? 6 : 29
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - dayOffset)
  return localDateKey(date)
}

function filterRecordByRange(
  record: StoredModelTokenUsage,
  range: TokenUsageRange
): ModelTokenUsage | null {
  if (range === 'all') {
    return toVisibleRecord(record)
  }

  const firstDate = startDateKey(range)
  const today = localDateKey(new Date())
  const buckets = Object.values(legacyDailyBuckets(record)).filter(
    (bucket) => bucket.date >= firstDate && bucket.date <= today
  )
  if (buckets.length === 0) return null
  const counters = buckets.reduce<TokenUsageCounters>(
    (sum, bucket) => ({
      requestCount: sum.requestCount + bucket.requestCount,
      reportedRequestCount: sum.reportedRequestCount + bucket.reportedRequestCount,
      unreportedRequestCount: sum.unreportedRequestCount + bucket.unreportedRequestCount,
      inputTokens: sum.inputTokens + bucket.inputTokens,
      outputTokens: sum.outputTokens + bucket.outputTokens,
      totalTokens: sum.totalTokens + bucket.totalTokens,
      cachedTokens: sum.cachedTokens + bucket.cachedTokens,
      reasoningTokens: sum.reasoningTokens + bucket.reasoningTokens
    }),
    emptyCounters()
  )
  return {
    ...toVisibleRecord(record),
    ...counters,
    lastUsedAt: buckets.reduce(
      (latest, bucket) => (bucket.lastUsedAt > latest ? bucket.lastUsedAt : latest),
      ''
    )
  }
}

export function getTokenUsageSnapshot(range: TokenUsageRange = 'all'): TokenUsageSnapshot {
  const rawRecords = tokenUsageStore.get('records')
  const records = isRecord(rawRecords)
    ? Object.entries(rawRecords)
        .map(([key, value]) => normalizeRecord(key, value))
        .filter((value): value is StoredModelTokenUsage => value !== null)
        .map((record) => filterRecordByRange(record, range))
        .filter((value): value is ModelTokenUsage => value !== null)
        .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
    : []

  const totals = records.reduce<TokenUsageSnapshot['totals']>(
    (sum, record) => ({
      requestCount: sum.requestCount + record.requestCount,
      reportedRequestCount: sum.reportedRequestCount + record.reportedRequestCount,
      unreportedRequestCount: sum.unreportedRequestCount + record.unreportedRequestCount,
      inputTokens: sum.inputTokens + record.inputTokens,
      outputTokens: sum.outputTokens + record.outputTokens,
      totalTokens: sum.totalTokens + record.totalTokens,
      cachedTokens: sum.cachedTokens + record.cachedTokens,
      reasoningTokens: sum.reasoningTokens + record.reasoningTokens
    }),
    emptyCounters()
  )

  const storedUpdatedAt = tokenUsageStore.get('updatedAt')
  const filteredUpdatedAt = records.reduce(
    (latest, record) => (record.lastUsedAt > latest ? record.lastUsedAt : latest),
    ''
  )
  return {
    records,
    totals,
    updatedAt:
      range === 'all'
        ? typeof storedUpdatedAt === 'string'
          ? storedUpdatedAt
          : null
        : filteredUpdatedAt || null
  }
}
