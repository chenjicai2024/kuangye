/**
 * 把异步任务严格按提交顺序执行。前一个任务失败不会阻断后续任务，
 * 适合保存同一份工作区，避免较旧快照晚于较新快照落盘。
 */
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve()

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
