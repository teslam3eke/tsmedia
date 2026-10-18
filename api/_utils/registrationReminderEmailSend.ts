import type { RegistrationReminderStage } from './registrationReminderEligibility.js'
import { buildRegistrationReminderEmailContent } from './registrationReminderEmailTemplate.js'
import { getSiteUrl } from './ecpayConfig.js'

export type SendRegistrationReminderEmailResult =
  | { ok: true; providerId?: string }
  | { ok: false; skipped?: boolean; error: string }

function readResendConfig(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.APPROVAL_EMAIL_FROM?.trim()
  if (!apiKey || !from) return null
  return { apiKey, from }
}

export async function sendRegistrationReminderEmailToRecipient(
  recipientEmail: string,
  stage: RegistrationReminderStage,
): Promise<SendRegistrationReminderEmailResult> {
  const cfg = readResendConfig()
  if (!cfg) {
    return { ok: false, skipped: true, error: 'registration_reminder_email_not_configured' }
  }

  const to = recipientEmail.trim()
  if (!to || !to.includes('@')) {
    return { ok: false, error: 'invalid_recipient' }
  }

  const content = buildRegistrationReminderEmailContent(getSiteUrl(), stage)

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
      console.warn('[registration-reminder-email] send failed', { status: res.status, message: msg, stage })
      return { ok: false, error: msg }
    }

    console.info('[registration-reminder-email] sent', { providerId: json?.id ?? 'unknown', stage })
    return { ok: true, providerId: json?.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network_error'
    console.warn('[registration-reminder-email] send error', { message: msg, stage })
    return { ok: false, error: msg }
  }
}
