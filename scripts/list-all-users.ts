/**
 * 列出 Supabase 所有使用者 Email ↔ 姓名／暱稱對照（測試常用）。
 *
 * 環境變數：SUPABASE_SERVICE_ROLE_KEY；SUPABASE_URL 或 VITE_SUPABASE_URL（可寫入 .env.local）
 *
 * 執行：
 *   npm run list:users
 *   npm run list:users -- --founding-only
 *   npm run list:users -- --csv=scripts/test-users.csv
 *
 * 預設會印到終端機，並寫入 scripts/test-users.csv（已 gitignore，可常開對照）。
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

type ProfileRow = {
  id: string
  name: string | null
  nickname: string | null
  gender: string | null
  founding_member_no: number | null
  account_status: string | null
}

type UserRow = {
  email: string
  name: string
  nickname: string
  gender: string
  foundingNo: string
  userId: string
  accountStatus: string
}

function genderLabel(g: string | null | undefined): string {
  if (g === 'male') return '男'
  if (g === 'female') return '女'
  return g?.trim() || '—'
}

function pad(s: string, n: number): string {
  const t = s.length > n ? `${s.slice(0, n - 1)}…` : s
  return t.padEnd(n, ' ')
}

function parseCsvPathArg(): string | null {
  const hit = process.argv.find((a) => a.startsWith('--csv='))
  if (!hit) return null
  return hit.slice('--csv='.length).trim() || null
}

function parseFoundingOnlyArg(): boolean {
  return process.argv.includes('--founding-only')
}

async function loadAllAuthEmails(
  admin: { listUsers: (args: { page: number; perPage: number }) => Promise<{ data: { users: { id: string; email?: string }[] }; error: Error | null }> },
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await admin.listUsers({ page, perPage })
    if (error) throw error
    for (const u of data.users) {
      if (u.email) map.set(u.id, u.email.toLowerCase())
    }
    if (data.users.length < perPage) break
    page += 1
  }
  return map
}

function toUserRows(profiles: ProfileRow[], emailById: Map<string, string>): UserRow[] {
  const rows: UserRow[] = []
  const seenProfileIds = new Set<string>()

  for (const p of profiles) {
    seenProfileIds.add(p.id)
    rows.push({
      email: emailById.get(p.id) ?? '(無 Auth Email)',
      name: p.name?.trim() || '—',
      nickname: p.nickname?.trim() || '—',
      gender: genderLabel(p.gender),
      foundingNo: p.founding_member_no != null ? String(p.founding_member_no) : '—',
      userId: p.id,
      accountStatus: p.account_status?.trim() || '—',
    })
  }

  for (const [id, email] of emailById) {
    if (seenProfileIds.has(id)) continue
    rows.push({
      email,
      name: '—',
      nickname: '—',
      gender: '—',
      foundingNo: '—',
      userId: id,
      accountStatus: '—',
    })
  }

  rows.sort((a, b) => {
    const fa = a.foundingNo !== '—' ? Number(a.foundingNo) : 9999
    const fb = b.foundingNo !== '—' ? Number(b.foundingNo) : 9999
    if (fa !== fb) return fa - fb
    return a.email.localeCompare(b.email, 'en')
  })

  return rows
}

function printTable(rows: UserRow[]) {
  console.log(`\n共 ${rows.length} 筆\n`)
  console.log(
    `${pad('Email', 34)} ${pad('姓名', 10)} ${pad('暱稱', 12)} ${pad('性別', 4)} ${pad('創始#', 6)} ${pad('帳號狀態', 10)} User ID`,
  )
  console.log('-'.repeat(120))
  for (const r of rows) {
    console.log(
      `${pad(r.email, 34)} ${pad(r.name, 10)} ${pad(r.nickname, 12)} ${pad(r.gender, 4)} ${pad(r.foundingNo, 6)} ${pad(r.accountStatus, 10)} ${r.userId}`,
    )
  }
  console.log('')
}

function writeCsv(filePath: string, rows: UserRow[]) {
  const header = ['email', 'name', 'nickname', 'gender', 'founding_member_no', 'account_status', 'user_id']
  const escape = (s: string) => {
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [r.email, r.name, r.nickname, r.gender, r.foundingNo, r.accountStatus, r.userId].map(escape).join(','),
    ),
  ]
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `\uFEFF${lines.join('\n')}\n`, 'utf8')
  console.log(`已寫入 CSV：${filePath}`)
}

async function main() {
  loadRepoEnvFiles()
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) {
    console.error('請設定 SUPABASE_SERVICE_ROLE_KEY（Dashboard > API > service_role，可寫入 .env.local）')
    process.exit(1)
  }
  if (!url) {
    console.error('請設定 SUPABASE_URL 或 VITE_SUPABASE_URL')
    process.exit(1)
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const emailById = await loadAllAuthEmails(supabase.auth.admin)

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, name, nickname, gender, founding_member_no, account_status')
  if (error) {
    console.error('讀取 profiles 失敗:', error.message)
    process.exit(1)
  }

  const rows = toUserRows((profiles ?? []) as ProfileRow[], emailById)
  const foundingOnly = parseFoundingOnlyArg()
  const outputRows = foundingOnly
    ? rows.filter((r) => r.foundingNo !== '—')
    : rows
  printTable(outputRows)

  const csvArg = parseCsvPathArg()
  const csvPath = path.resolve(repoRootDir(), csvArg ?? (foundingOnly ? 'scripts/founding-users.csv' : 'scripts/test-users.csv'))
  writeCsv(csvPath, outputRows)

  console.log('創始測試帳密規律：founding001@tsmedia.tw～founding050@tsmedia.tw，密碼 88888888')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
