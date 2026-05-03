/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** 正式站建議設為 https://www.tsmedia.tw — 註冊確認信 redirect 與 Supabase Redirect URLs 一致 */
  readonly VITE_SITE_URL?: string
  readonly VITE_TAPPAY_APP_ID?: string
  readonly VITE_TAPPAY_APP_KEY?: string
  readonly VITE_TAPPAY_SERVER_TYPE?: string
  /** 設為 1 時，讀取餘額前會呼叫 DB RPC test_ensure_daily_ten_credits（須 migration 017 + app_feature_flags 開啟） */
  readonly VITE_TEST_DAILY_TEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
