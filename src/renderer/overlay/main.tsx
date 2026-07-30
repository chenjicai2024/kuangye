import { createRoot } from 'react-dom/client'
import { OverlayApp } from './OverlayApp'
import { ActionChainOverlayApp } from './ActionChainOverlayApp'
import { ActionChainCaptureToolbar } from './ActionChainCaptureToolbar'
import { ActionChainCompactController } from './ActionChainCompactController'
import './overlay.css'

const mode = new URLSearchParams(window.location.search).get('mode')
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    mode === 'actionchain' ? (
      <ActionChainOverlayApp />
    ) : mode === 'actionchain-capture-toolbar' ? (
      <ActionChainCaptureToolbar />
    ) : mode === 'actionchain-compact-controller' ? (
      <ActionChainCompactController />
    ) : (
      <OverlayApp />
    )
  )
}
