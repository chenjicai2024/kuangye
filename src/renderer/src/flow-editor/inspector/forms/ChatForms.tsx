import { forwardRef, useImperativeHandle, useState } from 'react'
import { Section } from '../Section'
import { inputStyle, labelStyle } from '../../styles'
import type { StepFormHandle, StepFormProps } from './SimpleForms'

// ExtractChatDetailsForm
export const ExtractChatDetailsForm = forwardRef<StepFormHandle, StepFormProps>(
  function ExtractChatDetailsForm({ markDirty, params }, ref) {
    const [chatSnapshotVariable, setChatSnapshotVariable] = useState(
      params?.chatSnapshotVariable ?? 'chatSnapshot'
    )

    useImperativeHandle(ref, () => ({
      collectParams: () => ({
        chatSnapshotVariable: chatSnapshotVariable.trim() || 'chatSnapshot'
      })
    }))

    return (
      <Section title="解析聊天详情">
        <div style={labelStyle}>聊天快照输出变量</div>
        <input
          value={chatSnapshotVariable}
          onChange={(event) => {
            setChatSnapshotVariable(event.target.value)
            markDirty()
          }}
          style={inputStyle}
        />
        <div style={{ color: '#737b8c', fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
          通用识别所选聊天区域，区分私聊、群聊、原文和带来源标签的媒体视觉描述。
        </div>
      </Section>
    )
  }
)

// RecordChatHistoryForm
export const RecordChatHistoryForm = forwardRef<StepFormHandle, StepFormProps>(
  function RecordChatHistoryForm({ markDirty, params }, ref) {
    const [chatRecordMode, setChatRecordMode] = useState<'snapshot' | 'outgoing_reply'>(
      params?.chatRecordMode ?? 'snapshot'
    )
    const [chatSnapshotVariable, setChatSnapshotVariable] = useState(
      params?.chatSnapshotVariable ?? 'chatSnapshot'
    )
    const [chatConversationVariable, setChatConversationVariable] = useState(
      params?.chatConversationVariable ?? 'chatConversation'
    )
    const [chatReplyVariable, setChatReplyVariable] = useState(
      params?.chatReplyVariable ?? 'chatReply'
    )

    useImperativeHandle(ref, () => ({
      collectParams: () => ({
        chatRecordMode,
        chatSnapshotVariable: chatSnapshotVariable.trim() || 'chatSnapshot',
        chatConversationVariable: chatConversationVariable.trim() || 'chatConversation',
        chatReplyVariable: chatReplyVariable.trim() || 'chatReply'
      })
    }))

    return (
      <Section title="记录聊天内容">
        <div style={labelStyle}>记录模式</div>
        <select
          value={chatRecordMode}
          onChange={(event) => {
            setChatRecordMode(event.target.value as 'snapshot' | 'outgoing_reply')
            markDirty()
          }}
          style={inputStyle}
        >
          <option value="snapshot">保存截图解析结果并去重</option>
          <option value="outgoing_reply">保存已成功发送的我方回复</option>
        </select>
        {chatRecordMode === 'snapshot' && (
          <>
            <div style={{ ...labelStyle, marginTop: 10 }}>聊天快照输入变量</div>
            <input
              value={chatSnapshotVariable}
              onChange={(event) => {
                setChatSnapshotVariable(event.target.value)
                markDirty()
              }}
              style={inputStyle}
            />
          </>
        )}
        {chatRecordMode === 'outgoing_reply' && (
          <>
            <div style={{ ...labelStyle, marginTop: 10 }}>回复文字变量</div>
            <input
              value={chatReplyVariable}
              onChange={(event) => {
                setChatReplyVariable(event.target.value)
                markDirty()
              }}
              style={inputStyle}
            />
          </>
        )}
        <div style={{ ...labelStyle, marginTop: 10 }}>
          {chatRecordMode === 'snapshot' ? '会话引用输出变量' : '会话引用输入变量'}
        </div>
        <input
          value={chatConversationVariable}
          onChange={(event) => {
            setChatConversationVariable(event.target.value)
            markDirty()
          }}
          style={inputStyle}
        />
        <div style={{ color: '#737b8c', fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
          保存回复模式应放在 Enter 发送节点成功之后，避免把未发送内容写入历史。
        </div>
      </Section>
    )
  }
)

// GenerateChatReplyForm - chatIncludeScreenshot 由父组件管理（needsRegion 依赖）
interface GenerateChatReplyFormProps extends StepFormProps {
  chatIncludeScreenshot: boolean
  onChatIncludeScreenshotChange: (value: boolean) => void
}

export const GenerateChatReplyForm = forwardRef<StepFormHandle, GenerateChatReplyFormProps>(
  function GenerateChatReplyForm(
    { markDirty, params, chatIncludeScreenshot, onChatIncludeScreenshotChange },
    ref
  ) {
    const [chatConversationVariable, setChatConversationVariable] = useState(
      params?.chatConversationVariable ?? 'chatConversation'
    )
    const [chatReplyVariable, setChatReplyVariable] = useState(
      params?.chatReplyVariable ?? 'chatReply'
    )
    const [chatContextTokenBudget, setChatContextTokenBudget] = useState(
      String(params?.chatContextTokenBudget ?? 6000)
    )
    const [chatReplyPrompt, setChatReplyPrompt] = useState(params?.chatReplyPrompt ?? '')

    useImperativeHandle(ref, () => ({
      collectParams: () => ({
        chatConversationVariable: chatConversationVariable.trim() || 'chatConversation',
        chatReplyVariable: chatReplyVariable.trim() || 'chatReply',
        chatContextTokenBudget: Math.max(
          100,
          Math.floor(Number(chatContextTokenBudget)) || 6000
        ),
        chatIncludeScreenshot,
        chatReplyPrompt: chatReplyPrompt.trim()
      })
    }))

    return (
      <Section title="基于聊天记录生成回复">
        <div style={labelStyle}>会话引用输入变量</div>
        <input
          value={chatConversationVariable}
          onChange={(event) => {
            setChatConversationVariable(event.target.value)
            markDirty()
          }}
          style={inputStyle}
        />
        <div style={{ ...labelStyle, marginTop: 10 }}>回复输出变量</div>
        <input
          value={chatReplyVariable}
          onChange={(event) => {
            setChatReplyVariable(event.target.value)
            markDirty()
          }}
          style={inputStyle}
        />
        <div style={{ ...labelStyle, marginTop: 10 }}>聊天历史 Token 预算</div>
        <input
          type="number"
          min="100"
          value={chatContextTokenBudget}
          onChange={(event) => {
            setChatContextTokenBudget(event.target.value)
            markDirty()
          }}
          style={inputStyle}
        />
        <div style={{ ...labelStyle, marginTop: 10 }}>回复要求</div>
        <textarea
          value={chatReplyPrompt}
          onChange={(event) => {
            setChatReplyPrompt(event.target.value)
            markDirty()
          }}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <label
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            color: '#b6bdca',
            fontSize: 12,
            marginTop: 12
          }}
        >
          <input
            type="checkbox"
            checked={chatIncludeScreenshot}
            onChange={(event) => {
              onChatIncludeScreenshotChange(event.target.checked)
              markDirty()
            }}
          />
          同时附带当前聊天截图
        </label>
        <div style={{ color: '#737b8c', fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
          默认只发送带来源标签的纯文本聊天记录；开启截图后需要在上方选择聊天区域。
        </div>
      </Section>
    )
  }
)
