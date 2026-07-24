export type NotificationSettingKey = 'newMatch' | 'messages'

export interface NotificationSettings {
  newMatch: boolean
  messages: boolean
}

const STORAGE_KEY = 'notif_settings'
const DEFAULT_SETTINGS: NotificationSettings = { newMatch: true, messages: true }

/** 未曾設定的使用者預設開啟；只有明確儲存 false 才視為關閉。 */
export function readNotificationSettings(): NotificationSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(saved) as Partial<Record<NotificationSettingKey, boolean>>
    return {
      newMatch: parsed.newMatch !== false,
      messages: parsed.messages !== false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeNotificationSettings(next: NotificationSettings): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

/** 登入流程中明確同意系統通知時，同步開啟 App 內兩項通知偏好。 */
export function enableAllNotificationSettings(): void {
  writeNotificationSettings({ newMatch: true, messages: true })
}
