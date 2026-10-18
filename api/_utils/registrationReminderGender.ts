/** Registration Reminder lifecycle gender（authoritative：profiles.gender；client 不可傳入） */

export type RegistrationReminderLifecycleGender = 'male' | 'female' | 'unknown'

export function normalizeRegistrationReminderLifecycleGender(
  raw: string | null | undefined,
): RegistrationReminderLifecycleGender {
  if (raw === 'male') return 'male'
  if (raw === 'female') return 'female'
  return 'unknown'
}

/** 男性兩階段；female / unknown 三階段。 */
export function maxRegistrationReminderStageForGender(
  gender: RegistrationReminderLifecycleGender,
): 2 | 3 {
  return gender === 'male' ? 2 : 3
}

export function isRegistrationReminderStageAllowedForGender(
  stage: 1 | 2 | 3,
  gender: RegistrationReminderLifecycleGender,
): boolean {
  return stage <= maxRegistrationReminderStageForGender(gender)
}
