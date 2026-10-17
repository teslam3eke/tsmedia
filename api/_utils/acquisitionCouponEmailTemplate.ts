import { USER_COUPON_CAMPAIGN, type UserCouponCampaignKey } from './membershipCheckoutPricing.js'

export const EMAIL_LAUNCH_FROM_PARAM = 'fromEmail'
export const EMAIL_LAUNCH_ACQUISITION_COUPON_VALUE = 'acquisition_coupon'

export const ACQUISITION_EMAIL_48H_SUBJECT = '有些人，可能只差一個開始認識的機會'
export const ACQUISITION_EMAIL_7D_SUBJECT = '這次，真的只留給你 48 小時'

/** CTA：僅 fromEmail=acquisition_coupon，不含 PII。 */
export function buildAcquisitionCouponEmailCtaUrl(siteUrl: string): string {
  const base = siteUrl.trim().replace(/\/$/, '') || 'https://tsmedia.tw'
  const u = new URL('/', `${base}/`)
  u.searchParams.set(EMAIL_LAUNCH_FROM_PARAM, EMAIL_LAUNCH_ACQUISITION_COUPON_VALUE)
  return u.toString()
}

export type AcquisitionCouponEmailContent = {
  subject: string
  html: string
  text: string
  ctaUrl: string
  ctaLabel: string
}

function escapeHtmlAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function emailShell(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:420px;background:#ffffff;border-radius:16px;padding:28px 24px;">
        <tr><td style="font-size:16px;line-height:1.6;">
          ${bodyHtml}
          <p style="margin:28px 0 0;font-size:13px;color:#64748b;line-height:1.5;">tsmedia<br>在這裡，讓你遇見改變世界的人</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function ctaBlock(ctaUrl: string, label: string): string {
  return `<p style="margin:0 0 24px;text-align:center;">
            <a href="${escapeHtmlAttr(ctaUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:999px;">${label}</a>
          </p>`
}

export function buildAcquisitionCouponEmailContent(
  campaignKey: UserCouponCampaignKey,
  siteUrl: string,
): AcquisitionCouponEmailContent {
  const ctaUrl = buildAcquisitionCouponEmailCtaUrl(siteUrl)

  if (campaignKey === USER_COUPON_CAMPAIGN.APPROVED_48H_200) {
    const ctaLabel = '使用 $200 優惠'
    const html = emailShell(`
          <p style="margin:0 0 16px;">嗨，</p>
          <p style="margin:0 0 16px;">你已經通過 tsmedia 的審核了。</p>
          <p style="margin:0 0 16px;">有時候不是沒有想認識的人，<br>只是還沒決定要不要跨出第一步。</p>
          <p style="margin:0 0 16px;">所以我們替你準備了一個限時 $200 優惠。</p>
          <p style="margin:0 0 8px;font-weight:600;">VIP 會員現折 $200</p>
          <p style="margin:0 0 16px;color:#475569;">優惠將在 48 小時後失效。</p>
          <p style="margin:0 0 16px;color:#475569;">折價已自動帶入，不需要輸入優惠碼。</p>
          <p style="margin:0 0 24px;color:#475569;">也許下一個讓你想繼續聊下去的人，<br>已經在這裡了。</p>
          ${ctaBlock(ctaUrl, ctaLabel)}`)

    const text = `嗨，

你已經通過 tsmedia 的審核了。

有時候不是沒有想認識的人，
只是還沒決定要不要跨出第一步。

所以我們替你準備了一個限時 $200 優惠。

VIP 會員現折 $200
優惠將在 48 小時後失效。

折價已自動帶入，不需要輸入優惠碼。

也許下一個讓你想繼續聊下去的人，
已經在這裡了。

${ctaLabel}：${ctaUrl}

tsmedia
在這裡，讓你遇見改變世界的人`

    return { subject: ACQUISITION_EMAIL_48H_SUBJECT, html, text, ctaUrl, ctaLabel }
  }

  if (campaignKey === USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT) {
    const ctaLabel = '使用 3 折優惠'
    const html = emailShell(`
          <p style="margin:0 0 16px;">嗨，</p>
          <p style="margin:0 0 16px;">你通過 tsmedia 審核已經一段時間了。</p>
          <p style="margin:0 0 16px;">如果你還在想，要不要真的開始認識一個人——<br>我們想再推你一小步。</p>
          <p style="margin:0 0 16px;">這次替你保留了 VIP 3 折優惠。</p>
          <p style="margin:0 0 16px;font-weight:600;">只限 48 小時。</p>
          <p style="margin:0 0 16px;color:#475569;">折價已自動帶入，不需要輸入優惠碼。</p>
          <p style="margin:0 0 16px;color:#475569;">這也是這次審核後，<br>最後一次為你保留的會員優惠。</p>
          <p style="margin:0 0 24px;color:#475569;">不一定會遇見對的人，<br>但至少，別讓「沒有開始」變成最可惜的事。</p>
          ${ctaBlock(ctaUrl, ctaLabel)}`)

    const text = `嗨，

你通過 tsmedia 審核已經一段時間了。

如果你還在想，要不要真的開始認識一個人——
我們想再推你一小步。

這次替你保留了 VIP 3 折優惠。

只限 48 小時。

折價已自動帶入，不需要輸入優惠碼。

這也是這次審核後，
最後一次為你保留的會員優惠。

不一定會遇見對的人，
但至少，別讓「沒有開始」變成最可惜的事。

${ctaLabel}：${ctaUrl}

tsmedia
在這裡，讓你遇見改變世界的人`

    return { subject: ACQUISITION_EMAIL_7D_SUBJECT, html, text, ctaUrl, ctaLabel }
  }

  throw new Error('unsupported_campaign')
}
