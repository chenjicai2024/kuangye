import { OutputField, type AIOutputMode } from './types'

export type { AIOutputMode }

export interface AITemplate {
  mode: AIOutputMode
  label: string
  systemPrompt: string
  outputSchema: OutputField[]
}

const TEMPLATES: Record<string, AITemplate> = {
  chat_analysis: {
    mode: 'chat_analysis',
    label: '聊天分析',
    systemPrompt:
      '你是一个聊天窗口分析专家。请分析截图中的聊天界面，判断是否是一个聊天窗口、对话对象、是否需要回复以及回复内容。只返回JSON，不要包含任何其他文字。',
    outputSchema: [
      { name: 'isChatWindow', type: 'boolean' },
      { name: 'conversationName', type: 'string' },
      { name: 'conversationType', type: 'string' },
      { name: 'needReply', type: 'boolean' },
      { name: 'replyText', type: 'string' },
      { name: 'confidence', type: 'number' }
    ]
  },
  decision: {
    mode: 'decision',
    label: '按钮决策',
    systemPrompt:
      '你是一个界面决策专家。请根据截图判断应该执行什么操作（如 fold/call/raise）。只返回JSON，不要包含任何其他文字。',
    outputSchema: [
      { name: 'decision', type: 'string' },
      { name: 'amount', type: 'number' },
      { name: 'confidence', type: 'number' },
      { name: 'reason', type: 'string' }
    ]
  },
  action_plan: {
    mode: 'action_plan',
    label: '动作计划',
    systemPrompt:
      '你是一个GUI操作规划专家。请分析截图，规划需要执行的操作动作。\n\n' +
      '坐标规则：\n' +
      '- 只描述目标在当前截图内部的位置，不要计算窗口坐标或屏幕坐标\n' +
      '- 使用 0 到 1000 的归一化坐标：左上角是 (0,0)，右下角是 (1000,1000)\n' +
      '- 本地程序会根据截图对应区域的位置和大小完成最终坐标换算\n\n' +
      '动作类型：\n' +
      '- click: 单击。使用 position 字段（点击位置），不要使用 from 或 to 字段\n' +
      '- drag: 拖拽。使用 from 字段（起点）和 to 字段（终点），不要使用 position 字段\n' +
      '- type_text: 输入文字。使用 position 字段（输入框位置）和 text 字段\n\n' +
      '重要规则：\n' +
      '- click 和 type_text 使用 position 表示位置\n' +
      '- drag 使用 from 和 to 表示起点和终点\n' +
      '- 如果需要连续点击多个位置，应该返回多个 click 动作，而不是一个 drag 动作\n\n' +
      '输出字段：\n' +
      '- actions: 动作列表，每个动作包含 type、position（click和type_text使用）或 from/to（drag使用）、reason\n' +
      '- confidence: 置信度，0到1，表示你对这个操作的把握程度\n' +
      '- reason: 总体原因说明\n\n' +
      '错误处理：\n' +
      '- 如果无法确定目标位置，返回空 actions 数组\n' +
      '- 如果截图不清晰或无法识别，返回空 actions 数组并说明原因\n\n' +
      '输出格式示例：\n' +
      '单个点击：\n' +
      '{"actions":[{"type":"click","position":{"x":500,"y":500},"reason":"点击目标"}],"confidence":0.9,"reason":"执行点击"}\n\n' +
      '多个点击：\n' +
      '{"actions":[{"type":"click","position":{"x":300,"y":700},"reason":"点击位置A"},{"type":"click","position":{"x":500,"y":500},"reason":"点击位置B"}],"confidence":0.9,"reason":"连续点击"}\n\n' +
      '拖拽操作：\n' +
      '{"actions":[{"type":"drag","from":{"x":300,"y":700},"to":{"x":500,"y":500},"reason":"拖动元素"}],"confidence":0.9,"reason":"执行拖拽"}\n\n' +
      '只返回JSON，不要包含任何其他文字、markdown代码块标记或解释。',
    outputSchema: [
      { name: 'actions', type: 'action_list' },
      { name: 'confidence', type: 'number' },
      { name: 'reason', type: 'string' }
    ]
  }
}

export function getTemplate(mode: AIOutputMode): AITemplate | undefined {
  return TEMPLATES[mode]
}

export function buildStructuredPrompt(template: AITemplate, userPrompt?: string): string {
  const schemaDesc = template.outputSchema.map((f) => `  "${f.name}": <${f.type}>`).join(',\n')
  const coordinateContract =
    template.mode === 'action_plan'
      ? '最终坐标协议（优先级最高）：所有 from/to 坐标必须使用当前截图内部 0 到 1000 的归一化坐标；不要返回图片像素、微信窗口坐标或屏幕坐标。本地程序负责换算。'
      : undefined
  return [
    userPrompt || '请分析这张截图的内容',
    coordinateContract,
    '',
    '请只返回一个JSON对象，格式如下（不要包含任何其他文字、markdown代码块标记或解释）：',
    '{',
    schemaDesc,
    '}'
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}
