/**
 * Post-migration 165 唯讀：驗證 payment RPC EXECUTE 權限（不對真實會員 grant）。
 *
 * 用法（165 套用後）：
 *   npx tsx scripts/_post165-payment-rpc-permissions-readonly.ts
 *
 * 判斷：
 * - client 角色：PostgREST 應回 42501 / permission denied（函式不應執行到 PL/pgSQL 業務邏輯）
 * - service_role on grant_monthly：可執行到業務邏輯（dummy uuid → Profile gender required 等）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DUMMY_USER = '00000000-0000-0000-0000-000000000000'

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

type ProbeResult = {
  rpc: string
  role: 'anon' | 'authenticated' | 'service_role'
  httpStatus: number
  pgCode: string | null
  message: string
  permissionDenied: boolean
  enteredFunctionBody: boolean
}

function classify(message: string, pgCode: string | null): {
  permissionDenied: boolean
  enteredFunctionBody: boolean
} {
  const msg = message.toLowerCase()
  if (pgCode === '42501' || msg.includes('permission denied')) {
    return { permissionDenied: true, enteredFunctionBody: false }
  }
  // 進入函式後的業務錯誤（165 前 client 常見）
  if (
    msg.includes('not authenticated')
    || msg.includes('profile gender required')
    || msg.includes('user required')
    || pgCode === 'P0001'
  ) {
    return { permissionDenied: false, enteredFunctionBody: true }
  }
  return { permissionDenied: false, enteredFunctionBody: false }
}

async function probeRpc(
  baseUrl: string,
  apiKey: string,
  bearer: string,
  rpc: string,
  body: Record<string, unknown>,
  role: ProbeResult['role'],
): Promise<ProbeResult> {
  const res = await fetch(`${baseUrl}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let pgCode: string | null = null
  let message = ''
  try {
    const json = (await res.json()) as { code?: string; message?: string }
    pgCode = json.code ?? null
    message = json.message ?? JSON.stringify(json)
  } catch {
    message = await res.text()
  }
  const { permissionDenied, enteredFunctionBody } = classify(message, pgCode)
  return {
    rpc,
    role,
    httpStatus: res.status,
    pgCode,
    message: message.slice(0, 200),
    permissionDenied,
    enteredFunctionBody,
  }
}

async function main() {
  loadEnv()
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) {
    throw new Error('missing SUPABASE_URL, anon key, or SUPABASE_SERVICE_ROLE_KEY')
  }

  const probes: Array<{ rpc: string; body: Record<string, unknown> }> = [
    { rpc: 'complete_monthly_membership', body: {} },
    { rpc: 'grant_monthly_membership_for_user', body: { p_user_id: DUMMY_USER } },
    { rpc: 'purchase_credit_pack', body: { p_pack_key: 'heart_5' } },
    { rpc: 'grant_credit_pack_for_user', body: { p_user_id: DUMMY_USER, p_pack_key: 'heart_5' } },
  ]

  const results: ProbeResult[] = []
  for (const p of probes) {
    results.push(await probeRpc(url, anon, anon, p.rpc, p.body, 'anon'))
    results.push(await probeRpc(url, anon, anon, p.rpc, p.body, 'authenticated'))
    results.push(await probeRpc(url, service, service, p.rpc, p.body, 'service_role'))
  }

  const summary = {
    complete_monthly_membership: {
      anon: expectClientBlocked(results, 'complete_monthly_membership', 'anon'),
      authenticated: expectClientBlocked(results, 'complete_monthly_membership', 'authenticated'),
    },
    grant_monthly_membership_for_user: {
      anon: expectClientBlocked(results, 'grant_monthly_membership_for_user', 'anon'),
      authenticated: expectClientBlocked(results, 'grant_monthly_membership_for_user', 'authenticated'),
      service_role: expectServiceCanExecute(results, 'grant_monthly_membership_for_user', 'service_role'),
    },
    purchase_credit_pack: {
      anon: expectClientBlocked(results, 'purchase_credit_pack', 'anon'),
      authenticated: expectClientBlocked(results, 'purchase_credit_pack', 'authenticated'),
    },
    grant_credit_pack_for_user: {
      anon: expectClientBlocked(results, 'grant_credit_pack_for_user', 'anon'),
      authenticated: expectClientBlocked(results, 'grant_credit_pack_for_user', 'authenticated'),
      service_role: expectServiceCanExecute(results, 'grant_credit_pack_for_user', 'service_role'),
    },
    probes: results,
  }

  const ok =
    summary.complete_monthly_membership.anon
    && summary.complete_monthly_membership.authenticated
    && summary.grant_monthly_membership_for_user.anon
    && summary.grant_monthly_membership_for_user.authenticated
    && summary.grant_monthly_membership_for_user.service_role
    && summary.purchase_credit_pack.anon
    && summary.purchase_credit_pack.authenticated
    && summary.grant_credit_pack_for_user.anon
    && summary.grant_credit_pack_for_user.authenticated
    && summary.grant_credit_pack_for_user.service_role

  console.log(JSON.stringify({ ok, ...summary }, null, 2))
  if (!ok) process.exit(1)
}

function expectClientBlocked(all: ProbeResult[], rpc: string, role: ProbeResult['role']): boolean {
  const row = all.find((r) => r.rpc === rpc && r.role === role)
  if (!row) return false
  return row.permissionDenied || (!row.enteredFunctionBody && row.httpStatus >= 400)
}

function expectServiceCanExecute(all: ProbeResult[], rpc: string, role: ProbeResult['role']): boolean {
  const row = all.find((r) => r.rpc === rpc && r.role === role)
  if (!row) return false
  return row.enteredFunctionBody && !row.permissionDenied
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
