/** 測試站頂部提示（不擋操作） */
export default function StagingEnvBanner() {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[99999] flex justify-center px-3 pt-[max(0.35rem,env(safe-area-inset-top))]"
      role="status"
      aria-live="polite"
    >
      <span className="rounded-b-xl bg-amber-500 px-3 py-1 text-center text-[11px] font-bold tracking-wide text-amber-950 shadow-md">
        測試環境 · 非正式站
      </span>
    </div>
  )
}
