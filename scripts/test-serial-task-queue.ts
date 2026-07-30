import assert from 'node:assert/strict'
import { SerialTaskQueue } from '../src/renderer/src/flow-editor/serial-task-queue'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function run(): Promise<void> {
  const queue = new SerialTaskQueue()
  const writes: string[] = []

  const first = queue.enqueue(async () => {
    await delay(20)
    writes.push('old')
    return 'first'
  })
  const second = queue.enqueue(async () => {
    writes.push('new')
    return 'second'
  })

  assert.deepEqual(await Promise.all([first, second]), ['first', 'second'])
  assert.deepEqual(writes, ['old', 'new'])

  await assert.rejects(
    queue.enqueue(async () => {
      throw new Error('expected failure')
    }),
    /expected failure/
  )
  await queue.enqueue(async () => {
    writes.push('after-failure')
  })
  assert.deepEqual(writes, ['old', 'new', 'after-failure'])

  console.log('serial-task-queue tests passed')
}

void run()
