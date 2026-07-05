/**
 * 清空所有配對聊天小助手場次（sessions → answers／claims 連帶刪除）。
 * 不動拼圖解鎖紀錄（match_puzzle_manual_unlocks）。
 *
 * 環境變數：SUPABASE_SERVICE_ROLE_KEY；SUPABASE_URL 或 VITE_SUPABASE_URL（可寫入 .env.local）
 * 執行：npx tsx scripts/reset-chat-assist-sessions.ts
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

  const { count: before, error: countErr } = await supabase
    .from('match_chat_assist_sessions')
    .select('*', { count: 'exact', head: true })

  if (countErr) {
    console.error('讀取場次數失敗：', countErr.message)
    process.exit(1)
  }

  const { data: deleted, error: delErr } = await supabase
    .from('match_chat_assist_sessions')
    .delete()
    .gte('created_at', '1970-01-01T00:00:00Z')
    .select('id')

  if (delErr) {
    console.error('刪除失敗：', delErr.message)
    process.exit(1)
  }

  const removed = deleted?.length ?? 0
  console.log(`已清除聊天小助手場次：${removed} 筆（刪除前共 ${before ?? 0} 筆）`)
  console.log('answers／claims 已隨 sessions 連帶刪除。拼圖解鎖紀錄未動。')
  console.log('各裝置若 modal 仍異常，請清 localStorage 前綴 tsm_chat_assist_handled: 或 hard refresh。')
}

void main()
