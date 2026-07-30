export type ProgressiveTextChunkStrategy = 'random' | 'natural'

interface TextChunkOptions {
  strategy: ProgressiveTextChunkStrategy
  minSize?: number
  maxSize?: number
  random?: () => number
}

const NATURAL_MIN_SIZE = 4
const NATURAL_MAX_SIZE = 8
const SENTENCE_BOUNDARY = /^[，。！？；：、,.!?;:]$/u

function textLength(value: string): number {
  return Array.from(value).length
}

function splitRandomChunks(
  text: string,
  minSize: number,
  maxSize: number,
  random: () => number
): string[] {
  const characters = Array.from(text)
  const chunks: string[] = []
  let offset = 0
  while (offset < characters.length) {
    const size = minSize + Math.floor(random() * (maxSize - minSize + 1))
    const chunkCharacters = characters.slice(offset, offset + size)
    chunks.push(chunkCharacters.join(''))
    offset += chunkCharacters.length
  }
  return chunks
}

function splitNaturalChunks(text: string): string[] {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  const chunks: string[] = []
  let current = ''

  const flush = (): void => {
    if (!current) return
    chunks.push(current)
    current = ''
  }

  for (const item of Array.from(segmenter.segment(text))) {
    const token = item.segment
    if (token === '\r') continue
    if (token === '\n') {
      current += token
      flush()
      continue
    }

    const isBoundary = SENTENCE_BOUNDARY.test(token)
    if (
      !isBoundary &&
      current &&
      textLength(current) >= NATURAL_MIN_SIZE &&
      textLength(current) + textLength(token) > NATURAL_MAX_SIZE
    ) {
      flush()
    }

    current += token
    if (isBoundary) flush()
  }

  flush()
  return chunks
}

export function splitTextForProgressiveInput(text: string, options: TextChunkOptions): string[] {
  if (!text) return []
  if (options.strategy === 'natural') return splitNaturalChunks(text)

  const minSize = Math.max(1, Math.floor(options.minSize ?? 3))
  const maxSize = Math.max(minSize, Math.floor(options.maxSize ?? 5))
  return splitRandomChunks(text, minSize, maxSize, options.random ?? Math.random)
}
