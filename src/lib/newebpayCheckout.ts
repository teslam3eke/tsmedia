import { supabase } from '@/lib/supabase'

export type NewebPayCheckoutParams = {
  productType: 'membership' | 'credit_pack'
  packKey?: string
  email?: string
}

export type NewebPayOrderStatus = {
  ok: boolean
  paid?: boolean
  status?: string
  productType?: string
  packKey?: string | null
  amountNtd?: number
  error?: string
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export function submitNewebPayMpgForm(fields: {
  gatewayUrl: string
  merchantId: string
  tradeInfo: string
  tradeSha: string
  version: string
}) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = fields.gatewayUrl
  form.style.display = 'none'

  const entries: Record<string, string> = {
    MerchantID: fields.merchantId,
    TradeInfo: fields.tradeInfo,
    TradeSha: fields.tradeSha,
    Version: fields.version,
  }

  for (const [name, value] of Object.entries(entries)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }

  document.body.appendChild(form)
  form.submit()
}

export async function startNewebPayCheckout(params: NewebPayCheckoutParams): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) {
    throw new Error('登入已過期，請重新登入。')
  }

  const res = await fetch('/api/newebpay-create-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })

  const json = (await res.json()) as {
    ok?: boolean
    error?: string
    gatewayUrl?: string
    merchantId?: string
    tradeInfo?: string
    tradeSha?: string
    version?: string
  }

  if (!res.ok || !json.ok || !json.gatewayUrl || !json.merchantId || !json.tradeInfo || !json.tradeSha) {
    throw new Error(json.error ?? `無法建立付款（${res.status}）`)
  }

  submitNewebPayMpgForm({
    gatewayUrl: json.gatewayUrl,
    merchantId: json.merchantId,
    tradeInfo: json.tradeInfo,
    tradeSha: json.tradeSha,
    version: json.version ?? '2.0',
  })
}

export async function fetchNewebPayOrderStatus(orderNo: string): Promise<NewebPayOrderStatus> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) {
    return { ok: false, error: '登入已過期' }
  }

  const res = await fetch(`/api/newebpay-order-status?order=${encodeURIComponent(orderNo)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  const json = (await res.json()) as NewebPayOrderStatus
  if (!res.ok) {
    return { ok: false, error: json.error ?? `查詢失敗（${res.status}）` }
  }
  return json
}

/** 付款返回後輪詢 Notify 入帳（最多約 30 秒） */
export async function pollNewebPayOrderPaid(
  orderNo: string,
  opts?: { attempts?: number; intervalMs?: number },
): Promise<NewebPayOrderStatus | null> {
  const attempts = opts?.attempts ?? 15
  const intervalMs = opts?.intervalMs ?? 2000

  for (let i = 0; i < attempts; i++) {
    const status = await fetchNewebPayOrderStatus(orderNo)
    if (status.ok && status.paid) return status
    if (!status.ok && status.error !== '找不到訂單') {
      return status
    }
    await sleep(intervalMs)
  }
  return null
}

export type PaymentReturnQuery = {
  kind: 'return' | 'cancel' | null
  orderNo: string | null
  status: 'ok' | 'fail' | null
}

export function readPaymentReturnQuery(): PaymentReturnQuery {
  if (typeof window === 'undefined') {
    return { kind: null, orderNo: null, status: null }
  }
  const params = new URLSearchParams(window.location.search)
  const payment = params.get('payment')
  if (payment !== 'return' && payment !== 'cancel') {
    return { kind: null, orderNo: null, status: null }
  }
  return {
    kind: payment,
    orderNo: params.get('order'),
    status: params.get('status') === 'ok' ? 'ok' : params.get('status') === 'fail' ? 'fail' : null,
  }
}

export function clearPaymentReturnQuery() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('payment')
  url.searchParams.delete('order')
  url.searchParams.delete('status')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState({}, '', next)
}
