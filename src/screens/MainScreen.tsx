import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart, X, MessageCircle, Compass, User,
  Sparkles, MapPin, CalendarDays, Flame,
  ChevronLeft, ChevronDown, Send, Bell, BellOff,
  Cpu, Zap, LogOut, MessageSquare, Check, Pencil,
  Camera, Trash2, ImageIcon, Users, Star,
  Plus, Smile, BellRing, AlertCircle, Gem,
  FileText, Upload, ShieldCheck, ChevronRight, Flag, Ban, Eye,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/auth'
import {
  wakeSupabaseAuthFromBackground,
  reconnectSupabaseRealtimeOnly,
  refreshSupabaseAuthSoft,
  touchSupabaseAuthSessionRead,
  ensureConnection,
  ensureConnectionWithBudget,
  repairAuthAfterResume,
  prepareSupabaseForProfileReads,
  awaitRealtimeWsSignalWithin,
  PROFILE_TAB_REALTIME_SIGNAL_MS,
  supabase,
} from '@/lib/supabase'
import { clearAppQueryCache, queryClient } from '@/lib/queryClient'
import {
  getProfile, resolvePhotoUrls, upsertProfile, uploadPhoto, getIncomeVerification,
  uploadProofDoc, submitVerificationDoc, submitIncomeVerification,
  getUnreadAppNotifications, markAppNotificationRead,
  getTodayVerificationSubmissionCount, finalizeDueAiReviews,
  recordProfileInteraction, fetchDailyDiscoverDeck, submitProfileReport, blockProfile,
  getMyBlockedProfileKeys, submitMessageReport, getCreditBalance, spendBlurUnlockTile,
  getPhotoUnlockState,
  getMyMatches, getMatchMessages, sendMatchMessage, subscribeToMatchMessages,
  formatChatMessageFromRow, mergeUniqueChatMessages,
  claimDailyMemberHearts, refreshProfileTabStats, subscribeToNewMatches,
  instantMatchLeaveQueue,
  instantMatchLeaveQueueKeepalive,
} from '@/lib/db'
import { getAppDayKey, msUntilNextAppDayKeyChange, showDiscoverDeckRolloverNotification } from '@/lib/appDay'
import SubscriptionScreen from '@/screens/SubscriptionScreen'
import type { ProfileRow, QuestionnaireEntry, Region, IncomeTier, Company, AiConfidence, AppNotificationRow, AppNotificationKind, ReportReason, MessageReportReason, CreditBalance } from '@/lib/types'
import type { DailyDiscoverRpcRow, ProfileTabStats } from '@/lib/db'
import { REGION_LABELS, INCOME_TIER_META, PROFILE_PHOTO_MIN, PROFILE_PHOTO_MAX, PUZZLE_MAX_PHOTO_SLOTS } from '@/lib/types'
import { IncomeBorder } from '@/components/IncomeBorder'
import { AI_AUTO_REVIEW_UI_SECONDS } from '@/lib/aiReviewConstants'
import { actionTrace, shortId } from '@/lib/clientActionTrace'
import { CreditRewardFlash, type CreditRewardVariant } from '@/components/CreditRewardFlash'
import MatchSuccessSplash from '@/components/MatchSuccessSplash'
import InstantMatchTab from '@/screens/InstantMatchTab'
import DiscoverPuzzleIntroModal from '@/components/DiscoverPuzzleIntroModal'
import { PuzzlePhotoUnlock, collectConversationPhotoUrls, getPuzzleProgress } from '@/components/PuzzlePhotoUnlock'
import AdminScreen from '@/screens/AdminScreen'
import { clickFileInputWithGrace, isWithinMediaPickerGracePeriod } from '@/lib/resumeHardReload'
import { subscribeWebPushForCurrentUser } from '@/lib/webPush'
import { notifyServiceWorkerActiveChatMatch } from '@/lib/swActiveChat'
import {
  TM_APP_DEEP_LINK_EVENT,
  TM_FOREGROUND_TRANSPORT_KICK_EVENT,
  TM_PHYSICAL_CHANNEL_RESUBSCRIBE_EVENT,
} from '@/lib/appDeepLinkEvents'
import { discoverDeckLocalStorageKey } from '@/lib/discoverDeckLocalCache'
import {
  markSkipInstantMatchLeaveOnNextFullUnload,
  peekSkipInstantMatchLeaveOnFullUnload,
} from '@/lib/instantMatchUnloadGuard'

// ─── Hardcore-answer heuristic ───────────────────────────────────────────────
// "機車題挑戰" cards show a tiny diamond icon after particularly assertive
// answers. We detect that with a short keyword list — feels direct without
// needing the user to tag answers manually.
const HARDCORE_MARKERS = [
  '絕對', '硬核', '絕不', '我付', '當然', '肯定', '一定', '必須', '毫不', '不可能', '死都', '最硬',
]
const REPORT_REASONS: { value: ReportReason; label: string; desc: string }[] = [
  { value: 'fake_profile', label: '假帳號 / 盜用照片', desc: '資料或照片疑似不屬於本人' },
  { value: 'married_or_not_single', label: '已婚或非單身', desc: '疑似不符合單身交友規範' },
  { value: 'harassment', label: '騷擾或不當訊息', desc: '色情、威脅、歧視或持續騷擾' },
  { value: 'scam_or_sales', label: '詐騙 / 推銷', desc: '投資、保險、傳銷、借貸或商業招攬' },
  { value: 'inappropriate_content', label: '不當內容', desc: '暴力、裸露、仇恨或其他違規內容' },
  { value: 'privacy_violation', label: '侵犯隱私', desc: '截圖、側錄、外流或威脅散布資料' },
  { value: 'other', label: '其他', desc: '其他需要平台協助審查的情況' },
]
const MESSAGE_REPORT_REASONS: { value: MessageReportReason; label: string; desc: string }[] = REPORT_REASONS
  .filter((item) => item.value !== 'fake_profile' && item.value !== 'married_or_not_single')
  .map((item) => ({ ...item, value: item.value as MessageReportReason }))

function toIncomeTier(value: unknown): IncomeTier | null {
  return value === 'silver' || value === 'gold' || value === 'diamond' ? value : null
}
function isHardcoreAnswer(answer: string): boolean {
  if (!answer) return false
  return HARDCORE_MARKERS.some((kw) => answer.includes(kw))
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface QA {
  question: string
  answer: string
}

interface Profile {
  /** 封鎖／檢舉／互動鍵：實際會員為 uuid；Demo 為 `demo:數字` */
  profileKey: string
  id: number
  gender: 'male' | 'female'
  name: string
  nickname?: string
  age: number
  company: string
  role: string
  department: string
  location: string
  education: string
  bio: string
  interests: string[]
  initials: string
  gradientFrom: string
  gradientTo: string
  compatScore: number
  photoUrl?: string
  /** 多張生活照（URL 或 storage path，與 photoUrl 二選一或並存；有則以本陣列為主） */
  photoUrls?: string[]
  qa: QA[]
  workRegion: Region | null
  homeRegion: Region | null
  incomeTier?: IncomeTier
  showIncomeBorder?: boolean
  userId?: string
  /** 曾對此人送過愛心（RPC 欄位 liked_today；不限 app 日） */
  likedToday?: boolean
  /** 曾對此人送過超喜（RPC 欄位 super_liked_today；不限 app 日） */
  superLikedToday?: boolean
}

export type MainScreenTab = 'discover' | 'matches' | 'instant' | 'profile'
type Tab = MainScreenTab

// ─── Data ─────────────────────────────────────────────────────────────────────

// 探索頁僅用 MATCH_PROFILES（與配對／訊息同源）；已移除舊 PROFILES 僅滑卡假帳。

// Full Profile data for each match so PersonDetailView can render the exact
// same layout as the Discover card. Ids must match MATCH_META entries below.
const MATCH_PROFILES: Profile[] = [
  {
    profileKey: 'demo:101',
    id: 101,
    gender: 'female',
    name: '王雅婷',
    nickname: 'Yating',
    age: 31,
    company: '理律法律事務所',
    role: '律師',
    department: '金融與資本市場組',
    location: '台北',
    education: '台大法律系',
    bio: '習慣把複雜的事拆成小步驟慢慢理清。下班想做相反的事——聽爵士、煮一碗很慢的湯、看一部沒有邏輯的電影。',
    interests: ['爵士樂', '義大利料理', '歐洲電影', '手沖咖啡'],
    initials: '王',
    gradientFrom: '#7c3aed',
    gradientTo: '#6d28d9',
    compatScore: 92,
    workRegion: 'north',
    homeRegion: 'north',
    incomeTier: 'gold',
    showIncomeBorder: true,
    photoUrl: 'https://images.unsplash.com/photo-1773216282433-1d79669534c6?w=640&h=800&fit=crop&q=85',
    photoUrls: [
      'https://images.unsplash.com/photo-1773216282433-1d79669534c6?w=640&h=800&fit=crop&q=85',
      'https://images.unsplash.com/photo-1767786887394-9271ceacf801?w=640&h=800&fit=crop&q=85',
      'https://images.unsplash.com/photo-1759873821395-c29de82a5b99?w=640&h=800&fit=crop&q=85',
    ],
    qa: [
      { question: '你覺得愛情裡最被誤解的事情是什麼？',                  answer: '「我懂你」這三個字。大多數時候我們其實只是投射自己，真正的懂需要長期觀察、而且承認自己的偏見。' },
      { question: '你下班後還在處理工作的事，男友說「妳的工作比我重要嗎？」你怎麼回應？', answer: '這不是重要性的問題，是責任。我會把話題從「比較」拉回「時間分配」，然後真的去做，而不是只說。' },
      { question: '有什麼事情你很少跟人說，但對你影響很大？',             answer: '我在青少年時期花很多時間陪姐姐跑醫院。那段時間我學會怎麼在別人崩潰的時候穩住自己，也讓我對「溫柔」這件事很挑剔。' },
    ],
  },
  {
    profileKey: 'demo:102',
    id: 102,
    gender: 'male',
    name: '劉承恩',
    nickname: '承恩',
    age: 32,
    company: 'TSMC',
    role: '製程研發工程師',
    department: '先進製程 3nm 研發',
    location: '新竹',
    education: '清大材料所',
    bio: '喜歡在細節裡找秩序，也留一點空白給意外。週末常上山呼吸一下，相信有些事情只在稜線上才看得清楚。',
    interests: ['登山', '獨立書店', '威士忌', '露營'],
    initials: '劉',
    gradientFrom: '#0f766e',
    gradientTo: '#0d9488',
    compatScore: 88,
    workRegion: 'north',
    homeRegion: 'north',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&h=900&fit=crop&q=80',
    photoUrls: [
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&h=900&fit=crop&q=80',
      'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=600&h=900&fit=crop&q=80',
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=600&h=900&fit=crop&q=80',
    ],
    qa: [
      { question: '你如何定義「一段健康的關係」？',                     answer: '兩個人都不需要為了維繫關係而縮小自己。可以吵架，但吵完以後彼此更清楚對方是誰。' },
      { question: '工作對你來說的意義是什麼？',                         answer: '是一個能證明自己還在進步的地方。我不覺得工作就是全部，但它是讓我維持敏銳的方式。' },
      { question: '你最近一次真的難過是什麼時候？',                     answer: '阿公走的那天。才發現自己一直以為還有時間——這件事教我別拖延對喜歡的人說的話。' },
    ],
  },
  {
    profileKey: 'demo:103',
    id: 103,
    gender: 'female',
    name: '蔡佩如',
    nickname: '佩如',
    age: 29,
    company: 'MediaTek',
    role: '數位設計工程師',
    department: '數位 IP 設計',
    location: '新竹',
    education: '交大電子所',
    bio: '做事的時候最有條理，煮湯麵的時候最沒原則。喜歡看紀錄片，尤其是關於小鎮與老人的那種。',
    interests: ['紀錄片', '電子音樂', '手沖咖啡', '湯麵'],
    initials: '蔡',
    gradientFrom: '#b45309',
    gradientTo: '#d97706',
    compatScore: 90,
    workRegion: 'north',
    homeRegion: 'central',
    incomeTier: 'silver',
    showIncomeBorder: true,
    photoUrl: 'https://images.unsplash.com/photo-1767786887394-9271ceacf801?w=640&h=800&fit=crop&q=85',
    photoUrls: [
      'https://images.unsplash.com/photo-1767786887394-9271ceacf801?w=640&h=800&fit=crop&q=85',
      'https://images.unsplash.com/photo-1704731267884-91c2a0f6c20e?w=640&h=800&fit=crop&q=85',
      'https://images.unsplash.com/photo-1767396858128-85b1262a7677?w=640&h=800&fit=crop&q=85',
    ],
    qa: [
      { question: '你覺得自己最難相處的那一面是什麼？',                 answer: '我對「不誠實的舒服」很敏感。有人為了不讓氣氛尷尬說些模糊的場面話，我反而更不舒服——會一直追問，直到對方不得不攤牌。' },
      { question: '在感情裡，你最需要的是什麼？',                       answer: '是「不會消失」。不是每天轟轟烈烈，而是對方會在我需要他的那個瞬間還在。這對我比浪漫重要很多。' },
      { question: '如果可以改掉一個過去的決定，你會改嗎？',             answer: '不會。我以前很討厭自己走過的一些彎路，現在發現是那些彎路讓我看見某些人，做出某些選擇。改掉就不是我了。' },
    ],
  },
]

// Lightweight per-row metadata (last message / timestamp / unread count)
const MATCH_META: Record<number, { lastMessage: string; time: string; unread: number }> = {
  101: { lastMessage: '你也喜歡手沖嗎？我最近在練習 V60 ☕', time: '剛剛',    unread: 2 },
  102: { lastMessage: '週末要一起去陽明山嗎？',               time: '14 分鐘', unread: 0 },
  103: { lastMessage: '那部紀錄片我也很想看！',               time: '1 小時',  unread: 1 },
}

// Legacy shape used by existing MatchesTab — now derived from MATCH_PROFILES
const MATCHES = MATCH_PROFILES.map((p) => ({
  id: p.id,
  name: p.nickname ?? p.name,
  company: p.company,
  role: p.role,
  initials: p.initials,
  from: p.gradientFrom,
  to: p.gradientTo,
  ...MATCH_META[p.id],
}))

function findFullProfile(id: number): Profile | null {
  return MATCH_PROFILES.find((p) => p.id === id) ?? null
}

function getPublicName(profile: Pick<Profile, 'nickname' | 'name' | 'id'>): string {
  return profile.nickname?.trim() || `會員 ${profile.id}`
}

/** 探索／詳情標頭：並列顯示工作地、戶籍地方便對照 DB 與期望區域篩選 */
function DiscoverRegionChips({
  profile,
}: {
  profile: Pick<Profile, 'workRegion' | 'homeRegion'>
}) {
  const w = profile.workRegion
  const h = profile.homeRegion
  if (!w && !h) {
    return <InfoChip icon={MapPin} label="地區未填" />
  }
  return (
    <>
      {w ? (
        <InfoChip icon={MapPin} label={`工作地（${REGION_LABELS[w]}）`} />
      ) : null}
      {h ? (
        <InfoChip icon={MapPin} label={`戶籍地（${REGION_LABELS[h]}）`} />
      ) : null}
    </>
  )
}

function hashFromUuid(uuid: string): number {
  let h = 0
  for (let i = 0; i < uuid.length; i++) h = Math.imul(31, h) + uuid.charCodeAt(i) | 0
  return Math.abs(h)
}

function uuidToGradients(uuid: string): { from: string; to: string } {
  const h = hashFromUuid(uuid)
  return {
    from: `hsl(${h % 360} 62% 42%)`,
    to: `hsl(${(h + 42) % 360} 58% 36%)`,
  }
}

/** 與 QuestionnaireScreen（隨機 5 題）一致；卡片／詳情最多呈現幾組問答 */
const QUESTIONNAIRE_QA_CARD_LIMIT = 5

/** 探索／詳情卡不顯示問卷題型標籤用語（舊版種子答案曾嵌入 category）。 */
function scrubQuestionnaireAnswerForDiscover(answer: string): string {
  return answer
    .replaceAll('工作與生活平衡', '日常節奏')
    .replaceAll('未來規劃與自尊', '自我與期待')
    .replaceAll('金錢觀', '理財與取捨')
}

function rpcQuestionnaireToQa(entries: QuestionnaireEntry[] | null | undefined): QA[] {
  const raw = Array.isArray(entries) ? entries : []
  const normalized: QA[] = []
  for (const e of raw) {
    const ex = e as { text?: string; question?: string; answer?: string }
    const q = String(ex.text ?? ex.question ?? '').trim()
    const a = scrubQuestionnaireAnswerForDiscover(String(ex.answer ?? '').trim())
    if (q && a) normalized.push({ question: q, answer: a })
  }
  const out = normalized.slice(0, QUESTIONNAIRE_QA_CARD_LIMIT)
  const pad: QA = { question: '尚未填寫此題', answer: '對方尚未填寫' }
  while (out.length < QUESTIONNAIRE_QA_CARD_LIMIT) out.push(pad)
  return out
}

async function mapDailyDiscoverRow(row: DailyDiscoverRpcRow, slot: number): Promise<Profile> {
  const uid = String(row.id)
  const signed = await resolvePhotoUrls(row.photo_urls ?? [])
  const g = uuidToGradients(uid)
  const h = hashFromUuid(uid)
  const nn = row.nickname?.trim()
  const nm = row.name?.trim() || ''
  const displayNickname = nn || nm.split(/\s+/)[0] || '會員'
  const gender = row.gender === 'male' || row.gender === 'female' ? row.gender : 'female'
  const companyRaw = row.company?.trim()
  const company = companyRaw === 'TSMC' || companyRaw === 'MediaTek' ? companyRaw : (companyRaw || '—')
  const wr = row.work_region as Region | null
  const hr = row.home_region as Region | null
  return {
    profileKey: uid,
    id: slot + 1000,
    userId: uid,
    gender,
    name: nm || displayNickname,
    nickname: displayNickname,
    age: row.age ?? 28,
    company,
    role: row.job_title?.trim() || '會員',
    department: row.department?.trim() || '',
    location: (wr && REGION_LABELS[wr]) || (hr && REGION_LABELS[hr]) || '台灣',
    education: '',
    bio: row.bio?.trim() || '',
    interests: (row.interests ?? []).filter(Boolean),
    initials: (displayNickname[0] || '會'),
    gradientFrom: g.from,
    gradientTo: g.to,
    compatScore: 82 + (h % 14),
    photoUrls: signed,
    qa: rpcQuestionnaireToQa(row.questionnaire ?? null),
    workRegion: wr,
    homeRegion: hr,
    incomeTier: row.income_tier ?? undefined,
    showIncomeBorder: Boolean(row.show_income_border && row.income_tier),
    likedToday: Boolean(row.liked_today),
    superLikedToday: Boolean(row.super_liked_today),
  }
}

function formatDiscoverDeckLoadError(e: unknown): string {
  if (e && typeof e === 'object' && 'name' in e && (e as { name?: string }).name === 'TimeoutError') {
    /** 字串僅用中文與全形標點，避免 iOS 混入英文或斜線時雙向排版打亂順序 */
    return [
      '取得探索名單與相片簽章須在時間內做完，這次逾時。',
      '若是剛從背景回到本程式，請求可能較慢或暫停過。這不一定與無線網路品質有關。',
      '請按下方重試載入。或關掉程式後再開一次。',
    ].join('\n\n')
  }
  if (e instanceof DOMException && e.name === 'AbortError') {
    return [
      '連線被程式主動中止。多半是逾時限制或系統暫停了網頁。',
      '不一定是無線網路斷線。請按下方重試載入。必要時關掉程式再開。',
    ].join('\n\n')
  }
  if (e instanceof Error) {
    const m = e.message.trim()
    if (!m) {
      return '發生錯誤但沒有詳細訊息。請按下方重試載入。仍失敗請關掉程式後重開。'
    }
    if (m === '探索載入逾時' || m.toLowerCase().includes('timeout')) {
      return [
        '整段探索載入逾時。',
        '若您覺得網路正常，多半是回到前景後程式卡住。請重試或關掉程式再開。',
      ].join('\n\n')
    }
    return m.length > 320 ? `${m.slice(0, 320)}…` : m
  }
  const s = String(e).trim()
  if (!s || s === '[object Object]') {
    return '發生未知錯誤。請按下方重試載入。仍失敗請關掉程式後重開。'
  }
  return s.length > 320 ? `${s.slice(0, 320)}…` : s
}

/**
 * iOS PWA 上若只有整頁重載能恢復探索，於首次失敗時自動 reload 一次。
 * `sessionStorage` 避免連續重載；成功載入後 {@link clearDiscoverFailAutoReloadFlag}。
 */
const DISCOVER_FAIL_AUTO_RELOAD_KEY = 'tsmedia_discover_fail_auto_reload_v1'

function clearDiscoverFailAutoReloadFlag(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(DISCOVER_FAIL_AUTO_RELOAD_KEY)
  } catch {
    /* private mode */
  }
}

/** @returns 是否已觸發 reload（呼叫端應略過後續 setState） */
function tryDiscoverFailAutoReload(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (isWithinMediaPickerGracePeriod()) return false
    if (sessionStorage.getItem(DISCOVER_FAIL_AUTO_RELOAD_KEY) === '1') return false
    sessionStorage.setItem(DISCOVER_FAIL_AUTO_RELOAD_KEY, '1')
    markSkipInstantMatchLeaveOnNextFullUnload()
    window.location.reload()
    return true
  } catch {
    return false
  }
}

/** 將資料庫個人檔案轉成配對／聊天詳情用的 Profile（與探索卡版面一致）。 */
async function profileRowToMatchProfile(row: ProfileRow, idSlot: number): Promise<Profile> {
  const uid = row.id
  const signed = await resolvePhotoUrls(row.photo_urls ?? [])
  const g = uuidToGradients(uid)
  const h = hashFromUuid(uid)
  const nn = row.nickname?.trim()
  const nm = row.name?.trim() || ''
  const displayNickname = nn || nm.split(/\s+/)[0] || '會員'
  const gender = row.gender === 'male' || row.gender === 'female' ? row.gender : 'female'
  const companyRaw = row.company?.trim()
  const company = companyRaw === 'TSMC' || companyRaw === 'MediaTek' ? companyRaw : (companyRaw || '—')
  const wr = row.work_region
  const hr = row.home_region
  return {
    profileKey: uid,
    id: idSlot,
    userId: uid,
    gender,
    name: nm || displayNickname,
    nickname: displayNickname,
    age: row.age ?? 28,
    company,
    role: row.job_title?.trim() || '會員',
    department: row.department?.trim() || '',
    location: (wr && REGION_LABELS[wr]) || (hr && REGION_LABELS[hr]) || '台灣',
    education: '',
    bio: row.bio?.trim() || '',
    interests: (row.interests ?? []).filter(Boolean),
    initials: displayNickname.charAt(0) || '會',
    gradientFrom: g.from,
    gradientTo: g.to,
    compatScore: 82 + (h % 14),
    photoUrls: signed,
    qa: rpcQuestionnaireToQa(row.questionnaire ?? null),
    workRegion: wr,
    homeRegion: hr,
    incomeTier: row.income_tier ?? undefined,
    showIncomeBorder: Boolean(row.show_income_border && row.income_tier),
  }
}

function formatMatchListTime(ts: number): string {
  const diffMs = Date.now() - ts
  if (!Number.isFinite(diffMs) || diffMs < 0) return ''
  if (diffMs < 60_000) return '剛剛'
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)} 分鐘前`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3600_000)} 小時前`
  return '近日'
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function CompanyBadge({ company }: { company: string }) {
  const isTsmc = company === 'TSMC'
  const isMtk = company === 'MediaTek'
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide',
      isTsmc
        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 uppercase'
        : isMtk
          ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 uppercase'
          : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
    )}>
      <Cpu className="w-2.5 h-2.5" />
      {company}
    </span>
  )
}

function InfoChip({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5 bg-slate-50 ring-1 ring-slate-100 rounded-full px-3 py-1.5">
      <Icon className="w-3 h-3 text-slate-400" />
      <span className="text-xs text-slate-600 font-medium">{label}</span>
    </div>
  )
}

// ─── Notification Settings Modal ─────────────────────────────────────────────

type NotifKey = 'newMatch' | 'messages' | 'newProfile' | 'weeklyDigest'

interface NotifSettings {
  newMatch: boolean
  messages: boolean
  newProfile: boolean
  weeklyDigest: boolean
}

function NotificationModal({
  onClose,
  userId,
}: {
  onClose: () => void
  userId?: string | null
}) {
  const [settings, setSettings] = useState<NotifSettings>(() => {
    const defaults: NotifSettings = { newMatch: false, messages: false, newProfile: false, weeklyDigest: false }
    try {
      const saved = localStorage.getItem('notif_settings')
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults
    } catch { return defaults }
  })

  // ── Browser notification permission state & test helpers ──────────────
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported'
  )
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [testError, setTestError] = useState<string>('')

  // Detect iOS Safari (not PWA) — Notification API exists only when installed to Home Screen on iOS
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
  const isIOS = /iphone|ipad|ipod/.test(ua)
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      // iOS pre-16.4 legacy flag
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  const iosNeedsInstall = isIOS && !isStandalone

  const requestPerm = async () => {
    if (!supported) return 'unsupported' as const
    try {
      const p = await Notification.requestPermission()
      setPermission(p)
      if (p === 'granted' && userId) void subscribeWebPushForCurrentUser(userId)
      return p
    } catch {
      setPermission('denied')
      return 'denied' as const
    }
  }

  const fireTestNotification = async () => {
    setTestStatus('sending')
    setTestError('')
    try {
      if (!supported) {
        setTestStatus('error')
        setTestError(iosNeedsInstall
          ? '請先把 tsMedia 加到主畫面後再試'
          : '此瀏覽器不支援通知功能')
        return
      }
      let perm = Notification.permission
      if (perm === 'default') perm = await requestPerm() as NotificationPermission
      if (perm !== 'granted') {
        setTestStatus('error')
        setTestError('通知權限未允許，請到裝置設定開啟')
        return
      }
      const title = '測試通知'
      const body  = '如果你看到這則通知，代表通知功能運作正常 ✅'
      const options: NotificationOptions = {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'tsmedia-test',
      }
      // Prefer service-worker notifications (required on iOS PWA & Android Chrome PWA)
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready
        await reg.showNotification(title, options)
      } else {
        new Notification(title, options)
      }
      if (userId) void subscribeWebPushForCurrentUser(userId)
      setTestStatus('sent')
      setTimeout(() => setTestStatus('idle'), 2500)
    } catch (e) {
      setTestStatus('error')
      setTestError(e instanceof Error ? e.message : '發送失敗')
    }
  }

  const toggle = async (key: NotifKey) => {
    // Turning a toggle ON → ask for permission if we haven't yet
    if (!settings[key] && supported && Notification.permission === 'default') {
      await requestPerm()
    }
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem('notif_settings', JSON.stringify(next))
      return next
    })
  }

  const allOff = !Object.values(settings).some(Boolean)

  const items: { key: NotifKey; icon: React.ElementType; label: string; desc: string }[] = [
    { key: 'newMatch',      icon: Heart,    label: '新配對通知',   desc: '配對成功時通知你' },
    { key: 'messages',      icon: MessageCircle, label: '新訊息通知', desc: '收到新訊息時通知你' },
    { key: 'newProfile',    icon: Users,    label: '新推薦通知',   desc: '有新的高契合度對象時通知你' },
    { key: 'weeklyDigest',  icon: Star,     label: '每週精選摘要', desc: '每週一匯總你的配對概況' },
  ]

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[200] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 340, damping: 38 }}
        className="w-full max-w-md bg-white rounded-t-3xl px-5 pt-5 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-5" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {allOff ? <BellOff className="w-5 h-5 text-slate-400" /> : <Bell className="w-5 h-5 text-slate-800" />}
            <span className="text-[17px] font-bold text-slate-900">通知設定</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Permission status banner */}
        <div
          className={cn(
            'mb-4 p-3.5 rounded-2xl flex items-start gap-3',
            permission === 'granted'
              ? 'bg-emerald-50 ring-1 ring-emerald-100'
              : permission === 'denied'
              ? 'bg-red-50 ring-1 ring-red-100'
              : 'bg-amber-50 ring-1 ring-amber-100'
          )}
        >
          {permission === 'granted' ? (
            <BellRing className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className={cn('w-5 h-5 flex-shrink-0 mt-0.5', permission === 'denied' ? 'text-red-500' : 'text-amber-500')} />
          )}
          <div className="flex-1 min-w-0 text-[12px] leading-relaxed">
            {permission === 'granted' && <span className="text-emerald-800">已取得通知權限，你可以收到推播</span>}
            {permission === 'denied'  && <span className="text-red-700">通知被封鎖，請到裝置設定 → tsMedia → 通知 開啟</span>}
            {permission === 'default' && <span className="text-amber-800">尚未取得通知權限，開啟任一項目或點下方按鈕以授權</span>}
            {permission === 'unsupported' && (
              <span className="text-amber-800">
                {iosNeedsInstall
                  ? '此瀏覽器尚未支援通知。iOS 請先將 tsMedia 加到主畫面'
                  : '此裝置或瀏覽器不支援通知功能'}
              </span>
            )}
          </div>
        </div>

        {/* Test notification button */}
        <button
          onClick={fireTestNotification}
          disabled={testStatus === 'sending'}
          className={cn(
            'w-full mb-5 py-3 rounded-2xl font-semibold text-sm transition-all flex items-center justify-center gap-2',
            testStatus === 'sent'
              ? 'bg-emerald-500 text-white'
              : testStatus === 'error'
              ? 'bg-red-500 text-white'
              : 'bg-slate-900 text-white active:scale-[0.98]',
          )}
        >
          {testStatus === 'idle'    && <><BellRing className="w-4 h-4" /> 發送測試通知</>}
          {testStatus === 'sending' && <>發送中</>}
          {testStatus === 'sent'    && <><Check className="w-4 h-4" /> 已發送！請查看通知</>}
          {testStatus === 'error'   && <><AlertCircle className="w-4 h-4" /> {testError || '發送失敗'}</>}
        </button>

        {/* Items */}
        <div className="space-y-3">
          {items.map(({ key, icon: Icon, label, desc }) => (
            <div key={key} className="flex items-center gap-4 p-3.5 rounded-2xl bg-slate-50">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', settings[key] ? 'bg-slate-900' : 'bg-slate-200')}>
                <Icon className={cn('w-5 h-5', settings[key] ? 'text-white' : 'text-slate-400')} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">{label}</p>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{desc}</p>
              </div>
              {/* Toggle */}
              <button
                onClick={() => toggle(key)}
                className={cn(
                  'w-12 h-6.5 rounded-full relative transition-colors flex-shrink-0',
                  settings[key] ? 'bg-slate-900' : 'bg-slate-200'
                )}
                style={{ width: 48, height: 26 }}
              >
                <motion.div
                  animate={{ x: settings[key] ? 22 : 2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  className="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm"
                />
              </button>
            </div>
          ))}
        </div>

        {/* Note */}
        <p className="text-[11px] text-slate-400 text-center mt-5 leading-relaxed">
          通知功能需在裝置設定中允許「tsMedia」發送通知
        </p>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

function ReportProfileModal({
  target,
  onClose,
}: {
  target: {
    profileKey: string
    displayName: string
    userId?: string | null
  }
  onClose: () => void
}) {
  const [reason, setReason] = useState<ReportReason>('fake_profile')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const submit = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await submitProfileReport({
        reportedProfileKey: target.profileKey,
        reportedUserId: target.userId ?? null,
        reportedDisplayName: target.displayName,
        reason,
        details,
      })
      if (!result.ok) {
        setStatus({ type: 'error', message: result.error ?? '送出失敗，請稍後再試。' })
        return
      }
      setStatus({ type: 'success', message: '已收到檢舉，我們會盡快審查。' })
      window.setTimeout(onClose, 900)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[240] flex items-end justify-center bg-slate-950/55 px-4 pb-4 pt-10"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 24, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
        className="flex max-h-[84dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-50">
              <Flag className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">檢舉 {target.displayName}</h2>
              <p className="text-xs text-slate-400">平台會保密你的檢舉者身分</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          <p className="mb-3 text-xs font-bold tracking-[0.18em] text-slate-400 uppercase">檢舉原因</p>
          <div className="space-y-2">
            {REPORT_REASONS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setReason(item.value)}
                className={cn(
                  'w-full rounded-2xl px-4 py-3 text-left ring-1 transition-all',
                  reason === item.value ? 'bg-slate-900 text-white ring-slate-900' : 'bg-slate-50 text-slate-700 ring-slate-100',
                )}
              >
                <span className="block text-sm font-bold">{item.label}</span>
                <span className={cn('mt-0.5 block text-[11px] leading-relaxed', reason === item.value ? 'text-white/60' : 'text-slate-400')}>
                  {item.desc}
                </span>
              </button>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="text-xs font-bold tracking-[0.18em] text-slate-400 uppercase">補充說明</span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={4}
              placeholder="可以補充發生時間、對話內容、可疑行為等。"
              className="mt-2 w-full resize-none rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none ring-1 ring-slate-100 placeholder:text-slate-300 focus:ring-slate-300"
            />
          </label>

          {status && (
            <div className={cn(
              'mt-3 rounded-2xl px-3 py-2 text-xs font-semibold',
              status.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600',
            )}>
              {status.message}
            </div>
          )}
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl bg-slate-100 py-3 text-sm font-bold text-slate-500"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex-1 rounded-2xl bg-red-500 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? '送出中' : '送出檢舉'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

function BlockProfileConfirm({
  target,
  onClose,
  onBlocked,
}: {
  target: {
    profileKey: string
    displayName: string
    userId?: string | null
  }
  onClose: () => void
  onBlocked?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await blockProfile({
        blockedProfileKey: target.profileKey,
        blockedUserId: target.userId ?? null,
        blockedDisplayName: target.displayName,
        reason: 'user_block',
      })
      if (!result.ok) {
        setError(result.error ?? '封鎖失敗，請稍後再試。')
        return
      }
      onBlocked?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[245] flex items-center justify-center bg-slate-950/55 px-5"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, y: 10, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 8, opacity: 0 }}
        className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50">
          <Ban className="h-6 w-6 text-red-500" />
        </div>
        <h2 className="text-base font-black text-slate-900">封鎖 {target.displayName}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          封鎖後你們將不能看到彼此、不能配對，也不能繼續聊天。這個動作可以保護你的隱私與安全。
        </p>
        {error && <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={onClose} className="rounded-2xl bg-slate-100 py-3 text-sm font-bold text-slate-500">
            取消
          </button>
          <button onClick={submit} disabled={busy} className="rounded-2xl bg-red-500 py-3 text-sm font-bold text-white disabled:opacity-60">
            {busy ? '處理中' : '確認封鎖'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

function ReportMessageModal({
  target,
  onClose,
}: {
  target: {
    displayName: string
    messageBody: string
    reportedProfileKey?: string | null
    reportedUserId?: string | null
    messageId?: string | null
    matchId?: string | null
  }
  onClose: () => void
}) {
  const [reason, setReason] = useState<MessageReportReason>('harassment')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await submitMessageReport({
        reason,
        details,
        messageBody: target.messageBody,
        reportedProfileKey: target.reportedProfileKey ?? null,
        reportedUserId: target.reportedUserId ?? null,
        reportedDisplayName: target.displayName,
        messageId: target.messageId ?? null,
        matchId: target.matchId ?? null,
      })
      if (!result.ok) {
        setStatus(result.error ?? '送出失敗，請稍後再試。')
        return
      }
      setStatus('已收到訊息檢舉，我們會盡快審查。')
      window.setTimeout(onClose, 900)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[246] flex items-end justify-center bg-slate-950/55 px-4 pb-4 pt-10"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 24, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.98 }}
        className="flex max-h-[84dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-black text-slate-900">檢舉訊息</h2>
          <p className="mt-1 text-xs text-slate-400">對象：{target.displayName}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-bold text-slate-400">被檢舉訊息</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{target.messageBody}</p>
          </div>
          {MESSAGE_REPORT_REASONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setReason(item.value)}
              className={cn(
                'w-full rounded-2xl px-4 py-3 text-left ring-1 transition-all',
                reason === item.value ? 'bg-slate-900 text-white ring-slate-900' : 'bg-slate-50 text-slate-700 ring-slate-100',
              )}
            >
              <span className="block text-sm font-bold">{item.label}</span>
              <span className={cn('mt-0.5 block text-[11px] leading-relaxed', reason === item.value ? 'text-white/60' : 'text-slate-400')}>
                {item.desc}
              </span>
            </button>
          ))}
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
            placeholder="補充說明，選填"
            className="w-full resize-none rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none ring-1 ring-slate-100 placeholder:text-slate-300 focus:ring-slate-300"
          />
          {status && <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{status}</p>}
        </div>
        <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="flex-1 rounded-2xl bg-slate-100 py-3 text-sm font-bold text-slate-500">取消</button>
          <button onClick={submit} disabled={busy} className="flex-1 rounded-2xl bg-red-500 py-3 text-sm font-bold text-white disabled:opacity-60">
            {busy ? '送出中' : '送出檢舉'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

function collectProfilePhotoUrls(p: Profile): string[] {
  const list = (p.photoUrls ?? []).map((u) => String(u).trim()).filter(Boolean)
  if (list.length > 0) return list
  if (p.photoUrl) return [p.photoUrl]
  return []
}

const DISCOVER_DECK_PROFILE_CACHE_VERSION = 3 as const

function readDiscoverDeckProfileCache(uid: string, dayKey: string): Profile[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(discoverDeckLocalStorageKey(uid, dayKey))
    if (!raw) return []
    const o = JSON.parse(raw) as { v?: number; profiles?: unknown }
    if (o.v !== DISCOVER_DECK_PROFILE_CACHE_VERSION || !Array.isArray(o.profiles)) return []
    return o.profiles as Profile[]
  } catch {
    return []
  }
}

function writeDiscoverDeckProfileCache(uid: string, dayKey: string, profiles: Profile[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      discoverDeckLocalStorageKey(uid, dayKey),
      JSON.stringify({
        v: DISCOVER_DECK_PROFILE_CACHE_VERSION,
        t: Date.now(),
        profiles,
      }),
    )
  } catch {
    /* quota / private mode */
  }
}

/** 名單最前面連續累計至多 `max` 張相片 URL（用於預載）。 */
function collectTopDiscoverPhotoUrls(profiles: Profile[], max = 3): string[] {
  const out: string[] = []
  outer: for (const p of profiles) {
    for (const u of collectProfilePhotoUrls(p)) {
      const s = String(u).trim()
      if (s) out.push(s)
      if (out.length >= max) break outer
    }
  }
  return out
}

function preloadDiscoverImageUrls(urls: readonly string[]): void {
  if (typeof window === 'undefined') return
  for (const u of urls) {
    const img = new Image()
    try {
      if ('fetchPriority' in img) {
        ;(img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high'
      }
    } catch {
      /* ignore */
    }
    img.decoding = 'async'
    img.src = u
  }
}

const DEMO_PUZZLE_CLEARED_KEY = 'tsm-demo-puzzle-cleared-slots'

function discoverChatPuzzleIntroStorageKey(userId: string) {
  return `tsm-discover-chat-puzzle-intro:v1:${userId}`
}

function hasSeenDiscoverChatPuzzleIntro(userId: string): boolean {
  try {
    return Boolean(localStorage.getItem(discoverChatPuzzleIntroStorageKey(userId)))
  } catch {
    return false
  }
}

/** iOS 無痕／容量滿時 setItem 可能拋錯；關 modal 不應依賴寫入成功。 */
function markDiscoverChatPuzzleIntroSeen(userId: string): void {
  try {
    localStorage.setItem(discoverChatPuzzleIntroStorageKey(userId), '1')
  } catch {
    /* ignore */
  }
}

function loadDemoPuzzleClearedSlots(): Record<number, number[]> {
  try {
    const raw = sessionStorage.getItem(DEMO_PUZZLE_CLEARED_KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as Record<string, number[]>
    const out: Record<number, number[]> = {}
    for (const k of Object.keys(o)) {
      const id = Number(k)
      if (!Number.isFinite(id)) continue
      out[id] = o[k] ?? []
    }
    return out
  } catch {
    return {}
  }
}

function persistDemoPuzzleClearedSlots(map: Record<number, number[]>) {
  try {
    sessionStorage.setItem(DEMO_PUZZLE_CLEARED_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

/** 探索／個人檔案頂部：多張生活照左右滑或點圓點切換（單張時與原先相同） */
function BlurredProfilePhotoSlideshow({
  profileKey,
  photoUrls,
  alt,
  gradientFrom,
  gradientTo,
  variant,
  compatScore,
  onReportClick,
  unblockedIndices,
  /** 探索：前 N 張 slide 使用 `fetchPriority="high"`（搭配 `preloadDiscoverImageUrls`）。 */
  highFetchPrioritySlideCount = 0,
}: {
  profileKey: string | number
  photoUrls: string[]
  alt: string
  gradientFrom: string
  gradientTo: string
  variant: 'discover' | 'detail'
  compatScore?: number
  onReportClick: () => void
  /** 在聊天中已完整解鎖的相片的索引（0-based），不套用模糊。 */
  unblockedIndices?: ReadonlySet<number> | number[]
  highFetchPrioritySlideCount?: number
}) {
  const [index, setIndex] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const n = photoUrls.length
  const clearSet =
    unblockedIndices instanceof Set
      ? unblockedIndices
      : new Set(unblockedIndices ?? [])

  useEffect(() => {
    setIndex(0)
  }, [profileKey, photoUrls.join('|')])

  const step = (delta: number) => {
    if (n <= 1) return
    setIndex((i) => (i + delta + n) % n)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null || n <= 1) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (dx < -56) step(1)
    else if (dx > 56) step(-1)
  }

  const showPrivacy = n > 0
  const privacyClass =
    variant === 'discover'
      ? 'absolute z-[25] flex items-center gap-1.5 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5'
      : 'absolute top-4 left-4 z-[25] flex items-center gap-1.5 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5'
  const privacyStyle = variant === 'discover' ? { left: '1rem', bottom: '1rem' } : undefined

  return (
    <div
      className="relative w-full flex-shrink-0 overflow-hidden rounded-[0.8rem]"
      style={{ paddingBottom: '150%' }}
    >
      <div
        className="absolute inset-0 overflow-hidden rounded-[0.8rem]"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {n === 0 ? (
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(160deg, ${gradientFrom}, ${gradientTo})` }}
          />
        ) : (
          photoUrls.map((src, i) => (
            <img
              key={`${profileKey}-ph-${i}`}
              src={src}
              alt=""
              fetchPriority={
                variant === 'discover' && highFetchPrioritySlideCount > 0 && i < highFetchPrioritySlideCount
                  ? 'high'
                  : undefined
              }
              className={cn(
                'absolute inset-0 h-full w-full object-cover scale-[1.04] transition-opacity duration-200',
                i === index ? 'z-[1] opacity-100' : 'z-0 opacity-0 pointer-events-none',
              )}
              style={clearSet.has(i) ? undefined : { filter: 'blur(6px)' }}
              draggable={false}
            />
          ))
        )}

        <div className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              className="absolute left-1 top-1/2 z-[22] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm active:bg-black/50"
              aria-label="上一張"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              className="absolute right-1 top-1/2 z-[22] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm active:bg-black/50"
              aria-label="下一張"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="pointer-events-none absolute bottom-3 left-0 right-0 z-[22] flex flex-col items-center gap-1">
              <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/35 px-2 py-1 backdrop-blur-md">
                {photoUrls.map((_, i) => (
                  <button
                    key={`dot-${profileKey}-${i}`}
                    type="button"
                    onClick={() => setIndex(i)}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/45',
                    )}
                    aria-label={`第 ${i + 1} 張，共 ${n} 張`}
                  />
                ))}
              </div>
              <span className="text-[10px] font-bold tabular-nums text-white/90 drop-shadow">
                {index + 1} / {n}
              </span>
            </div>
          </>
        )}

        {showPrivacy && (
          <div className={privacyClass} style={privacyStyle}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-semibold text-white/90">隱私保護中</span>
          </div>
        )}

        {variant === 'discover' && (
          <button
            type="button"
            onClick={onReportClick}
            className="absolute left-4 top-4 z-[30] flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 text-[10px] font-semibold text-white/85 backdrop-blur-md active:bg-black/45"
          >
            <Flag className="h-3.5 w-3.5" />
            檢舉
          </button>
        )}

        {variant === 'detail' && compatScore != null && (
          <div className="absolute bottom-4 right-4 z-[25] flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-amber-300" />
            <span className="text-sm font-bold text-white">{compatScore}% 契合</span>
          </div>
        )}
      </div>
      <span className="sr-only">{alt}</span>
    </div>
  )
}

/** 探索卡片 UI（目前第幾張、是否看完、是否已捲過說明）：切開分頁時 DiscoverTab 會卸載，用此還原避免每次都回到第一張。 */
let discoverUiSessionCache: {
  userId: string
  dayKey: string
  deckRefresh: number
  cardIndex: number
  done: boolean
  scrolled: boolean
} | null = null

function takeDiscoverUiSnapshot(
  uid: string | undefined,
  dayKey: string,
  refreshTick: number,
): { cardIndex: number; done: boolean; scrolled: boolean } | null {
  const c = discoverUiSessionCache
  if (!uid || !c || c.userId !== uid || c.dayKey !== dayKey || c.deckRefresh !== refreshTick) return null
  return { cardIndex: c.cardIndex, done: c.done, scrolled: c.scrolled }
}

/** 每晚 10 點換日後，探索名單重載時的短暫慶祝動畫（置於相對定位容器內） */
function DiscoverDeckRolloverOverlay({ open, tick }: { open: boolean; tick: number }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key={tick}
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28 }}
        >
          <motion.div
            initial={{ scale: 0.88, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: -10, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className="max-w-[17rem] rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-6 py-5 text-center shadow-2xl ring-1 ring-white/10"
          >
            <motion.div
              animate={{ rotate: [0, -8, 8, -6, 6, 0] }}
              transition={{ duration: 0.85, ease: 'easeInOut' }}
              className="inline-flex"
            >
              <Sparkles className="w-9 h-9 text-amber-300" />
            </motion.div>
            <p className="mt-3 text-lg font-black text-white tracking-tight">今日探索已更新</p>
            <p className="mt-1.5 text-xs font-medium text-white/70 leading-relaxed">
              每晚 10 點換日 · 配對名單已重新產生
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Discover Tab ─────────────────────────────────────────────────────────────
function DiscoverTab({
  userId,
  discoverDeckDayKey,
  discoverDeckRolloverTick,
  foregroundReloadNonce,
  currentUserGender,
  preferredRegion,
  contentScrollRef,
  creditBalance,
  onOpenSubscription,
  refreshCredits,
  onCreditAction,
  onDiscoverMatch,
}: {
  userId?: string
  /** 與主畫面同步的 app 日（每晚 10 點換日），換日時會重抓探索名單 */
  discoverDeckDayKey: string
  /** 每次換日遞增，供換日動畫只播一次 */
  discoverDeckRolloverTick: number
  /** 回前景喚醒 auth 後遞增；搭配 deckRefresh bump 重抓探索並重設卡片進度 */
  foregroundReloadNonce: number
  currentUserGender: 'male' | 'female'
  preferredRegion: import('@/lib/types').Region | null
  contentScrollRef?: React.RefObject<HTMLDivElement | null>
  creditBalance: CreditBalance
  onOpenSubscription: () => void
  refreshCredits: () => void
  /** 成功送出愛心／超級喜歡後（扣款成功），供全螢幕獎勵動畫。 */
  onCreditAction?: (kind: 'like' | 'super_like') => void
  /** 伺服器回傳已配對時刷新配對／聊天列表（Realtime 亦會更新） */
  onDiscoverMatch?: () => void
}) {
  // Men see female profiles, women see male profiles (demo 另以 preferredRegion 篩選；已登入者由伺服器每日 6 人＋區域邏輯）
  const [blockedKeys, setBlockedKeys] = useState<string[]>([])
  const initialDiscoverCache =
    typeof window !== 'undefined' && userId
      ? readDiscoverDeckProfileCache(userId, discoverDeckDayKey)
      : []
  const [liveDeck, setLiveDeck] = useState<Profile[]>(() => initialDiscoverCache)
  const [liveDeckStatus, setLiveDeckStatus] = useState<'idle' | 'loading' | 'ready'>(() =>
    initialDiscoverCache.length > 0 ? 'ready' : 'idle',
  )
  /** RPC／逾時／例外時直接顯示在探索頁，方便 iOS 使用者回報 */
  const [deckLoadDiagnostic, setDeckLoadDiagnostic] = useState<string | null>(null)
  /** 探索載入失敗時，逐鍵診斷哪種恢復方式有效 */
  const [deckRecoverBusy, setDeckRecoverBusy] = useState<string | null>(null)
  const [deckRecoverTip, setDeckRecoverTip] = useState<string | null>(null)
  const [deckRefresh, setDeckRefresh] = useState(0)
  const liveDeckRef = useRef<Profile[]>([])
  liveDeckRef.current = liveDeck
  const lastDeckFetchCtxRef = useRef<{ uid: string; dk: string } | null>(null)
  /** `deckRefresh` 短時間連續 bump 時忽略前一輪 async，避免重複 RPC／setState 幽靈競態 */
  const deckLoadEpochRef = useRef(0)
  /** 中止「上一輪仍在 await 的探索 RPC」——僅 bump epoch 無法解 WebKit 卡住中的 fetch。 */
  const discoverDeckRpcFlightRef = useRef<AbortController | null>(null)
  const discoverUiSnap = userId ? takeDiscoverUiSnapshot(userId, discoverDeckDayKey, deckRefresh) : null
  const [celebrateDeck, setCelebrateDeck] = useState(false)
  const prevRolloverTickRef = useRef(0)
  const prevDiscoverUserIdRef = useRef(userId)
  const prevDeckRefreshRef = useRef<number | null>(null)

  useEffect(() => {
    if (prevDiscoverUserIdRef.current !== userId) {
      prevDiscoverUserIdRef.current = userId
      prevRolloverTickRef.current = discoverDeckRolloverTick
    }
  }, [userId, discoverDeckRolloverTick])

  const demoBase = useMemo(
    () => MATCH_PROFILES.filter((p) => {
      if (p.gender === currentUserGender) return false
      if (!preferredRegion) return true
      return p.workRegion === preferredRegion || p.homeRegion === preferredRegion
    }),
    [currentUserGender, preferredRegion],
  )

  /** 換帳號／換日：從 localStorage 拉回上一輪成功的名單，避免進探索先看到全屏轉圈（與 RPC 並行 SWR）。 */
  useLayoutEffect(() => {
    if (!userId) {
      setLiveDeck([])
      setLiveDeckStatus('idle')
      return
    }
    const cached = readDiscoverDeckProfileCache(userId, discoverDeckDayKey)
    setLiveDeck(cached)
    setLiveDeckStatus(cached.length > 0 ? 'ready' : 'idle')
  }, [userId, discoverDeckDayKey])

  const baseList = userId ? liveDeck : demoBase

  const visibleProfiles = useMemo(
    () => baseList.filter((p) => {
      if (blockedKeys.includes(p.profileKey)) return false
      if (p.userId && blockedKeys.includes(`user:${p.userId}`)) return false
      // 未登入 Demo：依目前性別偏好篩異性。已登入：名單已由 get_daily_discover_deck_v2 篩過，
      // 不可再用可能尚未同步的 currentUserGender 過濾，否則女性帳在預設 male 時會被濾成 0 人。
      if (!userId && p.gender === currentUserGender) return false
      return true
    }),
    [baseList, blockedKeys, currentUserGender, userId],
  )

  const discoverTopPhotosSig = useMemo(
    () => JSON.stringify(collectTopDiscoverPhotoUrls(visibleProfiles, 3)),
    [visibleProfiles],
  )

  useEffect(() => {
    if (!userId) return
    let urls: string[] = []
    try {
      urls = JSON.parse(discoverTopPhotosSig) as string[]
    } catch {
      return
    }
    if (!Array.isArray(urls) || urls.length === 0) return
    preloadDiscoverImageUrls(urls)
  }, [userId, discoverTopPhotosSig])

  const [index, setIndex] = useState(() => discoverUiSnap?.cardIndex ?? 0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [done, setDone] = useState(() => discoverUiSnap?.done ?? false)
  const [scrolled, setScrolled] = useState(() => discoverUiSnap?.scrolled ?? false)
  const [showNotifModal, setShowNotifModal] = useState(false)
  const [showNotifPrompt, setShowNotifPrompt] = useState(false)
  const [confirmIntent, setConfirmIntent] = useState<null | 'like' | 'super_like'>(null)
  const [reportTarget, setReportTarget] = useState<{ profileKey: string; displayName: string; userId?: string | null } | null>(null)
  const [blockTarget, setBlockTarget] = useState<{ profileKey: string; displayName: string; userId?: string | null } | null>(null)
  const cardScrollRef = useRef<HTMLDivElement | null>(null)
  const skipDiscoverIndexScrollResetRef = useRef(true)
  /** 前景 nonce 往往在數百毫秒內連跳 2〜4（mount ensure + invalidate + visibility debounce）；每次 bump deck 會拆掉上一輪探索 async → 只看到「略過 stale」。合併成單次 bump */
  /** DOM timer；勿用 `ReturnType<typeof setTimeout>`（與 @types/node 會衝突為 NodeJS.Timeout） */
  const discoverDeckBumpTimerRef = useRef<number | null>(null)
  /** 回前景／視窗時若仍卡在載入上一輪可能已被 Abort，補 bump（節流避免連打） */
  const deckWakeBumpStatusRef = useRef(liveDeckStatus)
  deckWakeBumpStatusRef.current = liveDeckStatus
  const lastDeckWakeBumpAtRef = useRef(0)

  useEffect(() => {
    if (!userId) return
    const maybeBumpAfterWake = () => {
      if (document.visibilityState !== 'visible') return
      if (deckWakeBumpStatusRef.current !== 'loading') return
      const now = Date.now()
      if (now - lastDeckWakeBumpAtRef.current < 700) return
      lastDeckWakeBumpAtRef.current = now
      setDeckRefresh((r) => r + 1)
    }
    document.addEventListener('visibilitychange', maybeBumpAfterWake)
    window.addEventListener('focus', maybeBumpAfterWake)
    return () => {
      document.removeEventListener('visibilitychange', maybeBumpAfterWake)
      window.removeEventListener('focus', maybeBumpAfterWake)
    }
  }, [userId])

  useEffect(() => {
    if (foregroundReloadNonce === 0) return
    if (discoverDeckBumpTimerRef.current) window.clearTimeout(discoverDeckBumpTimerRef.current)
    discoverDeckBumpTimerRef.current = window.setTimeout(() => {
      discoverDeckBumpTimerRef.current = null
      setDeckRefresh((r) => r + 1)
    }, 320)
    return () => {
      if (discoverDeckBumpTimerRef.current) {
        window.clearTimeout(discoverDeckBumpTimerRef.current)
        discoverDeckBumpTimerRef.current = null
      }
    }
  }, [foregroundReloadNonce])

  useEffect(() => {
    if (visibleProfiles.length === 0) return
    setIndex((i) => Math.min(i, visibleProfiles.length - 1))
  }, [visibleProfiles.length])

  // On first visit to Discover each session, prompt user to enable notifications
  // until they actually grant permission.
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission === 'granted') return
    const dismissed = sessionStorage.getItem('notif_prompt_dismissed') === '1'
    if (dismissed) return
    // Small delay so the card animation settles first
    const t = setTimeout(() => setShowNotifPrompt(true), 600)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    getMyBlockedProfileKeys().then(setBlockedKeys)
  }, [userId])

  // 父層 foreground nonce 在 JWT 換發後才遞增：關浮層 + 輕推 scroll（合併減少與 auth / vv 競態）。
  useEffect(() => {
    if (foregroundReloadNonce === 0) return
    setConfirmIntent(null)
    setShowNotifModal(false)
    setShowNotifPrompt(false)
    setReportTarget(null)
    setBlockTarget(null)
    requestAnimationFrame(() => {
      const el = cardScrollRef.current
      if (el) {
        const t = el.scrollTop
        el.scrollTop = t > 0 ? t - 1 : 1
        el.scrollTop = t
      }
      const outer = contentScrollRef?.current
      if (outer) {
        const ot = outer.scrollTop
        outer.scrollTop = ot > 0 ? ot - 1 : 1
        outer.scrollTop = ot
      }
    })
  }, [foregroundReloadNonce, contentScrollRef])

  // 探索名單：每次都打 RPC；若為同一 user／同日且畫面上已有 deck（例如回前景），不清空 UI — stale-while-revalidate。
  useEffect(() => {
    if (!userId) {
      discoverDeckRpcFlightRef.current?.abort()
      discoverDeckRpcFlightRef.current = null
      lastDeckFetchCtxRef.current = null
      setLiveDeckStatus('idle')
      setLiveDeck([])
      setDeckLoadDiagnostic(null)
      clearDiscoverFailAutoReloadFlag()
      return
    }

    const snap = { uid: userId, dk: discoverDeckDayKey }
    const prev = lastDeckFetchCtxRef.current
    const ctxChangedEarly = !prev || prev.uid !== snap.uid || prev.dk !== snap.dk
    /** 換人／換日立即載入；僅 deckRefresh bump 須蓋過前景換發第二下（320ms）並留余量。 */
    const debounceMs = ctxChangedEarly ? 0 : 580

    let cancelledOuter = false
    /**
     * 舊版把 `ensureConnectionWithBudget`（約 5.5s）與 RPC／簽章塞進同一個 22s race，常導致
     * `work:即將請求探索RPC` 後還沒等到 PostgREST 就被整段判逾時。此值只限制 **ensure 之後** 的 RPC+簽章。
     * （勿再對 RPC 另行 30s `raceWithBudgetMs`——會與 global fetch28s／計時漂移撞車，只看到假逾時。）
     * iOS 回前景時 RPC 可能重試多輪（各最多 ~28s）＋並行簽數張相片；過短會只看到假「探索載入逾時」。
     */
    const DECK_POST_ENSURE_BUDGET_MS = 78_000

    const timer = window.setTimeout(() => {
      queueMicrotask(() => {
        if (cancelledOuter) return

        discoverDeckRpcFlightRef.current?.abort()
        discoverDeckRpcFlightRef.current = new AbortController()
        const rpcFlightSig = discoverDeckRpcFlightRef.current.signal

        const ctx = { uid: userId, dk: discoverDeckDayKey }
        const keepStaleVisible =
          liveDeckRef.current.length > 0 &&
          (lastDeckFetchCtxRef.current == null ||
            (lastDeckFetchCtxRef.current.uid === ctx.uid &&
              lastDeckFetchCtxRef.current.dk === ctx.dk))
        lastDeckFetchCtxRef.current = ctx

        if (keepStaleVisible) {
          /** 前景靜默重抓時維持 ready，免得上一輪 loading 卡住全屏轉圈 */
          setLiveDeckStatus('ready')
        }

        const myEpoch = ++deckLoadEpochRef.current

        actionTrace('discover.deck', 'effect:開始', {
          uid: shortId(userId),
          dk: discoverDeckDayKey,
          deckRefresh,
          keepStaleVisible,
          myEpoch,
        })

        if (!keepStaleVisible) {
          setLiveDeckStatus('loading')
          setLiveDeck([])
          setDeckLoadDiagnostic(null)
        }

        let phase: 'rpc' | 'photos' = 'rpc'

        void (async () => {
          try {
            const work = async () => {
              const perfNow = () =>
                typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
              actionTrace('discover.deck', 'work:進入', { phase: 'pre-ensure', myEpoch })
              if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                await ensureConnectionWithBudget()
              }
              /** SWR 背景層：靜默觸發 PostgREST（與 RPC 並行，不阻塞 UI）。 */
              if (userId) {
                void supabase.from('profiles').select('id').eq('id', userId).limit(1).maybeSingle()
              }
              actionTrace('discover.deck', 'work:ensureConnection 結束', { myEpoch })
              if (cancelledOuter || deckLoadEpochRef.current !== myEpoch) {
                actionTrace('discover.deck', 'work:ensure 後略過 stale', {
                  cancelled: cancelledOuter,
                  myEpoch,
                  cur: deckLoadEpochRef.current,
                })
                return
              }

              let postEnsureTimeoutId: number | null = null
              const deckTimeoutErr = Object.assign(new Error('探索載入逾時'), { name: 'TimeoutError' })
              try {
                await Promise.race([
                  (async () => {
                    actionTrace('discover.deck', 'work:即將請求探索RPC', { myEpoch })
                    const tRpc = perfNow()
                    const { rows, rpcError } = await fetchDailyDiscoverDeck({
                      skipWake: true,
                      rpcFlightSignal: rpcFlightSig,
                    })
                    if (cancelledOuter || deckLoadEpochRef.current !== myEpoch) {
                      actionTrace('discover.deck', 'work:RPC 後略過 stale', {
                        ms: Math.round(perfNow() - tRpc),
                        myEpoch,
                      })
                      return
                    }
                    actionTrace('discover.deck', 'work:RPC 回來', {
                      ms: Math.round(perfNow() - tRpc),
                      rowCount: rows.length,
                      rpcErr: rpcError ? rpcError.slice(0, 80) : null,
                      myEpoch,
                    })
                    if (rpcError) {
                      if (cancelledOuter || deckLoadEpochRef.current !== myEpoch) return
                      if (tryDiscoverFailAutoReload()) return
                      const detail = rpcError.trim() || '（伺服器未附說明）'
                      setDeckLoadDiagnostic(['【探索名單】伺服器錯誤', detail].join('\n\n'))
                      if (!keepStaleVisible) setLiveDeck([])
                      setLiveDeckStatus('ready')
                      actionTrace('discover.deck', 'work:RPC 錯誤結束（UI ready）', {})
                      return
                    }
                    phase = 'photos'
                    const tPhotos = perfNow()
                    const profiles = await Promise.all(
                      rows.map(async (r, i) => {
                        actionTrace('discover.deck', 'mapRow:開始', {
                          i,
                          pid: shortId(String(r.id)),
                          photoPaths: (r.photo_urls ?? []).length,
                        })
                        try {
                          const p = await mapDailyDiscoverRow(r, i)
                          actionTrace('discover.deck', 'mapRow:結束', {
                            i,
                            pid: shortId(String(r.id)),
                            outPhotos: p.photoUrls?.length ?? 0,
                          })
                          return p
                        } catch (e) {
                          actionTrace('discover.deck', 'mapRow:例外', {
                            i,
                            msg: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
                          })
                          throw e
                        }
                      }),
                    )
                    if (cancelledOuter || deckLoadEpochRef.current !== myEpoch) {
                      actionTrace('discover.deck', 'work:簽章後略過 stale', {
                        cancelled: cancelledOuter,
                        mapMs: Math.round(perfNow() - tPhotos),
                        myEpoch,
                        cur: deckLoadEpochRef.current,
                      })
                      return
                    }
                    actionTrace('discover.deck', 'work:setState 前', {
                      profileCount: profiles.length,
                      mapMs: Math.round(perfNow() - tPhotos),
                      myEpoch,
                    })
                    setDeckLoadDiagnostic(null)
                    clearDiscoverFailAutoReloadFlag()
                    setLiveDeck(profiles)
                    setLiveDeckStatus('ready')
                    writeDiscoverDeckProfileCache(userId, discoverDeckDayKey, profiles)
                    actionTrace('discover.deck', 'work:完成', {
                      profileCount: profiles.length,
                      myEpoch,
                    })
                  })(),
                  new Promise<never>((_, reject) => {
                    postEnsureTimeoutId = window.setTimeout(
                      () => reject(deckTimeoutErr),
                      DECK_POST_ENSURE_BUDGET_MS,
                    )
                  }),
                ])
              } finally {
                if (postEnsureTimeoutId != null) {
                  window.clearTimeout(postEnsureTimeoutId)
                  postEnsureTimeoutId = null
                }
              }
            }

            await work()
          } catch (e) {
            if (cancelledOuter || deckLoadEpochRef.current !== myEpoch) return
            console.error('[DiscoverTab] deck load failed:', e)
            const ename =
              e && typeof e === 'object' && 'name' in e ? String((e as { name?: string }).name) : ''
            actionTrace('discover.deck', 'work:catch', { name: ename, phase, myEpoch })
            if (tryDiscoverFailAutoReload()) return
            const msg = formatDiscoverDeckLoadError(e)
            const noPhasePrefix =
              (e && typeof e === 'object' && (e as { name?: string }).name === 'TimeoutError') ||
              (e instanceof DOMException && e.name === 'AbortError')
            const combined = noPhasePrefix ? msg : `${phase === 'rpc' ? '【探索名單】' : '【相片網址簽章】'}\n\n${msg}`
            setDeckLoadDiagnostic(
              combined.trim() || '載入失敗，沒有詳細說明。請按下方重試或關掉程式再開。',
            )
            if (!keepStaleVisible) setLiveDeck([])
            setLiveDeckStatus('ready')
          }
        })()
      })
    }, debounceMs)

    return () => {
      actionTrace('discover.deck', 'effect:清理', {
        uid: shortId(userId),
        dk: discoverDeckDayKey,
        deckRefresh,
        /** 若與此行不同代表已有新一輪 effect 接上 */
        latestEpoch: deckLoadEpochRef.current,
      })
      discoverDeckRpcFlightRef.current?.abort()
      discoverDeckRpcFlightRef.current = null
      cancelledOuter = true
      window.clearTimeout(timer)
    }
  }, [userId, discoverDeckDayKey, deckRefresh])

  /** 探索長時間卡在 loading（epoch 被取消或 ensure 卡住未結束）；僅在目前前景時自動再踢一輪 */
  useEffect(() => {
    if (!userId || liveDeckStatus !== 'loading') return
    let cancelled = false
    const tid = window.setTimeout(() => {
      if (cancelled) return
      if (document.visibilityState !== 'visible') return
      setDeckRefresh((r) => r + 1)
    }, 14_000)
    return () => {
      cancelled = true
      window.clearTimeout(tid)
    }
  }, [userId, liveDeckStatus, deckRefresh])

  useEffect(() => {
    if (prevDeckRefreshRef.current === null) {
      prevDeckRefreshRef.current = deckRefresh
      return
    }
    if (prevDeckRefreshRef.current !== deckRefresh) {
      prevDeckRefreshRef.current = deckRefresh
      setIndex(0)
      setDone(false)
      setScrolled(false)
    }
  }, [deckRefresh])

  useEffect(() => {
    if (!userId) return
    discoverUiSessionCache = {
      userId,
      dayKey: discoverDeckDayKey,
      deckRefresh,
      cardIndex: index,
      done,
      scrolled,
    }
  }, [userId, discoverDeckDayKey, deckRefresh, index, done, scrolled])

  useEffect(() => {
    if (!userId) {
      prevRolloverTickRef.current = discoverDeckRolloverTick
      return
    }
    if (discoverDeckRolloverTick <= 0) return
    if (discoverDeckRolloverTick === prevRolloverTickRef.current) return
    prevRolloverTickRef.current = discoverDeckRolloverTick
    setCelebrateDeck(true)
    setIndex(0)
    setDone(false)
    setScrolled(false)
    const t = window.setTimeout(() => setCelebrateDeck(false), 2800)
    return () => window.clearTimeout(t)
  }, [discoverDeckRolloverTick, userId])

  // Reset hint + card scroll position when switching cards (skip initial mount so session restore keeps scrolled / scrollTop)
  useEffect(() => {
    if (skipDiscoverIndexScrollResetRef.current) {
      skipDiscoverIndexScrollResetRef.current = false
      return
    }
    setScrolled(false)
    // Reset outer main scroll too, in case user scrolled outer by mistake
    if (contentScrollRef?.current) contentScrollRef.current.scrollTop = 0
    // Scroll the card back to the photo
    if (cardScrollRef.current) cardScrollRef.current.scrollTop = 0
  }, [index])

  const profile = visibleProfiles[index]
  /** 當日已送愛心，或已送超喜（超喜後愛心也不可再送） */
  const heartLocked = Boolean(
    userId && profile && (profile.likedToday || profile.superLikedToday),
  )
  /** 當日已送超喜則不可再送超喜 */
  const superLocked = Boolean(userId && profile && profile.superLikedToday)

  const goNext = () => {
    if (index >= visibleProfiles.length - 1) { setDone(true); return }
    setDirection('next')
    setIndex((i) => i + 1)
  }

  const goPrev = () => {
    if (index <= 0) return
    setDirection('prev')
    setIndex((i) => i - 1)
  }

  const executeInteraction = async (action: 'pass' | 'like' | 'super_like') => {
    if (!profile) return
    if (!userId) {
      goNext()
      return
    }
    if (action === 'like' && creditBalance.heart <= 0) {
      onOpenSubscription()
      return
    }
    if (action === 'super_like' && creditBalance.super_like <= 0) {
      onOpenSubscription()
      return
    }
    const result = await recordProfileInteraction({
      targetProfileKey: profile.userId ?? profile.profileKey,
      targetUserId: profile.userId ?? null,
      action,
    })
    await refreshCredits()
    if (!result.ok && result.error) {
      if (
        result.error.includes('INSUFFICIENT_HEART')
        || result.error.includes('INSUFFICIENT_SUPER_LIKE')
      ) {
        onOpenSubscription()
        return
      }
      return
    }
    if (result.blocked || result.alreadyLiked || result.alreadySuperLiked) {
      return
    }
    if (result.ok && userId && profile.userId) {
      if (action === 'like') {
        setLiveDeck((prev) => {
          const next = prev.map((p) =>
            p.userId === profile.userId ? { ...p, likedToday: true } : p
          )
          return next
        })
      }
      if (action === 'super_like') {
        setLiveDeck((prev) => {
          const next = prev.map((p) =>
            p.userId === profile.userId ? { ...p, superLikedToday: true } : p
          )
          return next
        })
      }
    }
    if (result.ok) {
      if (result.matched) {
        onDiscoverMatch?.()
      }
      if (!result.matched) {
        if (action === 'like') onCreditAction?.('like')
        if (action === 'super_like') onCreditAction?.('super_like')
      }
      goNext()
    }
  }

  const openLikeConfirm = () => {
    if (!profile) return
    if (heartLocked) return
    if (!userId) {
      goNext()
      return
    }
    if (creditBalance.heart <= 0) {
      onOpenSubscription()
      return
    }
    setConfirmIntent('like')
  }

  const openSuperLikeConfirm = () => {
    if (!profile) return
    if (superLocked) return
    if (!userId) {
      goNext()
      return
    }
    if (creditBalance.super_like <= 0) {
      onOpenSubscription()
      return
    }
    setConfirmIntent('super_like')
  }

  const handleLike = () => openLikeConfirm()
  const handleSuperLike = () => openSuperLikeConfirm()
  const handlePass = () => executeInteraction('pass')
  const handleBlockedCurrent = () => {
    if (!profile) return
    setBlockedKeys((prev) => [...new Set([...prev, profile.profileKey])])
    goNext()
  }

  const bumpDeckReload = useCallback(() => {
    setDeckRecoverTip(null)
    setDeckLoadDiagnostic(null)
    setDeckRefresh((n) => n + 1)
  }, [])

  const runDeckRecovery = useCallback(async (label: string, prelude?: () => Promise<void>) => {
    setDeckRecoverBusy(label)
    setDeckRecoverTip(null)
    try {
      if (prelude) await prelude()
      setDeckLoadDiagnostic(null)
      setDeckRefresh((n) => n + 1)
      setDeckRecoverTip(`「${label}」已完成，已觸發重新載入。請看是否出現卡片。`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setDeckRecoverTip(`「${label}」前置步驟失敗：${msg}`)
    } finally {
      setDeckRecoverBusy(null)
    }
  }, [])

  if (userId && liveDeckStatus === 'loading' && visibleProfiles.length === 0) {
    return (
      <div className="relative flex min-h-[50vh] flex-col">
        <DiscoverDeckRolloverOverlay open={celebrateDeck} tick={discoverDeckRolloverTick} />
        <div className="flex flex-1 flex-col items-center justify-center text-center px-8">
        <div className="w-12 h-12 rounded-full border-2 border-slate-200 border-t-slate-700 animate-spin mb-4" />
        <p className="text-slate-600 font-semibold text-sm">載入今日探索名單</p>
        <p className="text-slate-400 text-xs mt-2 max-w-[18rem]">每晚 10 點更新。</p>
        <p className="text-slate-400 text-[11px] mt-3 max-w-[19rem] leading-relaxed">
          若超過十餘秒仍停在此畫面，會顯示錯誤說明。正常載入通常更快。
        </p>
        </div>
      </div>
    )
  }

  if (visibleProfiles.length === 0 || done || !profile) {
    const deckLoadFailed = Boolean(
      userId && deckLoadDiagnostic && liveDeckStatus === 'ready' && visibleProfiles.length === 0 && !done,
    )
    const deckFailureDetail =
      (deckLoadDiagnostic ?? '').trim() ||
      '未收到詳細原因。請先按下方重試載入。若仍只有這行字，請關掉程式後再試。'
    const emptyLive = Boolean(
      userId && liveDeckStatus === 'ready' && visibleProfiles.length === 0 && !done && !deckLoadDiagnostic,
    )
    const emptyDemo = !userId && visibleProfiles.length === 0 && !done
    return (
      <div className="relative flex flex-col h-full">
        <DiscoverDeckRolloverOverlay open={celebrateDeck} tick={discoverDeckRolloverTick} />
        <div className="flex flex-col items-center justify-center h-full text-center px-8">
        {deckLoadFailed ? (
          <div className="w-full max-w-sm">
            <div
              className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-left shadow-sm ring-1 ring-rose-100/80 [unicode-bidi:plaintext]"
              lang="zh-Hant"
            >
              <p className="text-[13px] font-bold text-rose-950">探索暫時載入失敗</p>
              <p className="mt-2 text-[11px] leading-relaxed text-rose-900/90">
                若曾自動重新載入過仍看到此畫面，請再試下方「⑧」或關掉程式後重開。
              </p>
              <p className="mt-3 whitespace-pre-wrap break-words text-[13px] font-normal leading-relaxed text-slate-900">
                {deckFailureDetail}
              </p>
            </div>
            <button
              type="button"
              disabled={Boolean(deckRecoverBusy)}
              onClick={bumpDeckReload}
              className="mt-6 w-full px-5 py-3 bg-slate-900 text-white text-sm font-semibold rounded-2xl disabled:opacity-50"
            >
              ① 僅重試載入
            </button>
            <p className="mt-4 text-[11px] leading-relaxed text-slate-600">
              若上面無效，請逐個試下方按鈕，並記下<strong className="font-semibold text-slate-800">哪一個</strong>能讓探索恢復（方便回報）。
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                disabled={Boolean(deckRecoverBusy)}
                onClick={() => void runDeckRecovery('換發登入並重連', wakeSupabaseAuthFromBackground)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[13px] font-medium text-slate-800 shadow-sm active:bg-slate-50 disabled:opacity-50"
              >
                ② 換發登入並重連（完整 wake）
              </button>
              <button
                type="button"
                disabled={Boolean(deckRecoverBusy)}
                onClick={() => void runDeckRecovery('僅軟換發 Session', refreshSupabaseAuthSoft)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[13px] font-medium text-slate-800 shadow-sm active:bg-slate-50 disabled:opacity-50"
              >
                ③ 僅軟換發（refresh，不重斷 WS）
              </button>
              <button
                type="button"
                disabled={Boolean(deckRecoverBusy)}
                onClick={() => void runDeckRecovery('僅重連即時頻道', reconnectSupabaseRealtimeOnly)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[13px] font-medium text-slate-800 shadow-sm active:bg-slate-50 disabled:opacity-50"
              >
                ④ 僅重連即時頻道（不切換 JWT）
              </button>
              <button
                type="button"
                disabled={Boolean(deckRecoverBusy)}
                onClick={() => void runDeckRecovery('讀取 Session', touchSupabaseAuthSessionRead)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[13px] font-medium text-slate-800 shadow-sm active:bg-slate-50 disabled:opacity-50"
              >
                ⑤ 僅讀取 Session（getSession，不換發）
              </button>
              <button
                type="button"
                disabled={Boolean(deckRecoverBusy)}
                onClick={() => {
                  setDeckRecoverBusy('清除 Query 快取')
                  setDeckRecoverTip(null)
                  try {
                    clearAppQueryCache()
                    setDeckLoadDiagnostic(null)
                    setDeckRefresh((n) => n + 1)
                    setDeckRecoverTip('已清除 TanStack 記憶體與 localStorage 持久化快取，並重試載入。')
                  } finally {
                    setDeckRecoverBusy(null)
                  }
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[13px] font-medium text-slate-800 shadow-sm active:bg-slate-50 disabled:opacity-50"
              >
                ⑥ 清除 Query 快取後重試（含持久化）
              </button>
              <button
                type="button"
                disabled={Boolean(deckRecoverBusy)}
                onClick={() => {
                  setDeckRecoverBusy('invalidateQueries')
                  setDeckRecoverTip(null)
                  try {
                    void queryClient.invalidateQueries()
                    setDeckLoadDiagnostic(null)
                    setDeckRefresh((n) => n + 1)
                    setDeckRecoverTip('已執行 invalidateQueries（標記重抓，未刪 localStorage）。')
                  } finally {
                    setDeckRecoverBusy(null)
                  }
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[13px] font-medium text-slate-800 shadow-sm active:bg-slate-50 disabled:opacity-50"
              >
                ⑦ 標記 Query 需重抓後重試
              </button>
              <button
                type="button"
                disabled={Boolean(deckRecoverBusy)}
                onClick={() => {
                  setDeckRecoverBusy('整頁重新載入')
                  clearDiscoverFailAutoReloadFlag()
                  markSkipInstantMatchLeaveOnNextFullUnload()
                  window.location.reload()
                }}
                className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-[13px] font-semibold text-amber-950 shadow-sm active:bg-amber-100/80 disabled:opacity-50"
              >
                ⑧ 整頁重新載入
              </button>
            </div>
            {deckRecoverBusy ? (
              <p className="mt-3 text-center text-[12px] font-medium text-sky-800">進行中：{deckRecoverBusy}</p>
            ) : null}
            {deckRecoverTip ? (
              <p className="mt-2 whitespace-pre-wrap text-center text-[11px] leading-relaxed text-slate-600">{deckRecoverTip}</p>
            ) : null}
          </div>
        ) : (
          <>
        <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Sparkles className="w-9 h-9 text-slate-300" />
        </div>
        {emptyLive && (
          <>
            <p className="text-slate-700 font-semibold text-lg">今日已沒有更多人可以配對</p>
            <button
              type="button"
              onClick={() => setDeckRefresh((n) => n + 1)}
              className="mt-6 px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-2xl"
            >
              重新載入
            </button>
          </>
        )}
        {emptyDemo && (
          <p className="text-slate-700 font-semibold text-lg">今日已沒有更多人可以配對</p>
        )}
        {!emptyLive && !emptyDemo && (
          <>
            <p className="text-slate-700 font-semibold text-lg">今日推薦已全部看完</p>
            <p className="text-slate-400 text-sm mt-1">明天再來探索更多工程師</p>
            <button
              type="button"
              onClick={() => { setIndex(0); setDone(false) }}
              className="mt-6 px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-2xl"
            >
              重新瀏覽
            </button>
          </>
        )}
          </>
        )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col h-full">
      <DiscoverDeckRolloverOverlay open={celebrateDeck} tick={discoverDeckRolloverTick} />
      {/* Counter */}
      <motion.div
        className="flex items-start justify-between gap-2 px-4 pt-3 pb-2 flex-shrink-0"
        animate={celebrateDeck ? { scale: [1, 1.02, 1] } : { scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h1 className="text-[20px] font-bold text-slate-900 tracking-tight leading-none">探索</h1>
          <p className="text-xs font-semibold text-slate-400 tabular-nums shrink-0">{index + 1} / {visibleProfiles.length}</p>
          <p className="text-[10px] font-medium leading-snug text-slate-400 max-w-[14rem] sm:max-w-none">
            每晚 10 點更新
          </p>
        </div>
        <button
          onClick={() => setShowNotifModal(true)}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center"
        >
          <Bell className="w-4 h-4 text-slate-500" />
        </button>
      </motion.div>

      {/* Card — internal scroll */}
      <div className="relative flex-1 min-h-0 overflow-hidden px-4 pb-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={profile.profileKey}
            initial={{ opacity: 0, x: direction === 'next' ? 60 : -60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction === 'next' ? -60 : 60 }}
            transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
            className="h-full"
          >
          <div
            ref={(el) => { cardScrollRef.current = el as HTMLDivElement | null }}
            className="h-full overflow-y-auto rounded-3xl bg-white shadow-md ring-1 ring-slate-100"
            style={{ WebkitOverflowScrolling: 'touch' }}
            onScroll={(e) => {
              if ((e.currentTarget as HTMLElement).scrollTop > 24) setScrolled(true)
            }}
          >
            {/* ── Photo header ── */}
            <>
              <IncomeBorder
                tier={(profile.showIncomeBorder && profile.incomeTier) ? profile.incomeTier : null}
                radius="1.4rem"
                thickness={8}
                showVerifyMark={false}
                showIncomeRangeLabel
                className="m-3"
              >
                <BlurredProfilePhotoSlideshow
                  profileKey={profile.profileKey}
                  photoUrls={collectProfilePhotoUrls(profile)}
                  alt={getPublicName(profile)}
                  gradientFrom={profile.gradientFrom}
                  gradientTo={profile.gradientTo}
                  variant="discover"
                  highFetchPrioritySlideCount={index === 0 ? 3 : 0}
                  onReportClick={() => setReportTarget({
                    profileKey: profile.profileKey,
                    displayName: getPublicName(profile),
                    userId: profile.userId ?? null,
                  })}
                />
                  </IncomeBorder>

                  {/* Public profile summary: nickname only, no real-name initial block. */}
                  <div className="px-5 pb-1 -mt-1">
                      <div className="pb-1">
                        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1.5">
                          <span className="text-[2rem] font-semibold tracking-[-0.03em] text-slate-900">{getPublicName(profile)}</span>
                          <span className="text-[1.2rem] font-medium text-slate-500">{profile.age}</span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <DiscoverRegionChips profile={profile} />
                          </span>
                        </div>
                      </div>
                    </div>
                </>

            {/* ── Scroll hint — below photo, semi-transparent ── */}
            <AnimatePresence>
              {!scrolled && (
                <motion.div
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                  className="flex flex-col items-center py-2 pointer-events-none bg-gradient-to-b from-white/60 to-white/90"
                >
                  <p className="text-[11px] font-semibold text-slate-400 tracking-wide mb-0.5">往下滑查看並配對</p>
                  <motion.div
                    animate={{ y: [0, 4, 0] }}
                    transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
                  >
                    <ChevronDown className="w-4 h-4 text-slate-300" />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Info section ────────────────────────────────── */}
            <div className="p-4 pt-2 space-y-4">
              {/* Bio */}
              <div className="bg-slate-50 rounded-2xl px-4 py-3.5">
                <p className="text-sm text-slate-700 leading-relaxed">{profile.bio}</p>
              </div>

              {/* Interests */}
              <div className="flex flex-wrap gap-2">
                {profile.interests.map((tag) => (
                  <span key={tag} className="px-3 py-1 bg-white ring-1 ring-slate-200 rounded-full text-xs font-semibold text-slate-600">
                    {tag}
                  </span>
                ))}
              </div>

              {/* ── 機車題挑戰 ────────────────────────────────── */}
              <div>
                <p className="text-[11px] font-semibold text-neutral-500 tracking-[0.18em] uppercase mb-3">
                  機車題挑戰
                </p>

                <div className="space-y-2.5">
                  {profile.qa.map(({ question, answer }, i) => (
                    <div key={i} className="bg-neutral-50 rounded-xl p-4">
                      <p className="text-[13px] text-neutral-600 leading-snug">
                        <span className="font-semibold text-neutral-400 mr-1.5">Q.</span>
                        {question}
                      </p>
                      <p className="mt-2 text-[14px] font-semibold text-neutral-800 leading-snug">
                        <span className="font-semibold text-neutral-400 mr-1.5">A.</span>
                        {answer}
                        {isHardcoreAnswer(answer) && (
                          <Gem className="inline-block w-3 h-3 ml-1 -mt-0.5 text-slate-600" aria-label="hardcore" />
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Action buttons — 看完才出現，在卡片最底部 ── */}
              <div className="pt-2 pb-10">
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-widest">你的決定</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>

                <div className="flex items-center justify-center gap-4">
                  {index > 0 && (
                    <motion.button
                      whileTap={{ scale: 0.88 }}
                      onClick={goPrev}
                      className="w-12 h-12 rounded-full border-2 border-slate-200 bg-white flex items-center justify-center shadow-sm"
                    >
                      <ChevronLeft className="w-5 h-5 text-slate-400" />
                    </motion.button>
                  )}

                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    onClick={handlePass}
                    className="w-16 h-16 rounded-full border-2 border-slate-200 bg-white flex items-center justify-center shadow-md"
                  >
                    <X className="w-7 h-7 text-slate-400" />
                  </motion.button>

                  {heartLocked ? (
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 ring-2 ring-slate-200/80">
                        <Heart className="h-6 w-6 text-slate-300" aria-hidden />
                      </div>
                      <span className="text-[10px] font-bold text-slate-400">
                        {profile.likedToday ? '已發送愛心' : '已送出超級喜歡'}
                      </span>
                    </div>
                  ) : (
                    <motion.button
                      whileTap={{ scale: 0.88 }}
                      onClick={handleLike}
                      className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center shadow-lg shadow-slate-900/25"
                      aria-label="一般喜歡"
                    >
                      <Heart className="w-7 h-7 text-white" />
                    </motion.button>
                  )}

                  {superLocked ? (
                    <div className="relative ml-2 flex h-[68px] w-[68px] flex-col items-center justify-center rounded-full border border-slate-200 bg-slate-100 ring-4 ring-slate-100/80">
                      <Sparkles className="h-7 w-7 text-slate-300" strokeWidth={2.4} aria-hidden />
                      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold text-slate-400">
                        已送出超級喜歡
                      </span>
                    </div>
                  ) : (
                    <motion.button
                      whileTap={{ scale: 0.88 }}
                      onClick={handleSuperLike}
                      className="relative ml-2 h-[68px] w-[68px] rounded-full border border-amber-200/80 bg-gradient-to-br from-amber-300 via-yellow-400 to-orange-500 flex items-center justify-center shadow-xl shadow-amber-400/35 ring-4 ring-amber-100/70"
                      aria-label="超級喜歡"
                    >
                      <Sparkles className="h-8 w-8 text-white drop-shadow-[0_2px_5px_rgba(146,64,14,0.55)]" strokeWidth={2.7} />
                      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-black text-amber-500">
                        超級喜歡
                      </span>
                    </motion.button>
                  )}

                  {index > 0 && <div className="w-12 h-12" />}
                </div>
                <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-400">
                  一般愛心不會通知對方；超級喜歡將與對方立即配對，雙方可開始聊天。
                </p>
              </div>
            </div>
          </div>
          </motion.div>
        </AnimatePresence>

      </div>

      {/* Notification modal */}
      <AnimatePresence>
        {showNotifModal && (
          <NotificationModal onClose={() => setShowNotifModal(false)} userId={userId} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmIntent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/50 px-5"
            onClick={() => setConfirmIntent(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.98, opacity: 0, y: 6 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl ring-1 ring-slate-100"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="discover-confirm-title"
            >
              <h2 id="discover-confirm-title" className="text-lg font-black text-slate-900">
                {confirmIntent === 'like' ? '送出愛心' : '送出超級喜歡'}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-600">
                <p>
                  你目前有
                  <span className="mx-1 font-bold tabular-nums text-slate-900">
                    {confirmIntent === 'like' ? creditBalance.heart : creditBalance.super_like}
                  </span>
                  {confirmIntent === 'like' ? '顆愛心' : '次超級喜歡'}
                  。
                </p>
                <p className="text-[13px] text-slate-500">
                  提醒：有效會員每日登入可領
                  <span className="mx-0.5 font-semibold text-slate-700">2 顆愛心</span>
                  。每晚 10 點換日；須訂閱有效且當日尚未領取。
                </p>
                {confirmIntent === 'super_like' && (
                  <p className="text-[13px] text-slate-500">
                    超級喜歡為另行取得的道具；送出後扣減 1 次，並與對方立即配對（與互相喜歡相同，可開聊天室）。
                  </p>
                )}
                <p className="font-semibold text-slate-800">真的要送出嗎？</p>
              </div>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmIntent(null)}
                  className="flex-1 rounded-2xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-600"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const a = confirmIntent
                    setConfirmIntent(null)
                    if (a === 'like' || a === 'super_like') await executeInteraction(a)
                  }}
                  className="flex-1 rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white"
                >
                  確定送出
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* First-login notification prompt — shown until user actually grants permission */}
      <AnimatePresence>
        {showNotifPrompt && (
          <NotifEnablePrompt
            onDismiss={() => {
              sessionStorage.setItem('notif_prompt_dismissed', '1')
              setShowNotifPrompt(false)
            }}
            onOpenSettings={() => {
              setShowNotifPrompt(false)
              setShowNotifModal(true)
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reportTarget && (
          <ReportProfileModal
            target={reportTarget}
            onClose={() => setReportTarget(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {blockTarget && (
          <BlockProfileConfirm
            target={blockTarget}
            onClose={() => setBlockTarget(null)}
            onBlocked={handleBlockedCurrent}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Notification Enable Prompt (first-visit nudge on Discover) ──────────────

function NotifEnablePrompt({
  onDismiss,
  onOpenSettings,
}: {
  onDismiss: () => void
  onOpenSettings: () => void
}) {
  const [busy, setBusy] = useState(false)

  const enableNow = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      onOpenSettings()
      return
    }
    setBusy(true)
    try {
      const perm = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission
      if (perm === 'granted') {
        // Enable the core toggles by default once user grants permission
        try {
          const defaults = { newMatch: true, messages: true, newProfile: false, weeklyDigest: false }
          const saved = localStorage.getItem('notif_settings')
          const merged = saved ? { ...JSON.parse(saved), newMatch: true, messages: true } : defaults
          localStorage.setItem('notif_settings', JSON.stringify(merged))
        } catch { /* noop */ }
        // Fire a welcome ping so the user immediately sees it works
        try {
          const options: NotificationOptions = {
            body: '通知已啟用，配對成功或收到訊息時會第一時間通知你',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: 'tsmedia-welcome',
          }
          if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready
            await reg.showNotification('通知已開啟', options)
          } else {
            new Notification('通知已開啟', options)
          }
        } catch { /* noop */ }
        onDismiss()
      } else {
        // Denied or still default — send them to the settings panel for guidance
        onOpenSettings()
      }
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[210] flex items-center justify-center px-6"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onDismiss}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        className="w-full max-w-sm bg-white rounded-3xl px-6 pt-7 pb-5 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-16 h-16 rounded-2xl bg-slate-900 mx-auto flex items-center justify-center mb-4">
          <BellRing className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-[19px] font-bold text-slate-900 tracking-tight mb-2">開啟通知，不錯過任何配對</h3>
        <p className="text-[13px] text-slate-500 leading-relaxed mb-5">
          一般愛心不會通知對方；配對成功或有人傳訊息給你時，我們會立即通知你。
        </p>
        <button
          onClick={enableNow}
          disabled={busy}
          className="w-full py-3.5 rounded-2xl bg-slate-900 text-white text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {busy ? '處理中' : '立即開啟通知'}
        </button>
        <button
          onClick={onDismiss}
          className="w-full py-2.5 mt-1 text-[13px] text-slate-400"
        >
          稍後再說
        </button>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

// ─── Matches Tab ─────────────────────────────────────────────────────────────

// ── Shared Person type used by the "view partner profile" modal ──────────────
interface PersonSummary {
  id: number
  name: string
  initials: string
  gradientFrom: string
  gradientTo: string
  company: string
  role: string
  subtitle?: string       // optional extra line (e.g. "理律 · 律師")
  /** 已登入：對方 auth id，供載入真實個人檔案 */
  peerUserId?: string | null
  /** 已登入：matches 列 id，供開啟聊天室 */
  matchId?: string | null
}

function MatchesTab({
  currentUserId,
  liveConversations,
  liveConversationsLoading,
  onOpenPerson,
  onStartChat,
}: {
  currentUserId?: string | null
  liveConversations: Conversation[]
  liveConversationsLoading: boolean
  onOpenPerson: (p: PersonSummary) => void
  onStartChat: (id: number | string) => void
}) {
  const isLoggedIn = Boolean(currentUserId)
  const count = isLoggedIn ? liveConversations.length : MATCHES.length

  const blockingMatchesLoad = isLoggedIn && liveConversationsLoading && liveConversations.length === 0

  if (blockingMatchesLoad) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-10 h-10 rounded-full border-2 border-slate-200 border-t-slate-700 animate-spin mb-3" />
        <p className="text-slate-600 font-semibold text-sm">載入配對</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-2">
        <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">配對</h1>
        <p className="text-xs text-slate-400 mt-0.5">你的 {count} 個配對</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-2 space-y-3 pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        {isLoggedIn ? (
          liveConversations.length === 0 ? (
            <p className="text-center text-slate-400 text-sm px-6 py-14 leading-relaxed">
              尚未有配對。雙方在探索互送喜歡後，會出現在這裡。
            </p>
          ) : (
            liveConversations.map((conv) => {
              const peerId = conv.peerUserId ?? ''
              const idSlot = peerId ? (Math.abs(hashFromUuid(peerId)) % 1_000_000) + 10_000 : 0
              const company = conv.subtitle.split(' · ')[0] || '—'
              const role = conv.subtitle.split(' · ')[1] ?? conv.subtitle
              const t = conv.matchedAt != null ? formatMatchListTime(conv.matchedAt) : ''
              const chatId = conv.matchId ?? String(conv.id)
              const openPerson = () =>
                onOpenPerson({
                  id: idSlot,
                  name: conv.name,
                  initials: conv.initials,
                  gradientFrom: conv.from,
                  gradientTo: conv.to,
                  company,
                  role,
                  subtitle: conv.subtitle,
                  peerUserId: conv.peerUserId ?? null,
                  matchId: chatId,
                })
              return (
                <motion.div
                  key={String(conv.id)}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100"
                >
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={openPerson}
                      className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0 active:scale-95 transition-transform"
                      style={{ background: `linear-gradient(135deg, ${conv.from}, ${conv.to})` }}
                      aria-label={`查看 ${conv.name} 的個人檔案`}
                    >
                      {conv.initials}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-slate-900 text-sm">{conv.name}</span>
                        <span className={cn(
                          'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                          company === 'TSMC' ? 'bg-blue-50 text-blue-600' : 'bg-indigo-50 text-indigo-600',
                        )}>
                          {company}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">{role}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">{t}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={openPerson}
                      className="flex-1 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 active:bg-slate-200 transition-colors"
                    >
                      查看檔案
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartChat(chatId)}
                      className="flex-[1.4] py-2 rounded-xl text-xs font-bold bg-slate-900 text-white flex items-center justify-center gap-1.5 active:bg-slate-800 transition-colors relative"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      開始聊天
                    </button>
                  </div>
                </motion.div>
              )
            })
          )
        ) : (
          MATCHES.map((match) => (
            <motion.div
              key={match.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100"
            >
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => onOpenPerson({
                    id: match.id, name: match.name, initials: match.initials,
                    gradientFrom: match.from, gradientTo: match.to,
                    company: match.company, role: match.role,
                  })}
                  className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0 active:scale-95 transition-transform"
                  style={{ background: `linear-gradient(135deg, ${match.from}, ${match.to})` }}
                  aria-label={`查看 ${match.name} 的個人檔案`}
                >
                  {match.initials}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-slate-900 text-sm">{match.name}</span>
                    <span className={cn(
                      'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                      match.company === 'TSMC' ? 'bg-blue-50 text-blue-600' : 'bg-indigo-50 text-indigo-600',
                    )}>
                      {match.company}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">{match.role}</p>
                </div>
                <span className="text-[10px] text-slate-400 flex-shrink-0">{match.time}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpenPerson({
                    id: match.id, name: match.name, initials: match.initials,
                    gradientFrom: match.from, gradientTo: match.to,
                    company: match.company, role: match.role,
                  })}
                  className="flex-1 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 active:bg-slate-200 transition-colors"
                >
                  查看檔案
                </button>
                <button
                  type="button"
                  onClick={() => onStartChat(match.id)}
                  className="flex-[1.4] py-2 rounded-xl text-xs font-bold bg-slate-900 text-white flex items-center justify-center gap-1.5 active:bg-slate-800 transition-colors relative"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  開始聊天
                  {match.unread > 0 && (
                    <span className="ml-1 min-w-[16px] h-[16px] px-1 bg-white text-slate-900 rounded-full text-[9px] font-black flex items-center justify-center">
                      {match.unread}
                    </span>
                  )}
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Person Detail Modal — viewable partner profile ──────────────────────────

function PersonDetailView({
  person,
  onClose,
  onStartChat,
  clearedPhotoSlots = [],
}: {
  person: PersonSummary
  onClose: () => void
  onStartChat?: (id: number | string) => void
  /** Demo：在聊天拼圖完整解鎖的相片索引（與 photoUrls 對齊）。 */
  clearedPhotoSlots?: number[]
}) {
  const [liveProfile, setLiveProfile] = useState<Profile | null>(null)
  const [reportTarget, setReportTarget] = useState<{ profileKey: string; displayName: string; userId?: string | null } | null>(null)
  const [blockTarget, setBlockTarget] = useState<{ profileKey: string; displayName: string; userId?: string | null } | null>(null)

  useEffect(() => {
    if (!person.peerUserId) {
      setLiveProfile(null)
      return
    }
    let cancelled = false
    const idSlot = (Math.abs(hashFromUuid(person.peerUserId)) % 1_000_000) + 10_000
    getProfile(person.peerUserId).then((row) => {
      if (cancelled || !row) return
      profileRowToMatchProfile(row, idSlot).then((p) => {
        if (!cancelled) setLiveProfile(p)
      })
    })
    return () => {
      cancelled = true
    }
  }, [person.peerUserId])

  const profile = person.peerUserId ? liveProfile : findFullProfile(person.id)

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[100] bg-[#fafafa] flex flex-col"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 36 }}
    >
      {/* Top bar */}
      <div className="flex-shrink-0 px-4 pt-safe pb-2 flex items-center justify-between">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <span className="text-sm font-bold text-slate-900">個人檔案</span>
        <button
          type="button"
          onClick={() => setReportTarget({
            profileKey: profile ? profile.profileKey : `person:${person.id}`,
            displayName: person.name,
            userId: profile?.userId ?? null,
          })}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center"
          aria-label="檢舉此用戶"
        >
          <Flag className="w-4 h-4 text-red-400" />
        </button>
      </div>

      {/* Scrollable content — layout mirrors the Discover card exactly */}
      <div
        className="flex-1 overflow-y-auto px-4 pb-24"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {profile ? (
          <div className="rounded-3xl bg-white shadow-md ring-1 ring-slate-100 overflow-hidden">
            {/* ── Photo header — vertical 2:3 portrait with income crown badge ── */}
            <IncomeBorder
              tier={(profile.showIncomeBorder && profile.incomeTier) ? profile.incomeTier : null}
              radius="1.4rem"
              thickness={8}
              showVerifyMark={false}
              className="m-3"
            >
              <BlurredProfilePhotoSlideshow
                profileKey={profile.profileKey}
                photoUrls={collectProfilePhotoUrls(profile)}
                alt={getPublicName(profile)}
                gradientFrom={profile.gradientFrom}
                gradientTo={profile.gradientTo}
                variant="detail"
                compatScore={profile.compatScore}
                unblockedIndices={clearedPhotoSlots}
                onReportClick={() => setReportTarget({
                  profileKey: profile ? profile.profileKey : `person:${person.id}`,
                  displayName: person.name,
                  userId: profile?.userId ?? null,
                })}
              />
            </IncomeBorder>

            <div className="px-5 pb-1 -mt-1">
              <div className="pb-1">
                <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1.5">
                  <span className="text-[2rem] font-semibold tracking-[-0.03em] text-slate-900">{getPublicName(profile)}</span>
                  <span className="text-[1.2rem] font-medium text-slate-500">{profile.age}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <DiscoverRegionChips profile={profile} />
                  </span>
                </div>
              </div>
            </div>

            {/* ── Info section (identical to Discover) ─────────────── */}
            <div className="p-4 pt-2 space-y-4">
              <div className="bg-slate-50 rounded-2xl px-4 py-3.5">
                <p className="text-sm text-slate-700 leading-relaxed">{profile.bio}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {profile.interests.map((tag) => (
                  <span key={tag} className="px-3 py-1 bg-white ring-1 ring-slate-200 rounded-full text-xs font-semibold text-slate-600">
                    {tag}
                  </span>
                ))}
              </div>

              <div>
                <p className="text-[11px] font-semibold text-neutral-500 tracking-[0.18em] uppercase mb-3">
                  機車題挑戰
                </p>

                <div className="space-y-2.5">
                  {profile.qa.map(({ question, answer }, i) => (
                    <div key={i} className="bg-neutral-50 rounded-xl p-4">
                      <p className="text-[13px] text-neutral-600 leading-snug">
                        <span className="font-semibold text-neutral-400 mr-1.5">Q.</span>
                        {question}
                      </p>
                      <p className="mt-2 text-[14px] font-semibold text-neutral-800 leading-snug">
                        <span className="font-semibold text-neutral-400 mr-1.5">A.</span>
                        {answer}
                        {isHardcoreAnswer(answer) && (
                          <Gem className="inline-block w-3 h-3 ml-1 -mt-0.5 text-slate-600" aria-label="hardcore" />
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-4 ring-1 ring-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">AI 契合度</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg, ${profile.gradientFrom}, ${profile.gradientTo})` }}
                      initial={{ width: 0 }}
                      animate={{ width: `${profile.compatScore}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                    />
                  </div>
                  <span className="text-sm font-bold text-slate-600">{profile.compatScore}%</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Fallback when full profile not available — minimal summary hero
          <div className="mt-2 rounded-3xl overflow-hidden relative" style={{ minHeight: 260 }}>
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(160deg, ${person.gradientFrom}, ${person.gradientTo})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            <div className="relative z-10 p-6 h-[260px] flex items-end">
              <div>
                <div className="w-20 h-20 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center text-white font-black text-4xl ring-2 ring-white/25 mb-3">
                  {person.initials}
                </div>
                <h2 className="text-2xl font-extrabold text-white tracking-tight">{person.name}</h2>
                <div className="mt-1.5">
                  <CompanyBadge company={person.company} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      {onStartChat && (
        <div
          className="flex-shrink-0 px-5 pt-3 bg-[#fafafa] border-t border-slate-100 space-y-2"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
        >
          <button
            onClick={() => setBlockTarget({
              profileKey: profile ? profile.profileKey : `person:${person.id}`,
              displayName: profile ? getPublicName(profile) : person.name,
              userId: profile?.userId ?? null,
            })}
            className="w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 bg-red-50 text-red-500"
          >
            <Ban className="w-4 h-4" />
            封鎖此用戶
          </button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onStartChat(person.matchId ?? person.id)}
            className="w-full py-3.5 bg-slate-900 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20"
          >
            <MessageSquare className="w-4 h-4" />
            開始聊天
          </motion.button>
        </div>
      )}
      <AnimatePresence>
        {reportTarget && (
          <ReportProfileModal
            target={reportTarget}
            onClose={() => setReportTarget(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {blockTarget && (
          <BlockProfileConfirm
            target={blockTarget}
            onClose={() => setBlockTarget(null)}
            onBlocked={onClose}
          />
        )}
      </AnimatePresence>
    </motion.div>,
    document.body,
  )
}

// ─── Messages Tab ─────────────────────────────────────────────────────────────

// ─── LINE-style message data ─────────────────────────────────────────────────

interface ChatMessage {
  id: string
  text: string
  from: 'me' | 'them'
  time: string        // HH:mm
  date: string        // 今天 / 昨天 / 2024/5/20
  read?: boolean      // only meaningful for 'me'
  /** ISO — used for ordering & unread (live chat); demo rows optional */
  createdAt?: string
}

interface Conversation {
  /** Demo: MATCH_PROFILES id (number). Live thread: same as `matchId` (uuid string). */
  id: number | string
  name: string
  subtitle: string
  initials: string
  from: string
  to: string
  photoUrl?: string
  /** Demo / live: puzzle cycles these URLs (max 3). */
  photoUrls?: string[]
  matchedAt?: number
  messages: ChatMessage[]
  /** Supabase match id — when set, ChatRoomView loads DB messages + Realtime */
  matchId?: string
  peerUserId?: string
}

const LIVE_CONV_CACHE_PREFIX = 'tsmedia:live-conversations:v1:'

function readLiveConvSessionCache(userId: string): Conversation[] | null {
  try {
    const raw = sessionStorage.getItem(LIVE_CONV_CACHE_PREFIX + userId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Conversation[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeLiveConvSessionCache(userId: string, rows: Conversation[]) {
  try {
    sessionStorage.setItem(LIVE_CONV_CACHE_PREFIX + userId, JSON.stringify(rows))
  } catch {
    /* quota / private mode */
  }
}

function clearLiveConvSessionCache(userId: string) {
  try {
    sessionStorage.removeItem(LIVE_CONV_CACHE_PREFIX + userId)
  } catch {
    /* ignore */
  }
}

function compareChatMessageTime(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt && b.createdAt) {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  }
  return String(a.id).localeCompare(String(b.id))
}

function hasMyReplyAfter(themMsg: ChatMessage, all: ChatMessage[]): boolean {
  return all.some((mm) => {
    if (mm.from !== 'me' || !themMsg.createdAt || !mm.createdAt) return false
    return new Date(mm.createdAt) > new Date(themMsg.createdAt)
  })
}

// ─── Chat Room View (LINE-style) ─────────────────────────────────────────────
// 版本 0430：聊天室鍵盤遮擋僅在此元件處理（visualViewport + paddingBottom）。
// 之後要比對／還原：git show 0430 或 git checkout 0430 -- src/screens/MainScreen.tsx
// 不要為了鍵盤去改全站 App.tsx / index.css（避免底部導覽浮動問題）。

function ChatRoomView({
  conversation,
  currentUserId,
  onBack,
  onChatInputFocus,
  onChatInputBlur,
  blurUnlockBalance,
  onNeedSubscription,
  refreshCredits,
  onDemoBlurSpent,
  onDemoPuzzleSlotCleared,
  onBlurUnlockSpent,
  foregroundReloadNonce,
  physicalChannelResubscribeNonce,
}: {
  conversation: Conversation
  currentUserId: string | null
  onBack: () => void
  onChatInputFocus?: () => void
  onChatInputBlur?: () => void
  blurUnlockBalance: number
  onNeedSubscription: () => void
  refreshCredits: () => void
  onDemoBlurSpent: () => void
  onDemoPuzzleSlotCleared?: (profileId: number, slotIndex: number) => void
  /** 拼圖道具成功消耗並解鎖 1 格後。 */
  onBlurUnlockSpent?: () => void
  /** 前景 wake 後遞增：重綁 Realtime、重抓訊息（避免 WS 僵死後聊天／列表不出貨）。 */
  foregroundReloadNonce: number
  physicalChannelResubscribeNonce: number
}) {
  const isLive = Boolean(conversation.matchId && currentUserId)
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    isLive ? [] : conversation.messages,
  )
  const [input, setInput] = useState('')
  const [reportMessage, setReportMessage] = useState<ChatMessage | null>(null)
  const [blockTarget, setBlockTarget] = useState<{ profileKey: string; displayName: string; userId?: string | null } | null>(null)
  const [recentSendTimes, setRecentSendTimes] = useState<number[]>([])
  const [sendWarning, setSendWarning] = useState('')
  const [manualUnlockedTiles, setManualUnlockedTiles] = useState<number[]>([])
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  /** Pushes composer + scroll area above the on-screen keyboard — chat shell only. */
  const [keyboardInsetBottom, setKeyboardInsetBottom] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  /** 避免因 sub-pixel vv 數值無限 setState → 捲動 → visualViewport 抖動／地震 */
  const lastInsetCommitRef = useRef<number | null>(null)
  const lastKbOpenCommitRef = useRef<boolean | null>(null)

  /** 回報 SW：此配對聊天開著時略過同對象推播；SW 重啟／切回前景時重新 arm；短週期 heartbeat 對齊 iOS／多 registration */
  useLayoutEffect(() => {
    if (!isLive || !conversation.matchId) return
    notifyServiceWorkerActiveChatMatch(conversation.matchId)
  }, [isLive, conversation.matchId])

  useEffect(() => {
    if (!isLive || !conversation.matchId) return
    const arm = () => notifyServiceWorkerActiveChatMatch(conversation.matchId)
    arm()
    const hb = window.setInterval(arm, 2500)
    document.addEventListener('visibilitychange', arm)
    const sw = navigator.serviceWorker
    const onCtl = () => arm()
    sw?.addEventListener('controllerchange', onCtl)
    return () => {
      clearInterval(hb)
      document.removeEventListener('visibilitychange', arm)
      sw?.removeEventListener('controllerchange', onCtl)
      notifyServiceWorkerActiveChatMatch(null)
    }
  }, [isLive, conversation.matchId])

  useEffect(() => {
    if (isLive) return
    setMessages(conversation.messages)
  }, [conversation, isLive])

  useEffect(() => {
    if (!isLive || !conversation.matchId || !currentUserId) return
    let cancelled = false
    ;(async () => {
      const rows = await getMatchMessages(conversation.matchId!)
      if (cancelled) return
      if (rows === null) return
      const mapped = rows
        .map((r) => formatChatMessageFromRow(r, currentUserId))
        .sort(compareChatMessageTime)
      setMessages(mapped)
    })()
    return () => {
      cancelled = true
    }
  }, [isLive, conversation.matchId, currentUserId, foregroundReloadNonce, physicalChannelResubscribeNonce])

  useEffect(() => {
    if (!isLive || !conversation.matchId || !currentUserId) return
    return subscribeToMatchMessages(conversation.matchId, (row) => {
      const msg = formatChatMessageFromRow(row, currentUserId)
      setMessages((prev) => mergeUniqueChatMessages(prev, msg))
    })
  }, [isLive, conversation.matchId, currentUserId, foregroundReloadNonce, physicalChannelResubscribeNonce])

  useEffect(() => {
    if (!isLive || !conversation.matchId) return
    let cancelled = false
    ;(async () => {
      const row = await getPhotoUnlockState(conversation.matchId!)
      if (cancelled || !row?.unlocked_tiles) return
      setManualUnlockedTiles([...row.unlocked_tiles])
    })()
    return () => {
      cancelled = true
    }
  }, [isLive, conversation.matchId, foregroundReloadNonce, physicalChannelResubscribeNonce])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [messages])

  // When the keyboard opens/closes the viewport resizes — make sure the
  // latest message stays in view rather than getting hidden behind the composer.
  useEffect(() => {
    const vv = window.visualViewport
    let raf = 0
    const scrollBottomOnceSoon = () => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' }), 200)
    }
    const updateKeyboardState = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        const layoutH = window.innerHeight
        const vvH = vv?.height ?? layoutH
        const vvTop = vv?.offsetTop ?? 0
        /** 勿訂閱 visualViewport.scroll — 與 scrollIntoView 互觸發會整頁上下震 */
        const rawInset = vv ? Math.max(0, layoutH - vvH - vvTop) : 0
        const roundedInset = Math.max(0, Math.round(rawInset))
        const inputFocused = document.activeElement === inputRef.current
        const viewportShrunk = vv ? vvH < layoutH - 110 : false
        /** 進房時瀏覽列／視窗細微調整易被算成小 inset；非鍵盤情境歸零，避免 padding 抖動 */
        const ghostInset =
          roundedInset <= 36 && roundedInset > 0 && !inputFocused && !viewportShrunk

        const nextInset = ghostInset ? 0 : roundedInset
        const nextOpen = inputFocused || viewportShrunk

        const prevI = lastInsetCommitRef.current
        const prevO = lastKbOpenCommitRef.current
        /** 門檻內視為同值，免得 sub-pixel vv 無限 rerender／捲動 */
        const insetChanged =
          prevI === null ||
          (nextInset !== prevI &&
            (Math.abs(nextInset - prevI) >= 12 || nextInset === 0 || prevI === 0))
        const openChanged = prevO === null || prevO !== nextOpen

        if (insetChanged) {
          lastInsetCommitRef.current = nextInset
          setKeyboardInsetBottom(nextInset)
        }
        if (openChanged) {
          lastKbOpenCommitRef.current = nextOpen
          setIsKeyboardOpen(nextOpen)
        }
        if (insetChanged || openChanged) scrollBottomOnceSoon()
      })
    }
    updateKeyboardState()
    vv?.addEventListener('resize', updateKeyboardState)
    window.addEventListener('resize', updateKeyboardState)
    document.addEventListener('focusin', updateKeyboardState)
    document.addEventListener('focusout', updateKeyboardState)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv?.removeEventListener('resize', updateKeyboardState)
      window.removeEventListener('resize', updateKeyboardState)
      document.removeEventListener('focusin', updateKeyboardState)
      document.removeEventListener('focusout', updateKeyboardState)
    }
  }, [])

  const send = async () => {
    if (!input.trim()) return
    const nowMs = Date.now()
    const recent = recentSendTimes.filter((time) => nowMs - time < 60_000)
    // 與 DB `send_match_message` 每分鐘上限一致，避免只擋一般聊天
    if (recent.length >= 20) {
      setSendWarning('你傳送太快了，請稍等一下再傳。')
      return
    }

    if (isLive && conversation.matchId && currentUserId) {
      const res = await sendMatchMessage(conversation.matchId, input.trim())
      if (!res.ok) {
        setSendWarning(res.error ?? '無法送出訊息')
        return
      }
      if (res.message) {
        const msg = formatChatMessageFromRow(res.message, currentUserId)
        setMessages((prev) => mergeUniqueChatMessages(prev, msg))
      }
      setRecentSendTimes([...recent, nowMs])
      setSendWarning('')
      setInput('')
      return
    }

    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const iso = now.toISOString()
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${nowMs}`,
        text: input.trim(),
        from: 'me',
        time: `${hh}:${mm}`,
        date: '今天',
        read: false,
        createdAt: iso,
      },
    ])
    setRecentSendTimes([...recent, nowMs])
    setSendWarning('')
    setInput('')
  }

  const simulateTheirReply = () => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const iso = now.toISOString()
    const samples = [
      '我也回你一則，測試拼圖解鎖。',
      '哈哈這個功能感覺滿有趣的。',
      '那我再補一句，看看會不會多開一格。',
      '收到，換我回覆你。',
    ]
    setMessages((prev) => [
      ...prev,
      {
        id: `sim-${Date.now()}`,
        text: samples[prev.length % samples.length],
        from: 'them',
        time: `${hh}:${mm}`,
        date: '今天',
        createdAt: iso,
      },
    ])
  }

  const spendDemoUnlock = async () => {
    const photoSlots = Math.min(
      PUZZLE_MAX_PHOTO_SLOTS,
      Math.max(1, collectConversationPhotoUrls(conversation).length),
    )
    const progress = getPuzzleProgress(
      messages,
      manualUnlockedTiles,
      conversation.matchedAt,
      Date.now(),
      String(conversation.id),
      photoSlots,
      isLive,
    )
    if (progress.allPhotosComplete) return
    if (blurUnlockBalance <= 0) {
      onNeedSubscription()
      return
    }
    if (isLive && conversation.matchId) {
      const prevLen = manualUnlockedTiles.length
      const res = await spendBlurUnlockTile(conversation.matchId)
      await refreshCredits()
      if (!res.ok) {
        if ((res.error ?? '').toLowerCase().includes('insufficient')) {
          onNeedSubscription()
        } else {
          setSendWarning(res.error ?? '解鎖失敗')
        }
        return
      }
      if (res.state?.unlocked_tiles) {
        setManualUnlockedTiles(res.state.unlocked_tiles)
        if (res.state.unlocked_tiles.length > prevLen) {
          onBlurUnlockSpent?.()
        }
      }
      setSendWarning('')
      return
    }
    const unlockedLocal = new Set(progress.unlockedTiles)
    const lockedTiles = Array.from({ length: 16 }, (_, tile) => tile).filter((tile) => !unlockedLocal.has(tile))
    const nextLocal = lockedTiles[Math.floor(Math.random() * lockedTiles.length)]
    if (nextLocal == null) return
    const nextGlobal = progress.activePhotoIndex * 16 + nextLocal
    setManualUnlockedTiles((tiles) => [...tiles, nextGlobal])
    onDemoBlurSpent()
    onBlurUnlockSpent?.()
    setSendWarning('已使用 1 次解除拼圖，隨機解鎖 1 片。')
  }

  // Group consecutive messages from the same sender to suppress repeated avatars
  type Group = { from: 'me' | 'them'; date: string; items: ChatMessage[] }
  const groups: Group[] = []
  for (const m of [...messages].sort(compareChatMessageTime)) {
    const last = groups[groups.length - 1]
    if (last && last.from === m.from && last.date === m.date) {
      last.items.push(m)
    } else {
      groups.push({ from: m.from, date: m.date, items: [m] })
    }
  }

  // Date separators — detect when date changes across groups
  const renderBlocks: Array<{ type: 'date'; date: string } | { type: 'group'; group: Group }> = []
  let lastDate = ''
  for (const g of groups) {
    if (g.date !== lastDate) {
      renderBlocks.push({ type: 'date', date: g.date })
      lastDate = g.date
    }
    renderBlocks.push({ type: 'group', group: g })
  }

  return (
    <div
      className="relative flex flex-col h-full bg-white"
      style={
        keyboardInsetBottom > 0
          ? { paddingBottom: keyboardInsetBottom }
          : undefined
      }
    >
      <div
        className="flex-shrink-0 border-b border-slate-100 bg-white"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
      >
        <div className="flex items-center gap-2 px-2 py-1">
          <button
            onClick={onBack}
            aria-label="返回"
            className="h-9 w-9 shrink-0 rounded-full bg-slate-100 flex items-center justify-center active:bg-slate-200"
          >
            <ChevronLeft className="w-5 h-5 text-slate-700" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black leading-tight text-slate-900">{conversation.name}</p>
          </div>
          <button
            onClick={() => setBlockTarget({
              profileKey: conversation.peerUserId ? `user:${conversation.peerUserId}` : `demo:${String(conversation.id)}`,
              displayName: conversation.name,
              userId: conversation.peerUserId ?? null,
            })}
            aria-label="封鎖對方"
            className="h-8 rounded-full bg-slate-100 px-3 text-[11px] font-bold text-red-500 active:bg-slate-200"
          >
            封鎖
          </button>
        </div>
        <PuzzlePhotoUnlock
          conversation={conversation}
          messages={messages}
          manualUnlockedTiles={manualUnlockedTiles}
          isKeyboardOpen={isKeyboardOpen}
          onSpendUnlock={spendDemoUnlock}
          liveUseDbTilesOnly={isLive}
          onPuzzleSlotComplete={
            !isLive && typeof conversation.id === 'number'
              ? (slot: number) => onDemoPuzzleSlotCleared?.(conversation.id as number, slot)
              : undefined
          }
        />
      </div>

      {/* Messages */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1 bg-slate-50/70"
        style={{ WebkitOverflowScrolling: 'touch', scrollPaddingBottom: 72 }}
      >
        <div className="mb-2 flex justify-center">
          {!isLive && (
            <button
              type="button"
              onClick={simulateTheirReply}
              className="rounded-full bg-violet-50 px-3 py-1.5 text-[11px] font-black text-violet-600 ring-1 ring-violet-100"
            >
              測試：讓對方傳一則訊息
            </button>
          )}
        </div>
        {renderBlocks.map((block, bi) => {
          if (block.type === 'date') {
            return (
              <div key={`date-${bi}`} className="flex justify-center py-2">
                <span className="text-[11px] text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                  {block.date}
                </span>
              </div>
            )
          }

          const g = block.group
          const isMe = g.from === 'me'
          return (
            <div key={`grp-${bi}`} className={cn('flex items-end gap-2', isMe ? 'justify-end' : 'justify-start')}>
              {/* Avatar column — only on their side, only on the LAST bubble of the group (bottom-aligned) */}
              {!isMe && (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-[12px] flex-shrink-0"
                  style={{ background: `linear-gradient(135deg, ${conversation.from}, ${conversation.to})` }}
                >
                  {conversation.initials}
                </div>
              )}

              <div className={cn('flex flex-col gap-1 max-w-[72%]', isMe ? 'items-end' : 'items-start')}>
                {!isMe && (
                  <p className="text-[11px] text-slate-500 px-1">{conversation.name}</p>
                )}
                {g.items.map((msg, mi) => {
                  const isLast = mi === g.items.length - 1
                  return (
                    <div key={msg.id} className={cn('flex items-end gap-1.5', isMe ? 'flex-row' : 'flex-row-reverse')}>
                      {/* Timestamp — shown only under the LAST bubble of a burst */}
                      {isLast && (
                        <div className={cn('flex flex-col text-[10px] text-slate-400', isMe ? 'items-end' : 'items-start')}>
                          {isMe && msg.read && <span className="leading-none">已讀</span>}
                          <span className="leading-none mt-0.5">{msg.time}</span>
                        </div>
                      )}
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          'px-3.5 py-2 text-[14px] leading-[1.45] whitespace-pre-wrap break-words',
                          isMe
                            ? 'bg-[#8fe37f] text-slate-900 rounded-2xl rounded-br-md'
                            : 'bg-slate-100 text-slate-900 rounded-2xl rounded-bl-md',
                        )}
                        onDoubleClick={() => !isMe && setReportMessage(msg)}
                        onContextMenu={(e) => {
                          if (!isMe) {
                            e.preventDefault()
                            setReportMessage(msg)
                          }
                        }}
                        role={!isMe ? 'button' : undefined}
                        title={!isMe ? '長按或點兩下可檢舉此訊息' : undefined}
                      >
                        {msg.text}
                      </motion.div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 px-2 py-1.5 bg-white border-t border-slate-200 flex items-center gap-1.5">
        {sendWarning && (
          <div className="absolute bottom-[54px] left-3 right-3 rounded-2xl bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-600">
            {sendWarning}
          </div>
        )}
        <button className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 active:bg-slate-100 flex-shrink-0">
          <Plus className="w-5 h-5" />
        </button>
        <div className="flex-1 flex items-center bg-slate-100 rounded-full pl-4 pr-1 min-h-[38px]">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
            onFocus={() => {
              /** 交由 focusin + visualViewport resize 統一推算；此處只做鍵盤動畫後一次補捲避免與 vv 對打 */
              window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' }), 280)
              onChatInputFocus?.()
            }}
            onBlur={() => {
              onChatInputBlur?.()
            }}
            placeholder="輸入訊息"
            style={{ fontSize: '16px' }}
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-400 py-1"
          />
          <button className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 flex-shrink-0">
            <Smile className="w-[18px] h-[18px]" />
          </button>
        </div>
        {input.trim() ? (
          <motion.button
            onMouseDown={(e) => e.preventDefault()}
            onClick={send}
            whileTap={{ scale: 0.9 }}
            className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0"
          >
            <Send className="w-4 h-4 text-white" />
          </motion.button>
        ) : (
          <button className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 active:bg-slate-100 flex-shrink-0">
            <Camera className="w-5 h-5" />
          </button>
        )}
      </div>
      <AnimatePresence>
        {reportMessage && (
          <ReportMessageModal
            target={{
              displayName: conversation.name,
              messageBody: reportMessage.text,
              reportedProfileKey: conversation.peerUserId ? `user:${conversation.peerUserId}` : `demo:${String(conversation.id)}`,
              reportedUserId: conversation.peerUserId ?? null,
              messageId: String(reportMessage.id),
              matchId: conversation.matchId ?? null,
            }}
            onClose={() => setReportMessage(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {blockTarget && (
          <BlockProfileConfirm
            target={blockTarget}
            onClose={() => setBlockTarget(null)}
            onBlocked={onBack}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

// ─── Edit Profile (Full Screen) ───────────────────────────────────────────────

interface LocalPhoto {
  id: string
  previewUrl: string
  storagePath?: string  // already uploaded
  file?: File           // new, not yet uploaded
}

const REGION_OPTIONS: Region[] = ['north', 'central', 'south', 'east']

function EditRegionGrid({
  value,
  onChange,
}: {
  value: Region | ''
  onChange: (r: Region) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {REGION_OPTIONS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={cn(
            'py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
            value === r
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 text-slate-500 bg-white',
          )}
        >
          {REGION_LABELS[r]}
        </button>
      ))}
    </div>
  )
}

function EditProfileScreen({
  profile,
  userId,
  onClose,
  onSaved,
}: {
  profile: ProfileRow
  userId: string
  onClose: () => void
  onSaved: (updated: ProfileRow) => void
}) {
  const [name, setName]     = useState(profile.name ?? '')
  const [nickname, setNickname] = useState(profile.nickname ?? '')
  const [bio, setBio]       = useState(profile.bio ?? '')
  const [workRegion,      setWorkRegion]      = useState<import('@/lib/types').Region | ''>(profile.work_region ?? '')
  const [homeRegion,      setHomeRegion]      = useState<import('@/lib/types').Region | ''>(profile.home_region ?? '')
  const [preferredRegion, setPreferredRegion] = useState<import('@/lib/types').Region | ''>(profile.preferred_region ?? '')
  const [showIncomeBorder, setShowIncomeBorder] = useState<boolean>(profile.show_income_border ?? false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Photos
  const [photos, setPhotos] = useState<LocalPhoto[]>(() =>
    (profile.photo_urls ?? []).map((p, i) => ({ id: `existing-${i}`, previewUrl: p, storagePath: p })),
  )
  const photoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false

    const loadExistingPhotoUrls = async () => {
      const storedPaths = profile.photo_urls ?? []
      if (storedPaths.length === 0) {
        setPhotos([])
        return
      }

      const signedUrls = await resolvePhotoUrls(storedPaths)
      if (cancelled) return

      setPhotos((prev) => {
        const newPhotos = prev.filter((photo) => photo.file)
        const existingPhotos = storedPaths.map((path, i) => ({
          id: `existing-${i}`,
          previewUrl: signedUrls[i] ?? path,
          storagePath: path,
        }))
        return [...existingPhotos, ...newPhotos].slice(0, PROFILE_PHOTO_MAX)
      })
    }

    loadExistingPhotoUrls()
    return () => { cancelled = true }
  }, [profile.photo_urls])

  // Questionnaire
  const [qa, setQa] = useState<QuestionnaireEntry[]>(() =>
    profile.questionnaire ?? [],
  )

  // Income verification status (for display — auto re-loaded after upload completes)
  const [incomeStatus, setIncomeStatus] = useState<{
    status: 'pending' | 'approved' | 'rejected'
    claimed: IncomeTier | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    getIncomeVerification(userId).then((row) => {
      if (cancelled) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any
      if (r) setIncomeStatus({ status: r.status, claimed: r.claimed_income_tier })
      else   setIncomeStatus(null)
    })
    return () => { cancelled = true }
  }, [userId])

  // Income upload form state
  const [incomeUploadTier, setIncomeUploadTier] = useState<IncomeTier | null>(null)
  const [incomeUploadFile, setIncomeUploadFile] = useState<File | null>(null)
  const [uploadingIncome, setUploadingIncome] = useState(false)
  const [incomeSubmitMsg, setIncomeSubmitMsg] = useState('')
  const [incomeReviewCountdown, setIncomeReviewCountdown] = useState(0)
  const incomeAiFinalizePendingRef = useRef(false)
  const incomeDocRef = useRef<HTMLInputElement>(null)
  const canSubmitIncomeVerification =
    profile.gender === 'female' || profile.verification_status === 'approved'

  useEffect(() => {
    if (incomeReviewCountdown <= 0) return
    const timer = window.setTimeout(() => setIncomeReviewCountdown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [incomeReviewCountdown])

  useEffect(() => {
    if (incomeReviewCountdown > 0) return
    if (!incomeAiFinalizePendingRef.current) return
    incomeAiFinalizePendingRef.current = false
    let cancelled = false
    ;(async () => {
      await finalizeDueAiReviews()
      const latestProfile = await getProfile(userId)
      const row = await getIncomeVerification(userId)
      if (cancelled) return
      if (row && typeof row === 'object' && 'status' in row && 'claimed_income_tier' in row) {
        const r = row as { status: 'pending' | 'approved' | 'rejected'; claimed_income_tier: IncomeTier | null }
        setIncomeStatus({ status: r.status, claimed: r.claimed_income_tier })
      }
      if (latestProfile) {
        onSaved(latestProfile)
        if (latestProfile.income_tier) {
          setIncomeSubmitMsg('AI 審核已通過，收入認證完成。')
        } else {
          setIncomeSubmitMsg((prev) =>
            prev.trim() !== '' ? prev : '若 AI 無法確認將轉人工審核，人工審核時間可能大於 12 小時。',
          )
        }
      }
    })()
    return () => { cancelled = true }
  }, [incomeReviewCountdown, userId])

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const fileToEnhancedBase64 = (file: File): Promise<string> =>
    new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        fileToBase64(file).then(resolve)
        return
      }

      const img = new Image()
      const objectUrl = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        const maxSide = 2600
        const scale = Math.min(3, Math.max(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          fileToBase64(file).then(resolve)
          return
        }
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.filter = 'contrast(1.22) brightness(1.06) saturate(0.85)'
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.95))
      }
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        fileToBase64(file).then(resolve)
      }
      img.src = objectUrl
    })

  const reviewIncomeWithAI = async (file: File, tier: IncomeTier) => {
    if (!file.type.startsWith('image/')) {
      return {
        passed: false,
        company: null,
        confidence: null,
        reason: 'PDF 文件無法即時 AI 審核，已轉人工審核。人工審核時間可能大於 12 小時。',
      } as const
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5 * 60 * 1000)
    try {
      const imageBase64 = await fileToEnhancedBase64(file)
      const response = await fetch('/api/verify-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          verificationKind: 'income',
          claimedIncomeTier: tier,
          claimedName: profile.name ?? undefined,
          claimedCompany: profile.company ?? undefined,
          docType: 'other',
        }),
        signal: controller.signal,
      })
      const data = await response.json() as {
        ok: boolean
        confidence?: string
        suggestedIncomeTier?: string | null
        message: string
        reason?: string
      }
      const confidence: AiConfidence | null =
        data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low'
          ? data.confidence
          : null
      return {
        passed: data.ok,
        company: null,
        confidence,
        suggestedIncomeTier: toIncomeTier(data.suggestedIncomeTier),
        reason: data.reason ?? data.message,
      }
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const submitIncome = async () => {
    if (!incomeUploadTier || !incomeUploadFile) return
    setIncomeSubmitMsg('')
    if (!canSubmitIncomeVerification) {
      setIncomeSubmitMsg('請先完成職業資料認證，通過後才能申請薪資收入審核。')
      return
    }
    setUploadingIncome(true)
    const count = await getTodayVerificationSubmissionCount(userId)
    if (count >= 20) {
      setIncomeSubmitMsg('今天已達送審上限 20 次，請明天再試。')
      setUploadingIncome(false)
      return
    }

    const optimisticIncomeTier = incomeUploadTier
    incomeAiFinalizePendingRef.current = false
    setIncomeStatus({ status: 'pending', claimed: optimisticIncomeTier })
    setIncomeReviewCountdown(0)
    setIncomeSubmitMsg('正在上傳並送審⋯')

    let aiResult: Awaited<ReturnType<typeof reviewIncomeWithAI>>
    let reviewMode: 'ai_auto' | 'manual' = 'manual'
    let manualReason = ''
    try {
      aiResult = await reviewIncomeWithAI(incomeUploadFile, incomeUploadTier)
      if (aiResult.passed) {
        reviewMode = 'ai_auto'
      } else {
        manualReason = aiResult.reason || 'AI 未通過，已轉人工審核。人工審核時間可能大於 12 小時。'
        setIncomeSubmitMsg(manualReason)
      }
    } catch {
      aiResult = {
        passed: false,
        company: null,
        confidence: null,
        suggestedIncomeTier: null,
        reason: 'AI 暫時無法完成審核，已轉人工審核。人工審核時間可能大於 12 小時。',
      }
      manualReason = aiResult.reason
      setIncomeSubmitMsg(manualReason)
    }

    const res = await uploadProofDoc(userId, incomeUploadFile)
    if (res.ok) {
      await submitIncomeVerification(userId, incomeUploadTier, 'payslip', res.path, aiResult, reviewMode, manualReason)
      setIncomeUploadFile(null)
      setIncomeUploadTier(null)
      if (reviewMode === 'ai_auto') {
        incomeAiFinalizePendingRef.current = true
        setIncomeReviewCountdown(AI_AUTO_REVIEW_UI_SECONDS)
        setIncomeSubmitMsg(`AI 審核倒數 ${AI_AUTO_REVIEW_UI_SECONDS} 秒。`)
      }
    } else {
      incomeAiFinalizePendingRef.current = false
      setIncomeStatus(null)
      setIncomeReviewCountdown(0)
      setIncomeSubmitMsg(`文件上傳失敗：${res.error ?? '請稍後再試'}`)
    }
    setUploadingIncome(false)
  }

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    const newItems: LocalPhoto[] = Array.from(files)
      .slice(0, PROFILE_PHOTO_MAX - photos.length)
      .map((f) => ({
        id: `new-${Date.now()}-${f.name}`,
        previewUrl: URL.createObjectURL(f),
        file: f,
      }))
    setPhotos((prev) => [...prev, ...newItems].slice(0, PROFILE_PHOTO_MAX))
  }

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const removed = prev.find((p) => p.id === id)
      if (removed?.file) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }

  const updateAnswer = (index: number, answer: string) => {
    setQa((prev) => prev.map((q, i) => i === index ? { ...q, answer } : q))
  }

  const save = async () => {
    if (!name.trim()) return
    const photoSlots = photos.filter((p) => p.storagePath || p.file)
    if (photoSlots.length < PROFILE_PHOTO_MIN) {
      setSaveMsg(`請至少上傳 ${PROFILE_PHOTO_MIN} 張生活照`)
      setTimeout(() => setSaveMsg(''), 3200)
      return
    }
    setSaving(true)
    setSaveMsg('')

    // Upload new photos
    const uploadedPaths: string[] = []
    for (const photo of photos) {
      if (photo.storagePath) {
        uploadedPaths.push(photo.storagePath)
      } else if (photo.file) {
        const res = await uploadPhoto(userId, photo.file)
        if (res.ok) uploadedPaths.push(res.path)
      }
    }

    const result = await upsertProfile({
      userId,
      name: name.trim(),
      nickname: nickname.trim(),
      bio: bio.trim(),
      questionnaire: qa.length > 0 ? qa : undefined,
      photoUrls: uploadedPaths.length > 0 ? uploadedPaths : undefined,
      workRegion:      workRegion      === '' ? null : workRegion,
      homeRegion:      homeRegion      === '' ? null : homeRegion,
      preferredRegion: preferredRegion === '' ? null : preferredRegion,
      showIncomeBorder,
    })

    setSaving(false)
    if (!result.ok) {
      setSaveMsg('儲存失敗，請稍後再試')
      setTimeout(() => setSaveMsg(''), 3000)
      return
    }
    setSaveMsg('已儲存 ✓')
    setTimeout(() => setSaveMsg(''), 1800)

    const updated: ProfileRow = {
      ...profile,
      name: name.trim(),
      nickname: nickname.trim(),
      bio: bio.trim(),
      questionnaire: qa.length > 0 ? qa : profile.questionnaire,
      photo_urls: uploadedPaths.length > 0 ? uploadedPaths : profile.photo_urls,
      work_region:      workRegion      === '' ? null : workRegion,
      home_region:      homeRegion      === '' ? null : homeRegion,
      preferred_region: preferredRegion === '' ? null : preferredRegion,
      show_income_border: showIncomeBorder,
    }
    onSaved(updated)
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[100] bg-[#fafafa] flex flex-col"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 36 }}
    >
      {/* Sticky header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 pt-safe pb-3 bg-[#fafafa] border-b border-slate-100">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </motion.button>

        <span className="font-bold text-slate-900 text-[15px]">編輯個人資訊</span>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={save}
          disabled={!name.trim() || !nickname.trim() || saving || photos.filter((p) => p.storagePath || p.file).length < PROFILE_PHOTO_MIN}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-bold transition-all',
            name.trim() && nickname.trim() && !saving && photos.filter((p) => p.storagePath || p.file).length >= PROFILE_PHOTO_MIN
              ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
              : 'bg-slate-100 text-slate-300',
          )}
        >
          {saving
            ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}><Cpu className="w-4 h-4" /></motion.div>
            : <Check className="w-4 h-4" />}
          {saveMsg || '儲存'}
        </motion.button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6" style={{ WebkitOverflowScrolling: 'touch' }}>

        {/* ── 基本資料 ─────────────────────────────────── */}
        <section>
          <SectionHeading label="基本資料" />

          <div className="space-y-3">
            <div>
              <label className="field-label">真實姓名 <span className="text-red-400">*</span></label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                placeholder="僅用於認證，不會顯示在探索頁"
                className="field-input"
              />
            </div>

            <div>
              <label className="field-label">暱稱 <span className="text-red-400">*</span></label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                placeholder="對方看到的顯示名稱"
                className="field-input"
              />
            </div>

            <div>
              <label className="field-label">自我介紹</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                placeholder="用幾句話介紹生活與個性即可，不必寫公司或職稱⋯"
                rows={4}
                className="field-input resize-none leading-relaxed"
              />
            </div>
          </div>
        </section>

        {/* ── 地點 ─────────────────────────────────────── */}
        <section>
          <SectionHeading label="地點" hint="影響配對範圍" />

          <div className="space-y-4">
            <div>
              <label className="field-label">工作地點</label>
              <EditRegionGrid value={workRegion} onChange={setWorkRegion} />
            </div>
            <div>
              <label className="field-label">戶籍地</label>
              <EditRegionGrid value={homeRegion} onChange={setHomeRegion} />
            </div>
            <div>
              <label className="field-label">希望配對的對象所在地</label>
              <EditRegionGrid value={preferredRegion} onChange={setPreferredRegion} />
              <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                對方的工作地或戶籍地其中一個符合就會出現在探索頁
              </p>
            </div>
          </div>
        </section>

        {/* ── 生活照 ───────────────────────────────────── */}
        <section>
          <SectionHeading label="生活照" hint={`${photos.length} / ${PROFILE_PHOTO_MAX} 張，至少 ${PROFILE_PHOTO_MIN} 張`} />

          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <div key={photo.id} className="relative aspect-square rounded-2xl overflow-hidden bg-slate-100">
                <img
                  src={photo.previewUrl}
                  alt=""
                  className="w-full h-full object-cover scale-110"
                  style={{ filter: 'blur(6px)' }}
                />
                <div className="absolute inset-0 bg-black/10" />
                <div className="absolute left-2 right-2 bottom-2 rounded-xl bg-white/80 backdrop-blur-sm px-2.5 py-1.5">
                  <p className="text-[10px] font-semibold text-slate-700 text-center tracking-wide">
                    隱私保護預覽
                  </p>
                </div>
                <button
                  onClick={() => removePhoto(photo.id)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/50 backdrop-blur rounded-full flex items-center justify-center"
                >
                  <Trash2 className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}

            {photos.length < PROFILE_PHOTO_MAX && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => clickFileInputWithGrace(photoInputRef.current)}
                className="aspect-square rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1 bg-white"
              >
                <Camera className="w-5 h-5 text-slate-300" />
                <span className="text-[10px] text-slate-300 font-medium">新增照片</span>
              </motion.button>
            )}

            {photos.length === 0 && (
              <div className="col-span-2 aspect-[2/1] rounded-2xl border-2 border-dashed border-slate-100 flex items-center justify-center bg-slate-50">
                <div className="text-center">
                  <ImageIcon className="w-8 h-8 text-slate-200 mx-auto mb-1" />
                  <p className="text-xs text-slate-300">最多 {PROFILE_PHOTO_MAX} 張生活照，至少 {PROFILE_PHOTO_MIN} 張</p>
                </div>
              </div>
            )}
          </div>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => addPhotos(e.target.files)}
          />
          <p className="text-xs text-slate-400 mt-2">上傳預覽會先以霧化方式顯示，正式照片會保留原始清晰版本。</p>
        </section>

        {/* ── 收入認證 皇冠特效 ─────────────────────────── */}
        <section>
          <SectionHeading
            label="收入認證皇冠特效"
            hint={
              profile.income_tier
                ? '可切換顯示'
                : profile.gender === 'female'
                  ? '選填，可不申請'
                  : undefined
            }
          />

          {profile.income_tier ? (
            <div className="bg-white rounded-3xl p-4 shadow-sm ring-1 ring-slate-100 space-y-3">
              {/* Preview with/without border */}
              <div className="flex items-center gap-4">
                <IncomeBorder
                  tier={showIncomeBorder ? profile.income_tier : null}
                  radius="0.75rem"
                  thickness={6}
                  crownCompact
                >
                  <div className="w-20 h-20 bg-slate-100 flex items-center justify-center text-slate-400 font-black text-xl">
                    {(profile.name ?? '?').charAt(0)}
                  </div>
                </IncomeBorder>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 leading-tight flex items-center gap-1.5">
                    <Gem className="w-4 h-4 text-slate-600" />
                    {INCOME_TIER_META[profile.income_tier].label}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {INCOME_TIER_META[profile.income_tier].range}
                  </p>
                  <p className="text-[11px] text-emerald-500 mt-0.5 font-semibold">✓ 已通過審核</p>
                </div>
              </div>

              {/* Toggle */}
              <button
                onClick={() => setShowIncomeBorder((v) => !v)}
                className={cn(
                  'w-full py-3 rounded-2xl text-sm font-bold flex items-center justify-between px-4 transition-all',
                  showIncomeBorder
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600',
                )}
              >
                <span>{showIncomeBorder ? '已啟用皇冠特效' : '未啟用'}</span>
                <div className={cn(
                  'w-11 h-6 rounded-full p-0.5 transition-all',
                  showIncomeBorder ? 'bg-white/30' : 'bg-slate-300',
                )}>
                  <div className={cn(
                    'w-5 h-5 rounded-full bg-white transition-all',
                    showIncomeBorder && 'translate-x-5',
                  )} />
                </div>
              </button>
              <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                啟用後，所有人看你的照片都會加上 {INCOME_TIER_META[profile.income_tier].short} 。
              </p>
            </div>
          ) : incomeStatus?.status === 'pending' ? (
            <div className="bg-amber-50 rounded-2xl p-4 ring-1 ring-amber-100">
              <p className="text-sm font-bold text-amber-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                收入認證審核中
              </p>
              <p className="text-xs text-amber-700/70 mt-1 leading-relaxed">
                你申請的 {incomeStatus.claimed ? INCOME_TIER_META[incomeStatus.claimed].label : '收入'} 正在審核。{incomeReviewCountdown > 0 ? `AI 審核倒數 ${incomeReviewCountdown} 秒。` : `AI 審核時間為 ${AI_AUTO_REVIEW_UI_SECONDS} 秒；若 AI 無法確認，會轉人工審核，人工審核時間可能大於 12 小時。`}
              </p>
            </div>
          ) : (
            /* Rejected or not yet submitted — show upload form */
            <div className="bg-white rounded-2xl p-4 ring-1 ring-slate-100 shadow-sm space-y-4">
              {!canSubmitIncomeVerification && (
                <div className="bg-slate-50 rounded-xl px-3 py-2.5 ring-1 ring-slate-100">
                  <p className="text-xs font-bold text-slate-600">請先完成職業資料認證，通過後才能申請薪資收入審核。</p>
                </div>
              )}
              {incomeStatus?.status === 'rejected' && (
                <div className="bg-rose-50 rounded-xl px-3 py-2.5 ring-1 ring-rose-100">
                  <p className="text-xs font-bold text-rose-700">上次送審未通過，請重新上傳更清晰的文件</p>
                </div>
              )}
              <div>
                <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3">
                  <Gem className="w-4 h-4 text-slate-500" />
                  上傳收入證明文件
                </p>
                <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                  可上傳薪資單、扣繳憑單、銀行對帳單等。AI 審核時間為 {AI_AUTO_REVIEW_UI_SECONDS} 秒；送出後會顯示倒數。若 AI 無法確認，會轉人工審核，人工審核時間可能大於 12 小時。
                </p>

                {/* Tier picker */}
                <p className="text-xs font-semibold text-slate-600 mb-2">選擇申請等級</p>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {(['silver','gold','diamond'] as IncomeTier[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setIncomeUploadTier(t)}
                      className={cn(
                        'rounded-xl p-2.5 text-center ring-1 transition-all',
                        incomeUploadTier === t
                          ? 'ring-slate-900 bg-slate-900 text-white'
                          : 'ring-slate-200 bg-white text-slate-700',
                      )}
                    >
                      <p className="text-xs font-bold leading-tight">{INCOME_TIER_META[t].label}</p>
                      <p className="text-[10px] opacity-70 mt-0.5 leading-tight">{INCOME_TIER_META[t].range}</p>
                    </button>
                  ))}
                </div>

                {/* File upload */}
                <input
                  ref={incomeDocRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  disabled={!canSubmitIncomeVerification}
                  onChange={(e) => setIncomeUploadFile(e.target.files?.[0] ?? null)}
                />
                <button
                  onClick={() => {
                    if (!canSubmitIncomeVerification) return
                    clickFileInputWithGrace(incomeDocRef.current)
                  }}
                  disabled={!canSubmitIncomeVerification}
                  className={cn(
                    'w-full rounded-2xl border-2 border-dashed py-4 flex flex-col items-center gap-1.5 transition-all',
                    !canSubmitIncomeVerification
                      ? 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
                      : incomeUploadFile ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50',
                  )}
                >
                  {incomeUploadFile ? (
                    <>
                      <FileText className="w-5 h-5 text-emerald-500" />
                      <p className="text-xs font-semibold text-emerald-700 truncate max-w-[200px]">{incomeUploadFile.name}</p>
                      <p className="text-[10px] text-emerald-500">點擊重新選擇</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5 text-slate-300" />
                      <p className="text-xs text-slate-400 font-medium">點擊上傳照片或 PDF</p>
                      <p className="text-[10px] text-slate-300">AI 審核時間為 {AI_AUTO_REVIEW_UI_SECONDS} 秒，送出後倒數</p>
                    </>
                  )}
                </button>

                {incomeSubmitMsg && (
                  <div className={cn(
                    'mt-3 rounded-2xl px-4 py-3 ring-1',
                    incomeSubmitMsg.includes('上限') || incomeSubmitMsg.includes('人工') || incomeSubmitMsg.includes('拒絕')
                      ? 'bg-amber-50 ring-amber-100'
                      : 'bg-blue-50 ring-blue-100',
                  )}>
                    <p className="text-xs font-medium leading-relaxed text-slate-700">{incomeSubmitMsg}</p>
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={submitIncome}
                  disabled={!canSubmitIncomeVerification || !incomeUploadTier || !incomeUploadFile || uploadingIncome}
                  className={cn(
                    'mt-3 w-full py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all',
                    canSubmitIncomeVerification && incomeUploadTier && incomeUploadFile && !uploadingIncome
                      ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
                      : 'bg-slate-100 text-slate-300',
                  )}
                >
                  {uploadingIncome
                    ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}><Cpu className="w-4 h-4" /></motion.div>
                    : <ShieldCheck className="w-4 h-4" />}
                  {uploadingIncome ? '上傳中⋯' : '送出認證申請'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── 價值觀問答 ────────────────────────────────── */}
        {qa.length > 0 && (
          <section>
            <SectionHeading label="價值觀問答" hint="可修改你的答案" />

            <div className="space-y-4">
              {qa.map((entry, i) => (
                <div key={entry.id} className="bg-white rounded-3xl p-4 shadow-sm ring-1 ring-slate-100">
                  <div className="flex items-start gap-2 mb-3">
                    <span className="w-5 h-5 rounded-md bg-slate-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-white text-[9px] font-black">Q{i + 1}</span>
                    </span>
                    <p className="text-[13px] font-semibold text-slate-800 leading-snug">{entry.text}</p>
                  </div>
                  <textarea
                    value={entry.answer}
                    onChange={(e) => updateAnswer(i, e.target.value)}
                    onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                    rows={4}
                    placeholder="修改你的回答⋯"
                    className="w-full text-sm text-slate-700 placeholder:text-slate-300 leading-relaxed bg-slate-50 rounded-2xl px-3.5 py-3 outline-none focus:ring-1 focus:ring-slate-300 transition resize-none"
                  />
                  <p className="text-[10px] text-slate-300 text-right mt-1">{entry.answer.length} 字</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="h-6" />
      </div>
    </motion.div>,
    document.body,
  )
}

// ─── Company Verify Screen ────────────────────────────────────────────────────

const COMPANY_DOC_TYPES: { value: 'employee_id' | 'tax_return' | 'payslip'; label: string }[] = [
  { value: 'employee_id', label: '員工證 / 識別證' },
  { value: 'tax_return',  label: '扣繳憑單' },
  { value: 'payslip',     label: '薪資單' },
]

function CompanyVerifyScreen({
  profile, userId, onClose, onVerified,
}: {
  profile: ProfileRow
  userId: string
  onClose: () => void
  onVerified: (updated: ProfileRow) => void
}) {
  const isApproved  = profile.verification_status === 'approved'
  const isSubmitted = profile.verification_status === 'submitted'

  const [selectedCompany, setSelectedCompany] = useState<'TSMC' | 'MediaTek' | ''>('TSMC')
  const [selectedDocType, setSelectedDocType]   = useState<'employee_id' | 'tax_return' | 'payslip' | ''>('')
  const [docFile, setDocFile]   = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [aiMessage, setAiMessage] = useState('')
  const [companyReviewCountdown, setCompanyReviewCountdown] = useState(0)
  const [linkedIncomeTier, setLinkedIncomeTier] = useState<IncomeTier | null>(null)
  const companyAiFinalizePendingRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const canLinkIncomeVerification = selectedDocType === 'tax_return' || selectedDocType === 'payslip'

  useEffect(() => {
    if (companyReviewCountdown <= 0) return
    const timer = window.setTimeout(() => setCompanyReviewCountdown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [companyReviewCountdown])

  useEffect(() => {
    if (companyReviewCountdown > 0) return
    if (!submitted) return
    if (!companyAiFinalizePendingRef.current) return
    companyAiFinalizePendingRef.current = false
    let cancelled = false
    ;(async () => {
      await finalizeDueAiReviews()
      const latest = await getProfile(userId)
      if (cancelled || !latest) return
      onVerified(latest)
      if (latest.verification_status === 'approved') {
        setAiMessage('AI 審核已通過，公司認證完成。')
      } else {
        setAiMessage((prev) =>
          prev.trim() !== '' ? prev : '若 AI 無法確認將轉人工審核，人工審核時間可能大於 12 小時。',
        )
      }
    })()
    return () => { cancelled = true }
  }, [companyReviewCountdown, submitted, userId])

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const fileToEnhancedBase64 = (file: File): Promise<string> =>
    new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        fileToBase64(file).then(resolve)
        return
      }

      const img = new Image()
      const objectUrl = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        const maxSide = 2600
        const scale = Math.min(3, Math.max(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          fileToBase64(file).then(resolve)
          return
        }
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.filter = 'contrast(1.22) brightness(1.06) saturate(0.85)'
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.95))
      }
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        fileToBase64(file).then(resolve)
      }
      img.src = objectUrl
    })

  const verifyCompanyDocWithAI = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      return {
        passed: false,
        company: null,
        confidence: null,
        reason: 'PDF 文件無法即時 AI 審核，已轉人工審核。人工審核時間可能大於 12 小時。',
      } as const
    }

    setAiMessage('AI 正在辨識員工證⋯')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5 * 60 * 1000)
    try {
      const imageBase64 = await fileToEnhancedBase64(file)
      const response = await fetch('/api/verify-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          verificationKind: 'employment',
          claimedName: profile.name ?? undefined,
          claimedCompany: selectedCompany || undefined,
          docType: selectedDocType || undefined,
        }),
        signal: controller.signal,
      })
      const data = await response.json() as {
        ok: boolean
        company?: string
        confidence?: string
        suggestedIncomeTier?: string | null
        message: string
        reason?: string
      }

      const aiCompany: Company | null = data.company === 'TSMC' || data.company === 'MediaTek' ? data.company : null
      const aiConfidence: AiConfidence | null = data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low'
        ? data.confidence
        : null

      return {
        passed: data.ok,
        company: aiCompany,
        confidence: aiConfidence,
        suggestedIncomeTier: toIncomeTier(data.suggestedIncomeTier),
        reason: data.reason ?? data.message,
      }
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const verifyLinkedIncomeWithAI = async (file: File, tier: IncomeTier) => {
    if (!file.type.startsWith('image/')) {
      return {
        passed: false,
        company: null,
        confidence: null,
        reason: 'PDF 文件將由人工審核確認。人工審核時間可能大於 12 小時。',
      } as const
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5 * 60 * 1000)
    try {
      const imageBase64 = await fileToEnhancedBase64(file)
      const response = await fetch('/api/verify-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          verificationKind: 'income',
          claimedIncomeTier: tier,
          claimedName: profile.name ?? undefined,
          claimedCompany: selectedCompany || profile.company || undefined,
          docType: selectedDocType || undefined,
        }),
        signal: controller.signal,
      })
      const data = await response.json() as {
        ok: boolean
        confidence?: string
        suggestedIncomeTier?: string | null
        message: string
        reason?: string
      }
      const aiConfidence: AiConfidence | null = data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low'
        ? data.confidence
        : null
      return {
        passed: data.ok,
        company: null,
        confidence: aiConfidence,
        suggestedIncomeTier: toIncomeTier(data.suggestedIncomeTier),
        reason: data.reason ?? data.message,
      }
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const submit = async () => {
    if (!selectedCompany || !selectedDocType || !docFile) return
    setSubmitError('')
    setAiMessage('')
    setSubmitting(true)
    const count = await getTodayVerificationSubmissionCount(userId)
    if (count >= 20) {
      setSubmitError('今天已達送審上限 20 次，請明天再試。')
      setSubmitting(false)
      return
    }

    const optimisticCompany = selectedCompany
    companyAiFinalizePendingRef.current = false
    setSubmitted(true)
    setCompanyReviewCountdown(0)
    setAiMessage('正在上傳並送審⋯')
    onVerified({ ...profile, company: optimisticCompany, verification_status: 'submitted' })

    let aiResult: Awaited<ReturnType<typeof verifyCompanyDocWithAI>>
    let reviewMode: 'ai_auto' | 'manual' = 'manual'
    let manualReason = ''
    try {
      aiResult = await verifyCompanyDocWithAI(docFile)
    } catch {
      aiResult = {
        passed: false,
        company: null,
        confidence: null,
        suggestedIncomeTier: null,
        reason: 'AI 暫時無法完成審核，已轉人工審核。人工審核時間可能大於 12 小時。',
      }
    }

    if (!aiResult.passed) {
      manualReason = aiResult.reason || 'AI 初審未通過，已轉人工審核。人工審核時間可能大於 12 小時。'
      setAiMessage(manualReason)
    } else if (selectedDocType === 'employee_id') {
      reviewMode = 'ai_auto'
    } else {
      reviewMode = 'manual'
      manualReason = 'AI 已初步辨識文件內容；扣繳憑單/薪資單字體較小，需人工覆核公司與姓名後才會通過。人工審核時間可能大於 12 小時。'
      setAiMessage(manualReason)
    }

    if (aiResult.company) setSelectedCompany(aiResult.company)

    const res = await uploadProofDoc(userId, docFile)
    if (!res.ok) {
      setSubmitError(`文件上傳失敗：${res.error}`)
      companyAiFinalizePendingRef.current = false
      setSubmitted(false)
      setCompanyReviewCountdown(0)
      setSubmitting(false)
      setAiMessage('')
      return
    }

    const docResult = await submitVerificationDoc(
      userId,
      aiResult.company ?? selectedCompany,
      selectedDocType,
      res.path,
      aiResult,
      reviewMode,
      manualReason,
    )
    if (!docResult.ok) {
      setSubmitError(`送出審核失敗：${docResult.error ?? '請稍後再試'}`)
      companyAiFinalizePendingRef.current = false
      setSubmitted(false)
      setCompanyReviewCountdown(0)
      setSubmitting(false)
      setAiMessage('')
      return
    }

    const autoIncomeTier = reviewMode === 'ai_auto' && canLinkIncomeVerification
      ? linkedIncomeTier ?? toIncomeTier('suggestedIncomeTier' in aiResult ? aiResult.suggestedIncomeTier : null)
      : null

    if (canLinkIncomeVerification && autoIncomeTier) {
      let incomeAiResult: Awaited<ReturnType<typeof verifyLinkedIncomeWithAI>>
      let incomeReviewMode: 'ai_auto' | 'manual' = 'manual'
      let incomeManualReason = ''
      try {
        incomeAiResult = await verifyLinkedIncomeWithAI(docFile, autoIncomeTier)
      } catch {
        incomeAiResult = {
          passed: false,
          company: null,
          confidence: null,
          suggestedIncomeTier: null,
          reason: 'AI 暫時無法完成收入審核，已轉人工審核。人工審核時間可能大於 12 小時。',
        }
      }
      if (incomeAiResult.passed) {
        incomeReviewMode = 'ai_auto'
      } else {
        incomeManualReason = incomeAiResult.reason || 'AI 未通過，已轉人工審核。人工審核時間可能大於 12 小時。'
      }
      await submitIncomeVerification(
        userId,
        autoIncomeTier,
        selectedDocType,
        res.path,
        incomeAiResult,
        incomeReviewMode,
        incomeManualReason,
      )
    }

    onVerified({ ...profile, company: aiResult.company ?? selectedCompany, verification_status: 'submitted' })
    setSubmitting(false)
    if (reviewMode === 'ai_auto') {
      companyAiFinalizePendingRef.current = true
      setCompanyReviewCountdown(AI_AUTO_REVIEW_UI_SECONDS)
      setAiMessage(`AI 審核倒數 ${AI_AUTO_REVIEW_UI_SECONDS} 秒。`)
    }
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[100] bg-[#fafafa] flex flex-col"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 36 }}
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 pt-safe pb-3 bg-[#fafafa] border-b border-slate-100">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </motion.button>
        <span className="font-bold text-slate-900 text-[15px]">公司認證</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {/* Status banner */}
        {isApproved ? (
          <div className="bg-emerald-50 rounded-2xl p-4 ring-1 ring-emerald-100 flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-800">公司認證已通過</p>
              <p className="text-xs text-emerald-600 mt-0.5">你的 {profile.company} 員工身份已驗證</p>
            </div>
          </div>
        ) : isSubmitted || submitted ? (
          <div className="bg-amber-50 rounded-2xl p-4 ring-1 ring-amber-100 flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-amber-800">審核中</p>
              <p className="text-xs text-amber-600 mt-0.5">
                文件已送出。{companyReviewCountdown > 0 ? `AI 審核倒數 ${companyReviewCountdown} 秒。` : (aiMessage || `AI 審核時間為 ${AI_AUTO_REVIEW_UI_SECONDS} 秒；若 AI 無法確認，會轉人工審核，人工審核時間可能大於 12 小時。`)}
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-blue-50 rounded-2xl p-4 ring-1 ring-blue-100">
            <p className="text-sm font-bold text-blue-800">上傳公司驗證文件</p>
            <p className="text-xs text-blue-600 mt-1 leading-relaxed">
              上傳員工識別證、扣繳憑單或薪資單。AI 審核時間為 {AI_AUTO_REVIEW_UI_SECONDS} 秒；送出後會顯示倒數。若 AI 無法確認，會轉人工審核，人工審核時間可能大於 12 小時。
            </p>
          </div>
        )}

        {/* Upload form — hidden when already approved/submitted */}
        {!isApproved && !isSubmitted && !submitted && (
          <div className="bg-white rounded-2xl p-4 ring-1 ring-slate-100 shadow-sm space-y-4">
            {/* Company select */}
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">選擇公司</p>
              <div className="grid grid-cols-2 gap-2">
                {(['TSMC', 'MediaTek'] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setSelectedCompany(c)}
                    className={cn(
                      'py-3 rounded-xl text-sm font-bold ring-1 transition-all',
                      selectedCompany === c
                        ? 'bg-slate-900 text-white ring-slate-900'
                        : 'bg-white text-slate-700 ring-slate-200',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Doc type select */}
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">文件類型</p>
              <div className="space-y-2">
                {COMPANY_DOC_TYPES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => {
                      setSelectedDocType(value)
                      if (value === 'employee_id') setLinkedIncomeTier(null)
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl ring-1 transition-all text-left',
                      selectedDocType === value
                        ? 'bg-slate-900 text-white ring-slate-900'
                        : 'bg-white text-slate-700 ring-slate-200',
                    )}
                  >
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm font-medium">{label}</span>
                    {selectedDocType === value && <Check className="w-4 h-4 ml-auto" />}
                  </button>
                ))}
              </div>
            </div>

            {canLinkIncomeVerification && (
              <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <p className="text-xs font-bold text-slate-700 mb-1.5">同步收入認證</p>
                <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                  這份文件若能看出薪資，可同時審核收入等級。AI 通過後收入認證也會進入 {AI_AUTO_REVIEW_UI_SECONDS} 秒倒數。
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(['silver','gold','diamond'] as IncomeTier[]).map((tier) => (
                    <button
                      key={tier}
                      onClick={() => setLinkedIncomeTier(tier)}
                      className={cn(
                        'rounded-xl px-2 py-2 text-center ring-1 transition-all',
                        linkedIncomeTier === tier
                          ? 'bg-slate-900 text-white ring-slate-900'
                          : 'bg-white text-slate-600 ring-slate-200',
                      )}
                    >
                      <p className="text-[11px] font-bold leading-tight">{INCOME_TIER_META[tier].label}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* File upload */}
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">上傳文件</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => clickFileInputWithGrace(fileRef.current)}
                className={cn(
                  'w-full rounded-2xl border-2 border-dashed py-5 flex flex-col items-center gap-2 transition-all',
                  docFile ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50',
                )}
              >
                {docFile ? (
                  <>
                    <FileText className="w-6 h-6 text-emerald-500" />
                    <p className="text-xs font-semibold text-emerald-700 truncate max-w-[220px]">{docFile.name}</p>
                    <p className="text-[10px] text-emerald-500">點擊重新選擇</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-slate-300" />
                    <p className="text-sm text-slate-400 font-medium">點擊上傳照片或 PDF</p>
                    <p className="text-[11px] text-slate-300">AI 審核時間為 {AI_AUTO_REVIEW_UI_SECONDS} 秒，送出後倒數</p>
                  </>
                )}
              </button>
            </div>

            {/* Submit */}
            {submitError && (
              <div className="rounded-2xl bg-red-50 px-4 py-3 ring-1 ring-red-100">
                <p className="text-xs font-medium leading-relaxed text-red-600">{submitError}</p>
              </div>
            )}

            {aiMessage && (
              <div className="rounded-2xl bg-blue-50 px-4 py-3 ring-1 ring-blue-100">
                <p className="text-xs font-medium leading-relaxed text-blue-700">
                  {companyReviewCountdown > 0 ? `AI 審核倒數 ${companyReviewCountdown} 秒。` : aiMessage}
                </p>
              </div>
            )}

            <button
              onClick={submit}
              disabled={!selectedCompany || !selectedDocType || !docFile || submitting}
              className={cn(
                'w-full py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all',
                selectedCompany && selectedDocType && docFile && !submitting
                  ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
                  : 'bg-slate-100 text-slate-300',
              )}
            >
              {submitting
                ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}><Cpu className="w-4 h-4" /></motion.div>
                : <ShieldCheck className="w-4 h-4" />}
              {submitting ? '上傳中⋯' : '送出認證申請'}
            </button>
          </div>
        )}
      </div>
    </motion.div>,
    document.body,
  )
}

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{label}</h3>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  )
}

// ─── App notifications：全屏彈窗（任意分頁皆顯示，非「我的」內嵌）─────────────────

function appNotificationModalMeta(kind: AppNotificationKind) {
  switch (kind) {
    case 'verification_approved':
      return {
        ring: 'ring-emerald-200',
        bg: 'bg-emerald-50',
        titleClass: 'text-emerald-800',
        bodyClass: 'text-emerald-700',
        Icon: ShieldCheck,
      }
    case 'verification_rejected':
      return {
        ring: 'ring-red-200',
        bg: 'bg-red-50',
        titleClass: 'text-red-800',
        bodyClass: 'text-red-600',
        Icon: AlertCircle,
      }
    case 'super_like_received':
      return {
        ring: 'ring-fuchsia-200',
        bg: 'bg-fuchsia-50',
        titleClass: 'text-fuchsia-900',
        bodyClass: 'text-fuchsia-800',
        Icon: Sparkles,
      }
    case 'match_created':
      return {
        ring: 'ring-rose-200',
        bg: 'bg-rose-50',
        titleClass: 'text-rose-900',
        bodyClass: 'text-rose-800',
        Icon: Heart,
      }
    case 'message_received':
      return {
        ring: 'ring-sky-200',
        bg: 'bg-sky-50',
        titleClass: 'text-slate-900',
        bodyClass: 'text-slate-700',
        Icon: MessageCircle,
      }
  }
}

function AppNotificationAlertPortal({
  notification,
  onDismiss,
}: {
  notification: AppNotificationRow
  onDismiss: () => void
}) {
  const meta = appNotificationModalMeta(notification.kind)
  const Icon = meta.Icon
  return createPortal(
    <div
      className="fixed inset-0 z-[232] flex items-center justify-center bg-slate-950/55 px-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-notif-alert-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        className={cn('w-full max-w-sm rounded-2xl p-5 shadow-xl ring-1', meta.bg, meta.ring)}
      >
        <div className="flex gap-3">
          <Icon className="mt-0.5 h-6 w-6 shrink-0 opacity-90" aria-hidden />
          <div className="min-w-0 flex-1">
            <p id="app-notif-alert-title" className={cn('text-sm font-bold leading-snug', meta.titleClass)}>
              {notification.title}
            </p>
            <p className={cn('mt-2 text-xs leading-relaxed', meta.bodyClass)}>{notification.body}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-5 w-full touch-manipulation rounded-xl bg-slate-900 py-3.5 text-sm font-bold text-white active:opacity-95"
        >
          知道了
        </button>
      </motion.div>
    </div>,
    document.body,
  )
}

// ─── 「我的」分頁：session 簡備份，冷啟／重載後先顯示上次暱稱 ─────────────────
function profileBriefKey(userId: string): string {
  return `tm_profile_brief_${userId}`
}

function persistProfileBrief(userId: string, row: ProfileRow): void {
  try {
    sessionStorage.setItem(
      profileBriefKey(userId),
      JSON.stringify({ name: row.name ?? '', nickname: row.nickname ?? '' }),
    )
  } catch {
    /* private mode */
  }
}

function readProfileBriefFallbackDisplay(userId: string): string | null {
  try {
    const raw = sessionStorage.getItem(profileBriefKey(userId))
    if (!raw) return null
    const o = JSON.parse(raw) as { name?: unknown; nickname?: unknown }
    const nick = typeof o.nickname === 'string' ? o.nickname.trim() : ''
    const nm = typeof o.name === 'string' ? o.name.trim() : ''
    const s = nick || nm
    return s || null
  } catch {
    return null
  }
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({
  userId,
  foregroundReloadNonce,
  onSignOut,
  creditBalance,
  onRefreshCredits,
  onOpenSubscription,
}: {
  userId: string
  foregroundReloadNonce: number
  onSignOut: () => void
  creditBalance: CreditBalance
  onRefreshCredits: () => void
  onOpenSubscription: () => void
}) {
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [editing, setEditing] = useState(false)
  const [showNotif, setShowNotif] = useState(false)
  const [showCompanyVerify, setShowCompanyVerify] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showTermsNotice, setShowTermsNotice] = useState(false)
  const [tabStats, setTabStats] = useState<ProfileTabStats | null>(null)
  const profileLoadEpochRef = useRef(0)
  const profilePollGenRef = useRef(0)
  useEffect(() => {
    const myEpoch = ++profileLoadEpochRef.current
    const load = async () => {
      const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      try {
        actionTrace('profileTab', 'load:開始', {
          rid,
          uid: shortId(userId),
          foregroundNonce: foregroundReloadNonce,
        })
        /** 勿阻塞：iOS／PWA `finalize_due_ai_reviews` RPC 偶有長掛，`await` 會擋住整頁個資與探索相關狀態。 */
        void finalizeDueAiReviews()
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          await prepareSupabaseForProfileReads('load')
        }
        /** 至多等 WS／Worker open；逾時不中斷，接著 REST（fetch 另有逾時）。 */
        await awaitRealtimeWsSignalWithin(PROFILE_TAB_REALTIME_SIGNAL_MS)

        /** `getProfile` 與統計並行，統計不依賴 profile 列。 */
        const [latest, stats] = await Promise.all([
          getProfile(userId),
          refreshProfileTabStats(),
        ])
        if (profileLoadEpochRef.current !== myEpoch) {
          actionTrace('profileTab', 'load:略過 stale', {
            rid,
            myEpoch,
            curEpoch: profileLoadEpochRef.current,
          })
          return
        }
        actionTrace('profileTab', 'load:已取得', {
          rid,
          hasProfile: Boolean(latest),
          nameLen: latest?.name?.length ?? 0,
          nickLen: latest?.nickname?.length ?? 0,
          hasStats: Boolean(stats),
        })
        if (latest) persistProfileBrief(userId, latest)
        setProfile((prev) => latest ?? prev)
        if (stats) setTabStats(stats)
        actionTrace('profileTab', 'load:setState 已呼叫', { rid })
      } catch (e) {
        console.warn('[tsmedia:profileTab] load failed', {
          rid,
          err: e instanceof Error ? e.message : String(e),
        })
      }
    }
    load()
  }, [userId, foregroundReloadNonce])

  useEffect(() => {
    if (!userId) return
    const loadNotifications = async () => {
      const myEpoch = ++profilePollGenRef.current
      const poll = Date.now()
      try {
        actionTrace('profileTab', 'poll:開始', { poll, uid: shortId(userId), myEpoch })
        void finalizeDueAiReviews()
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          await prepareSupabaseForProfileReads('poll')
        }
        await awaitRealtimeWsSignalWithin(PROFILE_TAB_REALTIME_SIGNAL_MS)
        const [latest, stats] = await Promise.all([
          getProfile(userId),
          refreshProfileTabStats(),
        ])
        if (profilePollGenRef.current !== myEpoch) {
          actionTrace('profileTab', 'poll:略過 stale', {
            poll,
            myEpoch,
            curEpoch: profilePollGenRef.current,
          })
          return
        }
        actionTrace('profileTab', 'poll:Promise.all 結束', {
          poll,
          hasProfile: Boolean(latest),
          hasStats: Boolean(stats),
          myEpoch,
        })
        if (latest) persistProfileBrief(userId, latest)
        setProfile((prev) => latest ?? prev)
        onRefreshCredits()
        if (stats) setTabStats(stats)
        actionTrace('profileTab', 'poll:完成', {
          poll,
        })
      } catch (e) {
        console.warn('[tsmedia:profileTab] poll failed', {
          poll,
          myEpoch,
          err: e instanceof Error ? e.message : String(e),
        })
      }
    }
    loadNotifications()
    const intervalId = window.setInterval(loadNotifications, 5_000)
    return () => window.clearInterval(intervalId)
  }, [userId, profile?.verification_status, profile?.income_tier])

  const displayName = useMemo(() => {
    const fromRow = profile?.nickname?.trim() || profile?.name?.trim()
    if (fromRow) return fromRow
    return readProfileBriefFallbackDisplay(userId) ?? '—'
  }, [profile?.nickname, profile?.name, userId])

  const interests = profile?.interests ?? []
  const bio = profile?.bio ?? ''
  const verStatus = profile?.verification_status ?? 'pending'
  const isFemale = profile?.gender === 'female'
  /** 女生不強制職業驗證：無收入等級時不顯示待驗證／審核中／已驗證（職業）字樣 */
  const profileSubtitle =
    profile?.income_tier
      ? profile.show_income_border
        ? `⋄ ${INCOME_TIER_META[profile.income_tier].short}`
        : INCOME_TIER_META[profile.income_tier].label
      : isFemale
        ? null
        : verStatus === 'approved'
          ? '✅ 已驗證'
          : verStatus === 'submitted'
            ? '審核中'
            : '待驗證'

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="mx-4 mt-4 space-y-3">
        {/* 使用概覽 — 連續／累積登入等（須 migration 016） */}
        <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 shadow-md ring-1 ring-white/10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">使用概覽</p>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-2xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 text-white/55">
                <Flame className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="text-[10px] font-semibold">連續登入</span>
              </div>
              <p className="mt-1 text-xl font-black tabular-nums text-white">
                {tabStats == null ? (
                  <span className="text-white/35">—</span>
                ) : (
                  <>
                    {tabStats.login_streak_days}
                    <span className="ml-0.5 text-xs font-bold text-white/50">天</span>
                  </>
                )}
              </p>
            </div>
            <div className="rounded-2xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 text-white/55">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="text-[10px] font-semibold">累積登入</span>
              </div>
              <p className="mt-1 text-xl font-black tabular-nums text-white">
                {tabStats == null ? (
                  <span className="text-white/35">—</span>
                ) : (
                  <>
                    {tabStats.login_total_days}
                    <span className="ml-0.5 text-xs font-bold text-white/50">天</span>
                  </>
                )}
              </p>
            </div>
            <div className="rounded-2xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 text-white/55">
                <Heart className="h-3.5 w-3.5 shrink-0 text-rose-300/90" aria-hidden />
                <span className="text-[10px] font-semibold">收到愛心</span>
              </div>
              <p className="mt-1 text-xl font-black tabular-nums text-white">
                {tabStats == null ? <span className="text-white/35">—</span> : tabStats.hearts_received}
              </p>
            </div>
            <div className="rounded-2xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 text-white/55">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-200/90" aria-hidden />
                <span className="text-[10px] font-semibold">收到超喜</span>
              </div>
              <p className="mt-1 text-xl font-black tabular-nums text-white">
                {tabStats == null ? <span className="text-white/35">—</span> : tabStats.super_likes_received}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-white/35">
            累積登入為曾開啟 App 的不重複天數，與每晚 10 點換日相同；收到愛心、超喜為他人對你按讚的累計。
          </p>
        </div>

        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 ring-1 ring-slate-200/90">
                <User className="h-7 w-7 text-slate-400" strokeWidth={1.75} aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">個人檔案</p>
                <h2 className="mt-0.5 truncate text-lg font-bold leading-tight text-slate-900">{displayName}</h2>
                {profileSubtitle != null && profileSubtitle !== '' ? (
                  <p className="mt-0.5 text-xs text-slate-500">{profileSubtitle}</p>
                ) : null}
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setEditing(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 ring-1 ring-slate-200/80"
              aria-label="編輯個人資料"
            >
              <Pencil className="h-4 w-4 text-slate-600" />
            </motion.button>
          </div>
        </div>
      </div>

      <div className="mx-4 mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-100">
          <Heart className="mx-auto h-4 w-4 text-rose-400" />
          <p className="mt-1 text-lg font-black text-slate-900">{creditBalance.heart}</p>
          <p className="text-[10px] font-semibold text-slate-400">愛心</p>
        </div>
        <div className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-100">
          <Sparkles className="mx-auto h-4 w-4 text-fuchsia-500" />
          <p className="mt-1 text-lg font-black text-slate-900">{creditBalance.super_like}</p>
          <p className="text-[10px] font-semibold text-slate-400">超級喜歡</p>
        </div>
        <div className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-100">
          <Eye className="mx-auto h-4 w-4 text-sky-500" />
          <p className="mt-1 text-lg font-black text-slate-900">{creditBalance.blur_unlock}</p>
          <p className="text-[10px] font-semibold text-slate-400">解除拼圖</p>
        </div>
      </div>

      {/* Bio */}
      {bio ? (
        <div className="mx-4 mt-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm ring-1 ring-slate-100">
          <p className="text-sm text-slate-700 leading-relaxed">{bio}</p>
        </div>
      ) : null}

      {/* Interests */}
      {interests.length > 0 && (
        <div className="mx-4 mt-3 bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">興趣</p>
          <div className="flex flex-wrap gap-2">
            {interests.map((b) => (
              <span key={b} className="px-3 py-1 bg-slate-50 ring-1 ring-slate-200 rounded-full text-xs text-slate-700 font-medium">
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions（可捲動）；登出置於會員同意書下方 */}
      <div className="mx-4 mt-3 bg-white rounded-2xl shadow-sm ring-1 ring-slate-100 overflow-hidden">
        <motion.button
          whileTap={{ backgroundColor: '#fffbeb' }}
          onClick={onOpenSubscription}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-amber-900 border-b border-slate-50 bg-amber-50/50"
        >
          <Star className="w-4 h-4 text-amber-500" />
          <span className="font-bold">會員訂閱</span>
          <ChevronRight className="w-4 h-4 text-amber-400 ml-auto" />
        </motion.button>
        <motion.button
          whileTap={{ backgroundColor: '#f8fafc' }}
          onClick={() => setEditing(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700 border-b border-slate-50"
        >
          <User className="w-4 h-4 text-slate-400" />
          <span>編輯個人資訊</span>
        </motion.button>
        <motion.button
          whileTap={{ backgroundColor: '#f8fafc' }}
          onClick={() => setShowNotif(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700 border-b border-slate-50"
        >
          <Bell className="w-4 h-4 text-slate-400" />
          <span>通知設定</span>
        </motion.button>
        <motion.button
          whileTap={{ backgroundColor: '#f8fafc' }}
          onClick={() => setShowCompanyVerify(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700 border-b border-slate-50"
        >
          <Cpu className="w-4 h-4 text-slate-400" />
          <span>公司認證</span>
          <ChevronRight className="w-4 h-4 text-slate-300 ml-auto" />
        </motion.button>
        <motion.button
          whileTap={{ backgroundColor: '#f8fafc' }}
          onClick={() => setShowTermsNotice(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700"
        >
          <FileText className="w-4 h-4 text-slate-400" />
          <span>會員同意書</span>
        </motion.button>
      </div>

      <div
        className="mx-4 mt-3 mb-4 space-y-2"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
      >
        {profile?.is_admin && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowAdmin(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-slate-700 bg-slate-100 ring-1 ring-slate-200"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>管理後台</span>
          </motion.button>
        )}
        <motion.button
          whileTap={{ backgroundColor: '#fff1f2' }}
          onClick={onSignOut}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-red-600 bg-white ring-1 ring-red-100 shadow-sm"
        >
          <LogOut className="w-4 h-4" />
          <span>登出</span>
        </motion.button>
      </div>
      </div>

      {/* Edit screen */}
      <AnimatePresence>
        {editing && profile && (
          <EditProfileScreen
            profile={profile}
            userId={userId}
            onClose={() => setEditing(false)}
            onSaved={(updated) => setProfile(updated)}
          />
        )}
      </AnimatePresence>

      {/* Company verify screen */}
      <AnimatePresence>
        {showCompanyVerify && profile && (
          <CompanyVerifyScreen
            profile={profile}
            userId={userId}
            onClose={() => setShowCompanyVerify(false)}
            onVerified={(updated) => setProfile(updated)}
          />
        )}
      </AnimatePresence>

      {/* Notification modal */}
      <AnimatePresence>
        {showNotif && <NotificationModal onClose={() => setShowNotif(false)} userId={userId} />}
      </AnimatePresence>

      <AnimatePresence>
        {showTermsNotice && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/50 px-5"
            onClick={() => setShowTermsNotice(false)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 8 }}
              className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <h2 className="text-base font-black text-slate-900">會員同意書</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                你已完成目前版本的同意紀錄。當平台更新重要條款時，系統會在進入主畫面前要求你重新閱讀並同意。
              </p>
              <button
                onClick={() => setShowTermsNotice(false)}
                className="mt-5 w-full rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white"
              >
                我知道了
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin screen */}
      <AnimatePresence>
        {showAdmin && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="fixed inset-0 z-50 bg-[#f5f5f7]"
          >
            <AdminScreen onBack={() => setShowAdmin(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Bottom Navigation ────────────────────────────────────────────────────────

const NAV_ITEMS: { tab: Tab; icon: React.ElementType; label: string }[] = [
  { tab: 'discover', icon: Compass, label: '探索' },
  { tab: 'matches', icon: Heart, label: '配對' },
  { tab: 'instant', icon: Zap, label: '即時配對' },
  { tab: 'profile', icon: User, label: '我的' },
]

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function MainScreen({
  user,
  onSignOut,
  initialDiscoverGender = 'male',
  initialTab = 'discover',
}: {
  user?: import('@supabase/supabase-js').User | null
  /** 與 App 問卷／個資同步，避免探索分頁預設 male 在 getProfile 前誤濾掉異性名單 */
  initialDiscoverGender?: 'male' | 'female'
  /** 登入後預設分頁；生活照未達標時由 App 設為 profile */
  initialTab?: MainScreenTab
  onSignOut?: () => void
}) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const prevTab = useRef<Tab>('discover')
  const activeTabRef = useRef<Tab>(initialTab ?? 'discover')
  activeTabRef.current = activeTab

  /** 即時配對「排隊中」時，攔截切到其他分頁／開聊天等導離行為並先確認 */
  const [instantQueueWaiting, setInstantQueueWaiting] = useState(false)
  const instantQueueWaitingRef = useRef(false)
  useEffect(() => {
    instantQueueWaitingRef.current = instantQueueWaiting
  }, [instantQueueWaiting])
  /** 使用者確認離開 queue 後、換頁完成前：避免 InstantMatchTab 仍以舊 snapshot 回報 waiting=true */
  const instantWaitingReportLockRef = useRef(false)
  useEffect(() => {
    if (activeTab !== 'instant') {
      instantWaitingReportLockRef.current = false
    }
  }, [activeTab])
  const handleInstantWaitingStateChange = useCallback((waiting: boolean) => {
    if (waiting && instantWaitingReportLockRef.current) return
    setInstantQueueWaiting(waiting)
  }, [])
  const [instantLeaveGuardOpen, setInstantLeaveGuardOpen] = useState(false)
  const pendingInstantNavTabRef = useRef<Tab | null>(null)

  const blockInstantNavIfWaiting = useCallback((target: Tab): boolean => {
    if (activeTabRef.current !== 'instant' || !instantQueueWaitingRef.current || target === 'instant') {
      return false
    }
    pendingInstantNavTabRef.current = target
    setInstantLeaveGuardOpen(true)
    return true
  }, [])

  const dismissInstantLeaveGuard = useCallback(() => {
    pendingInstantNavTabRef.current = null
    setInstantLeaveGuardOpen(false)
  }, [])

  const confirmInstantLeaveGuard = useCallback(async () => {
    const next = pendingInstantNavTabRef.current
    pendingInstantNavTabRef.current = null
    instantWaitingReportLockRef.current = true
    setInstantLeaveGuardOpen(false)
    setInstantQueueWaiting(false)
    instantQueueWaitingRef.current = false
    await instantMatchLeaveQueue()
    if (next != null) {
      prevTab.current = activeTabRef.current
      setActiveTab(next)
    } else {
      instantWaitingReportLockRef.current = false
    }
  }, [])

  /** 強制關閉時 `visibilitychange` 常漏；若仍標記為排隊中，`keepalive` RPC 盡力離隊。 */
  useEffect(() => {
    if (!user?.id) return
    const fire = (ev: Event) => {
      if (!instantQueueWaitingRef.current) return
      /* BFCache：`pagehide` + `persisted === true` 僅凍結頁面，使用者會回來——不可離隊（與 InstantMatchTab 一致）。 */
      if ((ev as PageTransitionEvent).persisted) return
      /* 程式觸發整頁 reload 前會設旗標，勿對等候列送 keepalive。 */
      if (peekSkipInstantMatchLeaveOnFullUnload()) return
      instantMatchLeaveQueueKeepalive()
    }
    window.addEventListener('pagehide', fire)
    window.addEventListener('beforeunload', fire)
    return () => {
      window.removeEventListener('pagehide', fire)
      window.removeEventListener('beforeunload', fire)
    }
  }, [user?.id])

  /** 給桌機自動整頁重載／冷啟還原分頁（與 App `readPreferredMainShellTab` 同 key） */
  useEffect(() => {
    try {
      sessionStorage.setItem('tm_last_main_tab_v1', activeTab)
    } catch {
      /* private mode */
    }
  }, [activeTab])
  const [currentUserGender, setCurrentUserGender] = useState<'male' | 'female'>(initialDiscoverGender)
  const [currentUserPreferredRegion, setCurrentUserPreferredRegion] = useState<import('@/lib/types').Region | null>(null)
  const [hideTabBarForChatKeyboard, setHideTabBarForChatKeyboard] = useState(false)
  const [viewingPerson, setViewingPerson] = useState<PersonSummary | null>(null)
  const [pendingChatId, setPendingChatId] = useState<number | string | null>(null)
  /** 配對分頁內嵌一般聊天（取代獨立「訊息」分頁） */
  const [matchesChatConversation, setMatchesChatConversation] = useState<Conversation | null>(null)
  const [liveMatchThreads, setLiveMatchThreads] = useState<Conversation[]>([])
  const [liveMatchThreadsLoading, setLiveMatchThreadsLoading] = useState(false)
  /** 給 {@link loadLiveMatchThreads} 判定是否已有 UI／session 快取——前景靜默刷新不致開全屏轉圈 */
  const liveMatchThreadsRef = useRef<Conversation[]>([])
  useEffect(() => {
    liveMatchThreadsRef.current = liveMatchThreads
  }, [liveMatchThreads])
  const [demoPuzzleClearedByProfile, setDemoPuzzleClearedByProfile] = useState<Record<number, number[]>>(() => loadDemoPuzzleClearedSlots())
  const discoverDeckDayRef = useRef(getAppDayKey())
  const [discoverDeckDayKey, setDiscoverDeckDayKey] = useState(() => getAppDayKey())
  const [discoverDeckRolloverTick, setDiscoverDeckRolloverTick] = useState(0)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const [showSubscription, setShowSubscription] = useState(false)
  const [creditBalance, setCreditBalance] = useState<CreditBalance>({ heart: 0, super_like: 0, blur_unlock: 0, point: 0 })
  const preSubscriptionCreditsRef = useRef<CreditBalance | null>(null)
  const [rewardFlash, setRewardFlash] = useState<null | {
    variant: CreditRewardVariant
    title: string
    subtitle?: string
  }>(null)
  const [matchSplash, setMatchSplash] = useState<{ matchId: string; peerUserId: string } | null>(null)
  /** 已登入者是否已有規定張數生活照（探索門檻） */
  const [selfPhotoOk, setSelfPhotoOk] = useState(true)
  const [showDiscoverPuzzleIntro, setShowDiscoverPuzzleIntro] = useState(false)
  const [photoGateToast, setPhotoGateToast] = useState(false)
  /** 每次從背景回到前景（JWT 可能需刷新）後遞增；用於重抓個資／探索快取失效 */
  const [foregroundReloadNonce, setForegroundReloadNonce] = useState(0)
  /** `removeAllChannels` 後延遲 500ms 廣播：重綁 matches／聊天 Realtime postgres_changes（見 `supabase.ts`）。 */
  const [physicalChannelResubscribeNonce, setPhysicalChannelResubscribeNonce] = useState(0)
  /** `visibilitychange` + `pageshow` 常同幀連發，避免探索 deck 連續被取消（epoch stale） */
  const lastFgScheduleAtRef = useRef(0)

  /** `supabase` 回前景運輸踢：profiles REST + Realtime 硬斷線後事件；探索等不必等 WS onOpen */
  useEffect(() => {
    if (!user?.id) return
    const bump = () => {
      void queryClient.invalidateQueries()
      setForegroundReloadNonce((n) => n + 1)
    }
    window.addEventListener(TM_FOREGROUND_TRANSPORT_KICK_EVENT, bump)
    return () => window.removeEventListener(TM_FOREGROUND_TRANSPORT_KICK_EVENT, bump)
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    const bump = () => setPhysicalChannelResubscribeNonce((n) => n + 1)
    window.addEventListener(TM_PHYSICAL_CHANNEL_RESUBSCRIBE_EVENT, bump)
    return () => window.removeEventListener(TM_PHYSICAL_CHANNEL_RESUBSCRIBE_EVENT, bump)
  }, [user?.id])

  /**
   * 首次進入主殼（SPA 內導航無新 `pageshow`）：使用者在 onboarding／驗證頁停留過久時 JWT 可能已過期；
   * 僅依賴「背景↔前景」wake 會漏掉此情況（iOS 特別明顯）。
   */
  useEffect(() => {
    if (!user?.id) return
    if (document.visibilityState !== 'visible') return
    void repairAuthAfterResume()
    void queryClient.invalidateQueries()
    setForegroundReloadNonce((n) => n + 1)
    let cancelled = false
    void ensureConnection().finally(() => {
      if (cancelled) return
      void queryClient.invalidateQueries()
      setForegroundReloadNonce((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  /** PWA／記憶體回收後冷啟：先顯示上次配對列表骨架，再由網路結果覆寫（soft reload 也不清空 UI）。 */
  useEffect(() => {
    if (!user?.id) return
    const cached = readLiveConvSessionCache(user.id)
    if (!cached?.length) return
    setLiveMatchThreads((prev) => (prev.length === 0 ? cached : prev))
  }, [user?.id])

  useEffect(() => {
    let debounceTimer: number | null = null

    const schedule = () => {
      if (document.visibilityState !== 'visible') return
      const ts = Date.now()
      if (ts - lastFgScheduleAtRef.current < 400) return
      lastFgScheduleAtRef.current = ts
      void repairAuthAfterResume()
      void queryClient.invalidateQueries()
      setForegroundReloadNonce((n) => n + 1)
      if (debounceTimer != null) window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null
        void ensureConnection().finally(() => {
          // 全螢幕 portal／獎勵層在 iOS  thaw 後偶仍吃掉觸控；前景換發 JWT 後一併關閉。
          setRewardFlash(null)
          setMatchSplash(null)
          setShowDiscoverPuzzleIntro(false)
          void queryClient.invalidateQueries()
          setForegroundReloadNonce((n) => n + 1)
        })
      }, 160)
    }

    document.addEventListener('visibilitychange', schedule)
    window.addEventListener('pageshow', schedule)
    window.addEventListener('focus', schedule)
    return () => {
      document.removeEventListener('visibilitychange', schedule)
      window.removeEventListener('pageshow', schedule)
      window.removeEventListener('focus', schedule)
      if (debounceTimer != null) window.clearTimeout(debounceTimer)
    }
  }, [])

  useEffect(() => {
    if (!user?.id) {
      setMatchSplash(null)
    }
  }, [user?.id])

  /** Web Push：已授權通知時寫入訂閱（可於開啟 App 或從系統設定開通知後觸發）。 */
  useEffect(() => {
    const uid = user?.id
    if (!uid) return
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void subscribeWebPushForCurrentUser(uid)
      }
    }
    run()
    document.addEventListener('visibilitychange', run)
    return () => document.removeEventListener('visibilitychange', run)
  }, [user?.id])

  /** 後台 app_notifications：全分頁彈窗；同一 id 會話內只會排入佇列一次，按「知道了」後標已讀再顯示下一則。 */
  const appNotifPopupQueueRef = useRef<AppNotificationRow[]>([])
  const appNotifQueuedOnceIdsRef = useRef(new Set<string>())
  const [activeAppNotifPopup, setActiveAppNotifPopup] = useState<AppNotificationRow | null>(null)

  useEffect(() => {
    appNotifPopupQueueRef.current = []
    appNotifQueuedOnceIdsRef.current.clear()
    setActiveAppNotifPopup(null)
  }, [user?.id])

  const tryDequeueAppNotifPopup = useCallback(() => {
    setActiveAppNotifPopup((prev) => {
      if (prev != null) return prev
      return appNotifPopupQueueRef.current.shift() ?? null
    })
  }, [])

  const dismissActiveAppNotifPopup = useCallback(() => {
    setActiveAppNotifPopup((cur) => {
      if (cur == null) return null
      const id = cur.id
      void markAppNotificationRead(id).finally(() => {
        queueMicrotask(() => {
          setActiveAppNotifPopup((p) => (p != null ? p : appNotifPopupQueueRef.current.shift() ?? null))
        })
      })
      return null
    })
  }, [])

  /** 推播／分享：`?match` 直達對話；僅 `?notif` 時向 DB 取 ref_match_id。SW 點通知時 replaceState 後再觸發此邏輯。 */
  const consumeUrlPushDeepLink = useCallback(() => {
    if (!user?.id) return
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const tabParam = url.searchParams.get('tab')
    const notifRaw = url.searchParams.get('notif')
    const matchRaw = url.searchParams.get('match')
    if (!tabParam && !notifRaw && !matchRaw) return

    const notifId = typeof notifRaw === 'string' ? notifRaw.trim() : ''
    const urlMatchLc = typeof matchRaw === 'string' ? matchRaw.trim().toLowerCase() : ''

    url.searchParams.delete('fromPush')
    url.searchParams.delete('notif')
    url.searchParams.delete('match')
    url.searchParams.delete('tab')
    const rest = url.searchParams.toString()
    window.history.replaceState({}, '', url.pathname + (rest ? `?${rest}` : ''))

    if (tabParam === 'discover' || tabParam === 'matches' || tabParam === 'instant' || tabParam === 'profile') {
      if (!blockInstantNavIfWaiting(tabParam)) {
        setActiveTab(tabParam)
      }
    }

    const openMatchRoom = (matchUuidLc: string) => {
      if (!matchUuidLc) return
      if (blockInstantNavIfWaiting('matches')) return
      setActiveTab('matches')
      setPendingChatId(matchUuidLc)
    }

    if (notifId) {
      appNotifQueuedOnceIdsRef.current.add(notifId)
      appNotifPopupQueueRef.current = appNotifPopupQueueRef.current.filter(
        (n) => n.id !== notifId && n.id.toLowerCase() !== notifId.toLowerCase(),
      )
      setActiveAppNotifPopup((cur) =>
        cur && (cur.id === notifId || cur.id.toLowerCase() === notifId.toLowerCase()) ? null : cur,
      )
      void markAppNotificationRead(notifId)
    }

    if (urlMatchLc) openMatchRoom(urlMatchLc)
    else if (notifId) {
      void (async () => {
        try {
          const { data, error } = await supabase
            .from('app_notifications')
            .select('ref_match_id')
            .eq('id', notifId)
            .maybeSingle()
          if (error || !data) return
          const mid = typeof data.ref_match_id === 'string' ? data.ref_match_id.trim().toLowerCase() : ''
          if (mid) openMatchRoom(mid)
        } catch {
          /* 無 ref_match_id 欄位或離線 */
        }
      })()
    }
  }, [user?.id, blockInstantNavIfWaiting])

  useEffect(() => {
    consumeUrlPushDeepLink()
  }, [consumeUrlPushDeepLink])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => consumeUrlPushDeepLink()
    window.addEventListener(TM_APP_DEEP_LINK_EVENT, handler)
    return () => window.removeEventListener(TM_APP_DEEP_LINK_EVENT, handler)
  }, [consumeUrlPushDeepLink])

  useEffect(() => {
    const uid = user?.id
    if (!uid) return
    let cancelled = false

    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      try {
        const list = await getUnreadAppNotifications(uid)
        if (cancelled) return
        for (const n of list) {
          /** LINE 類 UX：新訊息不插隊全螢「知道了」，只靠聊天室／角標；背景推播由 SW 負責 */
          if (n.kind === 'message_received') {
            void markAppNotificationRead(n.id)
            continue
          }
          if (!appNotifQueuedOnceIdsRef.current.has(n.id)) {
            appNotifQueuedOnceIdsRef.current.add(n.id)
            appNotifPopupQueueRef.current.push(n)
          }
        }
        tryDequeueAppNotifPopup()
      } catch {
        /* offline / transient */
      }
    }

    void poll()
    const iv = window.setInterval(poll, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(iv)
    }
  }, [user?.id, foregroundReloadNonce, tryDequeueAppNotifPopup])

  const clearRewardFlash = useCallback(() => {
    setRewardFlash(null)
  }, [])

  const openSubscriptionModal = useCallback(() => {
    preSubscriptionCreditsRef.current = { ...creditBalance }
    setShowSubscription(true)
  }, [creditBalance])

  const recordDemoPuzzleSlot = useCallback((profileId: number, slot: number) => {
    setDemoPuzzleClearedByProfile((prev) => {
      const merged = new Set([...(prev[profileId] ?? []), slot])
      const next = { ...prev, [profileId]: Array.from(merged).sort((a, b) => a - b) }
      persistDemoPuzzleClearedSlots(next)
      return next
    })
  }, [])

  useEffect(() => {
    discoverDeckDayRef.current = getAppDayKey()
    setDiscoverDeckDayKey(getAppDayKey())
    setDiscoverDeckRolloverTick(0)
  }, [user?.id])

  /** 換日若發生在 APP 未開時，登入時 ref 會直接對齊新 key，timer 偵測路徑不會進入。對照 localStorage 上一次 key 仍補一則系統通知（權限內）。 */
  useEffect(() => {
    if (!user?.id) return
    const LS = 'tm_last_seen_app_day_key_v1'
    const k = getAppDayKey()
    try {
      const prev = localStorage.getItem(LS)
      if (prev != null && prev !== k) void showDiscoverDeckRolloverNotification(k)
      localStorage.setItem(LS, k)
    } catch {
      /* private mode — 不中斷 */
    }
  }, [user?.id])

  useEffect(() => {
    let timeoutId: number | undefined
    let intervalId: number | undefined

    const applyRollover = () => {
      const k = getAppDayKey()
      if (k === discoverDeckDayRef.current) return
      discoverDeckDayRef.current = k
      setDiscoverDeckDayKey(k)
      setDiscoverDeckRolloverTick((n) => n + 1)
      if (user?.id) void showDiscoverDeckRolloverNotification(k)
    }

    const scheduleDeadline = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      const delay = msUntilNextAppDayKeyChange()
      timeoutId = window.setTimeout(() => {
        applyRollover()
        scheduleDeadline()
      }, delay)
    }

    applyRollover()
    scheduleDeadline()
    /** OS 休眠／背景节流時 timeout 不可靠，每分鐘補檢一次。 */
    intervalId = window.setInterval(applyRollover, 60_000)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') applyRollover()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      if (intervalId !== undefined) window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user?.id])

  const refreshCredits = useCallback(async () => {
    if (!user?.id) return
    setCreditBalance(await getCreditBalance(user.id))
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    ;(async () => {
      const before = await getCreditBalance(user.id)
      if (cancelled) return
      const claim = await claimDailyMemberHearts()
      if (cancelled) return
      await refreshCredits()
      if (cancelled) return
      const after = await getCreditBalance(user.id)
      if (cancelled) return
      if (!claim.ok) return
      const dh = after.heart - before.heart
      const ds = after.super_like - before.super_like
      const db = after.blur_unlock - before.blur_unlock
      const parts: string[] = []
      if (dh > 0) parts.push(`愛心 +${dh}`)
      if (ds > 0) parts.push(`超級喜歡 +${ds}`)
      if (db > 0) parts.push(`拼圖解鎖 +${db}`)
      if (parts.length > 0) {
        setRewardFlash({
          variant: 'daily',
          title: '今日獎勵已入帳',
          subtitle: parts.join(' · '),
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id, refreshCredits])

  /** 避免連續觸發 load 時舊請求晚到覆寫新資料；懸置請求時安全逾時仍會關閉 spinner */
  const liveMatchThreadsLoadGenRef = useRef(0)

  const loadLiveMatchThreads = useCallback(async (mode: 'full' | 'soft' = 'full') => {
    if (!user?.id) {
      setLiveMatchThreads([])
      setLiveMatchThreadsLoading(false)
      return
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      await ensureConnectionWithBudget()
    }
    const gen = ++liveMatchThreadsLoadGenRef.current
    const sessionWarm = readLiveConvSessionCache(user.id)
    const sessionLen = sessionWarm?.length ?? 0
    const memLen = liveMatchThreadsRef.current.length
    /** 任一來源已有名單則視為 SWR：`full` 亦不擋 UI（連線／WS 抖動不算「無資料」） */
    const hasWarmConversationList = sessionLen > 0 || memLen > 0
    const blockSpinner = mode === 'full' && !hasWarmConversationList
    if (blockSpinner) setLiveMatchThreadsLoading(true)
    const SAFETY_MS = 22_000
    const safetyTimer = window.setTimeout(() => {
      if (liveMatchThreadsLoadGenRef.current !== gen) return
      setLiveMatchThreadsLoading(false)
    }, SAFETY_MS)
    try {
      const matches = await getMyMatches(user.id)
      if (liveMatchThreadsLoadGenRef.current !== gen) return
      if (matches === null) return
      const rows: Conversation[] = []
      for (const m of matches) {
        if (liveMatchThreadsLoadGenRef.current !== gen) return
        const peerId = m.user_a === user.id ? m.user_b : m.user_a
        const p = await getProfile(peerId)
        if (liveMatchThreadsLoadGenRef.current !== gen) return
        const display = p?.nickname?.trim() || p?.name?.trim() || '配對對象'
        const subtitle =
          p?.company && p?.job_title
            ? `${p.company} · ${p.job_title}`
            : p?.company
              ? String(p.company)
              : p?.job_title ?? '新配對'
        const initials = display.charAt(0) || '?'
        const rawUrls = (p?.photo_urls ?? []).filter(Boolean).slice(0, PUZZLE_MAX_PHOTO_SLOTS)
        let photoUrl: string | undefined
        let photoUrls: string[] | undefined
        if (rawUrls.length > 0) {
          const resolved = await resolvePhotoUrls(rawUrls)
          if (liveMatchThreadsLoadGenRef.current !== gen) return
          const cleaned = resolved.filter(Boolean).slice(0, PUZZLE_MAX_PHOTO_SLOTS)
          if (cleaned.length > 0) {
            photoUrls = cleaned
            photoUrl = cleaned[0]
          }
        }
        rows.push({
          id: m.id,
          matchId: m.id,
          peerUserId: peerId,
          name: display,
          subtitle,
          initials,
          from: '#64748b',
          to: '#475569',
          photoUrl,
          photoUrls,
          matchedAt: new Date(m.created_at).getTime(),
          messages: [],
        })
      }
      if (liveMatchThreadsLoadGenRef.current !== gen) return
      setLiveMatchThreads(rows)
      writeLiveConvSessionCache(user.id, rows)
    } finally {
      window.clearTimeout(safetyTimer)
      if (liveMatchThreadsLoadGenRef.current === gen) setLiveMatchThreadsLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void loadLiveMatchThreads('full')
  }, [loadLiveMatchThreads])

  /** SW 在前景擋掉訊息橫幅時，補一輪對話列表（Realtime 未連上時） */
  useEffect(() => {
    const handler = () => {
      void loadLiveMatchThreads('soft')
    }
    window.addEventListener('tm_foreground_message_push', handler)
    return () => window.removeEventListener('tm_foreground_message_push', handler)
  }, [loadLiveMatchThreads])

  useEffect(() => {
    if (!user?.id || foregroundReloadNonce === 0) return
    void loadLiveMatchThreads('soft')
  }, [user?.id, foregroundReloadNonce, loadLiveMatchThreads])

  useEffect(() => {
    if (activeTab !== 'matches') setHideTabBarForChatKeyboard(false)
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'matches') setMatchesChatConversation(null)
  }, [activeTab])

  useEffect(() => {
    if (!user?.id) return
    return subscribeToNewMatches(user.id, (row) => {
      const peerId = row.user_a === user.id ? row.user_b : row.user_a
      setMatchSplash({ matchId: row.id, peerUserId: peerId })
      void loadLiveMatchThreads('soft')
    })
  }, [user?.id, loadLiveMatchThreads, foregroundReloadNonce, physicalChannelResubscribeNonce])

  useEffect(() => {
    if (pendingChatId == null) return
    const rq: number | string =
      typeof pendingChatId === 'string' ? pendingChatId.trim().toLowerCase() : pendingChatId
    const conv = liveMatchThreads.find((c) => {
      if (typeof rq === 'number') return c.id === rq
      if (typeof c.id === 'string' && c.id.trim().toLowerCase() === rq) return true
      if (typeof c.matchId === 'string' && c.matchId.trim().toLowerCase() === rq) return true
      return false
    })
    if (conv) {
      setMatchesChatConversation(conv)
      setPendingChatId(null)
    }
  }, [pendingChatId, liveMatchThreads])

  // "Start chat with <id>" — 配對分頁內開啟聊天室
  const startChatWith = (id: number | string) => {
    if (blockInstantNavIfWaiting('matches')) return
    setViewingPerson(null)
    setActiveTab('matches')
    setPendingChatId(id)
  }

  // Fetch current user's gender + preferred region + 生活照（切換分頁時重抓，以便「我的」上傳後可進探索）
  useEffect(() => {
    if (!user?.id) {
      setSelfPhotoOk(true)
      return
    }
    let cancelled = false
    void getProfile(user.id).then((profile) => {
      if (cancelled) return
      if (!profile) return
      if (profile.gender) setCurrentUserGender(profile.gender)
      setCurrentUserPreferredRegion((profile.preferred_region as import('@/lib/types').Region | null) ?? null)
      const n = (profile.photo_urls ?? []).filter(Boolean).length
      setSelfPhotoOk(n >= PROFILE_PHOTO_MIN)
    })
    return () => {
      cancelled = true
    }
  }, [user?.id, activeTab, foregroundReloadNonce])

  useEffect(() => {
    if (!user?.id || foregroundReloadNonce === 0) return
    void refreshCredits()
  }, [user?.id, foregroundReloadNonce, refreshCredits])

  // 首次進入探索：聊天拼圖解鎖說明（每帳號一次）
  useEffect(() => {
    if (!user?.id || activeTab !== 'discover' || !selfPhotoOk) return
    if (hasSeenDiscoverChatPuzzleIntro(user.id)) return
    setShowDiscoverPuzzleIntro(true)
  }, [user?.id, activeTab, selfPhotoOk])

  useEffect(() => {
    if (!photoGateToast) return
    const t = window.setTimeout(() => setPhotoGateToast(false), 4500)
    return () => window.clearTimeout(t)
  }, [photoGateToast])

  const handleSignOut = async () => {
    if (user?.id) clearLiveConvSessionCache(user.id)
    await signOut()
    onSignOut?.()
  }

  const notifyInstantMutualFriendMatch = useCallback(() => {
    void loadLiveMatchThreads('soft')
  }, [loadLiveMatchThreads])

  const tabContent: Record<Tab, React.ReactNode> = {
    discover: (
      <DiscoverTab
        userId={user?.id}
        discoverDeckDayKey={discoverDeckDayKey}
        discoverDeckRolloverTick={discoverDeckRolloverTick}
        foregroundReloadNonce={foregroundReloadNonce}
        currentUserGender={currentUserGender}
        preferredRegion={currentUserPreferredRegion}
        contentScrollRef={contentScrollRef}
        creditBalance={creditBalance}
        onOpenSubscription={openSubscriptionModal}
        refreshCredits={refreshCredits}
        onDiscoverMatch={() => {
          void loadLiveMatchThreads('soft')
        }}
        onCreditAction={(kind) => {
          setRewardFlash({
            variant: kind === 'like' ? 'heart_sent' : 'super_sent',
            title: kind === 'like' ? '已送出愛心' : '已送出超級喜歡',
            subtitle: '繼續探索下一位',
          })
        }}
      />
    ),
    matches: matchesChatConversation ? (
      <ChatRoomView
        key={typeof matchesChatConversation.id === 'string' ? matchesChatConversation.id : `demo-${matchesChatConversation.id}`}
        conversation={matchesChatConversation}
        currentUserId={user?.id ?? null}
        blurUnlockBalance={creditBalance.blur_unlock}
        onNeedSubscription={openSubscriptionModal}
        refreshCredits={refreshCredits}
        onDemoBlurSpent={() =>
          setCreditBalance((b) => ({
            ...b,
            blur_unlock: Math.max(0, b.blur_unlock - 1),
          }))
        }
        onChatInputFocus={() => setHideTabBarForChatKeyboard(true)}
        onChatInputBlur={() => setHideTabBarForChatKeyboard(false)}
        onDemoPuzzleSlotCleared={recordDemoPuzzleSlot}
        onBlurUnlockSpent={() =>
          setRewardFlash({
            variant: 'blur_unlock',
            title: '已解鎖拼圖 1 格',
            subtitle: '繼續聊天累積進度',
          })
        }
        onBack={() => setMatchesChatConversation(null)}
        foregroundReloadNonce={foregroundReloadNonce}
        physicalChannelResubscribeNonce={physicalChannelResubscribeNonce}
      />
    ) : (
      <MatchesTab
        currentUserId={user?.id}
        liveConversations={liveMatchThreads}
        liveConversationsLoading={liveMatchThreadsLoading}
        onOpenPerson={setViewingPerson}
        onStartChat={startChatWith}
      />
    ),
    instant: user?.id ? (
      <InstantMatchTab
        userId={user.id}
        foregroundReloadNonce={foregroundReloadNonce}
        onMutualFriendMatchCreated={notifyInstantMutualFriendMatch}
        onWaitingStateChange={handleInstantWaitingStateChange}
      />
    ) : (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center text-sm text-slate-500">
        請先登入以使用即時配對。
      </div>
    ),
    profile: (
      <ProfileTab
        userId={user?.id ?? ''}
        foregroundReloadNonce={foregroundReloadNonce}
        onSignOut={handleSignOut}
        creditBalance={creditBalance}
        onRefreshCredits={refreshCredits}
        onOpenSubscription={openSubscriptionModal}
      />
    ),
  }

  const matchesTabUnreadCount = useMemo(() => {
    return liveMatchThreads.reduce((sum, conv) => {
      const n = conv.messages.filter(
        (m) => m.from === 'them' && !hasMyReplyAfter(m, conv.messages),
      ).length
      return sum + n
    }, 0)
  }, [liveMatchThreads])

  const showTabBar = !(activeTab === 'matches' && matchesChatConversation && hideTabBarForChatKeyboard)

  const suppressTopChrome = activeTab === 'matches' && matchesChatConversation != null

  /** 配對內開聊天／即時頁自用頂區：外殼不重複長條 header */
  const mainOverflowHidden = suppressTopChrome && activeTab === 'matches'

  return (
    <div className="max-w-md mx-auto w-full flex-1 flex flex-col min-h-0 bg-white">
      {!suppressTopChrome && (
        <div className="flex-none flex items-center px-4 pb-3 pt-safe-bar border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center shrink-0">
              <Cpu className="w-[18px] h-[18px] text-white" />
            </div>
            <span className="font-bold text-slate-900 tracking-tight text-lg leading-none shrink-0">tsMedia</span>
            <span className="text-[11px] text-slate-400 leading-none shrink-0">Silicon Hearts</span>
            <span
              className="ml-auto min-w-0 truncate text-[10px] font-mono tabular-nums text-slate-400 max-w-[9rem] text-right"
              title={`Build ${__APP_BUILD_ID__}`}
            >
              {__APP_BUILD_ID__}
            </span>
          </div>
        </div>
      )}

      {photoGateToast && user?.id && (
        <div className="flex-none px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-center text-xs font-semibold text-amber-950">
          請先在「我的」上傳至少 {PROFILE_PHOTO_MIN} 張生活照，再使用探索。
        </div>
      )}

      {/* Scrollable content — flex-1 */}
      <main
        ref={contentScrollRef}
        className={cn(
          'flex-1 min-h-0',
          mainOverflowHidden ? 'overflow-hidden' : 'overflow-y-auto',
        )}
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeTab}-${activeTab === 'matches' ? (matchesChatConversation ? `chat:${matchesChatConversation.matchId ?? matchesChatConversation.id}` : 'list') : ''}`}
            className="h-full flex flex-col"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
          >
            {tabContent[activeTab]}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom nav — plain flex child, no fixed/absolute.
          Inline padding-bottom fills the iOS home-indicator safe area. */}
      {showTabBar && (
        <nav
          className="w-full bg-white border-t border-gray-200"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="h-[60px] max-w-md mx-auto flex justify-around items-center">
            {NAV_ITEMS.map(({ tab, icon: Icon, label }) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  const targetTab = tab
                  if (blockInstantNavIfWaiting(targetTab)) return
                  if (user?.id && targetTab === 'discover') {
                    // 不要用 await 擋住切 tab：iOS 回前景後 fetch 可能長時間掛住，底欄會像整排失效。
                    void getProfile(user.id).then((profile) => {
                      if (!profile) return
                      const ok = (profile.photo_urls ?? []).filter(Boolean).length >= PROFILE_PHOTO_MIN
                      setSelfPhotoOk(ok)
                      if (!ok) {
                        setPhotoGateToast(true)
                        setActiveTab((current) => (current === 'discover' ? 'profile' : current))
                      }
                    })
                  }
                  prevTab.current = activeTab
                  setActiveTab(targetTab)
                }}
                className="flex-1 h-full flex flex-col items-center justify-center gap-0.5 relative"
              >
                {activeTab === tab && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-slate-800 rounded-full"
                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                  />
                )}
                <span className="relative inline-flex">
                  <Icon className={cn('w-5 h-5 transition-colors', activeTab === tab ? 'text-slate-900' : 'text-slate-400')} />
                  {tab === 'matches' && matchesTabUnreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1 min-w-[15px] h-3.5 px-[3px] rounded-full bg-rose-500 text-[9px] font-bold leading-none text-white flex items-center justify-center tabular-nums">
                      {matchesTabUnreadCount > 99 ? '99+' : matchesTabUnreadCount}
                    </span>
                  )}
                </span>
                <span className={cn('text-[10px] font-medium transition-colors', activeTab === tab ? 'text-slate-900' : 'text-slate-400')}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Partner profile overlay — shared by 配對列表等 */}
      <AnimatePresence>
        {viewingPerson && (
          <PersonDetailView
            key={viewingPerson.peerUserId ?? String(viewingPerson.id)}
            person={viewingPerson}
            clearedPhotoSlots={viewingPerson.peerUserId ? [] : (demoPuzzleClearedByProfile[viewingPerson.id] ?? [])}
            onClose={() => setViewingPerson(null)}
            onStartChat={startChatWith}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {instantLeaveGuardOpen && (
          <motion.div
            key="instant-queue-leave-guard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="instant-leave-title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[320] flex items-end justify-center bg-black/50 px-4 pb-safe pt-10 sm:items-center sm:pb-8"
            onClick={(e) => {
              if (e.target === e.currentTarget) dismissInstantLeaveGuard()
            }}
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 14, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="mb-4 w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl ring-1 ring-black/[0.04] sm:mb-0"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="instant-leave-title" className="text-base font-bold text-slate-900">
                離開將中斷排隊
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                離開「即時配對」頁面會取消目前的等候。確定要離開嗎？
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
                <button
                  type="button"
                  className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white sm:w-auto sm:min-w-[7rem]"
                  onClick={() => void confirmInstantLeaveGuard()}
                >
                  確定離開
                </button>
                <button
                  type="button"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 sm:w-auto sm:min-w-[7rem]"
                  onClick={dismissInstantLeaveGuard}
                >
                  繼續等候
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSubscription && (
          <motion.div
            key="subscription-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[400] flex flex-col bg-white"
          >
            <SubscriptionScreen
              gender={currentUserGender}
              userEmail={user?.email ?? ''}
              onBack={() => setShowSubscription(false)}
              onSubscribed={async () => {
                setShowSubscription(false)
                const beforeSnap = preSubscriptionCreditsRef.current
                await refreshCredits()
                preSubscriptionCreditsRef.current = null
                if (!user?.id) return
                const after = await getCreditBalance(user.id)
                const parts: string[] = []
                if (beforeSnap) {
                  if (after.heart > beforeSnap.heart) parts.push(`愛心 +${after.heart - beforeSnap.heart}`)
                  if (after.super_like > beforeSnap.super_like) {
                    parts.push(`超級喜歡 +${after.super_like - beforeSnap.super_like}`)
                  }
                  if (after.blur_unlock > beforeSnap.blur_unlock) {
                    parts.push(`拼圖解鎖 +${after.blur_unlock - beforeSnap.blur_unlock}`)
                  }
                }
                setRewardFlash({
                  variant: 'grant',
                  title: parts.length > 0 ? '訂閱獎勵已入帳' : '訂閱成功',
                  subtitle: parts.length > 0 ? parts.join(' · ') : '會員權益已啟用',
                })
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <CreditRewardFlash
        open={rewardFlash != null}
        variant={rewardFlash?.variant ?? 'grant'}
        title={rewardFlash?.title ?? ''}
        subtitle={rewardFlash?.subtitle}
        onDismiss={clearRewardFlash}
      />

      <MatchSuccessSplash
        open={matchSplash != null}
        matchId={matchSplash?.matchId ?? null}
        peerUserId={matchSplash?.peerUserId ?? null}
        onClose={() => setMatchSplash(null)}
        onStartChat={(mid) => {
          setMatchSplash(null)
          startChatWith(mid)
        }}
      />

      {activeAppNotifPopup && (
        <AppNotificationAlertPortal
          key={activeAppNotifPopup.id}
          notification={activeAppNotifPopup}
          onDismiss={dismissActiveAppNotifPopup}
        />
      )}

      {user?.id && (
        <DiscoverPuzzleIntroModal
          open={showDiscoverPuzzleIntro}
          onGotIt={() => {
            setShowDiscoverPuzzleIntro(false)
            markDiscoverChatPuzzleIntroSeen(user.id)
          }}
        />
      )}
    </div>
  )
}


