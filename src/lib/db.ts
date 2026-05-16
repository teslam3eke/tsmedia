import { supabase, ensureConnectionWithBudget, repairAuthAfterResume } from './supabase'
import { actionTrace, shortId } from './clientActionTrace'
import { reportRealtimeChannel } from './resumeRealtimeTelemetry'
import { AI_AUTO_REVIEW_UI_SECONDS } from '@/lib/aiReviewConstants'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type {
  QuestionnaireEntry, Company, DocType, ProfileRow, Region, IncomeTier,
  AiConfidence, VerificationDocWithProfile, AppNotificationKind, AppNotificationRow,
  ProfileInteractionAction, MatchRow, MessageRow, ReportReason, ProfileReportRow,
  MessageReportReason, MessageReportRow, CreditBalance, CreditTransactionRow,
  PhotoUnlockStateRow,
} from './types'
import { PROFILE_PHOTO_MAX } from './types'

export const TERMS_VERSION = '2026-04-28'

function isRecoverableResumeAuthError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const msg = String(error.message ?? '').toLowerCase()
  return (
    code === 'PGRST116' ||
    code === '401' ||
    code === '42501' ||
    msg.includes('jwt') ||
    msg.includes('permission denied') ||
    msg.includes('not authorized')
  )
}

/** 探索 RPC：並「UI 新一輪取代／卸載」（parent abort）與「單次請求時間預算」（timer）→ 交由 PostgREST 傳入 fetch.signal */
function mergedDiscoverDeckAbortSignal(parent: AbortSignal | undefined, budgetMs: number): AbortSignal {
  const out = new AbortController()
  if (parent?.aborted) {
    out.abort()
    return out.signal
  }

  let tid: ReturnType<typeof globalThis.setTimeout> | null = globalThis.setTimeout(() => {
    tid = null
    try {
      out.abort()
    } catch {
      /* ignore */
    }
  }, budgetMs)

  const bust = () => {
    if (tid != null) {
      globalThis.clearTimeout(tid)
      tid = null
    }
    try {
      out.abort()
    } catch {
      /* ignore */
    }
  }

  if (parent) {
    if (parent.aborted) bust()
    else parent.addEventListener('abort', bust, { once: true })
  }

  return out.signal
}

// ─── Profiles ────────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
  if (visible) await ensureConnectionWithBudget()

  const query = () =>
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle()

  let { data, error } = await query()

  if (visible && error && isRecoverableResumeAuthError(error)) {
    await repairAuthAfterResume()
    await ensureConnectionWithBudget(12_000)
    ;({ data, error } = await query())
  }

  if (visible && error && isRecoverableResumeAuthError(error)) {
    await repairAuthAfterResume()
    ;({ data, error } = await query())
  }

  if (error && visible) {
    await ensureConnectionWithBudget()
    ;({ data, error } = await query())
  }

  if (error) {
    actionTrace('db.getProfile', '已取得：錯誤或無資料列', {
      uid: shortId(userId),
      code: error.code ?? '—',
      hint: typeof error.message === 'string' ? error.message.slice(0, 160) : '—',
    })
    console.error('[db] getProfile error:', error.message)
    return null
  }
  const row = data as ProfileRow
  actionTrace('db.getProfile', '已取得：profile 列', {
    uid: shortId(userId),
    nameLen: row.name?.length ?? 0,
    nickLen: row.nickname?.length ?? 0,
  })
  return row
}

export interface UpsertProfilePayload {
  userId: string
  name?: string
  nickname?: string
  gender?: 'male' | 'female'
  age?: number
  company?: Company
  jobTitle?: string
  department?: string
  bio?: string
  interests?: string[]
  questionnaire?: QuestionnaireEntry[]
  photoUrls?: string[]
  workRegion?: Region | null
  homeRegion?: Region | null
  preferredRegion?: Region | null
  showIncomeBorder?: boolean
}

export async function upsertProfile(payload: UpsertProfilePayload): Promise<{ ok: boolean; error?: string }> {
  const { userId, jobTitle, photoUrls, workRegion, homeRegion, preferredRegion, showIncomeBorder, ...rest } = payload

  // Build patch — always include id so upsert can match/insert the row
  const patch: Record<string, unknown> = { id: userId }
  if (rest.name          !== undefined) patch.name          = rest.name
  if (rest.nickname      !== undefined) patch.nickname      = rest.nickname
  if (rest.gender        !== undefined) patch.gender        = rest.gender
  if (rest.bio           !== undefined) patch.bio           = rest.bio
  if (rest.interests     !== undefined) patch.interests     = rest.interests
  if (rest.age           !== undefined) patch.age           = rest.age
  if (rest.company       !== undefined) patch.company       = rest.company
  if (rest.questionnaire !== undefined) patch.questionnaire = rest.questionnaire
  if (jobTitle           !== undefined) patch.job_title     = jobTitle
  if (photoUrls !== undefined) {
    patch.photo_urls = photoUrls.filter(Boolean).slice(0, PROFILE_PHOTO_MAX)
  }
  if (workRegion         !== undefined) patch.work_region      = workRegion
  if (homeRegion         !== undefined) patch.home_region      = homeRegion
  if (preferredRegion    !== undefined) patch.preferred_region = preferredRegion
  if (showIncomeBorder   !== undefined) patch.show_income_border = showIncomeBorder

  // Only id key = nothing to save
  if (Object.keys(patch).length <= 1) return { ok: true }

  // upsert: INSERT if row missing, UPDATE if it exists — never silently drops data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('profiles') as any)
    .upsert(patch, { onConflict: 'id' })

  if (error) {
    console.error('[db] upsertProfile error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function saveQuestionnaire(
  userId: string,
  entries: QuestionnaireEntry[],
): Promise<{ ok: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('profiles') as any)
    .upsert({ id: userId, questionnaire: entries }, { onConflict: 'id' })

  if (error) {
    console.error('[db] saveQuestionnaire error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export function hasAcceptedLatestTerms(profile: ProfileRow | null): boolean {
  return profile?.terms_version === TERMS_VERSION && Boolean(profile.terms_accepted_at)
}

export async function acceptLatestTerms(userId: string): Promise<{ ok: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('profiles') as any)
    .upsert({
      id: userId,
      terms_version: TERMS_VERSION,
      terms_accepted_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) {
    console.error('[db] acceptLatestTerms error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

// ─── Storage ─────────────────────────────────────────────────────────────────

// Compress image to at most 1080px on the longest side, JPEG quality 0.85
async function compressImage(file: File, maxPx = 1080, quality = 0.85): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const { naturalWidth: w, naturalHeight: h } = img
      const scale = Math.min(1, maxPx / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
        },
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file) }
    img.src = objectUrl
  })
}

export async function uploadPhoto(
  userId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const compressed = await compressImage(file)
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`

  const { error } = await supabase.storage
    .from('photos')
    .upload(path, compressed, { upsert: false, contentType: 'image/jpeg' })

  if (error) {
    console.error('[db] uploadPhoto error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true, path }
}

export async function resolvePhotoUrls(paths: string[]): Promise<string[]> {
  if (paths.length === 0) {
    actionTrace('db.resolvePhotoUrls', '已跳過（無路徑）', {})
    return []
  }

  const resolved = [...paths]
  const storagePaths = paths.filter((path) =>
    path &&
    !path.startsWith('http://') &&
    !path.startsWith('https://') &&
    !path.startsWith('blob:') &&
    !path.startsWith('data:')
  )

  if (storagePaths.length === 0) {
    actionTrace('db.resolvePhotoUrls', '已跳過（僅公開網址）', { paths: paths.length })
    return resolved
  }

  actionTrace('db.resolvePhotoUrls', '請求簽章', {
    paths: paths.length,
    storagePaths: storagePaths.length,
    firstPath: typeof storagePaths[0] === 'string' ? storagePaths[0].slice(0, 40) : '—',
  })

  /** 探索名單已回來但若此請求卡住（換發 JWT ／背景回前景後 zombie fetch），UI 會永遠 loading；Network 只看到 RPC OK。 */
  const SIGN_URLS_BUDGET_MS = 22_000

  try {
    const { data, error } = await Promise.race([
      supabase.storage.from('photos').createSignedUrls(storagePaths, 60 * 60),
      new Promise<{ data: null; error: { message: string } }>((resolve) =>
        globalThis.setTimeout(
          () =>
            resolve({
              data: null,
              error: { message: `簽章逾時（>${SIGN_URLS_BUDGET_MS}ms）` },
            }),
          SIGN_URLS_BUDGET_MS,
        ),
      ),
    ])

    if (error) {
      actionTrace('db.resolvePhotoUrls', '簽章失敗（沿用原路徑）', { msg: error.message?.slice?.(0, 120) ?? '—' })
      if (!String(error.message ?? '').includes('逾時')) {
        console.error('[db] resolvePhotoUrls error:', error.message)
      }
      return resolved
    }

    const signedMap = new Map(
      (data ?? [])
        .filter((item) => item.path && item.signedUrl)
        .map((item) => [item.path, item.signedUrl] as const),
    )

    actionTrace('db.resolvePhotoUrls', '簽章完成', {
      resolvedSlots: resolved.length,
      signedCount: signedMap.size,
    })
    return resolved.map((path) => signedMap.get(path) ?? path)
  } catch (e: unknown) {
    actionTrace('db.resolvePhotoUrls', '簽章例外（沿用原路徑）', {
      msg: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120),
    })
    console.error('[db] resolvePhotoUrls error:', e)
    return resolved
  }
}

export async function uploadProofDoc(
  userId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const isImage = file.type.startsWith('image/')
  const uploadFile = isImage ? await compressImage(file) : file
  const ext = isImage ? 'jpg' : (file.name.split('.').pop() ?? 'pdf')
  const path = `${userId}/${Date.now()}.${ext}`
  const contentType = isImage ? 'image/jpeg' : file.type

  const { error } = await supabase.storage
    .from('proofs')
    .upload(path, uploadFile, { upsert: true, contentType })

  if (error) {
    console.error('[db] uploadProofDoc error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true, path }
}

// ─── Verification Docs ───────────────────────────────────────────────────────

export interface AiResult {
  passed: boolean
  company: Company | null
  confidence: AiConfidence | null
  reason: string | null
}

export type ReviewSubmissionMode = 'ai_auto' | 'manual'

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000).toISOString()
}

export async function submitVerificationDoc(
  userId: string,
  company: Company,
  docType: DocType,
  docPath: string,
  aiResult?: AiResult,
  reviewMode: ReviewSubmissionMode = aiResult?.passed ? 'ai_auto' : 'manual',
  manualReviewReason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('verification_docs')
    .insert({
      user_id: userId,
      company,
      doc_type: docType,
      doc_url: docPath,
      status: 'pending',
      verification_kind: 'employment',
      review_mode: reviewMode,
      ai_review_ready_at: reviewMode === 'ai_auto' ? addSeconds(new Date(), AI_AUTO_REVIEW_UI_SECONDS) : null,
      manual_review_reason: manualReviewReason ?? null,
      ...(aiResult && {
        ai_passed:     aiResult.passed,
        ai_company:    aiResult.company,
        ai_confidence: aiResult.confidence,
        ai_reason:     aiResult.reason,
      }),
    })

  if (error) {
    console.error('[db] submitVerificationDoc error:', error.message)
    return { ok: false, error: error.message }
  }

  await supabase
    .from('profiles')
    .update({ verification_status: 'submitted' })
    .eq('id', userId)

  return { ok: true }
}

// ─── Income verification ─────────────────────────────────────────────────────
//
// 上傳收入認證文件。文件進 `verification_kind='income'`，需由管理員手動在
// Supabase Dashboard 審核後把 profiles.income_tier 設為對應 tier。
//
export async function submitIncomeVerification(
  userId: string,
  claimedTier: IncomeTier,
  docType: DocType,
  docPath: string,
  aiResult?: AiResult,
  reviewMode: ReviewSubmissionMode = aiResult?.passed ? 'ai_auto' : 'manual',
  manualReviewReason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('verification_docs')
    .insert({
      user_id: userId,
      doc_type: docType,
      doc_url: docPath,
      status: 'pending',
      verification_kind: 'income',
      claimed_income_tier: claimedTier,
      review_mode: reviewMode,
      ai_review_ready_at: reviewMode === 'ai_auto' ? addSeconds(new Date(), AI_AUTO_REVIEW_UI_SECONDS) : null,
      manual_review_reason: manualReviewReason ?? null,
      ...(aiResult && {
        ai_passed:     aiResult.passed,
        ai_company:    aiResult.company,
        ai_confidence: aiResult.confidence,
        ai_reason:     aiResult.reason,
      }),
    })

  if (error) {
    console.error('[db] submitIncomeVerification error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function getTodayVerificationSubmissionCount(userId: string): Promise<number> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)

  const { count, error } = await supabase
    .from('verification_docs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('submitted_at', start.toISOString())

  if (error) {
    console.error('[db] getTodayVerificationSubmissionCount error:', error.message)
    return 0
  }
  return count ?? 0
}

export async function finalizeDueAiReviews(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('finalize_due_ai_reviews')
  if (error) {
    console.error('[db] finalizeDueAiReviews error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

// ─── Admin functions ─────────────────────────────────────────────────────────

export async function getPendingVerifications(): Promise<VerificationDocWithProfile[]> {
  const { data, error } = await supabase
    .from('verification_docs')
    .select('*')
    .eq('status', 'pending')
    .eq('review_mode', 'manual')
    .order('submitted_at', { ascending: true })

  if (error) {
    console.error('[db] getPendingVerifications error:', error.message)
    return []
  }
  return attachProfilesToDocs((data ?? []) as VerificationDocWithProfile[])
}

export async function getAllVerifications(statusFilter?: string): Promise<VerificationDocWithProfile[]> {
  let query = supabase
    .from('verification_docs')
    .select('*')
    .order('submitted_at', { ascending: false })

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
    if (statusFilter === 'pending') {
      query = query.eq('review_mode', 'manual')
    }
  }

  const { data, error } = await query
  if (error) {
    console.error('[db] getAllVerifications error:', error.message)
    return []
  }
  return attachProfilesToDocs((data ?? []) as VerificationDocWithProfile[])
}

async function attachProfilesToDocs(docs: VerificationDocWithProfile[]): Promise<VerificationDocWithProfile[]> {
  const userIds = [...new Set(docs.map((doc) => doc.user_id).filter(Boolean))]
  if (userIds.length === 0) return docs

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, gender, photo_urls')
    .in('id', userIds)

  if (error) {
    console.error('[db] attachProfilesToDocs error:', error.message)
    return docs.map((doc) => ({ ...doc, profiles: null }))
  }

  const profileMap = new Map(
    (data ?? []).map((profile) => [profile.id, {
      name:       profile.name,
      gender:     profile.gender,
      photo_urls: profile.photo_urls,
    }]),
  )

  return docs.map((doc) => ({
    ...doc,
    profiles: profileMap.get(doc.user_id) ?? null,
  }))
}

export async function approveVerificationDoc(
  docId: string,
  doc: VerificationDocWithProfile,
  reviewerNote?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('verification_docs')
    .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewer_note: reviewerNote ?? null })
    .eq('id', docId)

  if (error) {
    console.error('[db] approveVerificationDoc error:', error.message)
    return { ok: false, error: error.message }
  }

  if (doc.verification_kind === 'employment') {
    await supabase
      .from('profiles')
      .update({ is_verified: true, verification_status: 'approved', company: doc.company })
      .eq('id', doc.user_id)
    await createAppNotification({
      userId: doc.user_id,
      kind: 'verification_approved',
      title: '職業認證已通過',
      body: `你的${doc.company ? ` ${doc.company} ` : ''}職業認證已通過。`,
    })
  } else if (doc.verification_kind === 'income' && doc.claimed_income_tier) {
    await supabase
      .from('profiles')
      .update({ income_tier: doc.claimed_income_tier })
      .eq('id', doc.user_id)
    await createAppNotification({
      userId: doc.user_id,
      kind: 'verification_approved',
      title: '收入認證已通過',
      body: '你的收入認證已通過，可以到編輯個人資訊開啟收入皇冠。',
    })
  }

  return { ok: true }
}

export async function rejectVerificationDoc(
  docId: string,
  doc?: VerificationDocWithProfile,
  reviewerNote?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('verification_docs')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewer_note: reviewerNote ?? null })
    .eq('id', docId)

  if (error) {
    console.error('[db] rejectVerificationDoc error:', error.message)
    return { ok: false, error: error.message }
  }

  if (doc?.verification_kind === 'employment') {
    await supabase
      .from('profiles')
      .update({ is_verified: false, verification_status: 'rejected' })
      .eq('id', doc.user_id)
    await createAppNotification({
      userId: doc.user_id,
      kind: 'verification_rejected',
      title: '職業認證未通過',
      body: reviewerNote ? `原因：${reviewerNote}` : '你的職業認證未通過，請重新上傳清楚的文件。',
    })
  } else if (doc?.verification_kind === 'income') {
    await createAppNotification({
      userId: doc.user_id,
      kind: 'verification_rejected',
      title: '收入認證未通過',
      body: reviewerNote ? `原因：${reviewerNote}` : '你的收入認證未通過，請重新上傳清楚的文件。',
    })
  }

  return { ok: true }
}

export async function createAppNotification(payload: {
  userId: string
  kind: AppNotificationKind
  title: string
  body: string
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('app_notifications')
    .insert({
      user_id: payload.userId,
      kind: payload.kind,
      title: payload.title,
      body: payload.body,
    })

  if (error) {
    console.error('[db] createAppNotification error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function getUnreadAppNotifications(userId: string): Promise<AppNotificationRow[]> {
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
  if (visible) await ensureConnectionWithBudget()

  const query = () =>
    supabase
      .from('app_notifications')
      .select('*')
      .eq('user_id', userId)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(10)

  let { data, error } = await query()
  if (error && visible) {
    await ensureConnectionWithBudget()
    ;({ data, error } = await query())
  }

  if (error) {
    console.error('[db] getUnreadAppNotifications error:', error.message)
    return []
  }
  return (data ?? []) as AppNotificationRow[]
}

export async function markAppNotificationRead(notificationId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('app_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)

  if (error) {
    console.error('[db] markAppNotificationRead error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

// ─── Matching / likes ────────────────────────────────────────────────────────

/** `get_daily_discover_deck_v2` RPC 回傳的單筆資料（jsonb） */
export type DailyDiscoverRpcRow = {
  id: string
  nickname: string | null
  name: string | null
  gender: 'male' | 'female' | null
  age: number | null
  company: string | null
  job_title: string | null
  department: string | null
  bio: string | null
  interests: string[] | null
  questionnaire: QuestionnaireEntry[] | null
  photo_urls: string[] | null
  work_region: Region | null
  home_region: Region | null
  income_tier: IncomeTier | null
  show_income_border: boolean | null
  /** 是否曾對此人送過愛心（伺服器 profile_interactions，不限日期；鍵名沿用 liked_today） */
  liked_today?: boolean
  /** 是否曾對此人送過超級喜歡（不限日期；鍵名沿用 super_liked_today） */
  super_liked_today?: boolean
}

/** 今日探索名單（最多 6 人）：優先未曾在探索出現；同條件依對方最近登入日／更新時間排序；不足時可含曾出現者。 */
export async function fetchDailyDiscoverDeck(options?: {
  skipWake?: boolean
  /** DiscoverTab 每輪載入建立的 signal：effect cleanup／新一輪取代時 abort，卡住中的上一輪 `await rpc` 才會卸下。 */
  rpcFlightSignal?: AbortSignal
}): Promise<{
  rows: DailyDiscoverRpcRow[]
  /** PostgREST／RPC 失敗時供 UI 顯示；成功為 null */
  rpcError: string | null
}> {
  const fin = (rows: DailyDiscoverRpcRow[], rpcError: string | null) => {
    actionTrace('db.fetchDailyDiscoverDeck', '已回傳', {
      rowCount: rows.length,
      err: rpcError ? rpcError.slice(0, 100) : null,
      skipWake: Boolean(options?.skipWake),
    })
    return { rows, rpcError }
  }
  /**
   * iOS／PWA：使用者可能在 visibility debounce 完成前就切到探索；此時 JWT 尚未換發，RPC 失敗會吃成空陣列。
   * 先與前景換發對齊（`ensureConnectionWithBudget`，單一 flight 合併並發），必要時再重試 RPC。
   * `skipWake`：呼叫端已在 race 外 `await ensureConnectionWithBudget()` 時設為 true，避免換發耗時併入 UI 逾時競賽。
   */
  /** 每一段重試都用「當下」是否在前景；快照式 `visible` 會在切 App／WebKit freeze 後誤對背景 RPC 換發／重試。 */
  const fg = () => typeof document !== 'undefined' && document.visibilityState === 'visible'

  if (fg() && !options?.skipWake) await ensureConnectionWithBudget()

  const deckRpcBudgetMs = 36_500
  /** 若 PostgREST 內部的 await fetch 完全不 settle，`abortSignal` 也救不了時，強制終止這次 await（避免探索頁 spinner 無限）。 */
  const deckRpcRaceMs = 38_500

  // PostgREST 對舊名 get_daily_discover_deck 曾快取錯誤簽章 → 400/PG 42601；改呼叫 v2（migration 037）。
  const rpcDeck = async (attempt: number) => {
    actionTrace('db.fetchDailyDiscoverDeck', 'rpc:即將發出', {
      attempt,
      skipWake: Boolean(options?.skipWake),
    })
    const rpcSignal = mergedDiscoverDeckAbortSignal(options?.rpcFlightSignal, deckRpcBudgetMs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (supabase as any)
      .rpc('get_daily_discover_deck_v2', {})
      .abortSignal(rpcSignal)
      .retry(false)
    actionTrace('db.fetchDailyDiscoverDeck', 'rpc:await開始', {
      attempt,
      clientVis: fg() ? 'visible' : 'hidden',
    })

    let res
    let raceTid: ReturnType<typeof globalThis.setTimeout> | null = null
    try {
      const raceCap = new Promise<never>((_, rej) => {
        raceTid = globalThis.setTimeout(() => {
          raceTid = null
          rej(
            Object.assign(new Error(`探索 RPC ${deckRpcRaceMs}ms 硬逾時`), { name: 'TimeoutError' }),
          )
        }, deckRpcRaceMs)
      })
      res = await Promise.race([query, raceCap])
    } catch (e: unknown) {
      actionTrace('db.fetchDailyDiscoverDeck', 'rpc:await失敗（race或abort）', {
        attempt,
        name: e && typeof e === 'object' && 'name' in e ? String((e as { name?: string }).name) : '?',
      })
      const msg = e instanceof Error ? e.message : String(e)
      const isHardTimeout = msg.includes('硬逾時')
      const isAbortLike =
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError')
      /** UI 新一輪取代／effect cleanup 會 abort 上一輪；不應 console.error 也不應當伺服器錯誤重試 */
      if (isAbortLike && !isHardTimeout) {
        return {
          data: null as unknown,
          error: {
            message: msg,
            code: 'ABORTED',
            hint: 'Request superseded (new discover load or flight cleanup)',
            details: '',
          },
        }
      }
      return {
        data: null as unknown,
        error: {
          message: String(e instanceof Error ? e.message : e),
          code: '',
          hint: 'Request was aborted (timeout or manual cancellation)',
          details: '',
        },
      }
    } finally {
      if (raceTid != null) {
        globalThis.clearTimeout(raceTid)
        raceTid = null
      }
    }

    actionTrace('db.fetchDailyDiscoverDeck', 'rpc:已取得', {
      attempt,
      hasErr: Boolean(res.error),
      code: res.error?.code ?? '—',
    })
    return res
  }

  let { data, error } = await rpcDeck(1)

  const errCode = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : ''
  if (errCode === 'ABORTED') {
    actionTrace('db.fetchDailyDiscoverDeck', 'omitAbortSuperseded（新一輪已取代）', {})
    return fin([], null)
  }

  if (error && fg()) {
    await repairAuthAfterResume()
    await ensureConnectionWithBudget(12_000)
    ;({ data, error } = await rpcDeck(2))
    const c2 = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : ''
    if (c2 === 'ABORTED') {
      actionTrace('db.fetchDailyDiscoverDeck', 'omitAbortSuperseded（attempt2）', {})
      return fin([], null)
    }
  }

  if (error && fg()) {
    await repairAuthAfterResume()
    ;({ data, error } = await rpcDeck(3))
    const c3 = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : ''
    if (c3 === 'ABORTED') {
      actionTrace('db.fetchDailyDiscoverDeck', 'omitAbortSuperseded（attempt3）', {})
      return fin([], null)
    }
  }

  if (error && fg()) {
    await ensureConnectionWithBudget()
    ;({ data, error } = await rpcDeck(4))
    const c4 = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : ''
    if (c4 === 'ABORTED') {
      actionTrace('db.fetchDailyDiscoverDeck', 'omitAbortSuperseded（attempt4）', {})
      return fin([], null)
    }
  }

  /** WebKit／切 App：`fetch` AbortError（或 budget abort）發生在背景時不應對使用者推「伺服器錯誤」，回前景後 MainScreen nonce 會重抓 */
  if (error && !fg()) {
    actionTrace('db.fetchDailyDiscoverDeck', 'omitErrorWhileHidden（回前景將重試）', {
      hint: typeof (error as { message?: string })?.message === 'string'
        ? String((error as { message?: string }).message).slice(0, 72)
        : '—',
    })
    return fin([], null)
  }

  if (error && typeof error === 'object' && (error as { code?: string }).code === 'ABORTED') {
    return fin([], null)
  }

  if (error) {
    console.error('[db] getDailyDiscoverDeck error:', error.message, error)
    const errObj = error as { message?: string; details?: string; hint?: string; code?: string }
    const detail = [errObj.message, errObj.details, errObj.hint, errObj.code ? `code:${errObj.code}` : '']
      .filter(Boolean)
      .join(' · ')
    return fin([], detail || '無法取得探索名單（RPC 錯誤）')
  }
  if (data == null) return fin([], null)
  try {
    const parsed = Array.isArray(data)
      ? data
      : (typeof data === 'string' ? (JSON.parse(data) as unknown) : [])
    if (!Array.isArray(parsed)) {
      return fin([], '伺服器回傳格式異常（預期為陣列）')
    }
    return fin(parsed as DailyDiscoverRpcRow[], null)
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
    return fin([], `解析探索名單失敗：${msg}`)
  }
}

/** 與 {@link fetchDailyDiscoverDeck} 相同來源；不需錯誤字串時用此簡寫。 */
export async function getDailyDiscoverDeck(): Promise<DailyDiscoverRpcRow[]> {
  const { rows } = await fetchDailyDiscoverDeck()
  return rows
}

export async function recordProfileInteraction(payload: {
  targetProfileKey: string
  action: ProfileInteractionAction
  targetUserId?: string | null
}): Promise<{
  ok: boolean
  matched?: boolean
  blocked?: boolean
  /** 曾對該對象送過 like／super_like（不限日期，不再用「當日」） */
  alreadyLiked?: boolean
  /** 曾對該對象送過 super_like */
  alreadySuperLiked?: boolean
  error?: string
}> {
  // Server-side RPC handles notification/match creation securely. For current
  // demo profiles targetUserId is null, so it records intent only; once Discover
  // uses real profiles, super likes notify the target automatically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('record_profile_interaction', {
    p_target_profile_key: payload.targetProfileKey,
    p_action: payload.action,
    p_target_user_id: payload.targetUserId ?? null,
  })

  if (error) {
    console.error('[db] recordProfileInteraction error:', error.message)
    return { ok: false, error: error.message }
  }
  const row = data as {
    matched?: boolean
    blocked?: boolean
    already_liked?: boolean
    already_super_liked?: boolean
    already_liked_today?: boolean
    already_super_liked_today?: boolean
  } | null
  return {
    ok: true,
    matched: Boolean(row?.matched),
    blocked: Boolean(row?.blocked),
    alreadyLiked: Boolean(
      row?.already_liked ?? row?.already_liked_today,
    ),
    alreadySuperLiked: Boolean(
      row?.already_super_liked ?? row?.already_super_liked_today,
    ),
  }
}

export async function completeMonthlyMembership(): Promise<{
  ok: boolean
  error?: string
  priceNtd?: number
  subscriptionExpiresAt?: string
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('complete_monthly_membership')

  if (error) {
    console.error('[db] completeMonthlyMembership error:', error.message)
    return { ok: false, error: error.message }
  }
  const row = data as { ok?: boolean; price_ntd?: number; subscription_expires_at?: string } | null
  return {
    ok: true,
    priceNtd: row?.price_ntd,
    subscriptionExpiresAt: row?.subscription_expires_at,
  }
}

export async function claimDailyMemberHearts(): Promise<{
  ok: boolean
  reason?: string
  appDayKey?: string
}> {
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
  if (visible) await ensureConnectionWithBudget()

  const rpc = async () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('claim_daily_member_hearts')

  let { data, error } = await rpc()
  if (error && visible) {
    await ensureConnectionWithBudget()
    ;({ data, error } = await rpc())
  }

  if (error) {
    console.error('[db] claimDailyMemberHearts error:', error.message)
    return { ok: false, reason: error.message }
  }
  const row = data as { ok?: boolean; reason?: string; app_day_key?: string } | null
  if (!row?.ok) {
    return { ok: false, reason: row?.reason ?? 'unknown', appDayKey: row?.app_day_key }
  }
  return { ok: true, appDayKey: row?.app_day_key }
}

export type ProfileTabStats = {
  login_streak_days: number
  login_total_days: number
  hearts_received: number
  super_likes_received: number
}

/** 更新登入 streak／累積天數，並回傳「我的」頁統計（須執行 migration 016） */
export async function refreshProfileTabStats(): Promise<ProfileTabStats | null> {
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
  if (visible) await ensureConnectionWithBudget()

  const rpc = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (supabase as any).rpc('refresh_profile_tab_stats')
  }

  let { data, error } = await rpc()
  if (error && visible) {
    await ensureConnectionWithBudget()
    ;({ data, error } = await rpc())
  }

  if (error) {
    actionTrace('db.refreshTabStats', '已取得：RPC 錯誤', {
      code: error.code ?? '—',
      msg: typeof error.message === 'string' ? error.message.slice(0, 120) : '—',
    })
    console.error('[db] refreshProfileTabStats error:', error.message)
    return null
  }
  let raw: unknown = data
  if (Array.isArray(raw) && raw.length > 0 && raw[0] != null && typeof raw[0] === 'object') {
    raw = raw[0]
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    actionTrace('db.refreshTabStats', '已取得：無法組出統計', {
      payloadKind: Array.isArray(data) ? `array:${data.length}` : data == null ? 'nullish' : typeof data,
    })
    return null
  }
  const row = raw as ProfileTabStats
  const out = {
    login_streak_days: Number(row.login_streak_days ?? 0),
    login_total_days: Number(row.login_total_days ?? 0),
    hearts_received: Number(row.hearts_received ?? 0),
    super_likes_received: Number(row.super_likes_received ?? 0),
  }
  actionTrace('db.refreshTabStats', '已取得：統計數字', {
    login_streak_days: out.login_streak_days,
    login_total_days: out.login_total_days,
    hearts_received: out.hearts_received,
    super_likes_received: out.super_likes_received,
  })
  return out
}

/** 成功為陣列（可能為空）；失敗為 null — 勿覆寫畫面上既有資料（PWA 回前景時 JWT 尚未好常誤判成「沒配對」）。 */
export async function getMyMatches(userId: string): Promise<MatchRow[] | null> {
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
  if (visible) await ensureConnectionWithBudget()

  const query = () =>
    supabase
      .from('matches')
      .select('*')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .order('created_at', { ascending: false })

  let { data, error } = await query()
  if (error && visible && isRecoverableResumeAuthError(error)) {
    await repairAuthAfterResume()
    await ensureConnectionWithBudget(12_000)
    ;({ data, error } = await query())
  }
  if (error && visible && isRecoverableResumeAuthError(error)) {
    await repairAuthAfterResume()
    ;({ data, error } = await query())
  }
  if (error && visible) {
    await ensureConnectionWithBudget()
    ;({ data, error } = await query())
  }

  if (error) {
    console.error('[db] getMyMatches error:', error.message)
    return null
  }
  return (data ?? []) as MatchRow[]
}

type RealtimeSubscribeLabel =
  | 'matches'
  | 'messages'
  | 'messages_incoming_sound'
  | 'instant_session_messages'
  | 'instant_sessions'

/** 任一頻道本地重建與時間錯開，降低與全域 wake 同一幀 teardown 競態（Console 會噴連線在半開又被關）。 */
let lastRealtimeChannelLocalRecycleTs = 0

/**
 * postgres_changes 頻道：subscribe 遇到 CHANNEL_ERROR／TIMED_OUT 時只做「卸頻道＋delay 後再接回」，
 * **不在此重跑** {@link repairAuthAfterResume}（前景已跑過；再打會跟 `wakeSupabaseAuthFromBackground` 搶全域 disconnect）。
 * 若仍需刷列表，請依賴 MainScreen／main.tsx 的回前景 invalidate。
 */
function subscribePostgresChannelWithBackoff(
  label: RealtimeSubscribeLabel,
  buildChannel: () => RealtimeChannel,
): () => void {
  let destroyed = false
  let backoffAttempt = 0
  let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let current: RealtimeChannel | null = null

  const clearRetryTimer = () => {
    if (retryTimer !== null) {
      globalThis.clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  const teardownChannel = async () => {
    clearRetryTimer()
    if (!current) return
    const ch = current
    current = null
    await supabase.removeChannel(ch)
  }

  const scheduleReconnect = () => {
    if (destroyed) return
    clearRetryTimer()
    backoffAttempt += 1
    const exp = Math.min(6, backoffAttempt)
    /** 下限 ~1.2s：wake 全域瞬斷時立刻略過可避免與新一輪 connect 對撞 */
    const base = Math.max(1_200, Math.min(30_000, 520 * Math.pow(2, exp)))
    const jitter = Math.floor(Math.random() * 500)
    retryTimer = globalThis.setTimeout(async () => {
      retryTimer = null
      if (destroyed) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      /**
       * 與全域 wake／其他頻道錯開，避免同時 removeChannel × N + connect 在半開態互卡。
       */
      const now = Date.now()
      const gap = 750 - (now - lastRealtimeChannelLocalRecycleTs)
      if (gap > 0) {
        await new Promise<void>((r) => globalThis.setTimeout(r, gap))
      }
      lastRealtimeChannelLocalRecycleTs = Date.now()
      if (destroyed) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      /** 換發已由前景路徑處理；此處只重建訂閱，減輕對探索 REST 的同時競爭。 */
      await teardownChannel()
      attach()
    }, base + jitter)
  }

  const attach = () => {
    if (destroyed) return
    clearRetryTimer()
    const channel = buildChannel()
    current = channel
    channel.subscribe((status) => {
      reportRealtimeChannel(label, String(status))
      if (status === 'SUBSCRIBED') {
        backoffAttempt = 0
        return
      }
      if (destroyed || !current) return
      const transportBad = status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'
      if (transportBad) scheduleReconnect()
    })
  }

  attach()

  return () => {
    destroyed = true
    clearRetryTimer()
    void teardownChannel()
  }
}

/** Realtime：監聽本人相關的新配對（public.matches 須在 publication supabase_realtime） */
export function subscribeToNewMatches(
  userId: string,
  onInsert: (row: MatchRow) => void,
): () => void {
  return subscribePostgresChannelWithBackoff('matches', () =>
    supabase
      .channel(`realtime-matches:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'matches', filter: `user_a=eq.${userId}` },
        (payload) => {
          const row = payload.new as MatchRow | null
          if (row) onInsert(row)
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'matches', filter: `user_b=eq.${userId}` },
        (payload) => {
          const row = payload.new as MatchRow | null
          if (row) onInsert(row)
        },
      )
  )
}

/** 成功為陣列（可能為空）；失敗為 null — 前景重載時勿清空聊天（避免誤以為訊息遺失）。 */
export async function getMatchMessages(matchId: string): Promise<MessageRow[] | null> {
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
  if (visible) await ensureConnectionWithBudget()

  const query = () =>
    supabase.from('messages').select('*').eq('match_id', matchId).order('created_at', { ascending: true })

  let { data, error } = await query()
  if (error && visible && isRecoverableResumeAuthError(error)) {
    await repairAuthAfterResume()
    await ensureConnectionWithBudget(12_000)
    ;({ data, error } = await query())
  }
  if (error && visible && isRecoverableResumeAuthError(error)) {
    await repairAuthAfterResume()
    ;({ data, error } = await query())
  }
  if (error && visible) {
    await ensureConnectionWithBudget()
    ;({ data, error } = await query())
  }

  if (error) {
    console.error('[db] getMatchMessages error:', error.message)
    return null
  }
  return (data ?? []) as MessageRow[]
}

export async function sendMatchMessage(matchId: string, body: string): Promise<{ ok: boolean; message?: MessageRow; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('send_match_message', {
    p_match_id: matchId,
    p_body: body,
  })

  if (error) {
    console.error('[db] sendMatchMessage error:', error.message)
    const msg = error.message ?? ''
    if (msg.includes('Message rate limit exceeded')) {
      return { ok: false, error: '你傳送太快了，請稍等一下再傳。' }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true, message: data as MessageRow }
}

/** Maps DB row → UI chat bubble (MainScreen ChatMessage shape). */
export function formatChatMessageFromRow(row: MessageRow, myUserId: string): {
  id: string
  text: string
  from: 'me' | 'them'
  time: string
  date: string
  read?: boolean
  createdAt: string
} {
  const created = new Date(row.created_at)
  const time = `${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`
  return {
    id: row.id,
    text: row.body,
    from: row.sender_id === myUserId ? 'me' : 'them',
    time,
    date: formatChatDateLabel(row.created_at),
    read: row.read_at != null ? true : undefined,
    createdAt: row.created_at,
  }
}

function formatChatDateLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  if (startOfDay(d) === startOfDay(now)) return '今天'
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  if (startOfDay(d) === startOfDay(y)) return '昨天'
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

function sortChatMessagesByTime<T extends { createdAt?: string; id: string }>(a: T, b: T): number {
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
  const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
  if (ta !== tb) return ta - tb
  return a.id.localeCompare(b.id)
}

export function mergeUniqueChatMessages<T extends { id: string; createdAt?: string }>(prev: T[], incoming: T): T[] {
  if (prev.some((m) => m.id === incoming.id)) return prev
  return [...prev, incoming].sort(sortChatMessagesByTime)
}

/**
 * Subscribe to new rows in `public.messages` for one match. Requires
 * `messages` to be in publication `supabase_realtime` (see migration 012).
 */
export function subscribeToMatchMessages(
  matchId: string,
  onInsert: (row: MessageRow) => void,
): () => void {
  return subscribePostgresChannelWithBackoff('messages', () =>
    supabase.channel(`match-messages:${matchId}`).on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `match_id=eq.${matchId}`,
      },
      (payload) => {
        onInsert(payload.new as MessageRow)
      },
    )
  )
}

/**
 * Subscribe to INSERT on `messages` limited to matches the viewer participates in,
 * scoped by explicit `match_id` filters (narrower fan-out than an unscoped table subscription).
 *
 * Used for in-app message sounds across threads while the lobby chat is closed.
 *
 * Requires `messages` in publication `supabase_realtime` (see migration 012).
 */
export function subscribeToMyIncomingMatchMessages(
  userId: string,
  matchIds: readonly string[],
  onInsert: (row: MessageRow) => void,
): () => void {
  /** Supabase realtime filter UUIDs — reject unknown shapes to avoid broken channels. */
  const uuidRx =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of matchIds) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (!id || seen.has(id)) continue
    if (!uuidRx.test(id)) continue
    seen.add(id)
    unique.push(id.toLowerCase())
    if (unique.length >= 64) break
  }
  if (unique.length === 0) {
    return () => {}
  }

  unique.sort()
  const filter =
    unique.length === 1
      ? `match_id=eq.${unique[0]}`
      : `match_id=in.(${unique.join(',')})`

  let h = 2166136261 >>> 0
  const keySrc = unique.join('|')
  for (let i = 0; i < keySrc.length; i += 1) {
    h ^= keySrc.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  const batchKey = `${unique.length}-${h}`

  return subscribePostgresChannelWithBackoff('messages_incoming_sound', () =>
    supabase
      .channel(`realtime-my-match-msgs:${userId}:${batchKey}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter,
        },
        (payload) => {
          const row = payload.new as MessageRow | null
          if (row?.sender_id && row.sender_id !== userId) {
            onInsert(row)
          }
        },
      ),
  )
}

export async function getPhotoUnlockState(matchId: string): Promise<PhotoUnlockStateRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('sync_photo_unlock_state', {
    p_match_id: matchId,
  })

  if (error) {
    console.error('[db] getPhotoUnlockState error:', error.message)
    return null
  }
  return data as PhotoUnlockStateRow
}

export async function spendBlurUnlockTile(matchId: string): Promise<{ ok: boolean; state?: PhotoUnlockStateRow; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('spend_blur_unlock_tile', {
    p_match_id: matchId,
  })

  if (error) {
    console.error('[db] spendBlurUnlockTile error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true, state: data as PhotoUnlockStateRow }
}

export async function simulatePartnerMatchMessage(matchId: string, body?: string): Promise<{ ok: boolean; message?: MessageRow; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('simulate_partner_match_message', {
    p_match_id: matchId,
    p_body: body ?? '我也回你一則，測試拼圖解鎖。',
  })

  if (error) {
    console.error('[db] simulatePartnerMatchMessage error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true, message: data as MessageRow }
}

// ─── 即時配對（7 分鐘房） ─────────────────────────────────────────────────────

export type InstantMatchPollResult =
  | { status: 'idle'; hint?: string }
  | { status: 'waiting'; hint?: string }
  | {
      status: 'in_session'
      phase: 'chat' | 'decide' | 'mutual_friend' | 'closed'
      session_id: string
      peer_user_id: string
      /** 供前端對應 decision_a / decision_b 哪一側為本人 */
      user_a: string
      user_b: string
      created_at: string
      chat_ends_at: string
      decision_a: string
      decision_b: string
    }
  | {
      status: 'done'
      session_id: string
      promoted_match_id?: string
      mutual_friend: boolean
      instant_end_reason?: 'peer_left' | 'self_left' | 'decision_closed'
    }

export type InstantMatchPollResponse =
  | { ok: true; data: InstantMatchPollResult }
  | { ok: false; error: string }

function mapInstantMatchPollFailure(err: {
  message?: string
  code?: string
  details?: string
  hint?: string
}): string {
  const raw = String(err.message ?? '')
  const msg = raw.toLowerCase()
  const detail = String(err.details ?? '').toLowerCase()
  const hint = String(err.hint ?? '').toLowerCase()
  const blob = `${msg} ${detail} ${hint}`

  if (blob.includes('failed to fetch') || blob.includes('networkerror') || blob.includes('load failed')) {
    return '網路連線異常，請檢查連線後再試。'
  }

  if (
    blob.includes('not authenticated') ||
    blob.includes('jwt expired') ||
    blob.includes('invalid jwt') ||
    blob.includes('invalid claim') ||
    err.code === 'PGRST303'
  ) {
    return '登入已失效或尚未登入。請重新整理頁面並再登入。'
  }

  if (
    blob.includes('permission denied for function') ||
    err.code === '42501' ||
    (blob.includes('permission denied') && blob.includes('instant'))
  ) {
    return '目前身分無法呼叫即時配對。請確認使用已登入的一般帳號（非僅訪客）。'
  }

  if (
    err.code === 'PGRST202' ||
    err.code === '42883' ||
    (blob.includes('could not find') && blob.includes('instant_match_poll')) ||
    (blob.includes('does not exist') && blob.includes('instant_match_poll'))
  ) {
    return (
      '後端尚未註冊 instant_match_poll（常見：Supabase 尚未套用 migration 048）。' +
      '請在專案執行 supabase migration / 貼上 `048_instant_match_sessions.sql`，' +
      '並在 SQL Editor 執行 NOTIFY pgrst, \'reload schema\'; 稍後重試。'
    )
  }

  const trimmed = raw.trim()
  if (trimmed) return trimmed
  return '無法取得配對狀態。'
}

/**
 * @param opts.enqueue `true`：寫入／維持等候列並執行撮合（按「開始配對」時）。
 *   `false`：僅查狀態，不強制入列（背景輪詢、離開佇列後）。
 */
export async function instantMatchPoll(opts: { enqueue: boolean }): Promise<InstantMatchPollResponse> {
  const { data, error } = await (supabase as any).rpc('instant_match_poll', {
    p_enqueue: opts.enqueue,
  })
  if (error) {
    console.error('[db] instantMatchPoll', error.code, error.message, error.details, error.hint)
    return { ok: false, error: mapInstantMatchPollFailure(error) }
  }
  if (data == null || typeof data !== 'object') {
    return {
      ok: false,
      error:
        '伺服器未回傳有效 JSON。請確認已套用 migration 048，並重載 PostgREST schema（pg_notify pgrst）。',
    }
  }
  return { ok: true, data: data as InstantMatchPollResult }
}

export async function instantMatchLeaveQueue(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await (supabase as any).rpc('instant_match_leave_queue')
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

const supabaseRpcOrigin = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').replace(/\/$/, '')
const supabaseAnonKeyForRpc = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

/** 供 unload／pagehide：`fetch`+`keepalive` 無法走 `supabase-js` 的超時包裝，需在關閉前帶上最新 JWT。 */
let instantMatchUnloadAccessToken: string | null = null

function syncInstantMatchUnloadAccessTokenFromSession(session: { access_token?: string } | null) {
  instantMatchUnloadAccessToken = session?.access_token ?? null
}

if (typeof window !== 'undefined') {
  void supabase.auth.getSession().then(({ data }) => {
    syncInstantMatchUnloadAccessTokenFromSession(data.session)
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    syncInstantMatchUnloadAccessTokenFromSession(session)
  })
}

/**
 * 關閉分頁／強制結束 App：`rpc().then` 常被中斷。`keepalive: true` 讓瀏覽器盡力在卸載前送出離隊。
 * 僅清除 `session_id is null` 的佇列列，不影響已開房。
 */
export function instantMatchLeaveQueueKeepalive(): void {
  if (typeof window === 'undefined') return
  const origin = supabaseRpcOrigin
  const key = supabaseAnonKeyForRpc
  const token = instantMatchUnloadAccessToken
  if (!origin || !key || !token) return
  const url = `${origin}/rest/v1/rpc/instant_match_leave_queue`
  try {
    void fetch(url, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
      keepalive: true,
    }).catch(() => {
      /* offline / tab already dead */
    })
  } catch {
    /* ignore */
  }
}

export async function instantSessionAbandon(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await (supabase as any).rpc('instant_session_abandon', { p_session_id: sessionId })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export function instantSessionAbandonKeepalive(sessionId: string): void {
  if (typeof window === 'undefined') return
  const origin = supabaseRpcOrigin
  const key = supabaseAnonKeyForRpc
  const token = instantMatchUnloadAccessToken
  if (!origin || !key || !token || !sessionId) return
  const url = `${origin}/rest/v1/rpc/instant_session_abandon`
  try {
    void fetch(url, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_session_id: sessionId }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

export type InstantSessionMessageRow = {
  id: string
  session_id: string
  sender_id: string
  body: string
  created_at: string
}

export async function getInstantSessionMessages(sessionId: string): Promise<InstantSessionMessageRow[] | null> {
  const { data, error } = await supabase
    .from('instant_session_messages')
    .select('id,session_id,sender_id,body,created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[db] getInstantSessionMessages', error.message)
    return null
  }
  return (data ?? []) as InstantSessionMessageRow[]
}

export async function sendInstantSessionMessage(sessionId: string, body: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await (supabase as any).rpc('instant_session_send_message', {
    p_session_id: sessionId,
    p_body: body,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, id: data as string }
}

export async function instantSessionDecide(
  sessionId: string,
  choice: 'friend' | 'pass',
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const { data, error } = await (supabase as any).rpc('instant_session_decide', {
    p_session_id: sessionId,
    p_choice: choice,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data as Record<string, unknown> }
}

export function subscribeToInstantSessionMessages(sessionId: string, onInsert: (row: InstantSessionMessageRow) => void): () => void {
  return subscribePostgresChannelWithBackoff('instant_session_messages', () =>
    supabase.channel(`instant-sess-msg:${sessionId}`).on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'instant_session_messages',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        onInsert(payload.new as InstantSessionMessageRow)
      },
    ),
  )
}

/** 對方離開场次時 `instant_sessions` 會 UPDATE，拉一次 poll 以盡快顯示「對方已離開」。 */
export function subscribeToInstantSessionSignals(sessionId: string, onSessionSignal: () => void): () => void {
  return subscribePostgresChannelWithBackoff('instant_sessions', () =>
    supabase.channel(`instant-sess-row:${sessionId}`).on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'instant_sessions',
        filter: `id=eq.${sessionId}`,
      },
      () => {
        onSessionSignal()
      },
    ),
  )
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function submitProfileReport(payload: {
  reportedProfileKey: string
  reason: ReportReason
  details?: string
  reportedUserId?: string | null
  reportedDisplayName?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser()
  const reporterUserId = auth.user?.id
  if (!reporterUserId) return { ok: false, error: '請先登入後再檢舉。' }

  const { error } = await supabase
    .from('profile_reports')
    .insert({
      reporter_user_id: reporterUserId,
      reported_user_id: payload.reportedUserId ?? null,
      reported_profile_key: payload.reportedProfileKey,
      reported_display_name: payload.reportedDisplayName ?? null,
      reason: payload.reason,
      details: payload.details?.trim() || null,
    })

  if (error) {
    console.error('[db] submitProfileReport error:', error.message)
    return { ok: false, error: error.message }
  }

  return { ok: true }
}

export async function getMyBlockedProfileKeys(): Promise<string[]> {
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) return []

  const { data, error } = await supabase
    .from('profile_blocks')
    .select('blocked_profile_key')
    .eq('blocker_user_id', userId)

  if (error) {
    console.error('[db] getMyBlockedProfileKeys error:', error.message)
    return []
  }
  return (data ?? []).map((row) => row.blocked_profile_key).filter(Boolean)
}

export async function blockProfile(payload: {
  blockedProfileKey: string
  blockedUserId?: string | null
  blockedDisplayName?: string | null
  reason?: string
}): Promise<{ ok: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('record_profile_block', {
    p_blocked_profile_key: payload.blockedProfileKey,
    p_blocked_user_id: payload.blockedUserId ?? null,
    p_blocked_display_name: payload.blockedDisplayName ?? null,
    p_reason: payload.reason ?? null,
  })

  if (error) {
    console.error('[db] blockProfile error:', error.message)
    return { ok: false, error: error.message }
  }

  return { ok: true }
}

export async function submitMessageReport(payload: {
  reason: MessageReportReason
  details?: string
  matchId?: string | null
  messageId?: string | null
  messageBody?: string | null
  reportedUserId?: string | null
  reportedProfileKey?: string | null
  reportedDisplayName?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser()
  const reporterUserId = auth.user?.id
  if (!reporterUserId) return { ok: false, error: '請先登入後再檢舉。' }

  const { error } = await supabase
    .from('message_reports')
    .insert({
      reporter_user_id: reporterUserId,
      reported_user_id: payload.reportedUserId ?? null,
      match_id: payload.matchId ?? null,
      message_id: payload.messageId ?? null,
      reported_profile_key: payload.reportedProfileKey ?? null,
      reported_display_name: payload.reportedDisplayName ?? null,
      message_body: payload.messageBody ?? null,
      reason: payload.reason,
      details: payload.details?.trim() || null,
    })

  if (error) {
    console.error('[db] submitMessageReport error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function getCreditTransactions(userId: string): Promise<CreditTransactionRow[]> {
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
  if (visible) await ensureConnectionWithBudget()

  const query = () =>
    supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

  let { data, error } = await query()
  if (error && visible) {
    await ensureConnectionWithBudget()
    ;({ data, error } = await query())
  }

  if (error) {
    console.error('[db] getCreditTransactions error:', error.message)
    return []
  }
  return (data ?? []) as CreditTransactionRow[]
}

export async function getCreditBalance(userId: string): Promise<CreditBalance> {
  if (import.meta.env.VITE_TEST_DAILY_TEN === '1') {
    const { error } = await supabase.rpc('test_ensure_daily_ten_credits')
    if (error) console.error('[db] test_ensure_daily_ten_credits:', error.message)
  }
  const txs = await getCreditTransactions(userId)
  const balance: CreditBalance = { heart: 0, super_like: 0, blur_unlock: 0, point: 0 }
  for (const tx of txs) {
    balance[tx.credit_type] += tx.amount
  }
  return balance
}

export async function getAdminProfileReports(): Promise<ProfileReportRow[]> {
  const { data, error } = await supabase
    .from('profile_reports')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[db] getAdminProfileReports error:', error.message)
    return []
  }
  return (data ?? []) as ProfileReportRow[]
}

export async function getAdminMessageReports(): Promise<MessageReportRow[]> {
  const { data, error } = await supabase
    .from('message_reports')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[db] getAdminMessageReports error:', error.message)
    return []
  }
  return (data ?? []) as MessageReportRow[]
}

export async function updateProfileReportStatus(reportId: string, status: ProfileReportRow['status'], reviewerNote?: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('profile_reports')
    .update({ status, reviewed_at: new Date().toISOString(), reviewer_note: reviewerNote ?? null })
    .eq('id', reportId)

  if (error) {
    console.error('[db] updateProfileReportStatus error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function updateMessageReportStatus(reportId: string, status: MessageReportRow['status'], reviewerNote?: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('message_reports')
    .update({ status, reviewed_at: new Date().toISOString(), reviewer_note: reviewerNote ?? null })
    .eq('id', reportId)

  if (error) {
    console.error('[db] updateMessageReportStatus error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** Normalize stored path (bucket-relative) — tolerate accidental `proofs/` prefix or absolute object URLs */
export function normalizeProofStoragePath(pathOrUrl: string): string {
  let path = pathOrUrl.trim()
  if (!path) return path
  try {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const u = new URL(path)
      const pub = '/public/proofs/'
      const sign = '/sign/proofs/'
      let idx = u.pathname.indexOf(pub)
      if (idx !== -1) path = decodeURIComponent(u.pathname.slice(idx + pub.length))
      else {
        idx = u.pathname.indexOf(sign)
        if (idx !== -1) path = decodeURIComponent(u.pathname.slice(idx + sign.length))
        else {
          idx = u.pathname.indexOf('/proofs/')
          if (idx !== -1) path = decodeURIComponent(u.pathname.slice(idx + '/proofs/'.length))
        }
      }
    }
  } catch {
    /* keep path */
  }
  if (path.startsWith('proofs/')) path = path.slice('proofs/'.length)
  return path
}

export async function getDocSignedUrl(path: string): Promise<string | null> {
  const normalized = normalizeProofStoragePath(path)
  const { data, error } = await supabase.storage
    .from('proofs')
    .createSignedUrl(normalized, 60 * 30)

  if (error || !data?.signedUrl) {
    console.error('[db] getDocSignedUrl failed:', error?.message ?? 'no url', normalized)
    return null
  }
  return data.signedUrl
}

// Get latest income-verification record for a user (for "審核中 / 已通過 / 已拒絕" status)
export async function getIncomeVerification(userId: string) {
  const { data, error } = await supabase
    .from('verification_docs')
    .select('*')
    .eq('user_id', userId)
    .eq('verification_kind', 'income')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[db] getIncomeVerification error:', error.message)
    return null
  }
  return data
}
