/** 診斷指定暱稱／email 的皇冠顯示條件 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (process.env[k] === undefined) process.env[k] = v
    }
  }
}

const NICKNAME = process.argv[2]?.trim() || '小凱'

async function main() {
  loadEnv()
  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('missing env')

  console.log('Supabase URL:', url)
  console.log('查詢暱稱:', NICKNAME)
  console.log('---')

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select(
      'id, nickname, name, gender, verification_status, income_tier, show_income_border, crown_effect_purchased_at, photo_urls',
    )
    .or(`nickname.eq.${NICKNAME},name.eq.${NICKNAME}`)

  if (error) throw error
  if (!profiles?.length) {
    const { data: fuzzy } = await supabase
      .from('profiles')
      .select('id, nickname, name, gender, income_tier, show_income_border, crown_effect_purchased_at')
      .ilike('nickname', `%${NICKNAME}%`)
    console.log('精確暱稱無結果，模糊搜尋:')
    console.log(JSON.stringify(fuzzy, null, 2))
    return
  }

  for (const p of profiles) {
    const { data: user } = await supabase.auth.admin.getUserById(p.id)
    const email = user?.user?.email ?? '(unknown)'

    const { data: incomeDocs } = await supabase
      .from('verification_documents')
      .select('id, verification_kind, status, claimed_income_tier, created_at')
      .eq('user_id', p.id)
      .eq('verification_kind', 'income')
      .order('created_at', { ascending: false })
      .limit(3)

    const male = p.gender === 'male'
    const paid = p.crown_effect_purchased_at != null
    const tier = p.income_tier
    const show = p.show_income_border === true
    const approved = p.verification_status === 'approved'

    const uiWouldShow =
      show &&
      tier != null &&
      (male ? paid : true)

    console.log(`\n=== ${p.nickname ?? p.name} (${email}) ===`)
    console.log('id:', p.id)
    console.log('gender:', p.gender)
    console.log('verification_status:', p.verification_status)
    console.log('income_tier:', tier)
    console.log('show_income_border:', p.show_income_border)
    console.log('crown_effect_purchased_at:', p.crown_effect_purchased_at)
    console.log('photo_urls count:', (p.photo_urls ?? []).length)
    console.log('--- 收入認證文件 ---')
    console.log(JSON.stringify(incomeDocs ?? [], null, 2))
    console.log('--- 前端皇冠條件 ---')
    console.log('  verification approved:', approved ? 'OK' : 'MISSING (探索可能進不去)')
    console.log('  income_tier 有值:', tier ? `OK (${tier})` : 'MISSING')
    console.log('  show_income_border:', show ? 'OK' : 'MISSING — 須在個人檔開啟')
    if (male) {
      console.log('  男性 crown_effect 已付費:', paid ? 'OK' : 'MISSING — 須 crown_effect_purchased_at')
    }
    console.log('  => 探索卡 IncomeBorder 應顯示:', uiWouldShow ? '是' : '否')
  }
}

void main()
