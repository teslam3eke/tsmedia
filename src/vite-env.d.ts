/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 由 vite.config define 注入，供 `src/lib/appVersion.ts` 與 `/build-id.txt` 比對 */
declare const __APP_BUILD_ID__: string

interface ImportMetaEnv {
  /** POST JSON：`resume`、`realtime_ws`、`realtime_channel`、`connection_repair`（無 PII） */
  readonly VITE_RESUME_REALTIME_TELEMETRY_URL?: string
  /** 正式站建議設為 https://www.tsmedia.tw — 註冊確認信 redirect 與 Supabase Redirect URLs 一致 */
  readonly VITE_SITE_URL?: string
  /** Web Push VAPID 公鑰（與 Vercel VAPID_PUBLIC_KEY 相同）；未設則不訂閱離線推播 */
  readonly VITE_VAPID_PUBLIC_KEY?: string
  readonly VITE_TAPPAY_APP_ID?: string
  readonly VITE_TAPPAY_APP_KEY?: string
  readonly VITE_TAPPAY_SERVER_TYPE?: string
  /** 設為 1 時，讀取餘額前會呼叫 DB RPC test_ensure_daily_ten_credits（須 migration 017 + app_feature_flags 開啟） */
  readonly VITE_TEST_DAILY_TEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
