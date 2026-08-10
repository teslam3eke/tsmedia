/**
 * 對單一已審核、尚未付費的男性會員發送意見回饋折扣通知。
 * npx tsx scripts/send-feedback-coupon-notification.ts user@example.com
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
  admin: ReturnType<typeof createClient>,
  targetEmail: string,
): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === targetEmail.toLowerCase(),
    )
    if (user) return user.id
    if (data.users.length < 200) break
  }
  return null
}

async function main() {
  loadEnv()
  const targetEmail = process.argv[2]?.trim()
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY

  if (!targetEmail) throw new Error('請提供收件者 Email。')
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('缺少 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY。')
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const userId = await findUserId(admin, targetEmail)
  if (!userId) throw new Error(`找不到帳號：${targetEmail}`)

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('gender, verification_status, account_status, subscription_expires_at')
    .eq('id', userId)
    .maybeSingle()
  if (profileError) throw profileError
  if (
    profile?.gender !== 'male'
    || profile.verification_status !== 'approved'
    || profile.account_status !== 'active'
  ) {
    throw new Error('目標帳號不是已審核通過的有效男性會員。')
  }
  if (
    profile.subscription_expires_at
    && new Date(profile.subscription_expires_at).getTime() > Date.now()
  ) {
    throw new Error('目標帳號目前已有有效會員，已停止發送。')
  }

  const { data: notification, error: notificationError } = await admin
    .from('app_notifications')
    .insert({
      user_id: userId,
      kind: 'feedback_coupon_offer',
      title: '補償您 NT$300 會員折扣碼',
      body: '很遺憾您最終沒有成為正式會員。前往 IG 留下真實意見，即可獲得會員折扣碼。',
    })
    .select('id')
    .single()
  if (notificationError) throw notificationError

  console.log(`已建立測試通知：${notification.id}`)
  console.log(`收件者：${targetEmail}`)
  console.log('系統推播將由 app_notifications Database Webhook 發送。')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
