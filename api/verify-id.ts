import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sanitizeVerificationUserMessage } from './_utils/companySanitize.js'
import {
  hasTopTierEmployerEvidence,
  looksLikeTsmcEwcVirtualBadge,
  resolveTopTierCompanyFromFields,
  type TopTierCompany,
} from './_utils/employerMatch.js'
import {
  claimedNameMatchesDetected,
  type VerificationDocTypeHint,
} from './_utils/verificationNameMatch.js'

// POST /api/verify-id

// Returns: { ok: boolean; company: 'TSMC' | 'MediaTek' | null; message: string }

type IncomeTier = 'silver' | 'gold' | 'diamond'

function incomeTierMeetsClaim(
  claimed: IncomeTier | undefined,
  suggested: IncomeTier | null | undefined,
): boolean {
  if (!claimed) return suggested != null
  if (!suggested) return false
  const rank: Record<IncomeTier, number> = { silver: 1, gold: 2, diamond: 3 }
  return rank[suggested] >= rank[claimed]
}

function incomeDocTypeForNameMatch(
  verificationKind: 'employment' | 'income',
  docType: VerificationDocTypeHint | undefined,
): VerificationDocTypeHint | undefined {
  if (verificationKind !== 'income') return docType
  if (docType === 'tax_return' || docType === 'payslip') return docType
  return 'tax_return'
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
    ? '這張文件類型是扣繳憑單/各類所得扣繳暨免扣繳憑單。detectedName 必須只填「所得人姓名」欄位上的繁體中文姓名（2–4 字），忽略英文／羅馬拼音／護照拼音列；若同時有中文與英文，只填中文，不要填「中文／英文」格式。雇主／公司名稱通常印在**右上角「扣繳單位」**區塊（含統一編號、單位名稱、地址）；請優先逐字讀取該區塊填入 detectedEmployer 與 employerEvidenceQuote，亦可能出現在「給付單位」或「雇主名稱」欄位；不可根據使用者選擇公司推測。'
    : docType === 'payslip'
      ? '這張文件類型是薪資單。detectedName 必須只填員工姓名欄位的繁體中文姓名，忽略英文／羅馬拼音；公司請看雇主、公司、發薪單位。'
      : docType === 'employee_id'
        ? '這張文件類型是員工證/識別證。證件若同時有中文姓名與英文姓名（或羅馬拼音），detectedName 必須優先包含清晰的中文姓名（與使用者資料比對以中文為準）；不得僅填英文而忽略可看見的中文。若中英文並列，請填「中文姓名／英文姓名」同一字串（例如「陳怡君／CHEN YI-CHUN」）。若為台積電「EWC Mobile Badges／職工福利委員會」App 螢幕上的「虛擬識別證」（含 tsmc logo、台灣積體電路製造股份有限公司、工號、姓名、動態日期浮水印），此為正式員工數位識別證；「虛擬」意指 App 數位版而非實體塑膠卡，仍應 isEmployeeId=true、containsVendorTerms=false。'
        : '若文件是扣繳憑單，姓名請只讀「所得人姓名」的中文；若是薪資單，姓名請只讀中文員工姓名；若是員工證，請優先讀中文姓名；中英文並列時以「中文／英文」填入 detectedName。'
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
  "detectedEmployer": "若有扣繳單位/雇主欄位可填，否則 null",
  "employerEvidenceQuote": "可選；收入審核不強制要求",
  "nameMatches": true/false,
  "annualIncomeAmount": "文件可辨識的年收入數字，若看不到則為 null",
  "suggestedIncomeTier": "silver" | "gold" | "diamond" | null,
  "confidence": "high" | "medium" | "low",
  "reason": "簡短說明原因（繁體中文）"
}

判斷標準：
- isEmployeeId 表示「是否為有效收入證明文件且支持申請等級」，不是員工證
- 若圖片模糊、不清楚、不是收入/薪資/稅務/銀行收入文件，isEmployeeId 為 false
- 若文件明顯無法支持申請的收入等級（suggestedIncomeTier 低於 claimed），isEmployeeId 為 false
- 若使用者姓名有提供，detectedName 只填繁體中文姓名；若同列英文如「林家華 (LIN CHIA-HUA)」仍只填中文「林家華」；中文與使用者姓名一致則 nameMatches 為 true
- 扣繳憑單必須讀「所得人姓名」的中文作為 detectedName
- detectedEmployer／employerEvidenceQuote 可填但不影響收入審核通過與否
- 若年收入 200–299 萬，suggestedIncomeTier 為 silver；300–399 萬為 gold；400 萬以上為 diamond；低於 200 萬或無法判斷為 null
- 若文件有遮蔽敏感資訊但仍能判斷收入範圍，可接受
- 當姓名一致、suggestedIncomeTier 符合或高於申請等級、文件類型正確時，isEmployeeId 必須為 true`
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
- **必須接受**台積電官方「EWC Mobile Badges／職工福利委員會」App 顯示的**虛擬識別證**（螢幕截圖可）：含 tsmc logo、「台灣積體電路製造股份有限公司」、工號、姓名；「虛擬識別證」= 正式員工數位員工證，**不是**造假、訪客證、廠商證或臨時證；containsVendorTerms 必須為 false；勿因「虛擬」二字拒絕
- 若是扣繳憑單，detectedName 必須取自「所得人姓名」（或同義欄位「納稅義務人」、「姓名」）的繁體中文，忽略英文／羅馬拼音；company 必須依文件實際雇主判斷，**優先讀右上角「扣繳單位」區塊**（統編旁單位名稱），其次才是「給付單位」、「雇主名稱」
- 使用者選擇公司可能選錯；只要文件實際雇主/公司是台積電或聯發科正式員工文件即可通過，company 請回文件實際公司
- 若是扣繳憑單或薪資單，detectedEmployer 必須逐字抄出文件上的扣繳單位/給付單位/雇主名稱；不得根據使用者選擇公司或文件外資訊推測
- 若 detectedEmployer 逐字內容不是台積電/TSMC/台灣積體電路或聯發科/MediaTek/MTK，isEmployeeId 必須為 false，company 必須為 null
- employerEvidenceQuote 必須逐字抄出能證明雇主名稱的原文片段；若你無法清楚逐字看到台積電或聯發科相關字樣，isEmployeeId 必須為 false，company 必須為 null
- 若圖片模糊、不清楚、非職業身份/薪資稅務文件，isEmployeeId 為 false
- 僅接受台積電或聯發科，其他公司也為 false
- 需看到公司名稱、logo、雇主名稱或明顯識別特徵
- 如果證件、職稱、備註、公司欄位、識別證類別出現「廠商」、「承攬商」、「外包」、「駐廠」、「vendor」、「contractor」、「外部人員」等字眼，必須 isEmployeeId 為 false
- 如果只是台積電/聯發科廠區通行證、訪客證、廠商工作證、施工證、臨時證，而非正式員工證，必須 isEmployeeId 為 false（**例外：台積電職工福利委員會 App 的虛擬識別證屬正式員工證，必須通過**）
- 文件上的姓名必須與使用者姓名「${normalizedClaimedName}」相同或高度一致（員工證若中英文並列，只要中文姓名與使用者姓名一致即可通過 nameMatches）
- detectedName 必須填入你從文件上看到的使用者姓名；員工識別證請優先抄錄中文姓名，並與英文並列時使用「中文／英文」格式；扣繳憑單與薪資單只填中文姓名；若看不到中文姓名，detectedName 為 null 且 nameMatches 為 false
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

    const docTypeForMatch = incomeDocTypeForNameMatch(
      verificationKind,
      docType as VerificationDocTypeHint | undefined,
    )
    const serverNameMatches = normalizedClaimedName
      ? claimedNameMatchesDetected(normalizedClaimedName, parsed.detectedName, { docType: docTypeForMatch })
      : false

    if (verificationKind === 'income') {
      if (!normalizedClaimedName) {
        return res.status(200).json({
          ok: false,
          company: null,
          confidence: parsed.confidence,
          reason: '缺少使用者姓名，無法比對文件姓名。',
          message: '缺少使用者姓名，無法比對文件姓名，請先完成個人資料姓名設定。',
        })
      }

      const incomeNameMismatch = !serverNameMatches
      const incomeTierOk = incomeTierMeetsClaim(claimedIncomeTier, parsed.suggestedIncomeTier)
      const incomeConfidenceOk = parsed.confidence === 'high' || parsed.confidence === 'medium'
      const incomeDocAccepted = !incomeNameMismatch
        && incomeTierOk
        && (
          parsed.isEmployeeId
          || (incomeConfidenceOk && parsed.suggestedIncomeTier != null && serverNameMatches)
        )

      if (!incomeDocAccepted) {
        const strictReason = incomeNameMismatch
          ? `文件姓名與使用者姓名不一致或無法確認。使用者姓名：${normalizedClaimedName}；文件姓名：${parsed.detectedName ?? '未辨識'}`
          : !incomeTierOk
            ? `文件顯示的收入等級不足以支持申請的 ${claimedIncomeTier ?? '收入'} 等級。`
            : undefined
        const rawReason = strictReason ?? parsed.reason
        const rawMessage = strictReason || parsed.reason || '未能辨識為有效收入證明，請確認圖片清晰度並重新上傳'
        return res.status(200).json({
          ok: false,
          company: null,
          reason: sanitizeVerificationUserMessage(rawReason),
          confidence: parsed.confidence,
          message: sanitizeVerificationUserMessage(rawMessage),
        })
      }

      const successReason = sanitizeVerificationUserMessage(parsed.reason)
      return res.status(200).json({
        ok: true,
        company: null,
        confidence: parsed.confidence,
        reason: successReason,
        suggestedIncomeTier: parsed.suggestedIncomeTier ?? null,
        message: `✓ 已辨識為有效收入證明（${successReason}）`,
      })
    }

    const taxOrPayslipNeedsEmployer = docType === 'tax_return' || docType === 'payslip'
    const virtualEmployeeBadge = docType === 'employee_id' && looksLikeTsmcEwcVirtualBadge(parsed)
    const resolvedCompany = resolveTopTierCompanyFromFields(parsed)
    const topTierEmployerSeen = hasTopTierEmployerEvidence(parsed)
    const employmentAcceptableConfidence = parsed.confidence === 'high'
      || (taxOrPayslipNeedsEmployer && parsed.confidence === 'medium' && resolvedCompany && topTierEmployerSeen)
      || (virtualEmployeeBadge && parsed.confidence === 'medium' && resolvedCompany && serverNameMatches)
    const isLowConfidenceEmployment = !employmentAcceptableConfidence
    const employmentNameMismatch = Boolean(normalizedClaimedName) && !serverNameMatches
    const employmentVendorDoc = parsed.containsVendorTerms === true && !virtualEmployeeBadge
    const employerEvidenceMissing = taxOrPayslipNeedsEmployer && !topTierEmployerSeen
    const employerMismatch = taxOrPayslipNeedsEmployer
      && Boolean(parsed.detectedEmployer?.trim())
      && !topTierEmployerSeen
    const taxPayslipLooksValid = taxOrPayslipNeedsEmployer
      && Boolean(resolvedCompany)
      && topTierEmployerSeen
      && serverNameMatches
      && !employmentVendorDoc
    const virtualBadgeLooksValid = virtualEmployeeBadge
      && Boolean(resolvedCompany)
      && serverNameMatches
    const effectiveIsEmployeeId = parsed.isEmployeeId || taxPayslipLooksValid || virtualBadgeLooksValid
    if (
      !effectiveIsEmployeeId
      || !resolvedCompany
      || isLowConfidenceEmployment
      || employmentNameMismatch
      || employmentVendorDoc
      || employerMismatch
      || employerEvidenceMissing
    ) {
      const strictReason = employmentNameMismatch
        ? `證件姓名與使用者姓名不一致或無法確認。使用者姓名：${normalizedClaimedName}；證件姓名：${parsed.detectedName ?? '未辨識'}`
        : employmentVendorDoc
          ? '文件疑似廠商、承攬商、外包、駐廠或訪客類證件，不可作為正式員工認證。'
          : employerMismatch
            ? `扣繳單位/雇主不符合頂尖企業限定資格。辨識到的扣繳單位/雇主：${parsed.detectedEmployer ?? '未辨識'}`
            : employerEvidenceMissing
              ? `無法從原文片段確認符合頂尖企業限定資格。原文片段：${parsed.employerEvidenceQuote ?? '未辨識'}`
              : undefined
      const rawReason = strictReason ?? parsed.reason
      const rawMessage = strictReason || (isLowConfidenceEmployment ? '員工身份、姓名或正式員工證特徵不足，需人工確認' : parsed.reason) || '未能辨識為符合頂尖企業限定的正式員工文件，請確認圖片清晰度並重新上傳'
      return res.status(200).json({
        ok: false,
        company: null,
        reason: sanitizeVerificationUserMessage(rawReason),
        confidence: parsed.confidence,
        message: sanitizeVerificationUserMessage(rawMessage),
      })
    }

    const successCompany: TopTierCompany = resolvedCompany ?? parsed.company!
    const successReason = sanitizeVerificationUserMessage(parsed.reason)
    return res.status(200).json({
      ok: true,
      company: successCompany,
      confidence: parsed.confidence,
      reason: successReason,
      suggestedIncomeTier: parsed.suggestedIncomeTier ?? null,
      message: `✓ 已辨識為符合頂尖企業限定的正式員工文件（${successReason}）`,
    })
  } catch (err) {
    console.error('[verify-id] Unexpected error:', err)
    return res.status(500).json({ ok: false, message: '伺服器發生錯誤，請稍後再試' })
  }
}
