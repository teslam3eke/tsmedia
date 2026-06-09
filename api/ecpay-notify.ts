/**
 * 綠界 PaymentInfoURL（ReturnURL）：背景通知入帳；須回傳純文字 1|OK
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('0|Method not allowed')
  }

  const cfgRes = readEcpayConfig(true)
  if (!cfgRes.ok) {
    console.error('[ecpay-notify] config', cfgRes.error)
    return res.status(500).send('0|Config error')
  }
  const { cfg } = cfgRes

  const body = await readEcpayFormBody(req)

  if (!body.MerchantTradeNo?.trim()) {
    console.warn('[ecpay-notify] missing MerchantTradeNo')
    return res.status(400).send('0|Missing MerchantTradeNo')
  }

  if (!verifyCheckMacValue(body, cfg.hashKey, cfg.hashIV)) {
    console.warn('[ecpay-notify] CheckMacValue mismatch', body.MerchantTradeNo)
    return res.status(400).send('0|CheckMacValue fail')
  }

  const admin = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey)
  const result = await fulfillEcpayOrder(admin, body)

  if (!result.ok) {
    console.error('[ecpay-notify] fulfill', result.error, body.MerchantTradeNo)
    return res.status(500).send(`0|${result.error}`)
  }

  return res.status(200).send('1|OK')
}
