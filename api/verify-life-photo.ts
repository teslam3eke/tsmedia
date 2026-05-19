import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// POST /api/verify-life-photo
// Authorization: Bearer <Supabase access_token>
// Body: { imageBase64: string }

const DAILY_FAILURE_LIMIT = 10

const PROMPT = `你是交友 App 生活照審核系統。使用者上傳的是「個人檔案生活照」，必須為**一位使用者本人**的正面露臉獨照。

請以 JSON 格式回覆（只回 JSON，不要多餘文字）：
{
  "hasClearHumanFace": true/false,
  "hasExactlyOnePerson": true/false,
  "isFrontFacingPortrait": true/false,
  "isMostlySceneryOrNonPerson": true/false,
  "isCartoonMemeScreenshotOrStock": true/false,
  "isValidProfilePhoto": true/false,
  "confidence": "high" | "medium" | "low",
  "reason": "簡短說明（繁體中文）"
}

判斷標準（嚴格）：
- hasExactlyOnePerson：照片中只能有**一位**真人；兩人及以上、情侶照、團體照、背景有第二人可辨 → false
- isFrontFacingPortrait：須為**露臉的正面照**（臉部朝向鏡頭；過度側臉、背影、低頭只看到頭頂、墨鏡／口罩遮住臉 → false）
- hasClearHumanFace：臉部清楚可辨
- isMostlySceneryOrNonPerson：純風景、美食、寵物、物品、建築等無真人主角 → true
- isCartoonMemeScreenshotOrStock：動漫、梗圖、明星網圖 → true
- isValidProfilePhoto：僅當**單人、正面露臉、清楚、非風景非梗圖**時 true
- 模糊、過暗、無法判斷 → confidence 為 low，isValidProfilePhoto 為 false`

function bearerToken(req: VercelRequest): string | null {
  const auth = req.headers.authorization?.trim()
  if (!auth?.startsWith('Bearer ')) return null
  const t = auth.slice('Bearer '.length).trim()
  return t.length > 0 ? t : null
}

function adminSupabase() {
  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key)
}

async function getAppDayKey(admin: ReturnType<typeof adminSupabase>): Promise<string> {
  const { data, error } = await admin.rpc('app_day_key_now')
  if (error) throw error
  return String(data)
}

async function getFailureCount(
  admin: ReturnType<typeof adminSupabase>,
  userId: string,
  appDayKey: string,
): Promise<number> {
  const { count, error } = await admin
    .from('life_photo_verify_failures')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('app_day_key', appDayKey)
  if (error) throw error
  return count ?? 0
}

async function recordFailure(
  admin: ReturnType<typeof adminSupabase>,
  userId: string,
  appDayKey: string,
): Promise<number> {
  const { error } = await admin.from('life_photo_verify_failures').insert({
    user_id: userId,
    app_day_key: appDayKey,
  })
  if (error) throw error
  return getFailureCount(admin, userId, appDayKey)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' })
  }

  const token = bearerToken(req)
  const url = process.env.SUPABASE_URL?.trim()
  const anon = process.env.SUPABASE_ANON_KEY?.trim() ?? process.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!token || !url || !anon) {
    return res.status(401).json({ ok: false, message: '請先登入後再上傳生活照' })
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser(token)
  const userId = userData.user?.id
  if (userErr || !userId) {
    return res.status(401).json({ ok: false, message: '登入已失效，請重新登入' })
  }

  const { imageBase64 } = req.body as { imageBase64?: string }
  if (!imageBase64 || !imageBase64.startsWith('data:image/')) {
    return res.status(400).json({ ok: false, message: '請提供有效的圖片' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: '伺服器設定錯誤，請稍後再試' })
  }

  try {
    const admin = adminSupabase()
    const appDayKey = await getAppDayKey(admin)
    const failuresBefore = await getFailureCount(admin, userId, appDayKey)

    if (failuresBefore >= DAILY_FAILURE_LIMIT) {
      return res.status(200).json({
        ok: false,
        limited: true,
        failuresToday: failuresBefore,
        remaining: 0,
        message: `今日生活照審核失敗已達 ${DAILY_FAILURE_LIMIT} 次，請明日再試（每晚 10 點換日）。`,
      })
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 260,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: imageBase64, detail: 'low' } },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[verify-life-photo] OpenAI error:', err)
      return res.status(502).json({ ok: false, message: 'AI 服務暫時無法使用，請稍後再試' })
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[]
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[verify-life-photo] Could not parse JSON from:', content)
      const failuresToday = await recordFailure(admin, userId, appDayKey)
      return res.status(200).json({
        ok: false,
        failuresToday,
        remaining: Math.max(0, DAILY_FAILURE_LIMIT - failuresToday),
        limited: failuresToday >= DAILY_FAILURE_LIMIT,
        message: '無法辨識照片內容，請上傳光線充足、正面露臉的獨照',
      })
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      hasClearHumanFace?: boolean
      hasExactlyOnePerson?: boolean
      isFrontFacingPortrait?: boolean
      isMostlySceneryOrNonPerson?: boolean
      isCartoonMemeScreenshotOrStock?: boolean
      isValidProfilePhoto?: boolean
      confidence?: string
      reason?: string
    }

    const lowConfidence = parsed.confidence === 'low'
    const scenery = parsed.isMostlySceneryOrNonPerson === true
    const notPerson = parsed.hasClearHumanFace === false
    const multiPerson = parsed.hasExactlyOnePerson === false
    const notFront = parsed.isFrontFacingPortrait === false
    const cartoon = parsed.isCartoonMemeScreenshotOrStock === true
    const invalid = parsed.isValidProfilePhoto !== true

    if (invalid || notPerson || multiPerson || notFront || scenery || cartoon || lowConfidence) {
      const reasonTw = multiPerson
        ? '生活照必須為單人正面獨照，不可上傳兩人以上的照片。'
        : notFront
          ? '請上傳露臉的正面照，臉部需朝向鏡頭。'
          : scenery
            ? '不可使用風景、美食、寵物或物品照片，請上傳以本人為主角的生活照。'
            : notPerson
              ? '請上傳臉部清楚可辨的正面生活照。'
              : cartoon
                ? '請上傳本人真實生活照，不可使用卡通、梗圖或網路圖片。'
                : lowConfidence
                  ? '照片過於模糊或光線不足，請換一張更清楚的正面獨照。'
                  : (parsed.reason?.trim() || '此照片不符合生活照要求，請重新選擇。')

      const failuresToday = await recordFailure(admin, userId, appDayKey)
      return res.status(200).json({
        ok: false,
        reason: reasonTw,
        failuresToday,
        remaining: Math.max(0, DAILY_FAILURE_LIMIT - failuresToday),
        limited: failuresToday >= DAILY_FAILURE_LIMIT,
        message: reasonTw,
      })
    }

    return res.status(200).json({
      ok: true,
      confidence: parsed.confidence,
      failuresToday: failuresBefore,
      remaining: Math.max(0, DAILY_FAILURE_LIMIT - failuresBefore),
      message: '照片符合生活照要求',
    })
  } catch (err) {
    console.error('[verify-life-photo] Unexpected error:', err)
    return res.status(500).json({ ok: false, message: '伺服器發生錯誤，請稍後再試' })
  }
}
