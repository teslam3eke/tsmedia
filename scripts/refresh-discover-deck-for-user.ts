/**
 * 清除指定帳號當 app 日的探索 deck，下次進探索會重新組 6 人。
 * npx tsx scripts/refresh-discover-deck-for-user.ts user@example.com
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

function loadEnv(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  for (const name of ['.env.local', '.env'] as const) {
    const filePath = path.join(root, name)
    if (!fs.existsSync(filePath)) continue
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const equalsAt = trimmed.indexOf('=')
      if (equalsAt <= 0) continue
      const key = trimmed.slice(0, equalsAt).trim()
      let value = trimmed.slice(equalsAt + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

async function findUserId(
  admin: ReturnType<typeof createClient>['auth']['admin'],
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === target)
    if (user) return user.id
    if (data.users.length < 200) break
  }
  return null
}

async function main() {
  loadEnv()
  const email = process.argv[2]?.trim()
  if (!email) throw new Error('請提供 Email。')

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('缺少 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY。')

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const userId = await findUserId(admin.auth.admin, email)
  if (!userId) throw new Error(`找不到帳號：${email}`)

  const { data: appDay, error: dayErr } = await admin.rpc('app_day_key_now')
  if (dayErr) throw dayErr
  const appDayKey = String(appDay)

  const { data: before, error: beforeErr } = await admin
    .from('daily_discover_deck')
    .select('target_user_ids')
    .eq('viewer_user_id', userId)
    .eq('app_day_key', appDayKey)
    .maybeSingle()
  if (beforeErr) throw beforeErr

  const { error: deleteErr } = await admin
    .from('daily_discover_deck')
    .delete()
    .eq('viewer_user_id', userId)
    .eq('app_day_key', appDayKey)
  if (deleteErr) throw deleteErr

  console.log(`已清除探索 deck`)
  console.log(`收件者：${email}`)
  console.log(`user_id：${userId}`)
  console.log(`app_day_key：${appDayKey}`)
  console.log(`原 deck 人數：${before?.target_user_ids?.length ?? 0}`)
  console.log('請在 App 硬重整後重新進入探索分頁，系統會依最新偏好重新組牌。')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
