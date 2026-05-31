/**
 * 藍新前景 Return：驗簽後導回 PWA（入帳仍靠 Notify）
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { decryptTradeInfo, parseTradeInfoPlain, verifyTradeSha } from './_utils/newebpayCrypto'
import { readNewebPayConfig } from './_utils/newebpayConfig'
import { parseResultJson } from './_utils/newebpayFulfill'

function readFormBody(req: VercelRequest): Record<string, string> {
  if (typeof req.body === 'string') {
    return Object.fromEntries(new URLSearchParams(req.body))
  }
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, string>
  }
  return {}
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cfgRes = readNewebPayConfig(false)
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
  const status = body.Status?.trim()
  const tradeInfo = body.TradeInfo?.trim()
  const tradeSha = body.TradeSha?.trim()

  if (!tradeInfo || !tradeSha || !verifyTradeSha(tradeInfo, tradeSha, cfg.hashKey, cfg.hashIV)) {
    return redirect({ payment: 'return', status: 'fail' })
  }

  let merchantOrderNo = ''
  try {
    const plain = decryptTradeInfo(tradeInfo, cfg.hashKey, cfg.hashIV)
    const outer = parseTradeInfoPlain(plain)
    const result = parseResultJson(outer.Result)
    merchantOrderNo = result?.MerchantOrderNo ?? outer.MerchantOrderNo ?? ''
  } catch {
    return redirect({ payment: 'return', status: 'fail' })
  }

  const ok = status === 'SUCCESS' && Boolean(merchantOrderNo)
  return redirect({
    payment: 'return',
    status: ok ? 'ok' : 'fail',
    ...(merchantOrderNo ? { order: merchantOrderNo } : {}),
  })
}
