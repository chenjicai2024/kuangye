import assert from 'node:assert/strict'
import { buildChatHistoryContext, parseChatSnapshotResponse } from '../src/core/chat-history'
import { mergeSnapshotMessages } from '../src/core/chat-history/store'
import type { ChatMessage, ExtractedChatMessage } from '../src/core/chat-history/types'

function extracted(
  text: string,
  senderRole: ExtractedChatMessage['senderRole'] = 'peer'
): ExtractedChatMessage {
  return {
    senderName: senderRole === 'self' ? '我' : '客户A',
    senderRole,
    contentKind: 'text',
    originalText: text
  }
}

function stored(text: string, index: number): ChatMessage {
  return {
    ...extracted(text),
    id: String(index),
    capturedAt: index,
    recordSource: 'vision_snapshot'
  }
}

const parsed = parseChatSnapshotResponse(`{
  "conversation":{"title":"客户A","type":"direct"},
  "messages":[
    {"senderName":"客户A","senderRole":"peer","contentKind":"text","originalText":"你好","visibleTime":"10:00"},
    {"senderName":"客户A","senderRole":"peer","contentKind":"image","mediaDescription":"一辆停在路边的白色汽车","visibleTime":"10:01"},
    {"senderName":"客户A","senderRole":"peer","contentKind":"video","mediaDescription":"视频缩略图显示室内桌面，未播放","visibleTime":"10:02"},
    {"senderName":"客户A","senderRole":"peer","contentKind":"sticker","mediaDescription":"一个微笑挥手的表情","visibleTime":"10:03"},
    {"senderName":"客户A","senderRole":"peer","contentKind":"voice","mediaDescription":"一条8秒语音，无法从截图确认语音内容","visibleTime":"10:04"}
  ]
}`)
assert.equal(parsed?.conversationTitle, '客户A')
assert.equal(parsed?.messages.length, 5)
assert.equal(parsed?.messages[1].contentKind, 'image')
assert.equal(parsed?.messages[1].originalText, undefined)
assert.equal(parsed?.messages[1].descriptionSource, 'vision_model')
assert.equal(parseChatSnapshotResponse('not json'), null)

const initial = ['A', 'B', 'C', 'D', 'E'].map((text, index) => stored(text, index))
const overlap = mergeSnapshotMessages(
  initial,
  ['C', 'D', 'E', 'F', 'G'].map((text) => extracted(text)),
  10
)
assert.equal(overlap.addedCount, 2)
assert.deepEqual(
  overlap.messages.map((message) => message.originalText),
  ['A', 'B', 'C', 'D', 'E', 'F', 'G']
)

const firstSticker: ChatMessage = {
  id: 'sticker-1',
  senderName: '客户A',
  senderRole: 'peer',
  contentKind: 'sticker',
  mediaDescription: '一个微笑并挥手的黄色表情',
  descriptionSource: 'vision_model',
  capturedAt: 1,
  recordSource: 'vision_snapshot'
}
const similarSticker: ExtractedChatMessage = {
  senderName: '客户A',
  senderRole: 'peer',
  contentKind: 'sticker',
  mediaDescription: '黄色表情正在微笑挥手',
  descriptionSource: 'vision_model'
}
assert.equal(mergeSnapshotMessages([firstSticker], [similarSticker], 2).addedCount, 0)
assert.equal(
  mergeSnapshotMessages([firstSticker], [similarSticker, similarSticker], 2).addedCount,
  1
)

const context = buildChatHistoryContext({
  id: 'direct:客户a',
  conversationTitle: '客户A',
  conversationType: 'direct',
  firstCapturedAt: 1,
  lastCapturedAt: 2,
  messages: [stored('你好', 1), firstSticker]
})
assert.match(context, /客户A/)
assert.match(context, /\[表情\]\[AI视觉描述\]/)
assert.doesNotMatch(context, /对方：黄色表情正在/)

const budgeted = buildChatHistoryContext(
  {
    id: 'direct:客户a',
    conversationTitle: '客户A',
    conversationType: 'direct',
    firstCapturedAt: 1,
    lastCapturedAt: 2,
    messages: Array.from({ length: 50 }, (_, index) => stored(`第${index}条消息`.repeat(20), index))
  },
  100
)
assert.match(budgeted, /第49条消息/)
assert.doesNotMatch(budgeted, /第0条消息/)

console.log('chat-history tests passed')
