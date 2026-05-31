/**
 * 藍新背景 Notify（以這裡入帳為準；須回傳純文字 SUCCESS）
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { decryptTradeInfo, verifyTradeSha } from './_utils/newebpayCrypto'
import { readNewebPayConfig } from './_utils/newebpayConfig'
import { fulfillNewebPayOrder } from './_utils/newebpayFulfill'

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
  if (req.method !== 'POST') {
    return res.status(405).send('FAIL')
  }

  const cfgRes = readNewebPayConfig(true)
  if (!cfgRes.ok) {
    console.error('[newebpay-notify] config', cfgRes.error)
    return res.status(500).send('FAIL')
  }
  const { cfg } = cfgRes

  const body = readFormBody(req)
  const status = body.Status?.trim()
  const tradeInfo = body.TradeInfo?.trim()
  const tradeSha = body.TradeSha?.trim()

  if (!tradeInfo || !tradeSha) {
    console.warn('[newebpay-notify] missing TradeInfo/TradeSha')
    return res.status(400).send('FAIL')
  }

  if (!verifyTradeSha(tradeInfo, tradeSha, cfg.hashKey, cfg.hashIV)) {
    console.warn('[newebpay-notify] TradeSha mismatch')
    return res.status(400).send('FAIL')
  }

  let decryptedPlain: string
  try {
    decryptedPlain = decryptTradeInfo(tradeInfo, cfg.hashKey, cfg.hashIV)
  } catch (e) {
    console.error('[newebpay-notify] decrypt', e)
    return res.status(400).send('FAIL')
  }

  if (status !== 'SUCCESS') {
    console.warn('[newebpay-notify] Status not SUCCESS', status)
    return res.status(200).send('SUCCESS')
  }

  const admin = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey)
  const result = await fulfillNewebPayOrder(admin, decryptedPlain)

  if (!result.ok) {
    console.error('[newebpay-notify] fulfill', result.error)
    return res.status(500).send('FAIL')
  }

  return res.status(200).send('SUCCESS')
}
