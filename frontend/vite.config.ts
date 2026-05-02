import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache'
            proxyRes.headers['x-accel-buffering'] = 'no'
          })
        },
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React framework
          react: ['react', 'react-dom'],
          // Graph visualization libraries (heavy)
          graph: ['react-force-graph-2d'],
          // EPUB reading
          epub: ['epubjs', 'react-reader'],
          // PDF rendering
          pdf: ['pdfjs-dist'],
        },
      },
    },
  },
})
