/** 聊天輸入 focus 期間暫停 App.tsx 的 document scroll snap，讓 iOS PWA 的 scroll/offset 可被量測。 */
let captureDepth = 0

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
