import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/** 與 dist/build-id.txt 一致；Vercel 上為 git SHA，本地 build 為 local-* */
const APP_BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? `local-${Date.now()}`

function emitBuildIdPlugin(): Plugin {
  return {
    name: 'emit-build-id',
    closeBundle() {
      const dir = path.resolve(process.cwd(), 'dist')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'build-id.txt'), `${APP_BUILD_ID}\n`, 'utf8')
    },
  }
}

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(APP_BUILD_ID),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'manifest.json', 'icons/*.png', 'hero.png', 'landing-photo.png'],
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,json}'],
        skipWaiting: true,
        clientsClaim: true,
        // build-id 一律走網路，避免 SW／HTTP 快取讓版本檢查讀到舊檔
        // Supabase：含 OPTIONS 預檢 + POST RPC；勿拆成僅 POST 規則 → 405。
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname === '/build-id.txt' || url.pathname.endsWith('/build-id.txt'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
    emitBuildIdPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
