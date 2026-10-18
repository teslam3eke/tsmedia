import type { RegistrationReminderStage } from './registrationReminderEligibility.js'
import type { RegistrationReminderLifecycleGender } from './registrationReminderGender.js'
import { TSSPE_DISCOUNT_NTD, TSSPE_MEMBERSHIP_DISCOUNT_CODE } from './tsspeConfig.js'

export const EMAIL_LAUNCH_FROM_PARAM = 'fromEmail'
export const EMAIL_LAUNCH_VERIFICATION_REMINDER_VALUE = 'verification_reminder'

export const REGISTRATION_REMINDER_EMAIL_SUBJECT_BY_STAGE: Record<RegistrationReminderStage, string> = {
  1: '你的 tsmedia 申請還差最後一步',
  2: '你的 tsmedia 申請還沒有完成',
  3: '還要繼續完成你的 tsmedia 申請嗎？',
}

/** @deprecated 使用 REGISTRATION_REMINDER_EMAIL_SUBJECT_BY_STAGE[1] */
export const REGISTRATION_REMINDER_EMAIL_SUBJECT = REGISTRATION_REMINDER_EMAIL_SUBJECT_BY_STAGE[1]

/** CTA：僅 fromEmail=verification_reminder，不含 PII。 */
export function buildRegistrationReminderEmailCtaUrl(siteUrl: string): string {
  const base = siteUrl.trim().replace(/\/$/, '') || 'https://tsmedia.tw'
  const u = new URL('/', `${base}/`)
  u.searchParams.set(EMAIL_LAUNCH_FROM_PARAM, EMAIL_LAUNCH_VERIFICATION_REMINDER_VALUE)
  return u.toString()
}

export type RegistrationReminderEmailContent = {
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

type StageCopy = {
  bodyHtml: string
  bodyText: string
  footerHtml: string
  footerText: string
}

function maleStage2TsspeCopy(): StageCopy {
  const code = TSSPE_MEMBERSHIP_DISCOUNT_CODE
  const discount = TSSPE_DISCOUNT_NTD
  return {
    bodyHtml: `<p style="margin:0 0 16px;">你的 tsmedia 帳號已經建立完成，<br>但目前還差審核資料沒有送出。</p>
          <p style="margin:0 0 16px;color:#475569;">如果前幾天剛好沒時間完成，<br>可以直接從上次的進度繼續。</p>
          <p style="margin:0 0 16px;color:#475569;">不用重新註冊。</p>
          <p style="margin:0 0 16px;color:#475569;">另外，我們替你保留了一組會員優惠：</p>
          <p style="margin:0 0 16px;font-weight:600;color:#0f172a;">優惠碼：<span style="letter-spacing:0.06em;">${code}</span></p>
          <p style="margin:0 0 16px;color:#475569;">完成審核並通過後，<br>購買 VIP 會員可再折 <strong style="color:#0f172a;">NT$${discount}</strong>。</p>`,
    bodyText: `你的 tsmedia 帳號已經建立完成，
但目前還差審核資料沒有送出。

如果前幾天剛好沒時間完成，
可以直接從上次的進度繼續。

不用重新註冊。

另外，我們替你保留了一組會員優惠：

優惠碼：${code}

完成審核並通過後，
購買 VIP 會員可再折 NT$${discount}。`,
    footerHtml:
      '<p style="margin:0 0 16px;font-size:14px;color:#475569;">完成資料並送出後，<br>我們就會進行人工審核。</p>',
    footerText: '完成資料並送出後，\n我們就會進行人工審核。',
  }
}

function stageCopy(
  stage: RegistrationReminderStage,
  lifecycleGender: RegistrationReminderLifecycleGender = 'unknown',
): StageCopy {
  if (stage === 1) {
    return {
      bodyHtml: `<p style="margin:0 0 16px;">你已經完成 tsmedia 的帳號註冊，<br>不過你的申請還沒有送出。</p>
          <p style="margin:0 0 16px;color:#475569;">完成審核資料後，才會正式進入 tsmedia。</p>
          <p style="margin:0 0 16px;color:#475569;">不用重新註冊，<br>回來把剩下的資料完成就可以了。</p>`,
      bodyText: `你已經完成 tsmedia 的帳號註冊，
不過你的申請還沒有送出。

完成審核資料後，才會正式進入 tsmedia。

不用重新註冊，
回來把剩下的資料完成就可以了。`,
      footerHtml:
        '<p style="margin:0 0 16px;font-size:14px;color:#475569;">我們會在收到資料後進行人工審核。</p>',
      footerText: '我們會在收到資料後進行人工審核。',
    }
  }
  if (stage === 2) {
    if (lifecycleGender === 'male') {
      return maleStage2TsspeCopy()
    }
    return {
      bodyHtml: `<p style="margin:0 0 16px;">你的 tsmedia 帳號已經建立完成，<br>但目前還差審核資料沒有送出。</p>
          <p style="margin:0 0 16px;color:#475569;">如果前幾天剛好沒時間完成，<br>可以直接從上次的進度繼續。</p>
          <p style="margin:0 0 16px;color:#475569;">不用重新註冊。</p>`,
      bodyText: `你的 tsmedia 帳號已經建立完成，
但目前還差審核資料沒有送出。

如果前幾天剛好沒時間完成，
可以直接從上次的進度繼續。

不用重新註冊。`,
      footerHtml:
        '<p style="margin:0 0 16px;font-size:14px;color:#475569;">完成資料並送出後，<br>我們就會進行人工審核。</p>',
      footerText: '完成資料並送出後，\n我們就會進行人工審核。',
    }
  }
  return {
    bodyHtml: `<p style="margin:0 0 16px;">你的 tsmedia 申請目前還沒有送出。</p>
          <p style="margin:0 0 16px;color:#475569;">如果你還想繼續，<br>回來完成剩下的資料就可以了。</p>`,
    bodyText: `你的 tsmedia 申請目前還沒有送出。

如果你還想繼續，
回來完成剩下的資料就可以了。`,
    footerHtml:
      '<p style="margin:0 0 16px;font-size:14px;color:#475569;">這是這次申請的最後一封提醒，<br>之後我們就不再打擾你了。</p>',
    footerText: '這是這次申請的最後一封提醒，\n之後我們就不再打擾你了。',
  }
}

export function buildRegistrationReminderEmailContent(
  siteUrl: string,
  stage: RegistrationReminderStage = 1,
  lifecycleGender: RegistrationReminderLifecycleGender = 'unknown',
): RegistrationReminderEmailContent {
  const ctaUrl = buildRegistrationReminderEmailCtaUrl(siteUrl)
  const ctaLabel = '繼續完成申請'
  const subject = REGISTRATION_REMINDER_EMAIL_SUBJECT_BY_STAGE[stage]
  const copy = stageCopy(stage, lifecycleGender)

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:420px;background:#ffffff;border-radius:16px;padding:28px 24px;">
        <tr><td style="font-size:16px;line-height:1.6;">
          <p style="margin:0 0 16px;">嗨，</p>
          ${copy.bodyHtml}
          <p style="margin:0 0 24px;text-align:center;">
            <a href="${escapeHtmlAttr(ctaUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:999px;">${ctaLabel}</a>
          </p>
          ${copy.footerHtml}
          <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">tsmedia<br>在這裡，讓你遇見改變世界的人</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = `嗨，

${copy.bodyText}

${ctaLabel}：${ctaUrl}

${copy.footerText}

tsmedia
在這裡，讓你遇見改變世界的人`

  return {
    subject,
    html,
    text,
    ctaUrl,
    ctaLabel,
  }
}
