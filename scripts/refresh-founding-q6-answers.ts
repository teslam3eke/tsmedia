/**
 * 重刷創始會員問卷第 6 題答案（50 則專屬、founding 序號一對一）。
 * 環境變數：SUPABASE_SERVICE_ROLE_KEY；SUPABASE_URL 或 VITE_SUPABASE_URL
 * 執行：npm run refresh:founding-q6
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  turningPointAnswerForFoundingNo,
} from './founding-questionnaire-answers.ts'
import {
  FIXED_TURNING_POINT_QUESTION_ID,
  FIXED_TURNING_POINT_QUESTION_TEXT,
  getFixedTurningPointQuestion,
} from '../src/utils/questions.ts'

type QEntry = {
  id?: number
  category?: string
  text?: string
  answer?: string
}

function repoRootDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function loadRepoEnvFiles(): void {
  const root = repoRootDir()
  for (const name of ['.env.local', '.env'] as const) {
    const filePath = path.join(root, name)
    if (!fs.existsSync(filePath)) continue
    const text = fs.readFileSync(filePath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      const key = t.slice(0, eq).trim()
      let val = t.slice(eq + 1).trim()
      if (!key) continue
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
}

function isTurningPointEntry(e: QEntry): boolean {
  const id = e.id
  const text = String(e.text ?? '').trim()
  return id === FIXED_TURNING_POINT_QUESTION_ID || text === FIXED_TURNING_POINT_QUESTION_TEXT
}

function refreshQuestionnaireQ6(entries: QEntry[] | null, foundingNo: number): QEntry[] {
  const fixed = getFixedTurningPointQuestion()
  const answer = turningPointAnswerForFoundingNo(foundingNo)
  const list = Array.isArray(entries) ? [...entries] : []
  let touched = false
  const mapped = list.map((e) => {
    if (!isTurningPointEntry(e)) return e
    touched = true
    return {
      ...e,
      id: fixed.id,
      category: fixed.category,
      text: fixed.text,
      answer,
    }
  })
  if (!touched) {
    mapped.push({ id: fixed.id, category: fixed.category, text: fixed.text, answer })
  }
  return mapped
}

async function main() {
  loadRepoEnvFiles()
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) {
    console.error('請設定 SUPABASE_SERVICE_ROLE_KEY（可寫入 .env.local）')
    process.exit(1)
  }
  if (!url) {
    console.error('請設定 SUPABASE_URL 或 VITE_SUPABASE_URL')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: rows, error: fetchErr } = await supabase
    .from('profiles')
    .select('id, founding_member_no, questionnaire')
    .not('founding_member_no', 'is', null)
    .order('founding_member_no')

  if (fetchErr) {
    console.error('讀取 profiles 失敗:', fetchErr.message)
    process.exit(1)
  }

  let updated = 0
  const errors: { no: number; message: string }[] = []

  for (const row of rows ?? []) {
    const no = row.founding_member_no as number
    if (!no || no < 1) continue
    const questionnaire = refreshQuestionnaireQ6(
      row.questionnaire as QEntry[] | null,
      no,
    )
    const { error: upErr } = await supabase
      .from('profiles')
      .update({ questionnaire })
      .eq('id', row.id)
    if (upErr) {
      errors.push({ no, message: upErr.message })
      continue
    }
    updated += 1
  }

  console.log('創始會員第 6 題已重刷:', updated, '筆')
  if (errors.length) {
    console.warn('失敗:', errors.length)
    for (const e of errors) console.warn(`  founding ${e.no}: ${e.message}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
