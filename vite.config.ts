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

/** public/build-id.txt 確保 dist 根目錄一定有此檔（避免 SPA fallback 把 /build-id.txt 當成前端路由）。此處在緊接 PWA 輸出後再覆寫內容。 */
function emitBuildIdPlugin(): Plugin {
  return {
    name: 'emit-build-id',
    enforce: 'post',
    closeBundle() {
      const dir = path.resolve(process.cwd(), 'dist')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'build-id.txt'), `${APP_BUILD_ID}\n`, 'utf8')
    },
  }
}

const DEV_API_PORT = Number(process.env.DEV_API_PORT ?? 3001)

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(APP_BUILD_ID),
  },
  server: {
    /** 同 Wi‑Fi 手機測試：用終端機顯示的 Network 網址（例 http://192.168.x.x:5173） */
    host: true,
    /** 本機 npm run dev：/api/* 轉發至 scripts/dev-api-server.ts */
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${DEV_API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'manifest.json', 'icons/*.png', 'hero.png', 'landing-photo.png', 'assets/landing-couple-bg.png'],
      manifest: false,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,json}'],
        globIgnores: ['**/*eruda*.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
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
