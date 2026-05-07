/**
 * Vercel Cron：每日 22:00 台北（14:00 UTC）對所有訂閱裝置發「探索換日」推播。
 * vercel.json 內 crons 需一併部署；專案建議設定 CRON_SECRET，與 Vercel Cron 帶入的 Bearer 一致。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { broadcastDiscoverDeckRolloverPush } from './_utils/pushSend'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).end()
    return
  }

  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret) {
    const auth = req.headers.authorization?.trim()
    if (auth !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
  }

  try {
    const result = await broadcastDiscoverDeckRolloverPush()
    res.status(200).json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron-discover-rollover-push]', e)
    res.status(500).json({ error: 'broadcast failed' })
  }
}
