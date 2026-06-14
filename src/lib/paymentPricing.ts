import { supabase } from '@/lib/supabase'

export type PaymentPricingLine = {
  listPriceNtd: number
  priceNtd: number
}

export type PaymentPromoInfo = {
  id: string
  label: string
  discountTenths: number
  endsAt: string
  productKeys: string[]
}

export type PublicPaymentPricing = {
  promo: PaymentPromoInfo | null
  membership: {
    male: PaymentPricingLine
    female: PaymentPricingLine
  }
  packs: Record<string, PaymentPricingLine>
}

type RpcPricing = {
  promo?: {
    id?: string
    label?: string
    discount_tenths?: number
    ends_at?: string
    product_keys?: string[]
  } | null
  membership?: {
    male?: { list_price_ntd?: number; price_ntd?: number }
    female?: { list_price_ntd?: number; price_ntd?: number }
  }
  packs?: Record<string, { list_price_ntd?: number; price_ntd?: number }>
}

function mapLine(row?: { list_price_ntd?: number; price_ntd?: number }): PaymentPricingLine {
  return {
    listPriceNtd: row?.list_price_ntd ?? 0,
    priceNtd: row?.price_ntd ?? 0,
  }
}

export function mapPublicPaymentPricing(raw: RpcPricing): PublicPaymentPricing {
  const promoRaw = raw.promo
  return {
    promo: promoRaw?.id
      ? {
          id: promoRaw.id,
          label: promoRaw.label ?? '',
          discountTenths: promoRaw.discount_tenths ?? 10,
          endsAt: promoRaw.ends_at ?? '',
          productKeys: promoRaw.product_keys ?? ['all'],
        }
      : null,
    membership: {
      male: mapLine(raw.membership?.male),
      female: mapLine(raw.membership?.female),
    },
    packs: Object.fromEntries(
      Object.entries(raw.packs ?? {}).map(([key, line]) => [key, mapLine(line)]),
    ),
  }
}

export async function fetchPublicPaymentPricing(): Promise<PublicPaymentPricing | null> {
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
  const rpc = async () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('get_public_payment_pricing')

  let { data, error } = await rpc()
  if (error && visible) {
    ;({ data, error } = await rpc())
  }
  if (error) {
    console.error('[paymentPricing] get_public_payment_pricing:', error.message)
    return null
  }
  return mapPublicPaymentPricing((data ?? {}) as RpcPricing)
}

/** 台灣慣例：2 → 「2 折」 */
export function formatDiscountTenthsZh(discountTenths: number): string {
  return `${discountTenths} 折`
}

export function isPromoPriceActive(listPriceNtd: number, priceNtd: number): boolean {
  return listPriceNtd > 0 && priceNtd < listPriceNtd
}

export function formatPromoEndsAtZhTw(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Taipei',
  })
}
