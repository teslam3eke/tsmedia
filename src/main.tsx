import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ── iOS keyboard: keep --app-height in sync with visual viewport ──
// When the keyboard appears, visualViewport.height shrinks; we pin
// the app height to the PRE-keyboard height so layouts don't jump.
let baseHeight = window.visualViewport?.height ?? window.innerHeight

function setAppHeight() {
  // Only shrink the CSS variable when keyboard is NOT open
  // (heuristic: if height drops by more than 150px it's the keyboard)
  const h = window.visualViewport?.height ?? window.innerHeight
  if (baseHeight - h < 150) baseHeight = h
  document.documentElement.style.setProperty('--app-height', `${baseHeight}px`)
}

setAppHeight()
window.visualViewport?.addEventListener('resize', setAppHeight)
window.addEventListener('resize', setAppHeight)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
