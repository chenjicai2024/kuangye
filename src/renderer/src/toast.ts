export type ToastType = 'success' | 'error'

export interface ToastMessage {
  message: string
  type: ToastType
}

type ToastListener = (toast: ToastMessage) => void

const listeners = new Set<ToastListener>()

export function showToast(message: string, type: ToastType): void {
  for (const listener of listeners) listener({ message, type })
}

export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
