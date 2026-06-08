/**
 * 綠界 OrderResultURL：前景導回 PWA（入帳仍靠 PaymentInfoURL）
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyCheckMacValue } from './_utils/ecpayCrypto.js'
import { readEcpayConfig } from './_utils/ecpayConfig.js'

function readFormBody(req: VercelRequest): Record<string, string> {
  if (typeof req.body === 'string') {
    return Object.fromEntries(new URLSearchParams(req.body))
  }
  if (req.body && typeof req.body === 'object') {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
      if (v !== undefined && v !== null) out[k] = String(v)
    }
    return out
  }
  return {}
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cfgRes = readEcpayConfig(false)
  const siteUrl = cfgRes.ok ? cfgRes.cfg.siteUrl : 'https://www.tsmedia.tw'

  const redirect = (params: Record<string, string>) => {
    const url = new URL('/', siteUrl)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
    res.redirect(302, url.toString())
  }

  if (req.method !== 'POST') {
    return redirect({ payment: 'return', status: 'fail' })
  }

  if (!cfgRes.ok) {
    return redirect({ payment: 'return', status: 'fail' })
  }
  const { cfg } = cfgRes

  const body = readFormBody(req)

  if (!verifyCheckMacValue(body, cfg.hashKey, cfg.hashIV)) {
    return redirect({ payment: 'return', status: 'fail' })
  }

  const merchantTradeNo = body.MerchantTradeNo?.trim() ?? ''
  const ok = body.RtnCode?.trim() === '1' && Boolean(merchantTradeNo)

  return redirect({
    payment: 'return',
    status: ok ? 'ok' : 'fail',
    ...(merchantTradeNo ? { order: merchantTradeNo } : {}),
  })
}
