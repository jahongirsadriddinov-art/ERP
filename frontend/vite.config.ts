import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


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

  // Recharts + d3 circular import muammosini hal qilish:
  // pre-bundle recharts → dev va prod da TDZ xatolarini bartaraf etadi
  optimizeDeps: {
    include: ['recharts'],
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
          // React core
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
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
          // Recharts + barcha d3-* sub-paketlar + victory-vendor — HAMMASI bitta chunk'da
          // bo'lishi shart (ular orasida circular importlar bor; ajratilsa TDZ xatosi kelib chiqadi)
          if (
            id.includes('node_modules/recharts') ||
            id.includes('node_modules/d3-') ||
            id.includes('node_modules/d3/') ||
            id.includes('node_modules/victory-vendor') ||
            id.includes('node_modules/internmap') ||
            id.includes('node_modules/robust-predicates')
          ) {
            return 'vendor-charts';
          }
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
