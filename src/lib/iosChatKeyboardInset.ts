import { useEffect, useRef, useState, type RefObject } from 'react'
import { iosOrIpadosLikely, standaloneDisplayModeLikely } from '@/lib/resumeHardReload'
import { setChatComposerKeyboardCapture } from '@/lib/chatComposerKeyboardBridge'

/** 鍵盤關閉時 vv.height 相對基準線縮小超過此值，視為 viewport 已因鍵盤縮短。 */
const VV_SHRINK_THRESHOLD_PX = 80

/** 小於此值的 inset 視為 0，避免 sub-pixel 抖動。 */
const INSET_COMMIT_THRESHOLD_PX = 36

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
 * 三信號取 max（Jarela / WebKit 社群慣例，但避開舊版單一 innerHeight 算法）：
 * 1. 輸入框 bottom 超出 visual viewport 可見底部
 * 2. scrollY + offsetTop（PWA 不縮 vv 時 iOS 常改 pan）
 * 3. layout gap（僅在主殼尚未跟 vv 同步時）
 * 最後：standalone PWA 且三信號皆無 → 延遲 fallback 估算
 */
export function computeChatKeyboardInset(params: ChatKeyboardInsetInput): number {
  const { vv, inputEl, restVvHeight, focusedForMs, standalonePwa } = params
  if (!vv || !inputEl) return 0

  const visibleBottom = vv.offsetTop + vv.height
  const inputBottom = inputEl.getBoundingClientRect().bottom
  const composerOverlap = Math.max(0, Math.round(inputBottom - visibleBottom))
  const scrollPanProxy = Math.max(0, Math.round((window.scrollY || 0) + vv.offsetTop))

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

export function isIosStandalonePwaLikely(): boolean {
  return iosOrIpadosLikely() && standaloneDisplayModeLikely()
}

type UseIosChatKeyboardInsetOptions = {
  /** 鍵盤狀態變更後是否補捲到底（vv scroll 事件會關閉以避免震動）。 */
  scrollToBottom?: () => void
}

/**
 * 配對／即時聊天輸入框：iOS 鍵盤避讓（三信號 + 條件 fallback，非舊版單一 vv 差值）。
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

      const focusedForMs =
        focusStartedAtRef.current == null ? 0 : Date.now() - focusStartedAtRef.current

      return computeChatKeyboardInset({
        vv: vv ?? null,
        inputEl: inputRef.current,
        restVvHeight: restVvHeightRef.current,
        focusedForMs,
        standalonePwa: isIosStandalonePwaLikely(),
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
        focusStartedAtRef.current = Date.now()
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
        setChatComposerKeyboardCapture(false)
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
      focusStartedAtRef.current = null
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
