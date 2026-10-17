import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration165 = fs.readFileSync(
  path.join(root, 'supabase/migrations/165_revoke_client_payment_bypass_rpcs.sql'),
  'utf8',
)
const migration162 = fs.readFileSync(
  path.join(root, 'supabase/migrations/162_user_coupon_entitlements.sql'),
  'utf8',
)
const migration110 = fs.readFileSync(
  path.join(root, 'supabase/migrations/110_ecpay_fulfill_idempotent.sql'),
  'utf8',
)

export const PAYMENT_BYPASS_CLIENT_RPCS = [
  'complete_monthly_membership',
  'purchase_credit_pack',
  'test_ensure_daily_ten_credits',
] as const

export const PAYMENT_GRANT_SERVICE_ROLE_ONLY_RPCS = [
  'grant_monthly_membership_for_user',
  'grant_credit_pack_for_user',
] as const

function expectRevokeClient(rpc: string, args: string) {
  const sig = `public\\.${rpc}${args.replace(/[()]/g, '\\$&')}`
  expect(migration165).toMatch(new RegExp(`revoke all on function ${sig} from public`, 'i'))
  expect(migration165).toMatch(new RegExp(`revoke all on function ${sig} from anon`, 'i'))
  expect(migration165).toMatch(new RegExp(`revoke all on function ${sig} from authenticated`, 'i'))
}

describe('migration 165 payment bypass revoke', () => {
  it('A–B. complete_monthly_membership: revoke public/anon/authenticated', () => {
    expectRevokeClient('complete_monthly_membership', '()')
    expect(migration165).not.toMatch(/drop function public\.complete_monthly_membership/i)
  })

  it('C–D. grant_monthly_membership_for_user: client revoke + service_role grant', () => {
    expectRevokeClient('grant_monthly_membership_for_user', '(uuid)')
    expect(migration165).toMatch(
      /grant execute on function public\.grant_monthly_membership_for_user\(uuid\) to service_role/i,
    )
  })

  it('E. documents service_role grant for grant_monthly (live EXECUTE verified post-migration)', () => {
    expect(migration165).toMatch(/grant execute on function public\.grant_monthly_membership_for_user\(uuid\) to service_role/)
  })

  it('F–G. purchase_credit_pack: revoke client roles', () => {
    expectRevokeClient('purchase_credit_pack', '(text)')
  })

  it('H. grant_credit_pack_for_user: revoke client + service_role only', () => {
    expectRevokeClient('grant_credit_pack_for_user', '(uuid, text)')
    expect(migration165).toMatch(
      /grant execute on function public\.grant_credit_pack_for_user\(uuid, text\) to service_role/i,
    )
  })

  it('test_ensure_daily_ten_credits revoke is optional when function missing (017)', () => {
    expect(migration165).toMatch(/test_ensure_daily_ten_credits/)
    expect(migration165).toMatch(/if exists/i)
    expect(migration165).not.toMatch(
      /^revoke all on function public\.test_ensure_daily_ten_credits/m,
    )
  })

  it('I. ECPay fulfill still calls grant_monthly_membership_for_user (162/110)', () => {
    expect(migration162).toMatch(/grant_monthly_membership_for_user\(v_order\.user_id\)/)
    expect(migration110).toMatch(/grant_monthly_membership_for_user\(v_order\.user_id\)/)
    expect(migration162).toMatch(/grant_credit_pack_for_user\(v_order\.user_id, v_order\.pack_key\)/)
  })

  it('J. TapPay membership server flow uses grant_monthly (documented in api)', () => {
    const tappay = fs.readFileSync(path.join(root, 'api/tappay-membership.ts'), 'utf8')
    expect(tappay).toMatch(/grant_monthly_membership_for_user/)
  })

  it('K. ECPay item fulfillment uses grant_credit_pack (documented in api)', () => {
    const tappayPack = fs.readFileSync(path.join(root, 'api/tappay-credit-pack.ts'), 'utf8')
    expect(tappayPack).toMatch(/grant_credit_pack_for_user/)
    expect(migration162).toMatch(/fulfill_ecpay_order_for_service/)
  })

  it('M. female discount RPC not modified by 165', () => {
    expect(migration165).not.toMatch(/redeem_female_membership_discount_code/)
    expect(migration165).not.toMatch(/preview_membership_discount_code/)
  })

  it('N. Purchase CAPI paths untouched by 165', () => {
    expect(migration165).not.toMatch(/meta/i)
    const paywall = fs.readFileSync(path.join(root, 'src/screens/MembershipPaywallScreen.tsx'), 'utf8')
    expect(paywall).toMatch(/trackMetaPurchaseFromTapPay/)
  })

  it('does not modify migration 164 file', () => {
    expect(migration165).not.toMatch(/164_acquisition/)
    expect(migration165).not.toMatch(/issue_acquisition_coupon_entitlement_v2/)
  })

  it('L. frontend blocks mock RPC unless dev + VITE_ALLOW_MOCK_PAYMENT', () => {
    const db = fs.readFileSync(path.join(root, 'src/lib/db.ts'), 'utf8')
    const provider = fs.readFileSync(path.join(root, 'src/lib/paymentProvider.ts'), 'utf8')
    expect(provider).toMatch(/import\.meta\.env\.PROD/)
    expect(provider).toMatch(/VITE_ALLOW_MOCK_PAYMENT/)
    expect(db).toMatch(/isClientMockPaymentEnabled/)
    expect(db).toMatch(/completeMonthlyMembership/)
  })
})
