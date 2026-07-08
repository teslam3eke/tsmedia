/**
 * 從 brand 主檔產生 PWA／favicon 與 App 內 logo-mark.png。
 *
 * 請把設計稿放到（擇一，優先由上而下）：
 *   public/assets/brand/logo-mark-source.png   ← 建議（透明或白底皆可）
 *   public/assets/brand/logo-mark-source.svg   ← 須為真正 SVG，勿把 PNG 改副檔名
 *
 * 用法：npm run generate:pwa-icons
 *
 * 注意：不會覆寫 logo-mark-source.*；logo-mark.png 為產物，供 App 顯示。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BRAND_DIR = path.join(ROOT, 'public', 'assets', 'brand')
const PUBLIC_DIR = path.join(ROOT, 'public')

const SOURCE_CANDIDATES = [
  'logo-mark-source.png',
  'logo-mark-source.svg',
  'logo-mark.png',
] as const

function resolveBrandSource(): string {
  for (const name of SOURCE_CANDIDATES) {
    const fp = path.join(BRAND_DIR, name)
    if (fs.existsSync(fp)) return fp
  }
  throw new Error(
    '找不到 logo 主檔。請放到 public/assets/brand/logo-mark-source.png（建議）或 logo-mark-source.svg',
  )
}

/** 副檔名為 .svg 但內容是 PNG（常見誤存）→ 仍可用 sharp 讀取 */
function openRasterSource(sourcePath: string): sharp.Sharp {
  const buf = fs.readFileSync(sourcePath)
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return sharp(buf)
  }
  return sharp(sourcePath)
}

function isRealSvgFile(sourcePath: string): boolean {
  if (!sourcePath.toLowerCase().endsWith('.svg')) return false
  const head = fs.readFileSync(sourcePath).subarray(0, 256).toString('utf8').trimStart()
  return head.startsWith('<svg') || head.startsWith('<?xml')
}

/** 白底主檔 → 去背＋裁切，供 App 內深色／半透明底使用 */
async function prepareTransparentLogo(sourcePath: string): Promise<sharp.Sharp> {
  const { data, info } = await openRasterSource(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = data
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]!
    const g = px[i + 1]!
    const b = px[i + 2]!
    if (r >= 245 && g >= 245 && b >= 245) px[i + 3] = 0
  }
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({ threshold: 8 })
}

async function renderSquare(
  source: sharp.Sharp,
  size: number,
  maskable: boolean,
  transparent = false,
): Promise<Buffer> {
  const bg = transparent
    ? ({ r: 0, g: 0, b: 0, alpha: 0 as const })
    : ({ r: 255, g: 255, b: 255, alpha: 1 as const })
  if (!maskable) {
    return source
      .clone()
      .resize(size, size, { fit: 'contain', background: bg })
      .png()
      .toBuffer()
  }
  const inner = Math.round(size * 0.8)
  const logo = await source
    .clone()
    .resize(inner, inner, { fit: 'contain', background: bg })
    .png()
    .toBuffer()
  return sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer()
}

async function main() {
  const sourcePath = resolveBrandSource()
  const source = openRasterSource(sourcePath)
  const appLogo = await prepareTransparentLogo(sourcePath)
  const meta = await source.metadata()
  console.log('來源:', path.relative(ROOT, sourcePath), `${meta.width}x${meta.height}`, meta.format)

  if (sourcePath.endsWith('.svg') && !isRealSvgFile(sourcePath)) {
    console.warn(
      '⚠ 此 .svg 內容其實是 PNG（常見於「另存 SVG」誤操作）。請改存為 logo-mark-source.png 以免編輯器／瀏覽器打不開。',
    )
  }

  fs.mkdirSync(BRAND_DIR, { recursive: true })
  fs.mkdirSync(path.join(PUBLIC_DIR, 'icons'), { recursive: true })

  if (isRealSvgFile(sourcePath)) {
    fs.copyFileSync(sourcePath, path.join(PUBLIC_DIR, 'favicon.svg'))
    console.log('✓ favicon.svg（來自真正 SVG 主檔）')
  } else {
    console.log('略過 favicon.svg（主檔非向量 SVG；分頁圖示用 favicon.ico / PNG）')
  }

  const png1024 = await renderSquare(appLogo, 1024, false, true)
  fs.writeFileSync(path.join(BRAND_DIR, 'logo-mark.png'), png1024)
  console.log('✓ assets/brand/logo-mark.png（App 內顯示用，透明底）')

  const outputs: Array<{ rel: string; size: number; maskable?: boolean }> = [
    { rel: 'icons/icon-192.png', size: 192 },
    { rel: 'icons/icon-512.png', size: 512 },
    { rel: 'icons/icon-1024.png', size: 1024 },
    { rel: 'icons/icon-192-maskable.png', size: 192, maskable: true },
    { rel: 'icons/icon-512-maskable.png', size: 512, maskable: true },
    { rel: 'icons/apple-touch-icon.png', size: 180 },
  ]

  for (const { rel, size, maskable } of outputs) {
    const buf = await renderSquare(source, size, maskable === true)
    fs.writeFileSync(path.join(PUBLIC_DIR, ...rel.split('/')), buf)
    console.log('✓', rel)
  }

  const favicon16 = await renderSquare(source, 16, false)
  const favicon32 = await renderSquare(source, 32, false)
  const favicon48 = await renderSquare(source, 48, false)
  const ico = await pngToIco([favicon16, favicon32, favicon48])
  fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.ico'), ico)
  console.log('✓ favicon.ico')

  console.log('\n完成 — 硬重整 PWA；主畫面捷徑需刪除後重新加入。')
}

void main()
