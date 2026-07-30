import type { Workspace } from '../../../core/action-chain/types'
import { useRef, useCallback, useState } from 'react'

const MAX_HISTORY = 50

export interface UndoRedoController {
  pushSnapshot: (workspace: Workspace) => void
  undo: () => Workspace | null
  redo: () => Workspace | null
  canUndo: boolean
  canRedo: boolean
}

export function useUndoRedo(): UndoRedoController {
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const pushSnapshot = useCallback((workspace: Workspace) => {
    undoStack.current.push(JSON.stringify(workspace))
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
    redoStack.current = []
    setCanUndo(undoStack.current.length > 1)
    setCanRedo(false)
  }, [])

  const undo = useCallback((): Workspace | null => {
    if (undoStack.current.length <= 1) return null
    const currentSnapshot = undoStack.current.pop()!
    redoStack.current.push(currentSnapshot)
    const prev = JSON.parse(undoStack.current[undoStack.current.length - 1]) as Workspace
    setCanUndo(undoStack.current.length > 1)
    setCanRedo(true)
    return prev
  }, [])

  const redo = useCallback((): Workspace | null => {
    if (redoStack.current.length === 0) return null
    const snapshot = redoStack.current.pop()!
    undoStack.current.push(snapshot)
    const next = JSON.parse(snapshot) as Workspace
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
    return next
  }, [])

  return { pushSnapshot, undo, redo, canUndo, canRedo }
}
