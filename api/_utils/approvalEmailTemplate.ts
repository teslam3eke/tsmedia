export const APPROVAL_EMAIL_SUBJECT = '你的 tsmedia 審核通過了 🎉'

export const EMAIL_LAUNCH_FROM_PARAM = 'fromEmail'
export const EMAIL_LAUNCH_APPROVAL_VALUE = 'approval'

/** CTA：僅 fromEmail=approval，不含 PII。 */
export function buildApprovalEmailCtaUrl(siteUrl: string): string {
  const base = siteUrl.trim().replace(/\/$/, '') || 'https://tsmedia.tw'
  const u = new URL('/', `${base}/`)
  u.searchParams.set(EMAIL_LAUNCH_FROM_PARAM, EMAIL_LAUNCH_APPROVAL_VALUE)
  return u.toString()
}

export type ApprovalEmailContent = {
  subject: string
  html: string
  text: string
  ctaUrl: string
}

export function buildApprovalEmailContent(siteUrl: string): ApprovalEmailContent {
  const ctaUrl = buildApprovalEmailCtaUrl(siteUrl)
  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:420px;background:#ffffff;border-radius:16px;padding:28px 24px;">
        <tr><td style="font-size:16px;line-height:1.6;">
          <p style="margin:0 0 16px;">嗨，你的 tsmedia 會員審核已經通過！</p>
          <p style="margin:0 0 24px;color:#475569;">現在可以開始看看有沒有想認識的人。</p>
          <p style="margin:0 0 28px;text-align:center;">
            <a href="${escapeHtmlAttr(ctaUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:999px;">開始探索</a>
          </p>
          <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">tsmedia<br>在這裡，讓你遇見改變世界的人</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = `嗨，你的 tsmedia 會員審核已經通過！

現在可以開始看看有沒有想認識的人。

開始探索：${ctaUrl}

tsmedia
在這裡，讓你遇見改變世界的人`

  return {
    subject: APPROVAL_EMAIL_SUBJECT,
    html,
    text,
    ctaUrl,
  }
}

function escapeHtmlAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
