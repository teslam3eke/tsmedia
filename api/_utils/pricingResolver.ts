import type { SupabaseClient } from '@supabase/supabase-js'

export type PricingLine = {
  list_price_ntd: number
  price_ntd: number
}

export type PublicPaymentPricing = {
  promo: {
    id: string
    label: string
    discount_tenths: number
    ends_at: string
    product_keys: string[]
  } | null
  membership: {
    male: PricingLine
    female: PricingLine
  }
  packs: Record<string, PricingLine>
}

export async function fetchPublicPaymentPricing(
  supabase: SupabaseClient,
): Promise<PublicPaymentPricing> {
  const { data, error } = await supabase.rpc('get_public_payment_pricing')
  if (error) {
    throw new Error(error.message)
  }
  return data as PublicPaymentPricing
}

export function membershipAmountFromPricing(
  pricing: PublicPaymentPricing,
  gender: 'male' | 'female',
): number {
  return pricing.membership[gender].price_ntd
}

export function packAmountFromPricing(
  pricing: PublicPaymentPricing,
  packKey: string,
): number | null {
  const pack = pricing.packs[packKey]
  return pack?.price_ntd ?? null
}
