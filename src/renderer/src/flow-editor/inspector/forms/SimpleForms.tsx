import { forwardRef, useImperativeHandle, useState } from 'react'
import type { StepParams } from '../../../../../core/action-chain/types'
import { Section } from '../Section'
import { inputStyle, labelStyle } from '../../styles'
import { COMMON_KEYS, MODIFIER_OPTIONS } from '../shared'

export interface StepFormHandle {
  collectParams: () => Partial<StepParams>
}

export interface StepFormProps {
  markDirty: () => void
  params?: StepParams
}

// ClickForm
export const ClickForm = forwardRef<StepFormHandle, StepFormProps>(function ClickForm(
  { markDirty, params },
  ref
) {
  const [clickPolicy, setClickPolicy] = useState<'single' | 'double'>(params?.clickPolicy ?? 'single')
  const [clickPositionMode, setClickPositionMode] = useState<'center' | 'random'>(
    params?.clickPositionMode ?? 'center'
  )

  useImperativeHandle(ref, () => ({
    collectParams: () => ({ clickPolicy, clickPositionMode })
  }))

  return (
    <Section title="点击">
      <div style={labelStyle}>点击次数</div>
      <select
        value={clickPolicy}
        onChange={(e) => {
          setClickPolicy(e.target.value as 'single' | 'double')
          markDirty()
        }}
        style={inputStyle}
      >
        <option value="single">单击</option>
        <option value="double">双击</option>
      </select>
      <div style={{ ...labelStyle, marginTop: 10 }}>点击位置</div>
      <select
        value={clickPositionMode}
        onChange={(event) => {
          setClickPositionMode(event.target.value as 'center' | 'random')
          markDirty()
        }}
        style={inputStyle}
      >
        <option value="center">固定点击区域中心</option>
        <option value="random">区域内安全随机</option>
      </select>
      <div style={{ color: '#737b8c', fontSize: 11, marginTop: 7, lineHeight: 1.5 }}>
        安全随机会在区域中间 70% 范围内重新选择落点，自动避开边缘。
      </div>
    </Section>
  )
})

// RandomMouseForm
export const RandomMouseForm = forwardRef<StepFormHandle, StepFormProps>(function RandomMouseForm(
  { markDirty, params },
  ref
) {
  const [minMoves, setMinMoves] = useState(String(params?.randomMouseMinMoves ?? 1))
  const [maxMoves, setMaxMoves] = useState(String(params?.randomMouseMaxMoves ?? 3))
  const [pauseMinMs, setPauseMinMs] = useState(String(params?.randomMousePauseMinMs ?? 100))
  const [pauseMaxMs, setPauseMaxMs] = useState(String(params?.randomMousePauseMaxMs ?? 400))

  useImperativeHandle(ref, () => ({
    collectParams: () => {
      const min = Math.max(1, Math.floor(Number(minMoves)) || 1)
      const max = Math.max(min, Math.floor(Number(maxMoves)) || 3)
      const minPause = Math.max(0, Math.floor(Number(pauseMinMs)) || 0)
      const maxPause = Math.max(minPause, Math.floor(Number(pauseMaxMs)) || 400)
      return {
        randomMouseMinMoves: min,
        randomMouseMaxMoves: max,
        randomMousePauseMinMs: minPause,
        randomMousePauseMaxMs: maxPause
      }
    }
  }))

  return (
    <Section title="随机鼠标">
      <div style={labelStyle}>随机移动次数</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input
          type="number"
          min="1"
          value={minMoves}
          onChange={(event) => {
            setMinMoves(event.target.value)
            markDirty()
          }}
          aria-label="最少随机移动次数"
          style={inputStyle}
        />
        <input
          type="number"
          min="1"
          value={maxMoves}
          onChange={(event) => {
            setMaxMoves(event.target.value)
            markDirty()
          }}
          aria-label="最多随机移动次数"
          style={inputStyle}
        />
      </div>
      <div style={{ ...labelStyle, marginTop: 10 }}>每次移动后的停顿（毫秒）</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input
          type="number"
          min="0"
          value={pauseMinMs}
          onChange={(event) => {
            setPauseMinMs(event.target.value)
            markDirty()
          }}
          aria-label="最短随机鼠标停顿"
          style={inputStyle}
        />
        <input
          type="number"
          min="0"
          value={pauseMaxMs}
          onChange={(event) => {
            setPauseMaxMs(event.target.value)
            markDirty()
          }}
          aria-label="最长随机鼠标停顿"
          style={inputStyle}
        />
      </div>
      <div style={{ color: '#737b8c', fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
        鼠标只在所选区域内部随机移动，每段使用贝塞尔轨迹，全程不会点击。
      </div>
    </Section>
  )
})

// WaitForm
export const WaitForm = forwardRef<StepFormHandle, StepFormProps>(function WaitForm(
  { markDirty, params },
  ref
) {
  const [waitMode, setWaitMode] = useState<'fixed' | 'random'>(params?.waitMode ?? 'fixed')
  const [waitMs, setWaitMs] = useState(String(params?.waitMs ?? 1000))
  const [waitMinMs, setWaitMinMs] = useState(String(params?.waitMinMs ?? params?.waitMs ?? 1000))
  const [waitMaxMs, setWaitMaxMs] = useState(String(params?.waitMaxMs ?? 5000))

  useImperativeHandle(ref, () => ({
    collectParams: () => {
      if (waitMode === 'random') {
        const min = Math.max(0, Math.floor(Number(waitMinMs)) || 0)
        const max = Math.max(min, Math.floor(Number(waitMaxMs)) || 5000)
        return { waitMode, waitMinMs: min, waitMaxMs: max }
      }
      return { waitMode, waitMs: Math.max(0, Math.floor(Number(waitMs)) || 0) }
    }
  }))

  return (
    <Section title="等待">
      <div style={labelStyle}>等待方式</div>
      <select
        value={waitMode}
        onChange={(event) => {
          setWaitMode(event.target.value as 'fixed' | 'random')
          markDirty()
        }}
        style={inputStyle}
      >
        <option value="fixed">固定时间</option>
        <option value="random">随机范围</option>
      </select>
      {waitMode === 'fixed' ? (
        <>
          <div style={{ ...labelStyle, marginTop: 10 }}>等待时间（毫秒）</div>
          <input
            type="number"
            min="0"
            value={waitMs}
            onChange={(event) => {
              setWaitMs(event.target.value)
              markDirty()
            }}
            style={inputStyle}
          />
        </>
      ) : (
        <>
          <div style={{ ...labelStyle, marginTop: 10 }}>随机范围（毫秒）</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input
              type="number"
              min="0"
              value={waitMinMs}
              onChange={(event) => {
                setWaitMinMs(event.target.value)
                markDirty()
              }}
              aria-label="最短等待时间"
              style={inputStyle}
            />
            <input
              type="number"
              min="0"
              value={waitMaxMs}
              onChange={(event) => {
                setWaitMaxMs(event.target.value)
                markDirty()
              }}
              aria-label="最长等待时间"
              style={inputStyle}
            />
          </div>
          <div style={{ color: '#737b8c', fontSize: 11, marginTop: 7, lineHeight: 1.5 }}>
            每次运行到该节点时，都会在最短和最长时间之间重新随机选择。
          </div>
        </>
      )}
    </Section>
  )
})

// WaitRedDotForm
export const WaitRedDotForm = forwardRef<StepFormHandle, StepFormProps>(function WaitRedDotForm(
  { markDirty, params },
  ref
) {
  const [threshold, setThreshold] = useState(String(params?.redDotThreshold ?? 0.5))

  useImperativeHandle(ref, () => ({
    collectParams: () => {
      const t = Number(threshold)
      return {
        redDotThreshold: Number.isFinite(t) ? Math.min(100, Math.max(0, t)) : 0.5
      }
    }
  }))

  return (
    <Section title="红点等待条件">
      <div style={labelStyle}>红色像素比例阈值（%）</div>
      <input
        type="number"
        min="0"
        max="100"
        step="0.1"
        value={threshold}
        onChange={(event) => {
          setThreshold(event.target.value)
          markDirty()
        }}
        style={inputStyle}
      />
      <div style={{ color: '#737b8c', fontSize: 11, marginTop: 7, lineHeight: 1.5 }}>
        检测区域的红色像素比例大于该数值时继续执行。默认值为 0.5%。
      </div>
    </Section>
  )
})

// KeyPressHotkeyForm
export const KeyPressHotkeyForm = forwardRef<StepFormHandle, StepFormProps & { isHotkey: boolean }>(
  function KeyPressHotkeyForm({ markDirty, params, isHotkey }, ref) {
    const [keyName, setKeyName] = useState(params?.keyName ?? '')
    const [modifiers, setModifiers] = useState<string[]>(params?.modifiers ?? [])

    useImperativeHandle(ref, () => ({
      collectParams: () => {
        const params: Partial<StepParams> = { keyName: keyName || undefined }
        if (isHotkey) {
          params.modifiers = modifiers.length > 0 ? modifiers : undefined
        }
        return params
      }
    }))

    return (
      <>
        <Section title="按键">
          <div style={labelStyle}>键名</div>
          <select
            value={keyName}
            onChange={(e) => {
              setKeyName(e.target.value)
              markDirty()
            }}
            style={inputStyle}
          >
            <option value="">选择按键</option>
            {COMMON_KEYS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Section>
        {isHotkey && (
          <Section title="修饰键">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
              {MODIFIER_OPTIONS.map((m) => (
                <label
                  key={m.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#b6bdca',
                    fontSize: 12,
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={modifiers.includes(m.value)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setModifiers([...modifiers, m.value])
                      } else {
                        setModifiers(modifiers.filter((x) => x !== m.value))
                      }
                      markDirty()
                    }}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </Section>
        )}
      </>
    )
  }
)

// RandomBranchForm - 纯静态说明，无 state
export const RandomBranchForm = forwardRef<StepFormHandle, StepFormProps>(function RandomBranchForm(
  _props,
  ref
) {
  useImperativeHandle(ref, () => ({ collectParams: () => ({}) }))

  return (
    <Section title="随机分支">
      <div style={{ color: '#aeb6c4', fontSize: 12, lineHeight: 1.65 }}>
        从该节点连接两条或更多路线，然后点击每条连线设置权重。每次执行到这里时只会随机选择一条路线继续。
      </div>
      <div style={{ color: '#737b8c', fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
        例如三条路线分别填写50、30、20，对应实际概率50%、30%、20%。
      </div>
    </Section>
  )
})
