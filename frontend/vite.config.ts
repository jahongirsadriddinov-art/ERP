import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

// Ilova o'zining versiyasini bilishi uchun (App.tsx'dagi yangilanish
// tekshiruvi, backend/src/routes/deploy.ts GET /latest bilan solishtiradi).
const pkgVersion = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version


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

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  plugins: [
    figmaAssetResolver(),
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
          if (id.includes('node_modules/date-fns')) return 'vendor-date';
          if (id.includes('node_modules/sonner')) return 'vendor-toast';
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
  },
})
