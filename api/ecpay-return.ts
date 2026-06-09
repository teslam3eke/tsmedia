/**
 * 綠界 OrderResultURL：前景導回 PWA；notify 失敗時在此備援入帳
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyCheckMacValue } from './_utils/ecpayCrypto.js'
import { readEcpayConfig } from './_utils/ecpayConfig.js'
import { readEcpayFormBody } from './_utils/ecpayFormBody.js'
import { fulfillEcpayOrder } from './_utils/ecpayFulfill.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

function appBaseFromConfig(cfg: { clientBackUrl: string; returnUrl: string }): string {
  const fromCancel = cfg.clientBackUrl.replace(/\/?\?payment=cancel$/, '')
  if (fromCancel) return fromCancel
  return cfg.returnUrl.replace(/\/api\/ecpay-return$/, '')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cfgRes = readEcpayConfig(true)
  const appBase = cfgRes.ok ? appBaseFromConfig(cfgRes.cfg) : 'https://www.tsmedia.tw'

  const redirect = (params: Record<string, string>) => {
    const url = new URL('/', appBase)
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

  const body = await readEcpayFormBody(req)

  if (!verifyCheckMacValue(body, cfg.hashKey, cfg.hashIV)) {
    console.warn('[ecpay-return] CheckMacValue mismatch', body.MerchantTradeNo)
    return redirect({ payment: 'return', status: 'fail' })
  }

  const merchantTradeNo = body.MerchantTradeNo?.trim() ?? ''
  const paidAtGateway = body.RtnCode?.trim() === '1' && Boolean(merchantTradeNo)
  let fulfilled = false

  if (paidAtGateway) {
    const admin = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey)
    const result = await fulfillEcpayOrder(admin, body)
    if (!result.ok) {
      console.error('[ecpay-return] fulfill', result.error, merchantTradeNo)
    } else {
      fulfilled = true
    }
  }

  return redirect({
    payment: 'return',
    status: paidAtGateway && fulfilled ? 'ok' : 'fail',
    ...(merchantTradeNo ? { order: merchantTradeNo } : {}),
  })
}
