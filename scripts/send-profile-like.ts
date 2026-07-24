/**
 * 營運一次性：指定 email 對另一 email 送探索 like（不扣愛心）。
 * npx tsx scripts/send-profile-like.ts <actorEmail> <targetEmail>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

function loadEnv(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  for (const name of ['.env.local', '.env'] as const) {
    const fp = path.join(root, name)
    if (!fs.existsSync(fp)) continue
    for (const line of fs.readFileSync(fp, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      const k = t.slice(0, eq).trim()
      let v = t.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (process.env[k] === undefined) process.env[k] = v
    }
  }
}

async function findUserId(
  supabase: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  let page = 1
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase())
    if (hit) return hit.id
    if (data.users.length < 200) break
    page++
  }
  return null
}

async function main(): Promise<void> {
  loadEnv()
  const actorEmail = process.argv[2]?.trim()
  const targetEmail = process.argv[3]?.trim()
  if (!actorEmail || !targetEmail) {
    console.error('用法: npx tsx scripts/send-profile-like.ts <actorEmail> <targetEmail>')
    process.exit(1)
  }

  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    console.error('請設定 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const actorId = await findUserId(supabase, actorEmail)
  const targetId = await findUserId(supabase, targetEmail)
  if (!actorId) throw new Error(`找不到 actor: ${actorEmail}`)
  if (!targetId) throw new Error(`找不到 target: ${targetEmail}`)
  if (actorId === targetId) throw new Error('actor 與 target 不可相同')

  const { data: day, error: dayErr } = await supabase.rpc('app_day_key_now')
  if (dayErr) throw dayErr

  const targetFilter = `target_user_id.eq.${targetId},target_profile_key.eq.${targetId},target_profile_key.eq.user:${targetId}`
  const { data: existing } = await supabase
    .from('profile_interactions')
    .select('id, action, created_at')
    .eq('actor_user_id', actorId)
    .in('action', ['like', 'super_like'])
    .or(targetFilter)
    .limit(1)

  let inserted = false
  if (existing?.length) {
    console.log('已存在 like，略過寫入:', existing[0])
  } else {
    const { error: insErr } = await supabase.from('profile_interactions').insert({
      actor_user_id: actorId,
      target_user_id: targetId,
      target_profile_key: targetId,
      action: 'like',
      interaction_app_day_key: day,
    })
    if (insErr) throw insErr
    inserted = true
    console.log(`已寫入 like：${actorEmail} → ${targetEmail}`)
  }

  const actorFilter = `target_user_id.eq.${actorId},target_profile_key.eq.${actorId},target_profile_key.eq.user:${actorId}`
  const { data: reciprocal } = await supabase
    .from('profile_interactions')
    .select('id')
    .eq('actor_user_id', targetId)
    .in('action', ['like', 'super_like'])
    .or(actorFilter)
    .limit(1)

  let matchId: string | null = null
  let matched = false
  if (reciprocal?.length) {
    const userA = actorId < targetId ? actorId : targetId
    const userB = actorId < targetId ? targetId : actorId
    const { data: matchRows, error: matchErr } = await supabase
      .from('matches')
      .upsert({ user_a: userA, user_b: userB }, { onConflict: 'user_a,user_b', ignoreDuplicates: true })
      .select('id')
    if (matchErr) throw matchErr

    if (matchRows?.[0]?.id) {
      matchId = matchRows[0].id
      matched = true
      for (const uid of [actorId, targetId]) {
        await supabase.from('app_notifications').insert({
          user_id: uid,
          kind: 'match_created',
          title: '你們配對成功了',
          body: '你們互相喜歡，可以開始聊天了。',
        })
      }
      console.log('雙向喜歡，已建立新配對:', matchId)
    } else {
      const { data: existingMatch } = await supabase
        .from('matches')
        .select('id')
        .eq('user_a', userA)
        .eq('user_b', userB)
        .maybeSingle()
      matchId = existingMatch?.id ?? null
      matched = Boolean(matchId)
      console.log('雙向喜歡，配對已存在:', matchId)
    }
  } else {
    console.log('目前僅單向 like；對方回按愛心後才會配對成功。')
  }

  console.log(
    JSON.stringify(
      { actorEmail, targetEmail, actorId, targetId, appDay: day, inserted, matched, matchId },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
