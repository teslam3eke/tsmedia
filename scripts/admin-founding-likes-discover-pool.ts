/**
 * 一次性營運：讓所有創始會員對「今日曾寫入 daily_discover_deck 的對象」送 like（不扣愛心）。
 * 需已套用 migration 031；使用 service_role。
 *
 * 執行：npx tsx scripts/admin-founding-likes-discover-pool.ts
 *
 * 「探索裡的人」= 今日任一使用者的探索名單（deck）出現過的 user id 聯集。
 * 若尚無人開過探索，deck 表可能為空，結果會是 0 筆 like。
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

async function main(): Promise<void> {
  loadRepoEnvFiles()
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) {
    console.error('請設定 SUPABASE_SERVICE_ROLE_KEY（勿提交到 git）')
    process.exit(1)
  }
  if (!url) {
    console.error('請設定 SUPABASE_URL 或 VITE_SUPABASE_URL')
    process.exit(1)
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase.rpc('admin_founding_likes_to_todays_discover_targets')
  if (error) {
    console.error('RPC 失敗:', error.message)
    process.exit(1)
  }
  console.log('完成:', JSON.stringify(data, null, 2))
  const row = data as { likes_inserted?: number; pairs_skipped?: number; new_matches?: number }
  if ((row.likes_inserted ?? 0) === 0) {
    console.log(
      '提示：若 likes_inserted 為 0，可能是今日尚無 daily_discover_deck 資料；請先讓部分帳號開啟「探索」以產生名單後再執行。',
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
