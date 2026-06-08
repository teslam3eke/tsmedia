/**
 * GET：前端查詢綠界是否已設定（不含金鑰）
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readEcpayConfig } from './_utils/ecpayConfig'

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const cfg = readEcpayConfig(false)
  return res.status(200).json({
    ok: true,
    configured: cfg.ok,
    sandbox: cfg.ok ? cfg.cfg.sandbox : null,
    provider: 'ecpay',
  })
}
