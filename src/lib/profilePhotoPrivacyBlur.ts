/** 探索卡片、配對聊天／拼圖（未成為好友前）生活照霧化強度 */
export const PROFILE_PHOTO_PRIVACY_BLUR_PX = 8

/** 霧化後放大裁切，避免 `overflow:hidden` 把 blur 邊緣裁掉而顯得幾乎沒模糊 */
export const PROFILE_PHOTO_PRIVACY_BLUR_SCALE = 1.15

export function profilePhotoPrivacyBlurFilter(): string {
  return `blur(${PROFILE_PHOTO_PRIVACY_BLUR_PX}px)`
}

export function profilePhotoPrivacyBlurStyle(): { filter: string; WebkitFilter: string } {
  const f = profilePhotoPrivacyBlurFilter()
  return { filter: f, WebkitFilter: f }
}

/** 拼圖 SVG `feGaussianBlur` 與 CSS blur(px) 對齊 */
export const PROFILE_PHOTO_PRIVACY_SVG_BLUR_STD = PROFILE_PHOTO_PRIVACY_BLUR_PX
