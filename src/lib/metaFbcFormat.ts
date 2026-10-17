/** Meta _fbc 格式：`fb.1.{creationTimeSec}.{fbclid}` */

export function fbclidFromFbcValue(fbc: string): string | null {
  const parts = fbc.split('.')
  if (parts.length < 4) return null
  return parts.slice(3).join('.') || null
}

export function creationTimeSecFromFbcValue(fbc: string): number | null {
  const parts = fbc.split('.')
  if (parts.length < 4) return null
  const ts = Number.parseInt(parts[2] ?? '', 10)
  return Number.isFinite(ts) ? ts : null
}

export function buildFbcValue(fbclid: string, creationTimeSec: number): string {
  return `fb.1.${creationTimeSec}.${fbclid}`
}
