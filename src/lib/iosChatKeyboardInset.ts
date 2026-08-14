import { useEffect, useRef, useState, type RefObject } from 'react'
import { iosOrIpadosLikely, standaloneDisplayModeLikely } from '@/lib/resumeHardReload'

/** 鍵盤關閉時 vv.height 相對基準線縮小超過此值，視為主殼已跟著縮高（勿再 pad 聊天室）。 */
const VV_SHRINK_THRESHOLD_PX = 80

/** layout viewport 高度；iOS 26 鍵盤開啟時比 innerHeight 可靠。 */
export function layoutViewportHeight(): number {
  if (typeof document === 'undefined') return 0
  return document.documentElement.clientHeight || window.innerHeight
}

/** 依 visualViewport 與 layout viewport 重疊計算鍵盤 inset（供測試／診斷）。 */
export function computeKeyboardInsetFromVisualViewport(vv: VisualViewport | null): number {
  if (!vv) return 0
  const layoutH = layoutViewportHeight()
  const raw = Math.max(0, layoutH - vv.height - vv.offsetTop)
  return Math.max(0, Math.round(raw))
}

/** iOS standalone PWA 在 vv 完全不縮時的保守鍵盤估算。 */
export function estimateIosKeyboardFallbackInset(restVvHeight?: number): number {
  const layoutH = restVvHeight ?? layoutViewportHeight()
  return Math.min(380, Math.max(260, Math.round(layoutH * 0.42)))
}

export function isIosStandalonePwaLikely(): boolean {
  return iosOrIpadosLikely() && standaloneDisplayModeLikely()
}

/** 相對鍵盤關閉時的 vv 基準線，是否已明顯縮小。 */
export function visualViewportShrunkFromRest(
  vv: VisualViewport | null,
  restVvHeight: number | null,
): boolean {
  if (!vv || restVvHeight == null || restVvHeight <= 0) return false
  return vv.height < restVvHeight - VV_SHRINK_THRESHOLD_PX
}

type UseIosChatKeyboardInsetOptions = {
  /** 鍵盤狀態變更後是否補捲到底（vv scroll 事件會關閉以避免震動）。 */
  scrollToBottom?: () => void
}

/**
 * 配對／即時聊天輸入框：iOS 鍵盤避讓。
 *
 * - Safari／PWA 若 visualViewport 已縮小 → 主殼 --app-height 已處理，聊天室 inset = 0。
 * - 僅 standalone PWA 且 vv 完全不縮 → fallback padding，避免鍵盤直接蓋住輸入框。
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
  const scrollToBottomRef = useRef(options?.scrollToBottom)
  scrollToBottomRef.current = options?.scrollToBottom

  useEffect(() => {
    const vv = window.visualViewport
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
        captureRestBaseline()
        return 0
      }

      const shrunk = visualViewportShrunkFromRest(vv, restVvHeightRef.current)

      // 主殼 App.tsx 已用 vv.height 更新 --app-height；勿再 pad 造成 Safari 雙重上推。
      if (shrunk) {
        return 0
      }

      // 僅 PWA：鍵盤開啟但 vv 不回報縮小（如 iOS 26.1）才估算 inset。
      if (isIosStandalonePwaLikely()) {
        return estimateIosKeyboardFallbackInset(restVvHeightRef.current ?? undefined)
      }

      return 0
    }

    const updateKeyboardState = (allowScroll: boolean) => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        const nextInset = resolveInset()
        const focused = inputFocused()
        const shrunk = visualViewportShrunkFromRest(vv, restVvHeightRef.current)
        const nextOpen = focused || shrunk || nextInset > 36

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
        if (allowScroll && (insetChanged || openChanged)) {
          scrollBottomOnceSoon()
        }
      })
    }

    const clearFocusTimers = () => {
      for (const id of focusTimersRef.current) window.clearTimeout(id)
      focusTimersRef.current = []
    }

    const scheduleFocusRemeasure = () => {
      clearFocusTimers()
      for (const delay of [0, 120, 280, 520]) {
        focusTimersRef.current.push(
          window.setTimeout(() => updateKeyboardState(true), delay),
        )
      }
    }

    const onFocusIn = (event: FocusEvent) => {
      if (event.target === inputRef.current) {
        scheduleFocusRemeasure()
        return
      }
      updateKeyboardState(true)
    }

    const onFocusOut = () => {
      clearFocusTimers()
      window.setTimeout(() => {
        captureRestBaseline()
        updateKeyboardState(true)
      }, 80)
    }

    const onVvResize = () => updateKeyboardState(true)
    const onVvScroll = () => updateKeyboardState(false)
    const onWindowResize = () => {
      if (!inputFocused()) captureRestBaseline()
      updateKeyboardState(true)
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
      vv?.removeEventListener('resize', onVvResize)
      vv?.removeEventListener('scroll', onVvScroll)
      window.removeEventListener('resize', onWindowResize)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [inputRef])

  return { keyboardInsetBottom, isKeyboardOpen }
}
