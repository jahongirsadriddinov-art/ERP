import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

// Ilova o'zining versiyasini bilishi uchun (App.tsx'dagi yangilanish
// tekshiruvi, backend/src/routes/deploy.ts GET /latest bilan solishtiradi).
// CI (VITE_APP_VERSION) backend /api/deploy/latest bilan AYNAN bir xil formatdagi versiyani beradi.
const pkgVersion = process.env.VITE_APP_VERSION || JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version


// Har build uchun noyob id — ochiq oyna yangi deploy chiqqanini /version.json orqali biladi va o'zi yangilanadi
// (lib/autoUpdate.ts; owner 2026-10-25: "yangilanish faqat refreshdan keyin yuklanyapti")
const BUILD_ID = process.env.VITE_BUILD_ID || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function versionManifest() {
  return {
    name: 'version-manifest',
    apply: 'build' as const,
    generateBundle(this: any) {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID, version: pkgVersion }) })
    },
  }
}

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  // Production'da konsolga ichki loglar chiqmasin (owner 2026-10-23); console.warn/error qoladi — xatolar kuzatuvi uchun
  esbuild: mode === 'production' ? { drop: ['debugger'], pure: ['console.log', 'console.debug', 'console.info', 'console.trace'] } : {},
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    figmaAssetResolver(),
    versionManifest(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  assetsInclude: ['**/*.svg', '**/*.csv'],

  // Recharts circular ESM dep ni pre-bundle orqali hal qilamiz
  optimizeDeps: {
    include: ['react', 'react-dom', 'scheduler', 'recharts'],
  },

  build: {
    target: 'esnext',
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ─── React ekotizimi — scheduler va react-is ham shu chunk'da bo'lishi shart.
          // react-dom scheduler'ga bog'liq: agar scheduler vendor'ga ketsa,
          // vendor-react → vendor → vendor-react dairesel dep hosil bo'ladi va
          // "Cannot read properties of undefined (reading 'forwardRef')" xatosi kelib chiqadi.
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/') ||
            id.includes('node_modules/react-is/')
          ) {
            return 'vendor-react';
          }
          // Framer Motion
          if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) {
            return 'vendor-motion';
          }
          // Radix UI
          if (id.includes('node_modules/@radix-ui')) {
            return 'vendor-radix';
          }
          // MUI — heaviest, isolated
          if (id.includes('node_modules/@mui') || id.includes('node_modules/@emotion')) {
            return 'vendor-mui';
          }
          // Recharts + barcha d3-* sub-paketlar — HAMMASI bitta chunk'da bo'lishi shart
          if (
            id.includes('node_modules/recharts') ||
            id.includes('node_modules/d3-') ||
            id.includes('node_modules/d3/') ||
            id.includes('node_modules/victory-vendor') ||
            id.includes('node_modules/internmap') ||
            id.includes('node_modules/robust-predicates') ||
            id.includes('node_modules/lodash') ||
            id.includes('node_modules/decimal.js-light') ||
            id.includes('node_modules/react-smooth') ||
            id.includes('node_modules/fast-equals') ||
            id.includes('node_modules/recharts-scale')
          ) {
            return 'vendor-charts';
          }
          // Faqat lazy sahifalar ishlatadigan og'ir kutubxonalar — umumiy 'vendor'ga
          // qo'shilsa, u har sahifada oldindan yuklanib qoladi (tezlikni pasaytiradi).
          if (id.includes('node_modules/leaflet')) return 'vendor-leaflet';
          if (id.includes('node_modules/jsqr') || id.includes('node_modules/qrcode') || id.includes('node_modules/dijkstrajs') || id.includes('node_modules/pngjs')) return 'vendor-qr';
          // Socket.io
          if (id.includes('node_modules/socket.io-client') || id.includes('node_modules/engine.io')) {
            return 'vendor-socket';
          }
          // i18n
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) {
            return 'vendor-i18n';
          }
          // Other large vendors
          if (id.includes('node_modules/sonner')) return 'vendor-toast';
          // 3D (AI ofis) — faqat lazy OfficeScene ishlatadi; umumiy 'vendor'ga tushsa har sahifada yuklanadi
          if (/node_modules\/(three|three-stdlib|@react-three|troika-[^/]+|@monogrid|maath|meshline|camera-controls|zustand|its-fine|suspend-react|react-reconciler|react-use-measure|@use-gesture|detect-gpu|hls\.js|stats-gl|stats\.js|tunnel-rat|webgl-constants|webgl-sdf-generator|bidi-js|@mediapipe|three-mesh-bvh|@dimforge|lil-gui)\//.test(id)) return 'vendor-three';
          // Vite'ning dinamik import yordamchisi — doim oldindan yuklanadigan 'vendor'da (aks holda Rollup uni
          // tasodifiy chunk'ga, masalan 842 KB'lik vendor-three'ga qo'yib, uni ham startda yuklatadi).
          if (id.includes('vite/preload-helper')) return 'vendor';
          // Native ko'priklar (Capacitor/Tauri) — kodda FAQAT dinamik import qilinadi (platform.ts, background.ts…);
          // umumiy 'vendor'ga tushsa, brauzerda ham har sahifada oldindan yuklanardi (~150 KB). Rollup o'zi bo'ladi.
          if (/node_modules\/(@capacitor\/|@tauri-apps\/|capacitor-native-biometric\/)/.test(id)) return undefined;
          // Remaining node_modules
          if (id.includes('node_modules')) return 'vendor';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  server: {
    port: 5173,
    host: true,
    // Lokal ishlab chiqishda API va socket SHU manzildan so'raladi va bu yerda
    // backendga uzatiladi. Sabab: ilova endi API'ni sahifaning O'Z manzilidan
    // so'raydi (prodda buni Cloudflare Worker uzatadi) — dev'da ham xuddi
    // shunday bo'lmasa, so'rovlar 5173 ga borib yo'qolardi. Shu proksi tufayli
    // dev va prod bir xil yo'ldan yuradi, demak dev'da ishlagan narsa prodda ham ishlaydi.
    proxy: Object.fromEntries(
      ['/api', '/socket.io', '/uploads', '/files', '/health', '/webhook'].map((p) => [
        p,
        { target: process.env.VITE_DEV_BACKEND || 'http://localhost:5000', changeOrigin: true, ws: p === '/socket.io' },
      ]),
    ),
  },
}))
