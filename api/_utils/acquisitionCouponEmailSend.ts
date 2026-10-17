import {
  USER_COUPON_CAMPAIGN,
  type UserCouponCampaignKey,
} from './membershipCheckoutPricing.js'
import { buildAcquisitionCouponEmailContent } from './acquisitionCouponEmailTemplate.js'
import { getSiteUrl } from './ecpayConfig.js'

export type SendAcquisitionCouponEmailResult =
  | { ok: true; providerId?: string }
  | { ok: false; skipped?: boolean; error: string }

function readResendConfig(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.APPROVAL_EMAIL_FROM?.trim()
  if (!apiKey || !from) return null
  return { apiKey, from }
}

export function isLifecycleAcquisitionCampaignKey(
  key: string,
): key is UserCouponCampaignKey {
  return (
    key === USER_COUPON_CAMPAIGN.APPROVED_48H_200 ||
    key === USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT
  )
}

/** 透過 Resend HTTP API 寄送 acquisition coupon Email；不 log 收件人 email。 */
export async function sendAcquisitionCouponEmailToRecipient(
  recipientEmail: string,
  campaignKey: UserCouponCampaignKey,
): Promise<SendAcquisitionCouponEmailResult> {
  const cfg = readResendConfig()
  if (!cfg) {
    return { ok: false, skipped: true, error: 'acquisition_coupon_email_not_configured' }
  }

  const to = recipientEmail.trim()
  if (!to || !to.includes('@')) {
    return { ok: false, error: 'invalid_recipient' }
  }

  const content = buildAcquisitionCouponEmailContent(campaignKey, getSiteUrl())

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [to],
        subject: content.subject,
        html: content.html,
        text: content.text,
      }),
    })

    const text = await res.text()
    let json: { id?: string; message?: string } | null = null
    try {
      json = JSON.parse(text) as { id?: string; message?: string }
    } catch {
      /* ignore */
    }

    if (!res.ok) {
      const msg = json?.message ?? `http_${res.status}`
      console.warn('[acquisition-coupon-email] send failed', { status: res.status, message: msg })
      return { ok: false, error: msg }
    }

    console.info('[acquisition-coupon-email] sent', {
      campaignKey,
      providerId: json?.id ?? 'unknown',
    })
    return { ok: true, providerId: json?.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network_error'
    console.warn('[acquisition-coupon-email] send error', { campaignKey, message: msg })
    return { ok: false, error: msg }
  }
}
