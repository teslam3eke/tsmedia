import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMetaCapiStandardEvent } from './metaCapi.js'
import { loadProfileMetaAttribution } from './metaCapiAttributionPatch.js'
import type { CompleteRegistrationCapiContext } from './metaCapiCompleteRegistration.js'

type ClaimRow = {
  applicationId: string
  userId: string
  submittedAt: string | null
}

function parseClaim(data: unknown): ClaimRow | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.ok !== true) return null
  const applicationId = typeof o.application_id === 'string' ? o.application_id : ''
  const userId = typeof o.user_id === 'string' ? o.user_id : ''
  if (!applicationId || !userId) return null
  return {
    applicationId,
    userId,
    submittedAt: typeof o.submitted_at === 'string' ? o.submitted_at : null,
  }
}

/** event_id = applicationId；永不 throw。 */
export async function deliverMetaSubmitApplicationCapiIfNeeded(
  admin: SupabaseClient,
  applicationId: string,
  ctx: CompleteRegistrationCapiContext,
): Promise<void> {
  const appId = applicationId.trim()
  if (!appId) return

  try {
    const { data: claimRaw, error: claimErr } = await admin.rpc('claim_meta_capi_submit_application', {
      p_application_id: appId,
    })
    if (claimErr) {
      console.warn('[meta-capi] submit_application claim failed', {
        applicationId: appId,
        message: claimErr.message,
      })
      return
    }

    const row = parseClaim(claimRaw)
    if (!row) return

    let email: string | null = null
    try {
      const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(row.userId)
      if (!authErr && authUser?.user?.email) email = authUser.user.email
    } catch {
      /* ignore */
    }

    const profile = await loadProfileMetaAttribution(admin, row.userId)

    const eventTimeSec = row.submittedAt
      ? Math.floor(new Date(row.submittedAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000)

    const result = await sendMetaCapiStandardEvent({
      eventName: 'SubmitApplication',
      eventId: appId,
      eventTimeSec,
      externalId: row.userId,
      email,
      fbp: profile.metaFbp,
      fbc: profile.metaFbc,
      clientIpAddress: ctx.clientIpAddress,
      clientUserAgent: ctx.clientUserAgent,
      customData: {
        content_name: '會員審核',
        content_category: 'verification',
      },
    })

    if (result.ok) {
      const { error: markErr } = await admin.rpc('mark_meta_capi_submit_application_sent', {
        p_application_id: appId,
      })
      if (markErr) {
        console.warn('[meta-capi] submit_application mark failed', {
          applicationId: appId,
          message: markErr.message,
        })
      }
      return
    }

    const errMsg = result.skipped ? 'meta_capi_not_configured' : result.error
    await admin.rpc('release_meta_capi_submit_application_in_flight', {
      p_application_id: appId,
      p_error: errMsg,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.warn('[meta-capi] submit_application unexpected', { applicationId: appId, message: msg })
    try {
      await admin.rpc('release_meta_capi_submit_application_in_flight', {
        p_application_id: appId,
        p_error: msg,
      })
    } catch {
      /* ignore */
    }
  }
}
