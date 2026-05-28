/** 探索卡片、配對聊天／拼圖（未成為好友前）生活照霧化強度 */
export const PROFILE_PHOTO_PRIVACY_BLUR_PX = 8

export function profilePhotoPrivacyBlurFilter(): string {
  return `blur(${PROFILE_PHOTO_PRIVACY_BLUR_PX}px)`
}

/** 拼圖 SVG `feGaussianBlur` 與 CSS blur(px) 對齊 */
export const PROFILE_PHOTO_PRIVACY_SVG_BLUR_STD = PROFILE_PHOTO_PRIVACY_BLUR_PX
