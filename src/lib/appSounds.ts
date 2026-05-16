/**
 * App 內短音效（配對成功／新訊息）。使用 Web Audio，不依賴音檔。
 * 與「通知設定」中 newMatch / messages 開關連動（見 shouldPlayInAppSound）。
 */

type NotifSoundKey = 'newMatch' | 'messages'

export function shouldPlayInAppSound(kind: NotifSoundKey): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem('notif_settings')
    if (!raw) return true
    const s = JSON.parse(raw) as Partial<Record<NotifSoundKey, boolean>>
    if (kind === 'newMatch') return s.newMatch !== false
    return s.messages !== false
  } catch {
    return true
  }
}

let sharedCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AC()
  }
  return sharedCtx
}

/** iOS／部分瀏覽器需在使用者手勢後才能播音；啟動後可呼叫一次 unlock。 */
export async function resumeAppAudioContext(): Promise<void> {
  const c = getAudioContext()
  if (c?.state === 'suspended') {
    await c.resume().catch(() => undefined)
  }
}

/**
 * 在首次點擊／觸控時解鎖 AudioContext（掛一次即可）。
 */
export function armAudioContextOnUserGesture(): () => void {
  if (typeof window === 'undefined') return () => {}
  const unlock = () => {
    void resumeAppAudioContext()
  }
  document.addEventListener('touchstart', unlock, { passive: true, once: true })
  document.addEventListener('click', unlock, { once: true })
  return () => {
    document.removeEventListener('touchstart', unlock)
    document.removeEventListener('click', unlock)
  }
}

/** match：雙音的和弦感；message：單一輕提示音 */
export function playInAppSound(kind: 'match' | 'message'): void {
  if (typeof window === 'undefined') return
  const gate = kind === 'match' ? shouldPlayInAppSound('newMatch') : shouldPlayInAppSound('messages')
  if (!gate) return

  const ctx = getAudioContext()
  if (!ctx) return

  const run = () => {
    const now = ctx.currentTime
    const master = ctx.createGain()
    const peak = kind === 'match' ? 0.11 : 0.09
    master.gain.value = peak
    master.connect(ctx.destination)

    if (kind === 'match') {
      const freqs = [523.25, 659.25] as const
      freqs.forEach((freq, i) => {
        const t0 = now + i * 0.07
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, t0)
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.linearRampToValueAtTime(0.14, t0 + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28)
        osc.connect(g)
        g.connect(master)
        osc.start(t0)
        osc.stop(t0 + 0.3)
      })
    } else {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, now)
      g.gain.setValueAtTime(0.0001, now)
      g.gain.linearRampToValueAtTime(0.12, now + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)
      osc.connect(g)
      g.connect(master)
      osc.start(now)
      osc.stop(now + 0.16)
    }
  }

  void ctx.resume().then(run).catch(() => undefined)
}
