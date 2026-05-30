/**
 * 註冊／編輯可選興趣。須涵蓋 seed 池與舊資料，避免「已選 N 個但畫面只亮少數」。
 */
export const PROFILE_INTEREST_TAGS = [
  '精品咖啡', '登山', '底片攝影', '日本文學', '爵士吉他',
  '手沖咖啡', '電影', '重訓', '單車', '台式料理',
  '紀錄片', '城市規劃', '義式料理', '閱讀', '天文觀測',
  '黑膠唱片', '清酒', '植物', '烘焙', '游泳',
  '登山健行', '桌遊', '投資理財', '料理', '潛水',
  '慢跑', '瑜伽', '皮拉提斯', '露營', '攝影', '茶席', '品酒',
  '甜點', '展覽', '博物館', '音樂祭', '古典樂', '爵士', 'podcast', '追劇',
  '密室逃脫', '志工', '小旅行', '咖啡探店', '插花', '繪畫', '書法', '語言學習',
  '爵士樂', '義大利料理', '歐洲電影', '獨立書店', '威士忌', '湯麵', '電子音樂',
] as const

/** 合併預設池與使用者已存標籤（保留順序、去重）。 */
export function mergeInterestTagOptions(saved: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...PROFILE_INTEREST_TAGS, ...saved]) {
    const t = raw.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}
