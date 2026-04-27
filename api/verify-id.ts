import type { VercelRequest, VercelResponse } from '@vercel/node'

// POST /api/verify-id
// Body: { imageBase64: string; verificationKind?: 'employment' | 'income'; claimedIncomeTier?: string; claimedName?: string; claimedCompany?: string; docType?: string }
// Returns: { ok: boolean; company: 'TSMC' | 'MediaTek' | null; message: string }

function normalizeNameForCompare(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFKC')
    .replace(/[\s　·・．.。､,，、\-－_()（）[\]【】「」『』:：;；/\\|]/g, '')
    .toLowerCase()
}

function namesMatchStrictly(claimedName: string, detectedName: string | null | undefined): boolean {
  const claimed = normalizeNameForCompare(claimedName)
  const detected = normalizeNameForCompare(detectedName)
  if (!claimed || !detected) return false
  return claimed === detected
}

function normalizeCompanyForCompare(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/[\s　·・．.。､,，、\-－_()（）[\]【】「」『』:：;；/\\|]/g, '')
    .toLowerCase()
}

function employerMatchesCompany(company: 'TSMC' | 'MediaTek' | null | undefined, detectedEmployer: string | null | undefined): boolean {
  const employer = normalizeCompanyForCompare(detectedEmployer)
  if (!company || !employer) return false
  if (company === 'MediaTek') {
    return employer.includes('聯發科') || employer.includes('mediatek') || employer.includes('mtk')
  }
  return employer.includes('台積電') || employer.includes('台灣積體電路') || employer.includes('tsmc')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' })
  }

  const { imageBase64, verificationKind = 'employment', claimedIncomeTier, claimedName, claimedCompany, docType } = req.body as {
    imageBase64?: string
    verificationKind?: 'employment' | 'income'
    claimedIncomeTier?: 'silver' | 'gold' | 'diamond'
    claimedName?: string
    claimedCompany?: 'TSMC' | 'MediaTek'
    docType?: 'employee_id' | 'tax_return' | 'payslip' | 'bank_statement' | 'other'
  }
  if (!imageBase64 || !imageBase64.startsWith('data:image/')) {
    return res.status(400).json({ ok: false, message: '請提供有效的圖片（data URL 格式）' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'Server misconfiguration: missing API key' })
  }

  const normalizedClaimedName = claimedName?.trim() ?? ''
  const normalizedClaimedCompany = claimedCompany === 'TSMC' || claimedCompany === 'MediaTek' ? claimedCompany : null
  const docTypeHint = docType === 'tax_return'
    ? '這張文件類型是扣繳憑單/扣繳暨免扣繳憑單。姓名請優先讀「所得人姓名」，也可能標示為「納稅義務人」、「姓名」。公司必須逐字抄出「扣繳單位」、「給付單位」、「雇主名稱」或公司名稱欄位；不可根據使用者選擇公司推測。'
    : docType === 'payslip'
      ? '這張文件類型是薪資單。姓名請讀員工姓名/姓名欄位，公司請看雇主、公司、發薪單位。'
      : docType === 'employee_id'
        ? '這張文件類型是員工證/識別證。姓名請讀證件上的姓名欄位。'
        : '若文件是扣繳憑單，姓名請讀「所得人姓名」；若是薪資單，姓名請讀員工姓名；若是員工證，姓名請讀證件姓名。'
  if (verificationKind === 'employment' && !normalizedClaimedName) {
    return res.status(200).json({
      ok: false,
      company: null,
      confidence: 'low',
      reason: '缺少使用者姓名，無法比對證件姓名。',
      message: '缺少使用者姓名，無法比對證件姓名，請先完成個人資料姓名設定。',
    })
  }

  const prompt = verificationKind === 'income'
    ? `你是台灣收入證明文件的審核系統。
請仔細辨認這張圖片，判斷它是否為可用的收入證明文件，例如：薪資單、扣繳憑單、報稅資料、銀行入帳紀錄或其他明確薪資/收入證明。

使用者申請的收入等級：${claimedIncomeTier ?? '未提供'}
使用者姓名：${normalizedClaimedName || '未提供'}
文件類型提示：${docTypeHint}
- silver：年收 200–299 萬
- gold：年收 300–399 萬
- diamond：年收 400 萬以上

請以 JSON 格式回覆，格式如下（只回 JSON，不要多餘文字）：
{
  "isEmployeeId": true/false,
  "company": null,
  "detectedName": "文件上的姓名，若看不到則為 null",
  "detectedEmployer": "逐字抄出文件上的扣繳單位/給付單位/雇主名稱，若看不到則為 null",
  "employerEvidenceQuote": "能證明雇主名稱的原文片段，若看不到則為 null",
  "nameMatches": true/false,
  "annualIncomeAmount": "文件可辨識的年收入數字，若看不到則為 null",
  "suggestedIncomeTier": "silver" | "gold" | "diamond" | null,
  "confidence": "high" | "medium" | "low",
  "reason": "簡短說明原因（繁體中文）"
}

判斷標準：
- 若圖片模糊、不清楚、不是收入/薪資/稅務/銀行收入文件，isEmployeeId 為 false
- 若文件明顯無法支持申請的收入等級，isEmployeeId 為 false
- 若使用者姓名有提供，文件上的姓名必須與使用者姓名相同或高度一致；若不同、看不到姓名、或無法判斷姓名，isEmployeeId 為 false 且 nameMatches 為 false
- 扣繳憑單必須讀「所得人姓名」作為 detectedName，不要把扣繳單位、公司名稱、負責人或統編誤當成姓名
- detectedName 必須填入你從文件看到的姓名；若看不到姓名，detectedName 為 null
- detectedEmployer 必須逐字填入扣繳單位/給付單位/雇主名稱；不可推測、不可填使用者選擇公司
- employerEvidenceQuote 必須逐字填入包含雇主名稱的原文片段；若沒有清楚看到，isEmployeeId 為 false
- 若年收入 200–299 萬，suggestedIncomeTier 為 silver；300–399 萬為 gold；400 萬以上為 diamond；低於 200 萬或無法判斷為 null
- 若文件有遮蔽敏感資訊但仍能判斷收入範圍，可接受`
    : `你是台灣科技公司職業身份文件的驗證系統。
請仔細辨認這張圖片，判斷：
1. 這是否為台積電（TSMC）或聯發科（MediaTek）的正式員工身份文件？
2. 如果是，是哪家公司？
3. 證件姓名是否與使用者姓名一致？

使用者姓名：${normalizedClaimedName}
使用者選擇公司：${normalizedClaimedCompany ?? '未提供'}（只作為前端選項參考；請以文件實際雇主/公司為準）
文件類型提示：${docTypeHint}

請以 JSON 格式回覆，格式如下（只回 JSON，不要多餘文字）：
{
  "isEmployeeId": true/false,
  "company": "TSMC" | "MediaTek" | null,
  "detectedName": "證件上的姓名，若看不到則為 null",
  "detectedEmployer": "逐字抄出員工證公司/扣繳單位/給付單位/雇主名稱，若看不到則為 null",
  "employerEvidenceQuote": "能證明雇主名稱的原文片段，若看不到則為 null",
  "nameMatches": true/false,
  "containsVendorTerms": true/false,
  "annualIncomeAmount": "文件可辨識的年收入數字，若看不到則為 null",
  "suggestedIncomeTier": "silver" | "gold" | "diamond" | null,
  "confidence": "high" | "medium" | "low",
  "reason": "簡短說明原因（繁體中文）"
}

判斷標準：
- 可接受正式員工識別證、薪資單、扣繳憑單、報稅/薪資資料；但必須能看出使用者是台積電或聯發科正式員工
- 若是扣繳憑單，detectedName 必須取自「所得人姓名」（或同義欄位「納稅義務人」、「姓名」），company 必須依「扣繳單位」、「給付單位」、「雇主名稱」判斷
- 使用者選擇公司可能選錯；只要文件實際雇主/公司是台積電或聯發科正式員工文件即可通過，company 請回文件實際公司
- 若是扣繳憑單或薪資單，detectedEmployer 必須逐字抄出文件上的扣繳單位/給付單位/雇主名稱；不得根據使用者選擇公司或文件外資訊推測
- 若 detectedEmployer 逐字內容不是台積電/TSMC/台灣積體電路或聯發科/MediaTek/MTK，isEmployeeId 必須為 false，company 必須為 null
- employerEvidenceQuote 必須逐字抄出能證明雇主名稱的原文片段；若你無法清楚逐字看到台積電或聯發科相關字樣，isEmployeeId 必須為 false，company 必須為 null
- 若圖片模糊、不清楚、非職業身份/薪資稅務文件，isEmployeeId 為 false
- 僅接受台積電或聯發科，其他公司也為 false
- 需看到公司名稱、logo、雇主名稱或明顯識別特徵
- 如果證件、職稱、備註、公司欄位、識別證類別出現「廠商」、「承攬商」、「外包」、「駐廠」、「vendor」、「contractor」、「外部人員」等字眼，必須 isEmployeeId 為 false
- 如果只是台積電/聯發科廠區通行證、訪客證、廠商工作證、施工證、臨時證，而非正式員工證，必須 isEmployeeId 為 false
- 文件上的姓名必須與使用者姓名「${normalizedClaimedName}」相同或高度一致；若不同、看不到姓名、或無法判斷姓名，isEmployeeId 為 false 且 nameMatches 為 false
- detectedName 必須填入你從文件上看到的使用者姓名；扣繳憑單請填「所得人姓名」；若看不到姓名，detectedName 為 null 且 nameMatches 為 false
- detectedEmployer 必須填入你從文件上看到的公司、扣繳單位、給付單位或雇主名稱
- 若年收入 200–299 萬，suggestedIncomeTier 為 silver；300–399 萬為 gold；400 萬以上為 diamond；低於 200 萬或無法判斷為 null
- 若只能看到公司 logo 但看不到姓名與正式員工身份，不可通過
- 對員工證審核要嚴格；對薪資單/扣繳憑單可用雇主名稱與姓名判斷正式任職關係`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 450,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageBase64, detail: 'high' } },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[verify-id] OpenAI error:', err)
      return res.status(502).json({ ok: false, message: 'AI 服務暫時無法使用，請稍後再試' })
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[]
    }
    const content = data.choices?.[0]?.message?.content ?? ''

    // Parse JSON from model response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[verify-id] Could not parse JSON from:', content)
      return res.status(200).json({ ok: false, company: null, message: '無法辨識圖片內容，請上傳更清晰的員工證照片' })
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      isEmployeeId: boolean
      company: 'TSMC' | 'MediaTek' | null
      detectedName?: string | null
      detectedEmployer?: string | null
      employerEvidenceQuote?: string | null
      nameMatches?: boolean
      containsVendorTerms?: boolean
      annualIncomeAmount?: string | number | null
      suggestedIncomeTier?: 'silver' | 'gold' | 'diamond' | null
      confidence: string
      reason: string
    }

    const strictNameMismatch = normalizedClaimedName
      ? !namesMatchStrictly(normalizedClaimedName, parsed.detectedName)
      : false
    const isLowConfidenceEmployment = verificationKind === 'employment' && parsed.confidence !== 'high'
    const employmentNameMismatch = verificationKind === 'employment' && (parsed.nameMatches !== true || strictNameMismatch)
    const employmentVendorDoc = verificationKind === 'employment' && parsed.containsVendorTerms === true
    const taxOrPayslipNeedsEmployer = verificationKind === 'employment'
      && (docType === 'tax_return' || docType === 'payslip')
    const employerMismatch = verificationKind === 'employment'
      && taxOrPayslipNeedsEmployer
      && !employerMatchesCompany(parsed.company, parsed.detectedEmployer)
    const employerEvidenceMissing = verificationKind === 'employment'
      && taxOrPayslipNeedsEmployer
      && !employerMatchesCompany(parsed.company, parsed.employerEvidenceQuote)
    const incomeNameMismatch = verificationKind === 'income' && Boolean(normalizedClaimedName) && (parsed.nameMatches !== true || strictNameMismatch)
    if (
      !parsed.isEmployeeId
      || incomeNameMismatch
      || (verificationKind === 'employment' && (
        !parsed.company
        || isLowConfidenceEmployment
        || employmentNameMismatch
        || employmentVendorDoc
        || employerMismatch
        || employerEvidenceMissing
      ))
    ) {
      const strictReason = employmentNameMismatch
        ? `證件姓名與使用者姓名不一致或無法確認。使用者姓名：${normalizedClaimedName}；證件姓名：${parsed.detectedName ?? '未辨識'}`
        : employmentVendorDoc
          ? '文件疑似廠商、承攬商、外包、駐廠或訪客類證件，不可作為正式員工認證。'
          : employerMismatch
            ? `扣繳單位/雇主不是台積電或聯發科。辨識到的扣繳單位/雇主：${parsed.detectedEmployer ?? '未辨識'}`
            : employerEvidenceMissing
              ? `無法從原文片段確認扣繳單位/雇主為台積電或聯發科。原文片段：${parsed.employerEvidenceQuote ?? '未辨識'}`
              : incomeNameMismatch
                ? `文件姓名與使用者姓名不一致或無法確認。使用者姓名：${normalizedClaimedName}；文件姓名：${parsed.detectedName ?? '未辨識'}`
                : undefined
      return res.status(200).json({
        ok: false,
        company: null,
        reason: strictReason ?? parsed.reason,
        confidence: parsed.confidence,
        message: strictReason || (isLowConfidenceEmployment ? '員工身份、姓名或正式員工證特徵不足，需人工確認' : parsed.reason) || (verificationKind === 'income'
          ? '未能辨識為有效收入證明，請確認圖片清晰度並重新上傳'
          : '未能辨識為台積電或聯發科員工證，請確認圖片清晰度並重新上傳'),
      })
    }

    return res.status(200).json({
      ok: true,
      company: parsed.company,
      confidence: parsed.confidence,
      reason: parsed.reason,
      suggestedIncomeTier: parsed.suggestedIncomeTier ?? null,
      message: verificationKind === 'income'
        ? `✓ 已辨識為有效收入證明（${parsed.reason}）`
        : `✓ 已辨識為 ${parsed.company} 員工證（${parsed.reason}）`,
    })
  } catch (err) {
    console.error('[verify-id] Unexpected error:', err)
    return res.status(500).json({ ok: false, message: '伺服器發生錯誤，請稍後再試' })
  }
}
