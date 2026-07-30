import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import type { StepParams, Variable } from '../../../../../core/action-chain/types'
import { insertTemplateToken } from '../../template-utils'
import { inputStyle, labelStyle, tokenButtonStyle } from '../../styles'
import { Section } from '../Section'
import type { StepFormHandle, StepFormProps } from './SimpleForms'

interface TypeTextFormProps extends StepFormProps {
  availableVariables: Variable[]
}

export const TypeTextForm = forwardRef<StepFormHandle, TypeTextFormProps>(function TypeTextForm(
  { markDirty, params, availableVariables },
  ref
) {
  const textTemplateRef = useRef<HTMLTextAreaElement>(null)
  const [textTemplate, setTextTemplate] = useState(params?.textTemplate ?? '')
  const [textInputMode, setTextInputMode] = useState<'instant' | 'progressive'>(
    params?.textInputMode ?? 'instant'
  )
  const [textChunkStrategy, setTextChunkStrategy] = useState<'random' | 'natural'>(
    params?.textChunkStrategy ?? 'random'
  )
  const [textChunkMin, setTextChunkMin] = useState(String(params?.textChunkMin ?? 3))
  const [textChunkMax, setTextChunkMax] = useState(String(params?.textChunkMax ?? 5))
  const [textChunkDelayMinMs, setTextChunkDelayMinMs] = useState(
    String(params?.textChunkDelayMinMs ?? 200)
  )
  const [textChunkDelayMaxMs, setTextChunkDelayMaxMs] = useState(
    String(params?.textChunkDelayMaxMs ?? 500)
  )

  function insertTextTemplateVariable(variableName: string): void {
    const textarea = textTemplateRef.current
    const insertion = insertTemplateToken(
      textTemplate,
      `{${variableName}}`,
      textarea?.selectionStart,
      textarea?.selectionEnd
    )

    setTextTemplate(insertion.value)
    markDirty()
    window.requestAnimationFrame(() => {
      const current = textTemplateRef.current
      if (!current || !current.isConnected) return
      current.focus({ preventScroll: true })
      current.setSelectionRange(insertion.caret, insertion.caret)
    })
  }

  useImperativeHandle(ref, () => ({
    collectParams: () => {
      const result: Partial<StepParams> = {}
      result.textTemplate = textTemplate
      result.textInputMode = textInputMode
      if (textInputMode === 'progressive') {
        result.textChunkStrategy = textChunkStrategy
        const minChunk = Math.max(1, Math.floor(Number(textChunkMin)) || 3)
        const maxChunk = Math.max(minChunk, Math.floor(Number(textChunkMax)) || 5)
        const minDelay = Math.max(0, Math.floor(Number(textChunkDelayMinMs)) || 0)
        const maxDelay = Math.max(minDelay, Math.floor(Number(textChunkDelayMaxMs)) || 500)
        result.textChunkMin = minChunk
        result.textChunkMax = maxChunk
        result.textChunkDelayMinMs = minDelay
        result.textChunkDelayMaxMs = maxDelay
      }
      return result
    }
  }))

  return (
    <Section title="输入文字">
      <textarea
        ref={textTemplateRef}
        value={textTemplate}
        onChange={(event) => {
          setTextTemplate(event.target.value)
          markDirty()
        }}
        rows={3}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      <div style={{ ...labelStyle, marginTop: 10 }}>输入方式</div>
      <select
        value={textInputMode}
        onChange={(event) => {
          setTextInputMode(event.target.value as 'instant' | 'progressive')
          markDirty()
        }}
        style={inputStyle}
      >
        <option value="instant">一次性输入</option>
        <option value="progressive">渐进输入（分段粘贴）</option>
      </select>
      {textInputMode === 'progressive' && (
        <div style={{ marginTop: 10 }}>
          <div style={labelStyle}>分段方式</div>
          <select
            value={textChunkStrategy}
            onChange={(event) => {
              setTextChunkStrategy(event.target.value as 'random' | 'natural')
              markDirty()
            }}
            style={inputStyle}
          >
            <option value="random">随机字数</option>
            <option value="natural">合理断句</option>
          </select>
          {textChunkStrategy === 'random' ? (
            <>
              <div style={{ ...labelStyle, marginTop: 10 }}>每段字数</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input
                  type="number"
                  min="1"
                  value={textChunkMin}
                  onChange={(event) => {
                    setTextChunkMin(event.target.value)
                    markDirty()
                  }}
                  aria-label="每段最少字数"
                  style={inputStyle}
                />
                <input
                  type="number"
                  min="1"
                  value={textChunkMax}
                  onChange={(event) => {
                    setTextChunkMax(event.target.value)
                    markDirty()
                  }}
                  aria-label="每段最多字数"
                  style={inputStyle}
                />
              </div>
            </>
          ) : (
            <div style={{ color: '#737b8c', fontSize: 11, marginTop: 7, lineHeight: 1.5 }}>
              优先按标点和换行分段，过长内容再按中文词语边界拆分。
            </div>
          )}
          <div style={{ ...labelStyle, marginTop: 10 }}>段落间隔（毫秒）</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input
              type="number"
              min="0"
              value={textChunkDelayMinMs}
              onChange={(event) => {
                setTextChunkDelayMinMs(event.target.value)
                markDirty()
              }}
              aria-label="最短段落间隔"
              style={inputStyle}
            />
            <input
              type="number"
              min="0"
              value={textChunkDelayMaxMs}
              onChange={(event) => {
                setTextChunkDelayMaxMs(event.target.value)
                markDirty()
              }}
              aria-label="最长段落间隔"
              style={inputStyle}
            />
          </div>
          <div style={{ color: '#737b8c', fontSize: 11, marginTop: 7, lineHeight: 1.5 }}>
            {textChunkStrategy === 'random'
              ? '默认每次粘贴 3～5 个字，间隔 200～500 毫秒；不会自动按 Enter。'
              : '每个短句依次粘贴，默认间隔 200～500 毫秒；不会自动按 Enter。'}
          </div>
        </div>
      )}
      {availableVariables.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
          {availableVariables.map((variable) => (
            <button
              type="button"
              key={variable.name}
              aria-label={`插入变量 ${variable.name}`}
              title={`插入 {${variable.name}} 到光标位置`}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={() => insertTextTemplateVariable(variable.name)}
              style={tokenButtonStyle}
            >
              {'{'}
              {variable.name}
              {'}'}
            </button>
          ))}
        </div>
      )}
    </Section>
  )
})
