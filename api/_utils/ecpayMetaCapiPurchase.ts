import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMetaCapiPurchase } from './metaCapi.js'

type ClaimRow = {
  merchant_trade_no: string
  user_id: string
  amount_ntd: number
  paid_at: string | null
  meta_fbp: string | null
  meta_fbc: string | null
  client_user_agent: string | null
  client_ip: string | null
  meta_event_source_url: string | null
}

function parseClaim(data: unknown): ClaimRow | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.ok !== true) return null
  const orderNo = typeof o.merchant_trade_no === 'string' ? o.merchant_trade_no : ''
  const userId = typeof o.user_id === 'string' ? o.user_id : ''
  const amount = typeof o.amount_ntd === 'number' ? o.amount_ntd : 0
  if (!orderNo || !userId || amount <= 0) return null
  return {
    merchant_trade_no: orderNo,
    user_id: userId,
    amount_ntd: amount,
    paid_at: typeof o.paid_at === 'string' ? o.paid_at : null,
    meta_fbp: typeof o.meta_fbp === 'string' ? o.meta_fbp : null,
    meta_fbc: typeof o.meta_fbc === 'string' ? o.meta_fbc : null,
    client_user_agent: typeof o.client_user_agent === 'string' ? o.client_user_agent : null,
    client_ip: typeof o.client_ip === 'string' ? o.client_ip : null,
    meta_event_source_url:
      typeof o.meta_event_source_url === 'string' ? o.meta_event_source_url : null,
  }
}

/**
 * 已 fulfill 且尚未標記 CAPI 送達時，嘗試送 Purchase（可 retry）。
 * 永不 throw；不影響付款／入帳。
 */
export async function deliverMetaPurchaseCapiIfNeeded(
  admin: SupabaseClient,
  merchantTradeNo: string,
): Promise<void> {
  const orderNo = merchantTradeNo.trim()
  if (!orderNo) return

  try {
    const { data: claimRaw, error: claimErr } = await admin.rpc(
      'claim_ecpay_meta_capi_purchase_delivery',
      { p_merchant_trade_no: orderNo },
    )
    if (claimErr) {
      console.warn('[meta-capi] claim failed', { orderNo, message: claimErr.message })
      return
    }

    const row = parseClaim(claimRaw)
    if (!row) return

    let fbp = row.meta_fbp
    let fbc = row.meta_fbc
    if (!fbp || !fbc) {
      const { data: profile } = await admin
        .from('profiles')
        .select('meta_fbp, meta_fbc')
        .eq('id', row.user_id)
        .maybeSingle()
      if (!fbp && profile?.meta_fbp) fbp = profile.meta_fbp as string
      if (!fbc && profile?.meta_fbc) fbc = profile.meta_fbc as string
    }

    let email: string | null = null
    try {
      const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(row.user_id)
      if (!authErr && authUser?.user?.email) email = authUser.user.email
    } catch {
      /* ignore */
    }

    let eventTimeSec = row.paid_at
      ? Math.floor(new Date(row.paid_at).getTime() / 1000)
      : Math.floor(Date.now() / 1000)

    const result = await sendMetaCapiPurchase({
      eventId: row.merchant_trade_no,
      eventTimeSec,
      eventSourceUrl: row.meta_event_source_url,
      valueNtd: row.amount_ntd,
      currency: 'TWD',
      orderId: row.merchant_trade_no,
      externalId: row.user_id,
      email,
      fbp,
      fbc,
      clientIpAddress: row.client_ip,
      clientUserAgent: row.client_user_agent,
    })

    if (result.ok) {
      const { error: markErr } = await admin.rpc('mark_ecpay_meta_capi_purchase_sent', {
        p_merchant_trade_no: orderNo,
      })
      if (markErr) {
        console.warn('[meta-capi] mark sent failed', { orderNo, message: markErr.message })
      }
      return
    }

    const errMsg = result.skipped ? 'meta_capi_not_configured' : result.error
    await admin.rpc('release_ecpay_meta_capi_purchase_in_flight', {
      p_merchant_trade_no: orderNo,
      p_error: errMsg,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.warn('[meta-capi] deliver unexpected', { orderNo, message: msg })
    try {
      await admin.rpc('release_ecpay_meta_capi_purchase_in_flight', {
        p_merchant_trade_no: orderNo,
        p_error: msg,
      })
    } catch {
      /* ignore */
    }
  }
}

/** @deprecated 使用 deliverMetaPurchaseCapiIfNeeded */
export const sendMetaPurchaseCapiAfterEcpayFulfill = deliverMetaPurchaseCapiIfNeeded
