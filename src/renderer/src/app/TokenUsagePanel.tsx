import { useState, useCallback, useEffect } from 'react'
import { RefreshIcon } from './icons'
import { formatTokenCount, formatUsageTime } from './log-utils'
import type { TokenUsageSnapshot, TokenUsageRange } from './types'
import { TOKEN_USAGE_RANGES } from './types'

export function TokenUsagePanel(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<TokenUsageSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<TokenUsageRange>('today')

  const loadUsage = useCallback(async (selectedRange: TokenUsageRange) => {
    setLoading(true)
    try {
      const result = await window.electron?.invoke<TokenUsageSnapshot>(
        'tokenUsage:get',
        selectedRange
      )
      setSnapshot(result || null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUsage(range)
  }, [loadUsage, range])

  const totals = snapshot?.totals

  return (
    <div className="settings-page slide-up token-usage-page">
      <div className="settings-page-header">
        <div>
          <div className="settings-title-row">
            <h1>Token 用量</h1>
            <button
              className="icon-action refresh-action"
              onClick={() => void loadUsage(range)}
              disabled={loading}
              title="刷新用量"
              aria-label="刷新 Token 用量"
            >
              <span className={loading ? 'refresh-icon spinning' : 'refresh-icon'}>
                <RefreshIcon />
              </span>
            </button>
          </div>
          <p>根据模型服务实际返回的 usage 持久化统计；未返回 usage 的调用会单独标记。</p>
        </div>
      </div>

      <div className="token-range-tabs" role="group" aria-label="Token 统计时间范围">
        {TOKEN_USAGE_RANGES.map((item) => (
          <button
            key={item.value}
            className={`token-range-tab ${range === item.value ? 'active' : ''}`}
            onClick={() => setRange(item.value)}
            disabled={loading && range === item.value}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="token-summary-grid">
        <div className="card token-summary-card">
          <span>总 Token</span>
          <strong>{formatTokenCount(totals?.totalTokens ?? 0)}</strong>
        </div>
        <div className="card token-summary-card">
          <span>输入 Token</span>
          <strong>{formatTokenCount(totals?.inputTokens ?? 0)}</strong>
        </div>
        <div className="card token-summary-card">
          <span>输出 Token</span>
          <strong>{formatTokenCount(totals?.outputTokens ?? 0)}</strong>
        </div>
        <div className="card token-summary-card">
          <span>调用次数</span>
          <strong>{formatTokenCount(totals?.requestCount ?? 0)}</strong>
        </div>
      </div>

      <div className="token-usage-meta">
        最近更新：{formatUsageTime(snapshot?.updatedAt ?? null)}
        {(totals?.unreportedRequestCount ?? 0) > 0
          ? ` · ${formatTokenCount(totals?.unreportedRequestCount ?? 0)} 次调用未返回 usage`
          : ''}
      </div>

      <div className="token-model-list">
        {!loading && (snapshot?.records.length ?? 0) === 0 ? (
          <div className="card token-empty-state">
            暂无用量记录。下一次 AI 请求成功后，这里会按模型自动记录。
          </div>
        ) : null}

        {snapshot?.records.map((record) => (
          <div className="card token-model-card" key={record.key}>
            <div className="token-model-header">
              <div>
                <strong>{record.model}</strong>
                <span>{record.provider}</span>
              </div>
              <span>最近使用：{formatUsageTime(record.lastUsedAt)}</span>
            </div>
            <div className="token-model-metrics">
              <span>
                输入<strong>{formatTokenCount(record.inputTokens)}</strong>
              </span>
              <span>
                输出<strong>{formatTokenCount(record.outputTokens)}</strong>
              </span>
              <span>
                总计<strong>{formatTokenCount(record.totalTokens)}</strong>
              </span>
              <span>
                调用<strong>{formatTokenCount(record.requestCount)}</strong>
              </span>
            </div>
            <div className="token-model-footnote">
              来源：{record.sources.join('、') || '未知'}
              {record.cachedTokens > 0 ? ` · 缓存 ${formatTokenCount(record.cachedTokens)}` : ''}
              {record.reasoningTokens > 0
                ? ` · 推理 ${formatTokenCount(record.reasoningTokens)}`
                : ''}
              {record.unreportedRequestCount > 0
                ? ` · 未计量 ${formatTokenCount(record.unreportedRequestCount)} 次`
                : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
