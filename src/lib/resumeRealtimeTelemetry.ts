declare const __APP_BUILD_ID__: string

/**
 * Resume + Realtime 遙測（不含 userId／token；僅 build、環境摘要與連線相位）。
 *
 * **啟用後端：** 設定 `VITE_RESUME_REALTIME_TELEMETRY_URL`（POST JSON）。
 * **本機對照：** `localStorage.setItem('tm_telemetry_mirror','1')` → 會 `console.info`。
 */

const STORAGE_MIRROR_KEY = 'tm_telemetry_mirror'

type ResumeSource =
  | 'visibility_visible'
  | 'pageshow'
  | 'freeze'
  | 'online'
  | 'visibility_hidden'
  | 'pagehide_bf_cache'

type RealtimeEnginePhase =
  | 'wake_attempt_start'
  | 'wake_after_inner_budget'
  /** 內層換發／disconnect 競賽後，可見時照例再打一輪 disconnect+connect（iOS bailout） */
  | 'wake_post_race_resync'
  | 'wake_mutex_cleared'
  | 'reconnect_realtime_only_disconnect'
  | 'reconnect_realtime_only_connect'

type ChannelFamily = 'matches' | 'messages'

type ConnectionRepairBrief =
  | { phase: 'start'; attempt: number; message: string }
  | { phase: 'success' }
  | { phase: 'reload'; message: string }

const endpoint = (import.meta.env.VITE_RESUME_REALTIME_TELEMETRY_URL ?? '').trim()

let lastBurstKey = ''

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 3)}…`
}

function telemetryMirror(): boolean {
  try {
    return Boolean(import.meta.env.DEV || localStorage.getItem(STORAGE_MIRROR_KEY) === '1')
  } catch {
    return Boolean(import.meta.env.DEV)
  }
}

function standAloneApprox(): boolean {
  try {
    return (
      globalThis.window.matchMedia('(display-mode: standalone)').matches ||
      (
        globalThis.window.navigator as Navigator & {
          standalone?: boolean
        }
      ).standalone === true
    )
  } catch {
    return false
  }
}

function baseEnvelope(): Record<string, unknown> {
  return {
    v: 1,
    ts: new Date().toISOString(),
    build: typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : '',
    ua: truncate(
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
      200,
    ),
    online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
    visibility:
      typeof document !== 'undefined' ? document.visibilityState : undefined,
    standalone: standAloneApprox(),
  }
}

function shouldCoalesceBurst(key: string): boolean {
  const now = Date.now()
  const bucket = `${key}:${Math.floor(now / 800)}`
  if (bucket === lastBurstKey) return true
  lastBurstKey = bucket
  return false
}

function post(payload: Record<string, unknown>): void {
  const body = { ...baseEnvelope(), ...payload }
  if (telemetryMirror()) {
    console.info('[tsmedia:telemetry]', body)
  }
  if (!endpoint) return

  void fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    mode: 'cors',
    keepalive: true,
    credentials: 'omit',
  }).catch(() => undefined)
}

export function reportResumeEvent(
  source: ResumeSource,
  extra?: Record<string, unknown>,
): void {
  if (
    source === 'visibility_visible' ||
    source === 'pageshow' ||
    source === 'freeze' ||
    source === 'online'
  ) {
    if (shouldCoalesceBurst(`resume:${source}`)) return
  }
  post({ kind: 'resume', source, ...(extra ?? {}) })
}

export function reportRealtimeEngine(phase: RealtimeEnginePhase): void {
  post({ kind: 'realtime_ws', phase })
}

export function reportRealtimeChannel(family: ChannelFamily, status: string): void {
  post({ kind: 'realtime_channel', family, status })
}

export function reportConnectionRepairTelemetry(detail: ConnectionRepairBrief): void {
  post({ kind: 'connection_repair', ...detail })
}
