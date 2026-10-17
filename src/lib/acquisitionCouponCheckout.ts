import { supabase } from '@/lib/supabase'

export type AcquisitionCouponAutoApply = {
  entitlementId: string
  campaignKey: string
  finalAmountNtd: number
  listPriceNtd: number
  promoPriceNtd: number
  displayLabel: string
  expiresAt: string
}

export async function fetchAcquisitionCouponAutoApply(): Promise<AcquisitionCouponAutoApply | null> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return null

  const res = await fetch('/api/my-acquisition-coupon-checkout', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  if (!res.ok) return null

  const json = (await res.json()) as {
    ok?: boolean
    autoApply?: AcquisitionCouponAutoApply | null
  }
  if (!json.ok || !json.autoApply?.entitlementId) return null
  return json.autoApply
}
