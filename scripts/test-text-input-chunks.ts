import assert from 'node:assert/strict'
import { splitTextForProgressiveInput } from '../src/core/rpa/text-input-chunks'

assert.deepEqual(
  splitTextForProgressiveInput('一二三四五六七八', {
    strategy: 'random',
    minSize: 3,
    maxSize: 5,
    random: () => 0
  }),
  ['一二三', '四五六', '七八']
)

const naturalText = '您好，您的汽车金融方案已经整理好了。稍后发给您！'
const naturalChunks = splitTextForProgressiveInput(naturalText, { strategy: 'natural' })
assert.equal(naturalChunks.join(''), naturalText)
assert.deepEqual(naturalChunks, ['您好，', '您的汽车金融方案', '已经整理好了。', '稍后发给您！'])

assert.deepEqual(splitTextForProgressiveInput('', { strategy: 'natural' }), [])

console.log('text-input-chunks tests passed')
