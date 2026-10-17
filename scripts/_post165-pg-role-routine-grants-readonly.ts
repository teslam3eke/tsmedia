/**
 * Post-migration 165：唯讀查 information_schema.role_routine_grants（Production）
 *
 * 需要 SUPABASE_DB_PASSWORD 或 SUPABASE_DB_URL（同 apply-migration-160.ts）
 * npx tsx scripts/_post165-pg-role-routine-grants-readonly.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const RPCS = [
  { name: 'complete_monthly_membership', args: '' },
  { name: 'grant_monthly_membership_for_user', args: 'uuid' },
  { name: 'purchase_credit_pack', args: 'text' },
  { name: 'grant_credit_pack_for_user', args: 'uuid, text' },
  { name: 'test_ensure_daily_ten_credits', args: '' },
] as const

const ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'] as const

function loadEnv() {
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

function connectionString(): string {
  const urlOverride = process.env.SUPABASE_DB_URL?.trim()
  if (urlOverride) return urlOverride
  const password = process.env.SUPABASE_DB_PASSWORD?.trim()
  const projectUrl = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  if (!password || !projectUrl) {
    throw new Error('請設定 SUPABASE_DB_PASSWORD 或 SUPABASE_DB_URL')
  }
  const ref = new URL(projectUrl).hostname.split('.')[0]
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`
}

type GrantRow = {
  routine_name: string
  grantee: string
  privilege_type: string
}

async function main() {
  loadEnv()
  const client = new pg.Client({
    connectionString: connectionString(),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const names = RPCS.map((r) => r.name)
    const { rows } = await client.query<GrantRow>(
      `
      select routine_name, grantee, privilege_type
      from information_schema.role_routine_grants
      where specific_schema = 'public'
        and routine_name = any($1::text[])
        and privilege_type = 'EXECUTE'
      order by routine_name, grantee
      `,
      [names],
    )

    const { rows: fnExists } = await client.query<{ proname: string; args: string }>(
      `
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any($1::text[])
      order by p.proname, args
      `,
      [names],
    )

    const matrix: Record<string, Record<string, boolean>> = {}
    for (const rpc of RPCS) {
      matrix[rpc.name] = {}
      for (const role of ROLES) {
        matrix[rpc.name][role] = rows.some(
          (g) => g.routine_name === rpc.name && g.grantee === role,
        )
      }
    }

    const expectations: Record<string, Partial<Record<(typeof ROLES)[number], boolean>>> = {
      complete_monthly_membership: {
        PUBLIC: false,
        anon: false,
        authenticated: false,
      },
      grant_monthly_membership_for_user: {
        PUBLIC: false,
        anon: false,
        authenticated: false,
        service_role: true,
      },
      purchase_credit_pack: {
        PUBLIC: false,
        anon: false,
        authenticated: false,
      },
      grant_credit_pack_for_user: {
        PUBLIC: false,
        anon: false,
        authenticated: false,
        service_role: true,
      },
      test_ensure_daily_ten_credits: {
        PUBLIC: false,
        anon: false,
        authenticated: false,
      },
    }

    const checks: Record<string, boolean> = {}
    for (const [rpc, exp] of Object.entries(expectations)) {
      const exists = fnExists.some((f) => f.proname === rpc)
      if (rpc === 'test_ensure_daily_ten_credits' && !exists) {
        checks[`${rpc}:skipped_missing`] = true
        continue
      }
      if (!exists) {
        checks[`${rpc}:exists`] = false
        continue
      }
      for (const [role, want] of Object.entries(exp)) {
        const actual = matrix[rpc]?.[role] ?? false
        checks[`${rpc}:${role}=${want}`] = actual === want
      }
    }

    const ok = Object.values(checks).every(Boolean)

    console.log(
      JSON.stringify(
        {
          ok,
          grantsExecute: rows,
          functionsPresent: fnExists,
          matrix,
          checks,
        },
        null,
        2,
      ),
    )
    if (!ok) process.exit(1)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
