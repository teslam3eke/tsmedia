import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject, type TouchEvent } from 'react'
import { iosOrIpadosLikely, standaloneDisplayModeLikely } from '@/lib/resumeHardReload'
import {
  clearPwaChatKeyboardShellState,
  readAppShellHeightPx,
  setChatComposerKeyboardCapture,
  setChatKeyboardInsetPx,
} from '@/lib/chatComposerKeyboardBridge'

/** 鍵盤關閉時 vv.height 相對基準線縮小超過此值，視為 viewport 已因鍵盤縮短。 */
const VV_SHRINK_THRESHOLD_PX = 80

/** 小於此值的 inset 視為 0，避免 sub-pixel 抖動。 */
const INSET_COMMIT_THRESHOLD_PX = 36

/** PWA vv 量測穩定後才提交（ios-pwa-keyboard-fix STABILITY_MS）。 */
const PWA_KB_STABILITY_MS = 80

/** layout viewport 高度。 */
export function layoutViewportHeight(): number {
  if (typeof document === 'undefined') return 0
  return document.documentElement.clientHeight || window.innerHeight
}

/** 主殼 --app-height 是否已跟 visualViewport 同步（避免 Safari 雙重補償）。 */
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
  standalonePwa: boolean
}

/** Safari：overlap + scroll pan + 條件 layout gap。 */
export function computeSafariChatKeyboardInset(params: ChatKeyboardInsetInput): number {
  const { vv, inputEl, restVvHeight, standalonePwa } = params
  if (!vv || !inputEl || standalonePwa) return 0

  const visibleBottom = vv.offsetTop + vv.height
  const inputBottom = inputEl.getBoundingClientRect().bottom
  const composerOverlap = Math.max(0, Math.round(inputBottom - visibleBottom))
  const scrollPanProxy = Math.max(0, Math.round((window.scrollY || 0) + vv.offsetTop))

  const layoutGap = shellFollowsVisualViewport(vv)
    ? 0
    : Math.max(0, Math.round(layoutViewportHeight() - vv.height - vv.offsetTop))

  let inset = Math.max(composerOverlap, scrollPanProxy, layoutGap)

  if (inset <= INSET_COMMIT_THRESHOLD_PX && visualViewportShrunkFromRest(vv, restVvHeight)) {
    inset = 0
  }

  return inset <= INSET_COMMIT_THRESHOLD_PX ? 0 : inset
}

/** PWA：baseline − vv.height、offsetTop、scroll pan 取 max（Jarela #173）。 */
export function measurePwaKeyboardHeightPx(
  vv: VisualViewport | null,
  baselineInnerHeight: number,
): number {
  if (!vv) return 0
  return Math.max(
    0,
    Math.round(baselineInnerHeight - vv.height),
    Math.round(vv.offsetTop),
    Math.round((window.scrollY || 0) + vv.offsetTop),
  )
}

export function isIosStandalonePwaLikely(): boolean {
  return iosOrIpadosLikely() && standaloneDisplayModeLikely()
}

type UseIosChatKeyboardInsetOptions = {
  scrollToBottom?: () => void
  /** PWA pre-lift 前藏底欄，避免 composer 卡在探索／配對列上方 */
  onKeyboardChromeChange?: (open: boolean) => void
}

export function useIosChatKeyboardInset(
  inputRef: RefObject<HTMLInputElement | null>,
  options?: UseIosChatKeyboardInsetOptions,
): {
  keyboardInsetBottom: number
  composerLiftPx: number
  isKeyboardOpen: boolean
  onChatInputPointerDown: (e?: MouseEvent | TouchEvent) => void
} {
  const [keyboardInsetBottom, setKeyboardInsetBottom] = useState(0)
  const [composerLiftPx, setComposerLiftPx] = useState(0)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)

  const lastInsetCommitRef = useRef<number | null>(null)
  const lastKbOpenCommitRef = useRef<boolean | null>(null)
  const restVvHeightRef = useRef<number | null>(null)
  const scrollToBottomRef = useRef(options?.scrollToBottom)
  const keyboardChromeRef = useRef(options?.onKeyboardChromeChange)
  const preLiftRef = useRef<(() => void) | null>(null)

  scrollToBottomRef.current = options?.scrollToBottom
  keyboardChromeRef.current = options?.onKeyboardChromeChange

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

    if (standalonePwa) {
      let baselineInnerHeight = window.innerHeight
      let stabilityTimer: number | null = null
      let tabBarRestoreTimer: number | null = null
      let pendingKb = 0
      let dismissing = false
      const savedKbRef = { current: 0 }

      const clearStabilityTimer = () => {
        if (stabilityTimer) clearTimeout(stabilityTimer)
        stabilityTimer = null
      }

      const dismissKeyboardChrome = () => {
        dismissing = true
        clearStabilityTimer()
        if (tabBarRestoreTimer) clearTimeout(tabBarRestoreTimer)
        tabBarRestoreTimer = null

        // 先放下 composer，避免底欄回復時 translateY 疊加造成上跳
        setComposerLiftPx(0)
        setKeyboardInsetBottom(0)
        setIsKeyboardOpen(false)
        clearPwaChatKeyboardShellState()
        setChatComposerKeyboardCapture(false)
        captureRestBaseline()

        tabBarRestoreTimer = window.setTimeout(() => {
          tabBarRestoreTimer = null
          keyboardChromeRef.current?.(false)
          dismissing = false
        }, 220)
      }

      const commitKbInset = (px: number, open: boolean) => {
        const h = Math.max(0, Math.round(px))
        if (h <= INSET_COMMIT_THRESHOLD_PX) {
          clearPwaChatKeyboardShellState()
          savedKbRef.current = 0
          setComposerLiftPx(0)
          setKeyboardInsetBottom(0)
          lastInsetCommitRef.current = 0
          setIsKeyboardOpen(open)
          return
        }
        if (dismissing) return
        setChatKeyboardInsetPx(h)
        savedKbRef.current = h
        setComposerLiftPx(h)
        setKeyboardInsetBottom(0)
        lastInsetCommitRef.current = h
        setIsKeyboardOpen(true)
        scrollBottomOnceSoon()
        window.setTimeout(scrollBottomOnceSoon, 120)
      }

      const triggerPreLift = () => {
        dismissing = false
        if (tabBarRestoreTimer) {
          clearTimeout(tabBarRestoreTimer)
          tabBarRestoreTimer = null
        }
        keyboardChromeRef.current?.(true)
        const rest = readAppShellHeightPx() ?? window.innerHeight
        const fallback = estimateIosKeyboardFallbackInset(restVvHeightRef.current ?? rest)
        const h =
          savedKbRef.current > INSET_COMMIT_THRESHOLD_PX
            ? savedKbRef.current
            : fallback
        commitKbInset(h, true)
      }

      preLiftRef.current = triggerPreLift

      const scheduleStableMeasure = () => {
        if (dismissing || !inputFocused() || !vv) return
        const calculated = measurePwaKeyboardHeightPx(vv, baselineInnerHeight)
        const rest = readAppShellHeightPx() ?? baselineInnerHeight
        const floor = Math.max(
          savedKbRef.current,
          estimateIosKeyboardFallbackInset(restVvHeightRef.current ?? rest),
        )
        if (calculated < 30 && floor <= INSET_COMMIT_THRESHOLD_PX) return
        pendingKb = Math.max(calculated, floor)
        if (stabilityTimer) clearTimeout(stabilityTimer)
        stabilityTimer = window.setTimeout(() => {
          stabilityTimer = null
          if (dismissing || !inputFocused()) return
          commitKbInset(pendingKb, true)
        }, PWA_KB_STABILITY_MS)
      }

      const onFocusIn = (event: FocusEvent) => {
        if (event.target !== inputRef.current) return
        dismissing = false
        keyboardChromeRef.current?.(true)
        setChatComposerKeyboardCapture(true)
        captureRestBaseline()
        baselineInnerHeight = window.innerHeight
        window.setTimeout(scheduleStableMeasure, PWA_KB_STABILITY_MS)
        window.setTimeout(scheduleStableMeasure, 180)
        window.setTimeout(scrollBottomOnceSoon, 120)
      }

      const onFocusOut = (event: FocusEvent) => {
        if (event.target !== inputRef.current) return
        // 若焦點仍在聊天 composer 內（如送出鈕），勿收鍵盤殼層
        const next = event.relatedTarget
        if (next instanceof Node && inputRef.current?.parentElement?.contains(next)) return
        dismissKeyboardChrome()
      }

      const onVvResize = () => {
        if (!inputFocused()) return
        scheduleStableMeasure()
      }

      const onOrientationChange = () => {
        if (stabilityTimer) clearTimeout(stabilityTimer)
        pendingKb = 0
        savedKbRef.current = 0
        clearPwaChatKeyboardShellState()
        baselineInnerHeight = window.innerHeight
        setTimeout(() => {
          baselineInnerHeight = window.innerHeight
        }, 200)
      }

      captureRestBaseline()
      document.addEventListener('focusin', onFocusIn)
      document.addEventListener('focusout', onFocusOut)
      vv?.addEventListener('resize', onVvResize)
      window.addEventListener('orientationchange', onOrientationChange)

      return () => {
        preLiftRef.current = null
        clearStabilityTimer()
        if (tabBarRestoreTimer) clearTimeout(tabBarRestoreTimer)
        dismissing = false
        setChatComposerKeyboardCapture(false)
        clearPwaChatKeyboardShellState()
        document.removeEventListener('focusin', onFocusIn)
        document.removeEventListener('focusout', onFocusOut)
        vv?.removeEventListener('resize', onVvResize)
        window.removeEventListener('orientationchange', onOrientationChange)
      }
    }

    preLiftRef.current = null

    const resolveInset = (): number => {
      if (!inputFocused()) {
        captureRestBaseline()
        return 0
      }
      return computeSafariChatKeyboardInset({
        vv: vv ?? null,
        inputEl: inputRef.current,
        restVvHeight: restVvHeightRef.current,
        standalonePwa: false,
      })
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
        const insetChanged =
          prevI === null
          || (nextInset !== prevI
            && (Math.abs(nextInset - prevI) >= 12 || nextInset === 0 || prevI === 0))

        if (insetChanged) {
          lastInsetCommitRef.current = nextInset
          setKeyboardInsetBottom(nextInset)
        }
        if (lastKbOpenCommitRef.current !== nextOpen) {
          lastKbOpenCommitRef.current = nextOpen
          setIsKeyboardOpen(nextOpen)
        }
        if (allowScroll && (insetChanged || nextOpen)) scrollBottomOnceSoon()
      })
    }

    const onFocusIn = (event: FocusEvent) => {
      if (event.target === inputRef.current) {
        setChatComposerKeyboardCapture(true)
        updateKeyboardState(true)
      }
    }

    const onFocusOut = () => {
      window.setTimeout(() => {
        setChatComposerKeyboardCapture(false)
        captureRestBaseline()
        updateKeyboardState(true)
      }, 80)
    }

    const onVvResizeSafari = () => updateKeyboardState(true)
    const onVvScrollSafari = () => updateKeyboardState(false)
    const onWindowResizeSafari = () => updateKeyboardState(true)

    captureRestBaseline()
    vv?.addEventListener('resize', onVvResizeSafari)
    vv?.addEventListener('scroll', onVvScrollSafari)
    window.addEventListener('resize', onWindowResizeSafari)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      setChatComposerKeyboardCapture(false)
      vv?.removeEventListener('resize', onVvResizeSafari)
      vv?.removeEventListener('scroll', onVvScrollSafari)
      window.removeEventListener('resize', onWindowResizeSafari)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [inputRef])

  const onChatInputPointerDown = useCallback((e?: MouseEvent | TouchEvent) => {
    if (!isIosStandalonePwaLikely()) return
    preLiftRef.current?.()
    const el = inputRef.current
    if (!el || !e) return
    el.focus({ preventScroll: true })
    e.preventDefault()
  }, [inputRef])

  return { keyboardInsetBottom, composerLiftPx, isKeyboardOpen, onChatInputPointerDown }
}
