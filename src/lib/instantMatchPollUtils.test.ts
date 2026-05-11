import { describe, expect, it } from 'vitest'
import { applyDismissedSessionFilter, INSTANT_MATCH_IDLE_HINT } from '@/lib/instantMatchPollUtils'
import type { InstantMatchPollResult } from '@/lib/db'

describe('applyDismissedSessionFilter', () => {
  it('passes through non-done', () => {
    const idle: InstantMatchPollResult = { status: 'idle' }
    expect(applyDismissedSessionFilter(idle, new Set(['x']))).toBe(idle)
  })

  it('keeps done when session not dismissed', () => {
    const done: InstantMatchPollResult = {
      status: 'done',
      session_id: 's1',
      mutual_friend: false,
      instant_end_reason: 'peer_left',
    }
    const next = applyDismissedSessionFilter(done, new Set())
    expect(next).toEqual(done)
  })

  it('maps done to idle when session_id dismissed', () => {
    const done: InstantMatchPollResult = {
      status: 'done',
      session_id: 's1',
      mutual_friend: false,
      instant_end_reason: 'peer_left',
    }
    const next = applyDismissedSessionFilter(done, new Set(['s1']))
    expect(next).toEqual({ status: 'idle', hint: INSTANT_MATCH_IDLE_HINT })
  })
})
