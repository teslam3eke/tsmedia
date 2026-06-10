import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

function readPackageVersion(): string {
  const pkgPath = path.join(process.cwd(), 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }
  const v = pkg.version?.trim()
  if (!v) throw new Error('package.json 缺少 version')
  return v
}

/** 語意化版本（1.0.0 → 1.0.1）；與 build-id.txt、/api/git-sha、PWA 更新檢查一致。 */
const APP_VERSION = readPackageVersion()
const APP_BUILD_ID = APP_VERSION

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

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_BUILD_ID__: JSON.stringify(APP_BUILD_ID),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'manifest.json', 'icons/*.png', 'hero.png', 'landing-photo.png'],
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
