/**
 * 建立 50 位創始會員：Auth 與 profiles。
 * 性別：founding001、003 為男，002、004 為女，各 25 位。
 *
 * 問卷與 App 相同題池；每位固定 5 題以序號 seed 抽取，見 getSeededRandomQuestions（已預填寫入 profiles.questionnaire）。
 * verification_status 預設 submitted：登入後不會再被導向「身分／職業驗證」流程（見 App.tsx maleNeedsIdentityVerify）。
 *
 * 頭像：
 * - 預設：免費 Unsplash URL（可能被下架）。
 * - 本機：預設讀 repo 根目錄旁的資料夾 `photo`（與 package.json 同層；路徑依腳本檔位置解析，不必在專案根目錄執行）。
 *   也可用環境變數 FOUNDING_PHOTOS_DIR 覆寫（相對路徑以 repo 根為準）。
 *   檔名（優先）：檔名以 1 開頭＝女生、2 開頭＝男生。
 *   女生序號 founding002、004…：建議流水檔名 1001.jpg～1025.jpg（第 1～25 位女生）；
 *   亦可 1002.jpg、1004.jpg…（1 + 三位 founding 序號）。男生類推 2001～2025 或 2001、2003…。
 *   備援舊命名：002.jpg、founding002.jpg 等仍會嘗試。
 *   會上傳到 Supabase Storage `photos/{userId}/founding-001.ext`，並寫入 profiles.photo_urls。
 *   某序號若無檔案，該位仍用 Unsplash。
 * - 僅先上傳女生：設 FOUNDING_PHOTO_GENDER=female（男生仍用圖庫、不因缺 2xxx 檔警告）。
 *
 * 帳號規律：founding001@tsmedia.tw 至 founding050@tsmedia.tw
 * 密碼一致：88888888
 *
 * 環境變數必填：SUPABASE_SERVICE_ROLE_KEY；SUPABASE_URL 可省略（會讀 VITE_SUPABASE_URL）。
 * 可將上述變數寫入 repo 根目錄 `.env.local`（勿提交 git）；執行前會自動載入 `.env.local`、`.env`。
 * 選填：FOUNDING_PHOTOS_DIR（未設則使用 `<repo>/photo`）、FOUNDING_PHOTO_GENDER（female|male，只從本機上傳該性別）
 *
 * 執行：npx tsx scripts/seed-founding-members.ts
 * 或：npm run seed:founding
 *
 * 已存在相同 email 時略過建立帳號，仍會更新 profile，含問卷、照片、founding_member_no。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSeededRandomQuestions } from '../src/utils/questions.ts'
import { FOUNDING_ANSWERS_BY_QUESTION_ID } from './founding-questionnaire-answers.ts'

const TERMS_VERSION = '2026-04-28'
const PASSWORD = '88888888'
const COUNT = 50
const EMAIL_DOMAIN = 'tsmedia.tw'
const EMAIL_LOCAL_PREFIX = 'founding'

/**
 * 免費 images.unsplash.com，非 Unsplash+。頭像不是 AI 生成，皆為圖庫素材 + CDN 裁切。
 * portraitUrlForFounding：4:5 接近社群大頭貼比例、facepad 放大以保留肩頸與背景（較不像過近的大頭裁切）、畫質略提。
 * crop=faces 在雙人／合照仍可能裁錯臉；正式上線仍建議自管上傳。
 * 女池偏戶外自然光、微笑、生活感；仍混東亞感較明顯與通用清新人像。
 */
const FEMALE_EAST_ASIAN_PORTRAIT_IDS: string[] = [
  '1704731267884-91c2a0f6c20e',
  '1758600587833-c07c5bda5c70',
  '1758600587839-56ba05596c69',
  '1675705444858-97005ce93298',
  '1761933808230-9a2e78956daa',
  '1771757019737-4468ded75c97',
  '1773899337978-b8d83bd9b783',
  '1668876220458-805bc60d6046',
  '1562532740-dac9bd8c2593',
  '1583198646737-517b9e660698',
  '1758600587683-d86675a2f6e9',
  '1545030716-e0b3497b1f5e',
  '1554226761-beb7579ea7fb',
  '1679801823749-ddcc06fb6a98',
  '1759873821395-c29de82a5b99',
  '1772249541659-a034b3360f19',
  '1773216282433-1d79669534c6',
  '1767786887394-9271ceacf801',
  '1771822413619-2e0f9d0dd17d',
  '1767396858128-85b1262a7677',
  '1760552069014-78ff72ee7cac',
  '1758337082707-e3fbd71ed461',
  '1760124146290-a896872ae49a',
  '1758467797282-25bb9b9024ca',
  '1713078582993-fdd86b1a2c1f',
  '1554226755-b903fbf23de0',
  '1773846175102-57afcecb6af3',
  '1773846175141-e5ff82778396',
  '1755143605418-f3f8955e4f5a',
  '1668879355609-8bdda74bda53',
  '1600481176431-47ad2ab2745d',
]

const MALE_EAST_ASIAN_PORTRAIT_IDS: string[] = [
  '1519085360753-af0119f7cbe7',
  '1628619488538-f4ce88739f56',
  '1628619487942-01c58eed5c33',
  '1628619488063-fdbe60bc376d',
  '1626859130267-7959f7326c3a',
  '1522075469751-3a6694fb2f61',
  '1634843824921-83bb75483c59',
  '1623512083603-5068ca8290f4',
]

function portraitUrlForFounding(no: number, gender: 'male' | 'female') {
  const pool = gender === 'male' ? MALE_EAST_ASIAN_PORTRAIT_IDS : FEMALE_EAST_ASIAN_PORTRAIT_IDS
  const idx = Math.floor((no - 1) / 2) % pool.length
  const id = pool[idx]
  return `https://images.unsplash.com/photo-${id}?auto=format&w=900&h=1125&fit=crop&crop=faces&facepad=4&q=92`
}

const LOCAL_PHOTO_EXT = ['.jpg', '.jpeg', '.png', '.webp'] as const

/** 只從本機資料夾上傳指定性別；其餘一律用 Unsplash（不掃本機、不警告缺檔） */
function foundingPhotoLocalScope(): 'all' | 'female' | 'male' {
  const v = process.env.FOUNDING_PHOTO_GENDER?.trim().toLowerCase()
  if (v === 'female' || v === 'f' || v === 'women' || v === 'woman') return 'female'
  if (v === 'male' || v === 'm' || v === 'men' || v === 'man') return 'male'
  return 'all'
}

function repoRootDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

/** 載入 repo 根目錄 `.env.local`、`.env`（僅補齊尚未設定的 process.env） */
function loadRepoEnvFiles(): void {
  const root = repoRootDir()
  for (const name of ['.env.local', '.env'] as const) {
    const filePath = path.join(root, name)
    if (!fs.existsSync(filePath)) continue
    const text = fs.readFileSync(filePath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      const key = t.slice(0, eq).trim()
      let val = t.slice(eq + 1).trim()
      if (!key) continue
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
}

function resolveFoundingPhotosDir(): string | null {
  const raw = process.env.FOUNDING_PHOTOS_DIR?.trim()
  const candidates: string[] = []
  const root = repoRootDir()
  if (raw) {
    candidates.push(path.isAbsolute(raw) ? raw : path.resolve(root, raw))
  } else {
    candidates.push(path.join(root, 'photo'))
  }
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
  }
  if (raw) {
    console.error(`FOUNDING_PHOTOS_DIR 不是有效資料夾: ${candidates[0]}`)
    process.exit(1)
  }
  return null
}

/** `photo` 內是否已有 1xxx／2xxx 慣例檔名（本機男女頭像） */
function photoDirHasGenderPrefix(dir: string, prefixChar: '1' | '2'): boolean {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return false
  }
  const re =
    prefixChar === '2'
      ? /^2\d{3}\.(?:jpe?g|png|webp)$/i
      : /^1\d{3}\.(?:jpe?g|png|webp)$/i
  return entries.some((n) => re.test(n))
}

/** 1 開頭＝女、2 開頭＝男。
 * 女生 founding 序號為 2,4,…,50：可採流水號 1001～1025（第 1～25 位女生，即 1 + pad3(no/2)），
 * 或依序號 1002、1004…（1 + pad3(no)）。男類推 2001～2025（2+pad3((no+1)/2)）或 2001、2003…。
 * 再備援舊命名 002 / founding002。
 */
function findLocalFoundingPhotoFile(no: number, gender: 'male' | 'female', dir: string): string | null {
  const stem = pad3(no)
  const prefix = gender === 'female' ? '1' : '2'
  const ordinal = gender === 'female' ? Math.floor(no / 2) : Math.floor((no + 1) / 2)
  const ordStem = pad3(ordinal)
  const genderedBases = [
    `${prefix}${ordStem}`,
    `${prefix}-${ordStem}`,
    `${prefix}_${ordStem}`,
    `${prefix}${stem}`,
    `${prefix}-${stem}`,
    `${prefix}_${stem}`,
  ]
  for (const b of genderedBases) {
    for (const ext of LOCAL_PHOTO_EXT) {
      const full = path.join(dir, b + ext)
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full
    }
  }
  const legacy = [stem, `founding${stem}`, `founding-${stem}`, `founding_${stem}`]
  for (const b of legacy) {
    for (const ext of LOCAL_PHOTO_EXT) {
      const full = path.join(dir, b + ext)
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full
    }
  }
  return null
}

function contentTypeForImagePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

async function uploadLocalFoundingPhoto(
  supabase: SupabaseClient,
  userId: string,
  no: number,
  localPath: string,
): Promise<string> {
  const buf = fs.readFileSync(localPath)
  const ext = path.extname(localPath).toLowerCase() || '.jpg'
  const storagePath = `${userId}/founding-${pad3(no)}${ext}`
  const { error } = await supabase.storage.from('photos').upload(storagePath, buf, {
    upsert: true,
    contentType: contentTypeForImagePath(localPath),
  })
  if (error) throw new Error(`上傳 ${storagePath} 失敗: ${error.message}`)
  return storagePath
}

async function photoUrlForFoundingSeat(
  supabase: SupabaseClient,
  userId: string,
  no: number,
  gender: 'male' | 'female',
): Promise<string> {
  const dir = resolveFoundingPhotosDir()
  if (!dir) return portraitUrlForFounding(no, gender)
  const scope = foundingPhotoLocalScope()
  if (scope === 'female' && gender === 'male') return portraitUrlForFounding(no, gender)
  if (scope === 'male' && gender === 'female') return portraitUrlForFounding(no, gender)
  const local = findLocalFoundingPhotoFile(no, gender, dir)
  if (!local) {
    const hint =
      gender === 'female'
        ? `1${pad3(Math.floor(no / 2))}.jpg 或 1${pad3(no)}.jpg`
        : `2${pad3(Math.floor((no + 1) / 2))}.jpg 或 2${pad3(no)}.jpg`
    console.warn(`[founding ${pad3(no)}] 本機無對應檔（建議檔名：${hint}），改用預設圖庫`)
    return portraitUrlForFounding(no, gender)
  }
  return uploadLocalFoundingPhoto(supabase, userId, no, local)
}

/** 興趣大池：洗牌後取 4 項，避免人人相同 */
const INTEREST_POOL_COMMON = [
  '重訓', '慢跑', '游泳', '單車', '瑜伽', '皮拉提斯', '登山', '露營', '攝影', '手沖咖啡', '茶席', '品酒',
  '甜點', '烘焙', '下廚', '展覽', '博物館', '音樂祭', '古典樂', '爵士', '閱讀', 'podcast', '電影', '追劇',
  '桌遊', '密室逃脫', '志工', '小旅行', '咖啡探店', '插花', '繪畫', '書法', '程式 side project', '語言學習',
]

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleSeeded<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items]
  const rnd = mulberry32(seed)
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function pick<T>(arr: readonly T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length]
}

/** 題幹 hash：讓同一分類下不同題目用詞仍錯開，不整段複述題目 */
function hashQuestionText(text: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** 依題目 id 取對題作答（見 founding-questionnaire-answers.ts）；缺 id 時依分類給短備援 */
function syntheticAnswer(no: number, q: { id: number; category: string; text: string }, slot: number) {
  const h = hashQuestionText(q.text)
  const seed = (no * 131 + q.id * 17 + slot * 29 + h * 5) >>> 0
  const pool = FOUNDING_ANSWERS_BY_QUESTION_ID[q.id]
  if (pool?.length) {
    return pick(pool, seed)
  }
  const segKey =
    q.category === '工作與生活平衡' || q.category === '未來規劃與自尊' || q.category === '金錢觀'
      ? q.category
      : '金錢觀'
  if (segKey === '金錢觀') {
    return '談錢我傾向先把界線與雙方在意點說清楚，再找彼此能承受的分攤方式。'
  }
  if (segKey === '工作與生活平衡') {
    return '工作與陪伴我會盡量事先講空檔與底線，避免用已讀不回讓對方猜。'
  }
  return '談未來我會先分清楚「想要」跟「應該」，也留空間調整，不把承諾說死。'
}

function questionnaireForSeat(no: number, gender: 'male' | 'female') {
  const pickSeed = no * 100_003 + (gender === 'male' ? 17 : 91_981)
  const picked = getSeededRandomQuestions(5, gender, pickSeed)
  return picked.map((q, i) => ({
    id: q.id,
    category: q.category,
    text: q.text,
    answer: syntheticAnswer(no, q, i),
  }))
}

function interestsForSeat(no: number, gender: 'male' | 'female'): string[] {
  const bias = gender === 'male' ? ['重訓', '單車', '登山'] : ['瑜伽', '甜點', '插花']
  const pool = shuffleSeeded([...INTEREST_POOL_COMMON, ...bias], no * 1_103_515_245)
  const out: string[] = []
  for (const x of pool) {
    if (!out.includes(x)) out.push(x)
    if (out.length >= 4) break
  }
  return out
}

const FAMILY = [
  '陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭', '謝', '洪', '郭', '邱', '曾', '羅', '葉', '蘇', '周', '簡', '朱', '彭', '游', '魏', '趙', '徐', '薛', '潘', '杜', '戴', '夏', '鍾', '汪', '田', '方', '石', '丁', '傅', '侯', '曹', '溫', '姚', '盧', '姜', '沈', '高', '梁', '蕭',
]

const MALE_GIVEN = [
  '冠宇', '柏翰', '宥翔', '奕辰', '承恩', '庭安', '俊廷', '冠廷', '哲維', '奕廷',
  '子軒', '冠霖', '彦廷', '柏宇', '昱廷', '宸翰', '靖宇', '冠儒', '丞恩', '翊軒',
  '秉翰', '昱辰', '宥廷', '柏廷', '廷宇',
]
const FEMALE_GIVEN = [
  '子晴', '怡君', '思妤', '雅婷', '映晴', '品妍', '欣怡', '佳蓉', '雅筑', '沛珊',
  '柔安', '芷琳', '芯語', '詩涵', '羽彤', '宜庭', '婉婷', '佳穎', '若瑜', '沛芸',
  '靖雯', '奕璇', '芷萱', '妍希', '芷晴',
]

/** 台灣常見英文暱稱；與中文本名分開，不作音譯 */
const MALE_ENGLISH_NICKNAMES = [
  'Kevin', 'Jason', 'Eric', 'Alex', 'Leo', 'Ryan', 'Brian', 'Justin', 'Tommy', 'Andy',
  'Ken', 'Vic', 'Hank', 'Owen', 'Max', 'Felix', 'Ian', 'Tony', 'Jeff', 'Derek',
  'Simon', 'Chris', 'Marcus', 'Wayne', 'Steven', 'David', 'Peter', 'Jack', 'Henry', 'Russell',
]
const FEMALE_ENGLISH_NICKNAMES = [
  'Amy', 'Emily', 'Kelly', 'Cindy', 'Annie', 'Ruby', 'Ivy', 'Chloe', 'Mia', 'Zoe',
  'Ella', 'Tiffany', 'Jessica', 'Grace', 'Alice', 'Bonnie', 'Lynn', 'May', 'Peggy', 'Sandy',
  'Wendy', 'Joyce', 'Fiona', 'Esther', 'Nicole', 'Lisa', 'Helen', 'Yuki', 'Gina', 'Sheila',
]

/** 約 30% 使用中文風格暱稱；以下 15 筆與 founding_member_no 固定對應，不重複。英文暱稱仍可由池輪替重複。 */
const ZH_NICKNAME_BY_FOUNDING_NO: Record<number, string> = {
  8: '小安',
  9: '阿琳',
  10: '靜宜',
  18: '雅文',
  19: '慧如',
  20: '芷瑜',
  28: '書瑩',
  29: '佳雯',
  30: '淑婷',
  38: '怡安',
  39: '筱婷',
  40: '宜璇',
  48: '韻如',
  49: '美玲',
  50: '琇琇',
}

/** 每 10 人中 7 人英文暱稱 → 全體約 70% */
function nicknameForFounding(no: number, gender: 'male' | 'female') {
  if (((no - 1) % 10) < 7) {
    const pool = gender === 'male' ? MALE_ENGLISH_NICKNAMES : FEMALE_ENGLISH_NICKNAMES
    return pool[(no - 1) % pool.length]
  }
  const zh = ZH_NICKNAME_BY_FOUNDING_NO[no]
  if (zh) return zh
  const pool = gender === 'male' ? MALE_ENGLISH_NICKNAMES : FEMALE_ENGLISH_NICKNAMES
  return pool[(no - 1) % pool.length]
}

const REGIONS = ['north', 'central', 'south', 'east'] as const
const REGION_LABEL: Record<(typeof REGIONS)[number], string> = {
  north: '北部',
  central: '中部',
  south: '南部',
  east: '東部',
}
const COMPANIES = ['TSMC', 'MediaTek'] as const

const MALE_JOBS = [
  ['製程整合工程師', '先進製程'],
  ['數位設計工程師', '數位 IP'],
  ['設備工程師', '薄膜製程'],
  ['製程研發工程師', '3nm 研發'],
  ['SoC 架構工程師', '5G 晶片'],
] as const
const FEMALE_JOBS = [
  ['產品工程師', '良率提升'],
  ['人資專員', '招募與薪酬'],
  ['財務分析師', '管理會計'],
  ['設計工程師', '類比 IP'],
  ['專案經理', '客戶專案'],
] as const

function pad3(n: number) {
  return String(n).padStart(3, '0')
}

function emailFor(no: number) {
  return `${EMAIL_LOCAL_PREFIX}${pad3(no)}@${EMAIL_DOMAIN}`
}

/** 自介不含公司／職稱、不出現姓名／暱稱；依序號輪替模板 */
function bioForSeat(
  no: number,
  gender: 'male' | 'female',
  homeRegion: (typeof REGIONS)[number],
  workRegion: (typeof REGIONS)[number],
) {
  const h = REGION_LABEL[homeRegion]
  const w = REGION_LABEL[workRegion]
  const templates =
    gender === 'male'
      ? [
          `步調快但慢慢在學留白；家在${h}，週末常在${w}走走，想找能好好說話的人。`,
          `成長背景在${h}，現在活動圈多在${w}。不愛派對，更喜歡深度聊天與穩定相處。`,
          `習慣把專注留在白天、把生活留給自己。喜歡${h}的步調，也常在${w}找咖啡館待一下午。`,
          `在${h}長大，日常往返${w}。相信感情要慢慢來，寧可慢也不要硬湊。`,
          `外表看起來很理性，其實私下很宅也很愛聊價值觀；住${h}，活動多在${w}。`,
          `越來越在意生活品質。根在${h}，現在多半在${w}活動，想找步伐相近的對象。`,
          `壓力大時會靠運動與獨處回血；假日喜歡回${h}陪家人，平日在${w}把日子過踏實。`,
          `對我來說感情像長跑：家在${h}，生活圈${w}，希望遇到願意一起把日子過好的人。`,
          `在${w}生活、心還在${h}。更想被認識的是個性與相處起來舒不舒服。`,
          `講話偏直但對人很真；喜歡${w}的街景，也想念${h}的巷弄小吃與人情味。`,
          `生活圈${w}、老家${h}。相信關係要靠溝通堆出來，而不是靠猜。`,
          `在${h}長大、常在${w}。想找能一起把平凡日子過得不無聊的人。`,
          `習慣把行程排滿但也留一段空白給自己；喜歡${w}的夜，也愛${h}的早晨。`,
          `慢熱但熟了會很穩。${h}是安全感的來源，${w}是挑戰自己的地方。`,
          `不追求戲劇化浪漫，更在意彼此能不能把話說清楚、把日子過踏實。`,
        ]
      : [
          `節奏快但很在意生活儀式感；家在${h}，常在${w}探店散步。`,
          `喜歡把週末留給自己，也期待遇到能一起安排小旅行的人。成長在${h}，現在多在${w}。`,
          `習慣把情緒整理完再說話。喜歡${w}的咖啡香，也想念${h}的熟悉感。`,
          `在${h}長大，活動圈多在${w}。相信好的關係是互相接住，而不是互相消耗。`,
          `私底下愛拍照、愛記錄生活。${h}是根，${w}是探索世界的起點。`,
          `喜歡把生活過得有點浪漫但不浮誇；住${h}，日常常在${w}往返。`,
          `對感情慢熟但認真。假日喜歡回${h}陪家人，平日多半在${w}專心做事。`,
          `重視界線與尊重，也希望彼此都能保留一點自己的空間。`,
          `在${w}生活、心裡牽掛${h}。更想被認識的是溫柔與堅持。`,
          `講話柔但原則清楚；喜歡${w}的展覽，也愛${h}的巷弄小店。`,
          `相信感情要靠日常累積；${h}教我踏實，${w}教我勇敢。`,
          `在${h}長大、常在${w}。想找能一起把生活過得穩穩、也偶爾放飛的人。`,
          `習慣用清單管理人生，但對感情想保留一點不那麼精準的浪漫。`,
          `喜歡把日子過得有滋有味；${h}是安全感，${w}是放鬆的出口。`,
          `期待彼此能好好說話、也能好好獨處的關係。`,
        ]
  return templates[(no - 1) % templates.length]
}

async function findUserIdByEmail(
  admin: { listUsers: (args: { page: number; perPage: number }) => Promise<{ data: { users: { id: string; email?: string }[] }; error: Error | null }> },
  email: string,
) {
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await admin.listUsers({ page, perPage })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit.id
    if (data.users.length < perPage) return null
    page += 1
  }
}

async function main() {
  loadRepoEnvFiles()
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) {
    console.error(
      '請設定 SUPABASE_SERVICE_ROLE_KEY（Dashboard > Project Settings > API > service_role secret），可寫入 .env.local',
    )
    process.exit(1)
  }
  if (!url) {
    console.error('請設定 SUPABASE_URL 或 VITE_SUPABASE_URL')
    process.exit(1)
  }

  if (FEMALE_EAST_ASIAN_PORTRAIT_IDS.length < 1 || MALE_EAST_ASIAN_PORTRAIT_IDS.length < 1) {
    console.error('頭像圖池不可為空')
    process.exit(1)
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const localDir = resolveFoundingPhotosDir()
  if (localDir) {
    console.log(`本機頭像資料夾: ${localDir}`)
    const scope = foundingPhotoLocalScope()
    const rawGender = process.env.FOUNDING_PHOTO_GENDER?.trim()
    if (rawGender) console.log(`環境變數 FOUNDING_PHOTO_GENDER="${rawGender}"（影響本機上傳範圍）`)
    if (scope === 'female') console.log('FOUNDING_PHOTO_GENDER=female：僅上傳女生本機照，男生用圖庫')
    if (scope === 'male') console.log('FOUNDING_PHOTO_GENDER=male：僅上傳男生本機照，女生用圖庫')
    if (scope === 'female' && photoDirHasGenderPrefix(localDir, '2')) {
      console.warn('')
      console.warn('※ 偵測到 photo 內有男生檔名（2001.jpg～2025.jpg 等），但目前為「只上傳女生」模式，男生仍會用圖庫。')
      console.warn('  若要男生也用本機照：請移除環境變數 FOUNDING_PHOTO_GENDER（含 Windows 使用者環境變數、或 PowerShell 曾執行的 $env:FOUNDING_PHOTO_GENDER），關閉終端機後重開，再執行 npm run seed:founding。')
      console.warn('')
    }
    if (scope === 'male' && photoDirHasGenderPrefix(localDir, '1')) {
      console.warn('')
      console.warn('※ 偵測到 photo 內有女生檔名（1xxx），但目前為「只上傳男生」模式。')
      console.warn('  若要女生也用本機照：請移除 FOUNDING_PHOTO_GENDER 後重跑。')
      console.warn('')
    }
  }

  const admin = supabase.auth.admin
  let created = 0
  let skippedAuth = 0
  let updated = 0
  const errors: { email: string; step: string; message: string }[] = []

  for (let no = 1; no <= COUNT; no += 1) {
    const email = emailFor(no)
    const gender = no % 2 === 1 ? 'male' : 'female'
    const company = COMPANIES[no % 2]
    const age = 26 + (no % 9)
    const given = gender === 'male' ? MALE_GIVEN[(no - 1) % MALE_GIVEN.length] : FEMALE_GIVEN[(no - 1) % FEMALE_GIVEN.length]
    const surname = FAMILY[(no - 1) % FAMILY.length]
    const name = `${surname}${given}`
    const nickname = nicknameForFounding(no, gender)
    const jobs = gender === 'male' ? MALE_JOBS : FEMALE_JOBS
    const [jobTitle, department] = jobs[no % jobs.length]
    const workRegion = REGIONS[no % 4]
    const homeRegion = REGIONS[(no + 1) % 4]
    const preferredRegion = REGIONS[(no + 2) % 4]
    const interests = interestsForSeat(no, gender)

    const questionnaire = questionnaireForSeat(no, gender)

    let userId = await findUserIdByEmail(admin, email)

    if (!userId) {
      const { data, error } = await admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: {
          founding_member: true,
          founding_member_no: no,
        },
      })
      if (error) {
        errors.push({ email, step: 'createUser', message: error.message })
        console.error(`[${email}] 建立失敗:`, error.message)
        continue
      }
      userId = data.user.id
      created += 1
    } else {
      skippedAuth += 1
      const { error: upErr } = await admin.updateUserById(userId, {
        password: PASSWORD,
        user_metadata: { founding_member: true, founding_member_no: no },
      })
      if (upErr) {
        console.warn(`[${email}] 更新密碼／metadata 略過:`, upErr.message)
      }
    }

    const photoUrl = await photoUrlForFoundingSeat(supabase, userId, no, gender)

    const now = new Date().toISOString()
    const patch = {
      id: userId,
      name,
      nickname,
      gender,
      age,
      company,
      job_title: jobTitle,
      department,
      bio: bioForSeat(no, gender, homeRegion, workRegion),
      interests,
      questionnaire,
      photo_urls: [photoUrl],
      work_region: workRegion,
      home_region: homeRegion,
      preferred_region: preferredRegion,
      show_income_border: false,
      verification_status: 'submitted',
      is_verified: false,
      account_status: 'active',
      terms_version: TERMS_VERSION,
      terms_accepted_at: now,
      founding_member_no: no,
    }

    const { error: pErr } = await supabase.from('profiles').upsert(patch, { onConflict: 'id' })
    if (pErr) {
      errors.push({ email, step: 'profiles', message: pErr.message })
      console.error(`[${email}] profile 寫入失敗:`, pErr.message)
      continue
    }
    updated += 1
    console.log(`OK ${pad3(no)} ${email} ${gender}`)
  }

  console.log('\n--- 摘要 ---')
  console.log('新建立 Auth 使用者:', created)
  console.log('已存在，略過建立:', skippedAuth)
  console.log('Profile upsert 成功:', updated)
  console.log('錯誤筆數:', errors.length)
  if (errors.length) console.log(errors)

  if (errors.length > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
