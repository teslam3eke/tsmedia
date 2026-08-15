/** 聊天輸入 focus 期間；PWA 另同步 --chat-kb-inset 供 App.tsx 縮短主殼。 */
let captureDepth = 0
let chatKbInsetPx = 0
let chatShellRestHeightPx: number | null = null

export function setChatComposerKeyboardCapture(active: boolean): void {
  if (typeof document === 'undefined') return
  captureDepth = active ? captureDepth + 1 : Math.max(0, captureDepth - 1)
  if (captureDepth > 0) {
    document.documentElement.dataset.chatComposerKeyboard = '1'
  } else {
    delete document.documentElement.dataset.chatComposerKeyboard
  }
}

export function chatComposerKeyboardCaptureActive(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset.chatComposerKeyboard === '1'
}

export function setChatKeyboardInsetPx(px: number): void {
  chatKbInsetPx = Math.max(0, Math.round(px))
  if (typeof document === 'undefined') return
  if (chatKbInsetPx > 0) {
    document.documentElement.style.setProperty('--chat-kb-inset', `${chatKbInsetPx}px`)
  } else {
    document.documentElement.style.removeProperty('--chat-kb-inset')
  }
}

export function getChatKeyboardInsetPx(): number {
  return chatKbInsetPx
}

export function setChatShellRestHeightPx(h: number | null): void {
  chatShellRestHeightPx = h == null ? null : Math.max(96, Math.round(h))
}

export function getChatShellRestHeightPx(): number | null {
  return chatShellRestHeightPx
}

export function clearPwaChatKeyboardShellState(): void {
  chatKbInsetPx = 0
  chatShellRestHeightPx = null
  if (typeof document === 'undefined') return
  document.documentElement.style.removeProperty('--chat-kb-inset')
}

/** PWA 聊天鍵盤開啟時：主殼高度 = focus 前基準 − inset（Jarela / ios-pwa-keyboard-fix 路徑）。 */
export function pwaChatKeyboardShellHeightPx(): number | null {
  if (chatKbInsetPx <= 36 || chatShellRestHeightPx == null) return null
  return Math.max(200, chatShellRestHeightPx - chatKbInsetPx)
}

export function readAppShellHeightPx(): number | null {
  if (typeof document === 'undefined') return null
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim()
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 96 ? n : null
}
