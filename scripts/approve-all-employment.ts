/**
 * 批量核准所有使用者職業認證（profiles + employment verification_docs）。
 * 等同 supabase/migrations/075_approve_all_employment.sql。
 *
 * 環境變數：SUPABASE_SERVICE_ROLE_KEY；SUPABASE_URL 或 VITE_SUPABASE_URL（可寫入 .env.local）
 * 執行：npx tsx scripts/approve-all-employment.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

function repoRootDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function loadRepoEnvFiles(): void {
  const root = repoRootDir()
  for (const name of ['.env.local', '.env'] as const) {
    const filePath = path.join(root, name)
    if (!fs.existsSync(filePath)) continue
    const text = fs.readFileSync(filePath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      const key = t.slice(0, eq).trim()
      let val = t.slice(eq + 1).trim()
      if (!key) continue
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
}

async function main() {
  loadRepoEnvFiles()
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) {
    console.error('請設定 SUPABASE_SERVICE_ROLE_KEY（可寫入 .env.local）')
    process.exit(1)
  }
  if (!url) {
    console.error('請設定 SUPABASE_URL 或 VITE_SUPABASE_URL')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const now = new Date().toISOString()

  const { data: docs, error: docErr } = await supabase
    .from('verification_docs')
    .update({
      status: 'approved',
      reviewed_at: now,
      reviewer_note: '測試環境批量核准（075 script）',
    })
    .eq('verification_kind', 'employment')
    .in('status', ['pending', 'rejected'])
    .select('id')

  if (docErr) {
    console.error('verification_docs 更新失敗:', docErr.message)
    process.exit(1)
  }

  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .update({ is_verified: true, verification_status: 'approved' })
    .or('verification_status.neq.approved,is_verified.eq.false')
    .select('id')

  if (profErr) {
    console.error('profiles 更新失敗:', profErr.message)
    process.exit(1)
  }

  console.log('employment 文件核准:', docs?.length ?? 0, '筆')
  console.log('profiles 設為 approved:', profiles?.length ?? 0, '筆')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
