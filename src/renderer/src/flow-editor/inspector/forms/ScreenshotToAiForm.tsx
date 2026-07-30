import { forwardRef, useImperativeHandle, useState } from 'react'
import type { OutputField, StepParams } from '../../../../../core/action-chain/types'
import { getTemplate } from '../../../../../core/action-chain/ai-templates'
import { inputStyle, labelStyle, smallButtonStyle, ghostButtonStyle } from '../../styles'
import { Section } from '../Section'
import type { StepFormHandle, StepFormProps } from './SimpleForms'

export const ScreenshotToAiForm = forwardRef<StepFormHandle, StepFormProps>(
  function ScreenshotToAiForm({ markDirty, params }, ref) {
    const [aiPrompt, setAiPrompt] = useState(params?.aiPrompt ?? '')
    const [outputMode, setOutputMode] = useState<string>(params?.outputMode ?? 'text')
    const [variableName, setVariableName] = useState(params?.variableName ?? '')
    const [outputFields, setOutputFields] = useState<OutputField[]>(params?.outputSchema ?? [])

    useImperativeHandle(ref, () => ({
      collectParams: () => {
        const result: Partial<StepParams> = {}
        result.variableName = variableName.trim() || 'reply'
        result.aiPrompt = aiPrompt.trim() || '请描述这张截图的内容'
        result.outputMode = outputMode as StepParams['outputMode']
        const validFields = outputFields.filter((field) => field.name.trim())
        if (validFields.length > 0) result.outputSchema = validFields
        return result
      }
    }))

    return (
      <Section title="AI 输出">
        <div style={labelStyle}>输出模式</div>
        <select
          value={outputMode}
          onChange={(e) => {
            setOutputMode(e.target.value)
            markDirty()
            const mode = e.target.value
            if (mode !== 'text' && mode !== 'structured_json') {
              const template = getTemplate(mode as Parameters<typeof getTemplate>[0])
              if (template && template.outputSchema.length > 0) {
                setOutputFields([...template.outputSchema])
              }
            }
          }}
          style={inputStyle}
        >
          <option value="text">文本</option>
          <option value="structured_json">自定义 JSON</option>
          <option value="chat_analysis">聊天分析</option>
          <option value="decision">按钮决策</option>
          <option value="action_plan">动作计划</option>
        </select>

        <div style={{ ...labelStyle, marginTop: 10 }}>AI Prompt</div>
        <textarea
          value={aiPrompt}
          onChange={(event) => {
            setAiPrompt(event.target.value)
            markDirty()
          }}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical' }}
        />

        {outputMode === 'text' ? (
          <>
            <div style={{ ...labelStyle, marginTop: 10 }}>回复变量名</div>
            <input
              value={variableName}
              onChange={(e) => {
                setVariableName(e.target.value)
                markDirty()
              }}
              style={inputStyle}
            />
          </>
        ) : (
          <>
            <div style={{ ...labelStyle, marginTop: 10 }}>结果变量名</div>
            <input
              value={variableName}
              onChange={(e) => {
                setVariableName(e.target.value)
                markDirty()
              }}
              style={inputStyle}
            />
            <div style={{ ...labelStyle, marginTop: 10 }}>结构化字段</div>
            {outputFields.map((field, index) => (
              <div key={index} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  value={field.name}
                  onChange={(e) => {
                    const next = [...outputFields]
                    next[index] = { ...field, name: e.target.value }
                    setOutputFields(next)
                    markDirty()
                  }}
                  placeholder="字段名"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <select
                  value={field.type}
                  onChange={(e) => {
                    const next = [...outputFields]
                    next[index] = { ...field, type: e.target.value as OutputField['type'] }
                    setOutputFields(next)
                    markDirty()
                  }}
                  style={{ ...inputStyle, width: 88 }}
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="object">object</option>
                  <option value="array">array</option>
                  <option value="point">point</option>
                  <option value="rect">rect</option>
                  <option value="action">action</option>
                  <option value="action_list">action_list</option>
                </select>
                <button
                  onClick={() => {
                    setOutputFields(outputFields.filter((_, i) => i !== index))
                    markDirty()
                  }}
                  style={{ ...smallButtonStyle, color: '#ef4444' }}
                >
                  删除
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                setOutputFields([...outputFields, { name: '', type: 'string' }])
                markDirty()
              }}
              style={ghostButtonStyle}
            >
              + 添加字段
            </button>
          </>
        )}
      </Section>
    )
  }
)
