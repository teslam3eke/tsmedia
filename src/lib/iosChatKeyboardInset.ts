import { useEffect, useRef, useState, type RefObject } from 'react'
import { iosOrIpadosLikely, standaloneDisplayModeLikely } from '@/lib/resumeHardReload'
import { setChatComposerKeyboardCapture } from '@/lib/chatComposerKeyboardBridge'

/** 鍵盤關閉時 vv.height 相對基準線縮小超過此值，視為 viewport 已因鍵盤縮短。 */
const VV_SHRINK_THRESHOLD_PX = 80

/** 小於此值的 inset 視為 0，避免 sub-pixel 抖動。 */
const INSET_COMMIT_THRESHOLD_PX = 36

/** PWA 已 latch 後，僅當新值高出此門檻才再更新（避免來回跳）。 */
const PWA_INSET_RELATCH_DELTA_PX = 48

/** layout viewport 高度。 */
export function layoutViewportHeight(): number {
  if (typeof document === 'undefined') return 0
  return document.documentElement.clientHeight || window.innerHeight
}

/** 主殼 --app-height 是否已跟 visualViewport 同步（避免雙重補償）。 */
export function shellFollowsVisualViewport(vv: VisualViewport | null): boolean {
  if (!vv || typeof document === 'undefined') return false
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim()
  if (!raw) return false
  const shellH = Number.parseFloat(raw)
  if (!Number.isFinite(shellH)) return false
  return Math.abs(shellH - vv.height) < 48
}

export function estimateIosKeyboardFallbackInset(restVvHeight?: number): number {
  const layoutH = restVvHeight ?? layoutViewportHeight()
  return Math.min(380, Math.max(260, Math.round(layoutH * 0.42)))
}

export function visualViewportShrunkFromRest(
  vv: VisualViewport | null,
  restVvHeight: number | null,
): boolean {
  if (!vv || restVvHeight == null || restVvHeight <= 0) return false
  return vv.height < restVvHeight - VV_SHRINK_THRESHOLD_PX
}

export type ChatKeyboardInsetInput = {
  vv: VisualViewport | null
  inputEl: HTMLElement | null
  restVvHeight: number | null
  focusedForMs: number
  standalonePwa: boolean
}

/**
 * Safari：overlap + scroll pan + 條件 layout gap。
 * PWA：不用 scroll pan（與允許 document pan 會互相打架）；vv 已縮則交給主殼。
 */
export function computeChatKeyboardInset(params: ChatKeyboardInsetInput): number {
  const { vv, inputEl, restVvHeight, focusedForMs, standalonePwa } = params
  if (!vv || !inputEl) return 0

  if (standalonePwa && visualViewportShrunkFromRest(vv, restVvHeight)) {
    return 0
  }

  const visibleBottom = vv.offsetTop + vv.height
  const inputBottom = inputEl.getBoundingClientRect().bottom
  const composerOverlap = Math.max(0, Math.round(inputBottom - visibleBottom))

  const scrollPanProxy = standalonePwa
    ? 0
    : Math.max(0, Math.round((window.scrollY || 0) + vv.offsetTop))

  const layoutGap = shellFollowsVisualViewport(vv)
    ? 0
    : Math.max(0, Math.round(layoutViewportHeight() - vv.height - vv.offsetTop))

  let inset = Math.max(composerOverlap, scrollPanProxy, layoutGap)

  if (inset <= INSET_COMMIT_THRESHOLD_PX && standalonePwa) {
    const vvUnchanged = !visualViewportShrunkFromRest(vv, restVvHeight)
    const shellSynced = shellFollowsVisualViewport(vv)
    if (vvUnchanged && !shellSynced && focusedForMs >= 280) {
      inset = estimateIosKeyboardFallbackInset(restVvHeight ?? undefined)
    }
  }

  return inset <= INSET_COMMIT_THRESHOLD_PX ? 0 : inset
}

/** PWA 專用：單調 latch，focus 期間不因 vv scroll 來回改 inset。 */
export function latchPwaKeyboardInset(prev: number | null, raw: number, focused: boolean): number {
  if (!focused) return raw

  if (raw <= INSET_COMMIT_THRESHOLD_PX) {
    if (prev != null && prev > INSET_COMMIT_THRESHOLD_PX) return prev
    return 0
  }

  if (prev == null || prev <= INSET_COMMIT_THRESHOLD_PX) return raw
  if (raw >= prev + PWA_INSET_RELATCH_DELTA_PX) return raw
  return prev
}

export function isIosStandalonePwaLikely(): boolean {
  return iosOrIpadosLikely() && standaloneDisplayModeLikely()
}

type UseIosChatKeyboardInsetOptions = {
  /** 鍵盤狀態變更後是否補捲到底（PWA 僅 focus 首輪；vv scroll 不觸發）。 */
  scrollToBottom?: () => void
}

/**
 * 配對／即時聊天輸入框：iOS 鍵盤避讓。
 * Safari 用三信號；PWA 用 latch + fallback，避免 scroll／padding 回饋狂抖。
 */
export function useIosChatKeyboardInset(
  inputRef: RefObject<HTMLInputElement | null>,
  options?: UseIosChatKeyboardInsetOptions,
): { keyboardInsetBottom: number; isKeyboardOpen: boolean } {
  const [keyboardInsetBottom, setKeyboardInsetBottom] = useState(0)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const lastInsetCommitRef = useRef<number | null>(null)
  const lastKbOpenCommitRef = useRef<boolean | null>(null)
  const focusTimersRef = useRef<number[]>([])
  const restVvHeightRef = useRef<number | null>(null)
  const focusStartedAtRef = useRef<number | null>(null)
  const pwaLatchedInsetRef = useRef<number | null>(null)
  const pwaDidInitialScrollRef = useRef(false)
  const scrollToBottomRef = useRef(options?.scrollToBottom)
  scrollToBottomRef.current = options?.scrollToBottom

  useEffect(() => {
    const vv = window.visualViewport
    const standalonePwa = isIosStandalonePwaLikely()
    let raf = 0

    const inputFocused = () => document.activeElement === inputRef.current

    const captureRestBaseline = () => {
      if (vv && vv.height > 96) {
        restVvHeightRef.current = vv.height
      }
    }

    const scrollBottomOnceSoon = () => {
      scrollToBottomRef.current?.()
    }

    const resolveInset = (): number => {
      const focused = inputFocused()
      if (!focused) {
        pwaLatchedInsetRef.current = null
        captureRestBaseline()
        return 0
      }

      const focusedForMs =
        focusStartedAtRef.current == null ? 0 : Date.now() - focusStartedAtRef.current

      const raw = computeChatKeyboardInset({
        vv: vv ?? null,
        inputEl: inputRef.current,
        restVvHeight: restVvHeightRef.current,
        focusedForMs,
        standalonePwa,
      })

      if (!standalonePwa) return raw

      const latched = latchPwaKeyboardInset(pwaLatchedInsetRef.current, raw, true)
      pwaLatchedInsetRef.current = latched > INSET_COMMIT_THRESHOLD_PX ? latched : null
      return latched
    }

    const updateKeyboardState = (allowScroll: boolean) => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        const nextInset = resolveInset()
        const focused = inputFocused()
        const shrunk = visualViewportShrunkFromRest(vv ?? null, restVvHeightRef.current)
        const nextOpen = focused || shrunk || nextInset > INSET_COMMIT_THRESHOLD_PX

        const prevI = lastInsetCommitRef.current
        const prevO = lastKbOpenCommitRef.current
        const insetChanged =
          prevI === null
          || (nextInset !== prevI
            && (Math.abs(nextInset - prevI) >= 12 || nextInset === 0 || prevI === 0))
        const openChanged = prevO === null || prevO !== nextOpen

        if (insetChanged) {
          lastInsetCommitRef.current = nextInset
          setKeyboardInsetBottom(nextInset)
        }
        if (openChanged) {
          lastKbOpenCommitRef.current = nextOpen
          setIsKeyboardOpen(nextOpen)
        }

        if (!allowScroll || (!insetChanged && !openChanged)) return

        if (standalonePwa) {
          if (focused && !pwaDidInitialScrollRef.current) {
            pwaDidInitialScrollRef.current = true
            scrollBottomOnceSoon()
          }
          return
        }

        scrollBottomOnceSoon()
      })
    }

    const clearFocusTimers = () => {
      for (const id of focusTimersRef.current) window.clearTimeout(id)
      focusTimersRef.current = []
    }

    const scheduleFocusRemeasure = () => {
      clearFocusTimers()
      pwaDidInitialScrollRef.current = false
      for (const delay of [0, 120, 320]) {
        focusTimersRef.current.push(
          window.setTimeout(() => updateKeyboardState(true), delay),
        )
      }
    }

    const onFocusIn = (event: FocusEvent) => {
      if (event.target === inputRef.current) {
        focusStartedAtRef.current = Date.now()
        pwaLatchedInsetRef.current = null
        setChatComposerKeyboardCapture(true)
        scheduleFocusRemeasure()
        return
      }
      updateKeyboardState(true)
    }

    const onFocusOut = () => {
      clearFocusTimers()
      window.setTimeout(() => {
        focusStartedAtRef.current = null
        pwaLatchedInsetRef.current = null
        pwaDidInitialScrollRef.current = false
        setChatComposerKeyboardCapture(false)
        captureRestBaseline()
        updateKeyboardState(true)
      }, 80)
    }

    const onVvResize = () => updateKeyboardState(!standalonePwa)
    const onVvScroll = () => {
      if (standalonePwa) return
      updateKeyboardState(false)
    }
    const onWindowResize = () => {
      if (!inputFocused()) captureRestBaseline()
      updateKeyboardState(!standalonePwa)
    }

    captureRestBaseline()
    updateKeyboardState(false)
    vv?.addEventListener('resize', onVvResize)
    vv?.addEventListener('scroll', onVvScroll)
    window.addEventListener('resize', onWindowResize)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      clearFocusTimers()
      focusStartedAtRef.current = null
      pwaLatchedInsetRef.current = null
      pwaDidInitialScrollRef.current = false
      setChatComposerKeyboardCapture(false)
      vv?.removeEventListener('resize', onVvResize)
      vv?.removeEventListener('scroll', onVvScroll)
      window.removeEventListener('resize', onWindowResize)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [inputRef])

  return { keyboardInsetBottom, isKeyboardOpen }
}
