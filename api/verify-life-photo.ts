import type { VercelRequest, VercelResponse } from '@vercel/node'

// POST /api/verify-life-photo
// Body: { imageBase64: string }
// Returns: { ok: boolean; message: string; reason?: string; confidence?: string }

const PROMPT = `你是交友 App 生活照審核系統。使用者上傳的是「個人檔案生活照」，必須能讓其他會員認出本人。

請判斷這張圖片是否適合作為生活照。

請以 JSON 格式回覆（只回 JSON，不要多餘文字）：
{
  "hasClearHumanFace": true/false,
  "isMostlySceneryOrNonPerson": true/false,
  "isCartoonMemeScreenshotOrStock": true/false,
  "isValidProfilePhoto": true/false,
  "confidence": "high" | "medium" | "low",
  "reason": "簡短說明（繁體中文）"
}

判斷標準：
- hasClearHumanFace：必須有至少一位真人，臉部清楚可辨（正臉、側臉、自拍皆可；墨鏡／口罩導致無法辨識臉部則 false）
- isMostlySceneryOrNonPerson：純風景、美食、寵物、物品、建築、海邊夕陽、車子、螢幕截圖等「沒有真人為主角」→ true
- isCartoonMemeScreenshotOrStock：動漫、梗圖、明星網圖、明顯非本人現場拍攝 → true
- isValidProfilePhoto：綜合結論；僅當有清楚真人臉、且非純風景／非人物主題、且非卡通梗圖時才 true
- 團體照若本人臉部夠清楚可 true；若臉太小或看不清則 false
- 模糊、過暗、無法判斷時 confidence 為 low，isValidProfilePhoto 應 false`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' })
  }

  const { imageBase64 } = req.body as { imageBase64?: string }
  if (!imageBase64 || !imageBase64.startsWith('data:image/')) {
    return res.status(400).json({ ok: false, message: '請提供有效的圖片（data URL 格式）' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: '伺服器設定錯誤，請稍後再試' })
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 220,
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
      return res.status(200).json({
        ok: false,
        message: '無法辨識照片內容，請上傳光線充足、臉部清楚的生活照',
      })
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      hasClearHumanFace?: boolean
      isMostlySceneryOrNonPerson?: boolean
      isCartoonMemeScreenshotOrStock?: boolean
      isValidProfilePhoto?: boolean
      confidence?: string
      reason?: string
    }

    const lowConfidence = parsed.confidence === 'low'
    const scenery = parsed.isMostlySceneryOrNonPerson === true
    const notPerson = parsed.hasClearHumanFace === false
    const cartoon = parsed.isCartoonMemeScreenshotOrStock === true
    const invalid = parsed.isValidProfilePhoto !== true

    if (invalid || notPerson || scenery || cartoon || lowConfidence) {
      const reason = scenery
        ? '請上傳以本人為主角的生活照，不可使用風景、美食、寵物或物品照片。'
        : notPerson
          ? '請上傳臉部清楚可辨的生活照（正臉或側臉皆可）。'
          : cartoon
            ? '請上傳本人真實生活照，不可使用卡通、梗圖或網路圖片。'
            : lowConfidence
              ? '照片過於模糊或光線不足，請換一張臉部更清楚的照片。'
              : (parsed.reason?.trim() || '此照片不符合生活照要求，請重新選擇。')

      return res.status(200).json({
        ok: false,
        confidence: parsed.confidence,
        reason,
        message: reason,
      })
    }

    return res.status(200).json({
      ok: true,
      confidence: parsed.confidence,
      reason: parsed.reason,
      message: '照片符合生活照要求',
    })
  } catch (err) {
    console.error('[verify-life-photo] Unexpected error:', err)
    return res.status(500).json({ ok: false, message: '伺服器發生錯誤，請稍後再試' })
  }
}
