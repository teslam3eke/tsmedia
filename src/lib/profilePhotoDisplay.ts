import { cn } from '@/lib/utils'

/** 探索／個人檔案：2:3 直式 object-cover（聊天室拼圖維持獨立版型） */
export const PROFILE_PHOTO_COVER_CLASS =
  'absolute inset-0 h-full w-full object-cover object-center'

/** 2:3 外框（寬度由父層決定，高度自動） */
export const PROFILE_PHOTO_ASPECT_BOX_CLASS = 'relative w-full overflow-hidden'
export const PROFILE_PHOTO_ASPECT_INNER_CLASS = 'absolute inset-0'

/** 仍霧化時略放大裁切；已解鎖不加 scale，避免清晰照被二次放大而糊 */
export function profilePhotoCoverClassName(privacyBlurred: boolean): string {
  return cn(PROFILE_PHOTO_COVER_CLASS, privacyBlurred && 'scale-[1.04]')
}

/** 探索／個人檔案 SVG 內嵌圖與 object-cover 對齊 */
export const PROFILE_PHOTO_SVG_PRESERVE = 'xMidYMid slice'
