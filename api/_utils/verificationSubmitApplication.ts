import type { SupabaseClient } from '@supabase/supabase-js'

export type VerificationSubmitDocInput = {
  kind: 'identity' | 'bonus' | 'income'
  docType: string
  path: string
  claimedIncomeTier?: string | null
}

export type VerificationSubmitResult =
  | { ok: true; applicationId: string }
  | { ok: false; error: string }

function normalizeProofStoragePath(path: string): string {
  return path.replace(/^\/+/, '').trim()
}

async function deleteProofDocsFromStorage(admin: SupabaseClient, paths: string[]): Promise<void> {
  const normalized = paths.map(normalizeProofStoragePath).filter(Boolean)
  if (normalized.length === 0) return
  const { error } = await admin.storage.from('proofs').remove(normalized)
  if (error) {
    console.warn('[verification-submit] storage remove failed', { message: error.message })
  }
}

export async function runVerificationSubmitApplication(
  admin: SupabaseClient,
  userId: string,
  declaredCompany: string,
  docs: VerificationSubmitDocInput[],
): Promise<VerificationSubmitResult> {
  const company = declaredCompany.trim()
  if (!company) return { ok: false, error: '請先在個人資料填寫任職公司。' }

  const { data: pending } = await admin
    .from('verification_applications')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .limit(1)

  if (pending?.length) {
    return { ok: false, error: '你已有待審核的申請，請等待結果。' }
  }

  const { data: application, error: appError } = await admin
    .from('verification_applications')
    .insert({ user_id: userId, status: 'pending' })
    .select('id')
    .single()

  if (appError || !application) {
    console.error('[verification-submit] app insert', appError?.message)
    return { ok: false, error: appError?.message ?? '送審失敗，請稍後再試。' }
  }

  const applicationId = application.id as string
  const rows = docs.map((d) => ({
    user_id: userId,
    application_id: applicationId,
    company,
    doc_type: d.docType,
    doc_url: d.path,
    status: 'pending' as const,
    verification_kind: d.kind,
    review_mode: 'manual' as const,
    claimed_income_tier: d.kind === 'income' ? (d.claimedIncomeTier ?? null) : null,
  }))

  if (rows.length > 0) {
    const { error: docsError } = await admin.from('verification_docs').insert(rows)
    if (docsError) {
      console.error('[verification-submit] docs insert', docsError.message)
      await deleteProofDocsFromStorage(
        admin,
        docs.map((d) => d.path),
      )
      await admin.from('verification_applications').delete().eq('id', applicationId)
      return { ok: false, error: docsError.message }
    }
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ verification_status: 'submitted', company })
    .eq('id', userId)

  if (profileError) {
    console.error('[verification-submit] profile update', profileError.message)
    await admin.from('verification_docs').delete().eq('application_id', applicationId)
    await admin.from('verification_applications').delete().eq('id', applicationId)
    await deleteProofDocsFromStorage(
      admin,
      docs.map((d) => d.path),
    )
    return { ok: false, error: profileError.message }
  }

  return { ok: true, applicationId }
}
