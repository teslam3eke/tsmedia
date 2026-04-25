import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR   = join(__dirname, '..', 'public', 'icons')

mkdirSync(OUT_DIR, { recursive: true })

/**
 * tsMedia app icon — brand-consistent with the in-app logo:
 * deep slate background + clean white CPU chip with a small heart inside.
 * Designed full-bleed so iOS can round-corner it and Android can mask it
 * (all meaningful content is kept inside the central 80% safe zone).
 */
const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="#1e293b"/>
      <stop offset="1"   stop-color="#0b1220"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0"   stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="1"   stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Full-bleed background: iOS/Android will round or mask the corners -->
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="420" fill="url(#glow)"/>

  <!-- CPU chip group, centred, ~55% of canvas -->
  <g transform="translate(512 512)">
    <g transform="translate(-220 -220)" fill="none" stroke="#ffffff" stroke-width="38" stroke-linecap="round" stroke-linejoin="round">
      <!-- Chip body -->
      <rect x="40" y="40" width="360" height="360" rx="56" ry="56"/>
      <!-- Inner chip frame -->
      <rect x="110" y="110" width="220" height="220" rx="28" ry="28"/>

      <!-- Pins: top -->
      <line x1="130" y1="0"  x2="130" y2="40"/>
      <line x1="190" y1="0"  x2="190" y2="40"/>
      <line x1="250" y1="0"  x2="250" y2="40"/>
      <line x1="310" y1="0"  x2="310" y2="40"/>
      <!-- Pins: bottom -->
      <line x1="130" y1="400" x2="130" y2="440"/>
      <line x1="190" y1="400" x2="190" y2="440"/>
      <line x1="250" y1="400" x2="250" y2="440"/>
      <line x1="310" y1="400" x2="310" y2="440"/>
      <!-- Pins: left -->
      <line x1="0"   y1="130" x2="40"  y2="130"/>
      <line x1="0"   y1="190" x2="40"  y2="190"/>
      <line x1="0"   y1="250" x2="40"  y2="250"/>
      <line x1="0"   y1="310" x2="40"  y2="310"/>
      <!-- Pins: right -->
      <line x1="400" y1="130" x2="440" y2="130"/>
      <line x1="400" y1="190" x2="440" y2="190"/>
      <line x1="400" y1="250" x2="440" y2="250"/>
      <line x1="400" y1="310" x2="440" y2="310"/>
    </g>

    <!-- Heart inside the chip -->
    <g transform="translate(0 0) scale(4.2)" fill="#ffffff">
      <path d="M0 14 C -14 2, -20 -6, -10 -12 C -4 -15, 0 -10, 0 -6 C 0 -10, 4 -15, 10 -12 C 20 -6, 14 2, 0 14 Z"/>
    </g>
  </g>
</svg>
`

// Also produce a dedicated maskable variant with a bigger background "bleed"
// so Android can aggressively mask (circle / squircle) without clipping the
// chip graphic. Maskable spec: safe zone = inner 80% circle.
const svgMaskable = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e293b"/>
      <stop offset="1" stop-color="#0b1220"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <g transform="translate(512 512) scale(0.78)">
    <g transform="translate(-220 -220)" fill="none" stroke="#ffffff" stroke-width="38" stroke-linecap="round" stroke-linejoin="round">
      <rect x="40" y="40" width="360" height="360" rx="56" ry="56"/>
      <rect x="110" y="110" width="220" height="220" rx="28" ry="28"/>
      <line x1="130" y1="0"   x2="130" y2="40"/>
      <line x1="190" y1="0"   x2="190" y2="40"/>
      <line x1="250" y1="0"   x2="250" y2="40"/>
      <line x1="310" y1="0"   x2="310" y2="40"/>
      <line x1="130" y1="400" x2="130" y2="440"/>
      <line x1="190" y1="400" x2="190" y2="440"/>
      <line x1="250" y1="400" x2="250" y2="440"/>
      <line x1="310" y1="400" x2="310" y2="440"/>
      <line x1="0"   y1="130" x2="40"  y2="130"/>
      <line x1="0"   y1="190" x2="40"  y2="190"/>
      <line x1="0"   y1="250" x2="40"  y2="250"/>
      <line x1="0"   y1="310" x2="40"  y2="310"/>
      <line x1="400" y1="130" x2="440" y2="130"/>
      <line x1="400" y1="190" x2="440" y2="190"/>
      <line x1="400" y1="250" x2="440" y2="250"/>
      <line x1="400" y1="310" x2="440" y2="310"/>
    </g>
    <g transform="translate(0 0) scale(4.2)" fill="#ffffff">
      <path d="M0 14 C -14 2, -20 -6, -10 -12 C -4 -15, 0 -10, 0 -6 C 0 -10, 4 -15, 10 -12 C 20 -6, 14 2, 0 14 Z"/>
    </g>
  </g>
</svg>
`

async function renderPng(svgString, size, outName) {
  const out = join(OUT_DIR, outName)
  await sharp(Buffer.from(svgString)).resize(size, size).png({ compressionLevel: 9 }).toFile(out)
  console.log('wrote', out)
}

// Standard "any" icons (iOS uses this — full-bleed, OS adds rounding)
await renderPng(svg(1024),      1024, 'icon-1024.png')
await renderPng(svg(512),        512, 'icon-512.png')
await renderPng(svg(192),        192, 'icon-192.png')
await renderPng(svg(180),        180, 'apple-touch-icon.png')  // iOS home-screen spec

// Maskable variant for Android adaptive icons
await renderPng(svgMaskable(512), 512, 'icon-512-maskable.png')
await renderPng(svgMaskable(192), 192, 'icon-192-maskable.png')

// Also expose a source SVG so the same art can be used as favicon fallback
writeFileSync(join(OUT_DIR, 'icon.svg'), svg(1024))
console.log('done')
