import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type RegistrationReminderLifecycleGender,
  normalizeRegistrationReminderLifecycleGender,
} from './registrationReminderGender.js'

export async function loadRegistrationReminderLifecycleGenderByUserIds(
  admin: SupabaseClient,
  userIds: readonly string[],
): Promise<Map<string, RegistrationReminderLifecycleGender>> {
  const map = new Map<string, RegistrationReminderLifecycleGender>()
  if (!userIds.length) return map

  const unique = [...new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0))]
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200)
    const { data, error } = await admin.from('profiles').select('id, gender').in('id', chunk)
    if (error) {
      console.warn('[registration-reminder] gender batch load failed', { message: error.message })
      for (const id of chunk) map.set(id, 'unknown')
      continue
    }
    const found = new Set<string>()
    for (const row of data ?? []) {
      const id = typeof row.id === 'string' ? row.id : ''
      if (!id) continue
      found.add(id)
      map.set(id, normalizeRegistrationReminderLifecycleGender(row.gender as string | null))
    }
    for (const id of chunk) {
      if (!found.has(id)) map.set(id, 'unknown')
    }
  }
  return map
}
