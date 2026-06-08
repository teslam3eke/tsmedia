import { supabase } from '@/lib/supabase'

export type EcpayCheckoutParams = {
  productType: 'membership' | 'credit_pack'
  packKey?: string
  email?: string
}

export type EcpayOrderStatus = {
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

export function submitEcpayAioForm(fields: { gatewayUrl: string; formFields: Record<string, string> }) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = fields.gatewayUrl
  form.style.display = 'none'

  for (const [name, value] of Object.entries(fields.formFields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }

  document.body.appendChild(form)
  form.submit()
}

export async function startEcpayCheckout(params: EcpayCheckoutParams): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) {
    throw new Error('登入已過期，請重新登入。')
  }

  const res = await fetch('/api/ecpay-create-order', {
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
    formFields?: Record<string, string>
  }

  if (!res.ok || !json.ok || !json.gatewayUrl || !json.formFields) {
    throw new Error(json.error ?? `無法建立付款（${res.status}）`)
  }

  submitEcpayAioForm({
    gatewayUrl: json.gatewayUrl,
    formFields: json.formFields,
  })
}

export async function fetchEcpayOrderStatus(orderNo: string): Promise<EcpayOrderStatus> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) {
    return { ok: false, error: '登入已過期' }
  }

  const res = await fetch(`/api/ecpay-order-status?order=${encodeURIComponent(orderNo)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  const json = (await res.json()) as EcpayOrderStatus
  if (!res.ok) {
    return { ok: false, error: json.error ?? `查詢失敗（${res.status}）` }
  }
  return json
}

/** 付款返回後輪詢 PaymentInfoURL 入帳（最多約 30 秒） */
export async function pollEcpayOrderPaid(
  orderNo: string,
  opts?: { attempts?: number; intervalMs?: number },
): Promise<EcpayOrderStatus | null> {
  const attempts = opts?.attempts ?? 15
  const intervalMs = opts?.intervalMs ?? 2000

  for (let i = 0; i < attempts; i++) {
    const status = await fetchEcpayOrderStatus(orderNo)
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
