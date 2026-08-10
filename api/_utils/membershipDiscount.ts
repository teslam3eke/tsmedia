import type { SupabaseClient } from '@supabase/supabase-js'

export type ResolvedMaleMembershipDiscount = {
  code: string
  discountNtd: number
  finalPriceNtd: number
}

export function normalizeMembershipDiscountCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : ''
}

export function applyFixedMembershipDiscount(basePriceNtd: number, discountNtd: number): number {
  return Math.max(1, basePriceNtd - discountNtd)
}

export async function resolveMaleMembershipDiscount(
  admin: SupabaseClient,
  rawCode: unknown,
  basePriceNtd: number,
): Promise<ResolvedMaleMembershipDiscount | null> {
  const code = normalizeMembershipDiscountCode(rawCode)
  if (!code) return null

  const nowIso = new Date().toISOString()
  const { data, error } = await admin
    .from('membership_discount_codes')
    .select('code, male_discount_ntd, enabled, starts_at, ends_at')
    .eq('code', code)
    .eq('enabled', true)
    .lte('starts_at', nowIso)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (
    !data
    || (data.ends_at != null && new Date(data.ends_at).getTime() <= Date.now())
    || typeof data.male_discount_ntd !== 'number'
    || data.male_discount_ntd <= 0
  ) {
    throw new Error('INVALID_MEMBERSHIP_DISCOUNT_CODE')
  }

  return {
    code: data.code,
    discountNtd: data.male_discount_ntd,
    finalPriceNtd: applyFixedMembershipDiscount(basePriceNtd, data.male_discount_ntd),
  }
}
