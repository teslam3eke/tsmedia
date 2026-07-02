import { supabase } from '@/lib/supabase'
import { shouldIgnoreSiteMaintenance } from '@/lib/appEnv'

export type SitePublicStatus = {
  maintenance: boolean
}

export async function fetchSitePublicStatus(): Promise<SitePublicStatus> {
  if (shouldIgnoreSiteMaintenance()) {
    return { maintenance: false }
  }
  if (import.meta.env.VITE_SITE_MAINTENANCE === '1') {
    return { maintenance: true }
  }
  try {
    const { data, error } = await supabase.rpc('get_site_public_status')
    if (error) {
      console.warn('[siteMaintenance] get_site_public_status', error.message)
      return { maintenance: false }
    }
    const row = data as { maintenance?: boolean } | null
    return { maintenance: row?.maintenance === true }
  } catch (err) {
    console.warn('[siteMaintenance] fetch failed', err)
    return { maintenance: false }
  }
}
