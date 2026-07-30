import { useState, useEffect, useRef } from 'react'
import { subscribeToast, type ToastType } from '../toast'

export function Toast(): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [type, setType] = useState<ToastType>('success')
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return subscribeToast((toast) => {
      setMessage(toast.message)
      setType(toast.type)
      setVisible(true)
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setVisible(false), 2500)
    })
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  return <div className={`toast ${type} ${visible ? 'show' : ''}`}>{message}</div>
}
