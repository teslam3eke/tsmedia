/**
 * POST：管理員 authoritative 審核 verification application（通過／退件）+ 推播 + Approval Email
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  runApproveVerificationApplication,
  runRejectVerificationApplication,
} from './_utils/verificationApplicationReview.js'

function bearerToken(req: VercelRequest): string | null {
  const auth = req.headers.authorization?.trim()
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice('Bearer '.length).trim() || null
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const token = bearerToken(req)
  const url = process.env.SUPABASE_URL?.trim() ?? process.env.VITE_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const anon = process.env.SUPABASE_ANON_KEY?.trim() ?? process.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!token || !url || !serviceKey || !anon) {
    res.status(401).json({ ok: false, error: 'unauthorized' })
    return
  }

  const admin = createClient(url, serviceKey)
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const callerId = userData.user?.id
  if (userError || !callerId) {
    res.status(401).json({ ok: false, error: 'invalid session' })
    return
  }

  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', callerId)
    .maybeSingle()
  if (profileError || callerProfile?.is_admin !== true) {
    res.status(403).json({ ok: false, error: 'admin only' })
    return
  }

  const rawBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}
  const action = typeof rawBody.action === 'string' ? rawBody.action.trim() : ''
  const applicationId =
    typeof rawBody.applicationId === 'string'
      ? rawBody.applicationId.trim()
      : typeof rawBody.application_id === 'string'
        ? rawBody.application_id.trim()
        : ''
  const skipIncome = rawBody.skipIncome === true || rawBody.skip_income === true
  const reviewerNote =
    typeof rawBody.reviewerNote === 'string'
      ? rawBody.reviewerNote
      : typeof rawBody.reviewer_note === 'string'
        ? rawBody.reviewer_note
        : null

  if (!applicationId) {
    res.status(400).json({ ok: false, error: 'applicationId required' })
    return
  }

  if (action === 'approve') {
    const result = await runApproveVerificationApplication(admin, applicationId, {
      skipIncome,
      reviewerNote,
    })
    res.status(result.ok ? 200 : 400).json(result)
    return
  }

  if (action === 'reject') {
    const result = await runRejectVerificationApplication(admin, applicationId, reviewerNote)
    res.status(result.ok ? 200 : 400).json(result)
    return
  }

  res.status(400).json({ ok: false, error: 'action must be approve or reject' })
}
