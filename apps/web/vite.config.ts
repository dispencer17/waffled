/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type ProxyOptions } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// onnxruntime-web's wasm engine (~13 MB) is fetched at runtime from /ort/ when the
// openWakeWord engine starts (see lib/voice/openwakeword.ts). Emit it from
// node_modules into the build — self-hosted, no third-party CDN, nothing that
// heavy committed to git. configureServer covers `npm run dev`.
const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']
function ortWasmAssets(): Plugin {
  const dist = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist')
  return {
    name: 'ort-wasm-assets',
    generateBundle() {
      for (const f of ORT_FILES) {
        this.emitFile({ type: 'asset', fileName: `ort/${f}`, source: fs.readFileSync(path.join(dist, f)) })
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/ort\/([\w.-]+)$/.exec(req.url ?? '')
        if (!m || !ORT_FILES.includes(m[1])) return next()
        res.setHeader('content-type', m[1].endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        fs.createReadStream(path.join(dist, m[1])).pipe(res)
      })
    },
  }
}

// Proxy /api to the local api container so the SPA and api share an origin (no
// CORS), exactly like Caddy does in the stack. We forward the browser's host +
// proto so the api can build correct absolute URLs (OIDC redirect_uri, the
// "Back to Waffled" links) — otherwise it only sees its own :3000 address and SSO
// callbacks point at the wrong place.
const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: false,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        if (req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host)
        const encrypted = (req.socket as { encrypted?: boolean }).encrypted
        proxyReq.setHeader('x-forwarded-proto', encrypted ? 'https' : 'http')
      })
    },
  },
  // Uploaded media (/media/*) is served by Caddy off the shared waffled_media volume,
  // NOT by the api — so in dev we forward to the running stack's Caddy (:8080) the
  // same way it's served in production. Without this, the dev server returns
  // index.html for /media URLs and uploaded images render broken.
  '/media': {
    target: 'http://localhost:8080',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react(), ortWasmAssets()],
  // @powersync/web ships its own SQLite WASM + worker; pre-bundling breaks them,
  // so exclude it from Vite's dep optimizer (PowerSync's documented Vite setup).
  optimizeDeps: { exclude: ['@powersync/web'] },
  // The Picovoice packages declare only a `module` entry (no main/exports),
  // which Vitest's SSR resolver can't locate — point straight at the ESM files.
  resolve: {
    alias: {
      '@picovoice/porcupine-web': '@picovoice/porcupine-web/dist/esm/index.js',
      '@picovoice/web-voice-processor': '@picovoice/web-voice-processor/dist/esm/index.js',
    },
  },
  worker: { format: 'es' },
  server: {
    port: 5175,
    proxy: apiProxy,
  },
  // `vite preview` mirrors the dev proxy so a production build can be exercised
  // against the local api (and the service worker's /api caching verified).
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
  test: {
    // Browser smoke specs use Playwright's runner and must never be collected by Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Run test files sequentially (like apps/api). Vitest otherwise spawns a worker per
    // *host* core, ignoring the cgroup CPU limit — on a 2-core CI runner that oversubscribes
    // and starves jsdom renders ~60×, making interaction tests time out. Sequential keeps
    // each file at full speed and reliable. (Slightly slower wall-clock; worth it in CI.)
    fileParallelism: false,
    // Extra headroom for the heavier interaction tests on slow CI.
    testTimeout: 15000,
    // CI-only safety net: GitHub's shared 2-core runners occasionally stall a whole
    // file (GC / scheduler) despite the fixes above. Retry on CI so a transient load
    // stall doesn't red-X the build; keep 0 locally so real failures fail fast.
    retry: process.env.CI ? 2 : 0,
  },
})
