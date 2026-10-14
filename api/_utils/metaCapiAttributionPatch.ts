import type { SupabaseClient } from '@supabase/supabase-js'
import type { MetaAttributionInput } from './clientRequestMeta.js'

/** 將請求 body 的 fbp/fbc 併入 profiles（供 CAPI 前補 attribution；失敗不 throw）。 */
export async function patchProfileMetaAttributionIfPresent(
  admin: SupabaseClient,
  userId: string,
  input: MetaAttributionInput,
): Promise<void> {
  if (!input.metaFbp && !input.metaFbc) return
  const patch: Record<string, string> = { meta_attribution_updated_at: new Date().toISOString() }
  if (input.metaFbp) patch.meta_fbp = input.metaFbp
  if (input.metaFbc) patch.meta_fbc = input.metaFbc
  const { error } = await admin.from('profiles').update(patch).eq('id', userId)
  if (error) {
    console.warn('[meta-capi] profile attribution patch failed', { userId, message: error.message })
  }
}

export async function loadProfileMetaAttribution(
  admin: SupabaseClient,
  userId: string,
): Promise<{ metaFbp: string | null; metaFbc: string | null }> {
  const { data } = await admin
    .from('profiles')
    .select('meta_fbp, meta_fbc')
    .eq('id', userId)
    .maybeSingle()
  return {
    metaFbp: typeof data?.meta_fbp === 'string' ? data.meta_fbp : null,
    metaFbc: typeof data?.meta_fbc === 'string' ? data.meta_fbc : null,
  }
}
