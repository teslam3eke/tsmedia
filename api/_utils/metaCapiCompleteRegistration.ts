import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMetaCapiStandardEvent } from './metaCapi.js'
import type { MetaAttributionInput } from './clientRequestMeta.js'

export type CompleteRegistrationCapiContext = {
  clientIpAddress: string | null
  clientUserAgent: string | null
  eventSourceUrl: string
  /** 本次請求帶入的 attribution（註冊／待送快照）；勿 fallback 至 profiles.meta_fbp/fbc。 */
  attribution?: MetaAttributionInput
}

type ClaimRow = {
  userId: string
  metaRegFbp: string | null
  metaRegFbc: string | null
  registeredAt: string | null
}

function parseClaim(data: unknown): ClaimRow | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.ok !== true) return null
  const userId = typeof o.user_id === 'string' ? o.user_id : ''
  if (!userId) return null
  return {
    userId,
    metaRegFbp: typeof o.meta_reg_fbp === 'string' ? o.meta_reg_fbp : null,
    metaRegFbc: typeof o.meta_reg_fbc === 'string' ? o.meta_reg_fbc : null,
    registeredAt: typeof o.registered_at === 'string' ? o.registered_at : null,
  }
}

/** event_id = user.id；永不 throw。 */
export async function deliverMetaCompleteRegistrationCapiIfNeeded(
  admin: SupabaseClient,
  userId: string,
  ctx: CompleteRegistrationCapiContext,
): Promise<void> {
  const id = userId.trim()
  if (!id) return

  try {
    const { data: claimRaw, error: claimErr } = await admin.rpc('claim_meta_capi_complete_registration', {
      p_user_id: id,
    })
    if (claimErr) {
      console.warn('[meta-capi] complete_registration claim failed', { userId: id, message: claimErr.message })
      return
    }

    const row = parseClaim(claimRaw)
    if (!row) return

    let email: string | null = null
    try {
      const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(id)
      if (!authErr && authUser?.user?.email) email = authUser.user.email
    } catch {
      /* ignore */
    }

    const fromRequest = ctx.attribution
    let fbp = fromRequest?.metaFbp ?? row.metaRegFbp
    let fbc = fromRequest?.metaFbc ?? row.metaRegFbc

    const eventTimeSec = row.registeredAt
      ? Math.floor(new Date(row.registeredAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000)

    const result = await sendMetaCapiStandardEvent({
      eventName: 'CompleteRegistration',
      eventId: id,
      eventTimeSec,
      eventSourceUrl: ctx.eventSourceUrl,
      externalId: id,
      email,
      fbp,
      fbc,
      clientIpAddress: ctx.clientIpAddress,
      clientUserAgent: ctx.clientUserAgent,
    })

    if (result.ok) {
      const { error: markErr } = await admin.rpc('mark_meta_capi_complete_registration_sent', {
        p_user_id: id,
      })
      if (markErr) {
        console.warn('[meta-capi] complete_registration mark failed', { userId: id, message: markErr.message })
      }
      return
    }

    const errMsg = result.skipped ? 'meta_capi_not_configured' : result.error
    await admin.rpc('release_meta_capi_complete_registration_in_flight', {
      p_user_id: id,
      p_error: errMsg,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.warn('[meta-capi] complete_registration unexpected', { userId: id, message: msg })
    try {
      await admin.rpc('release_meta_capi_complete_registration_in_flight', {
        p_user_id: id,
        p_error: msg,
      })
    } catch {
      /* ignore */
    }
  }
}
