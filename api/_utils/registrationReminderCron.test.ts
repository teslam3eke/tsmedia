import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const vercelJson = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
  crons?: { path: string; schedule: string }[]
}

describe('registration reminder cron wiring', () => {
  it('registers 6-hour cron path', () => {
    const entry = vercelJson.crons?.find((c) => c.path === '/api/cron-registration-reminder-email')
    expect(entry?.schedule).toBe('30 1,7,13,19 * * *')
  })
})
