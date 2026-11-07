import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/dashboard/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'out',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:7860',
      '/status': 'http://localhost:7860',
      '/stream': 'http://localhost:7860',
    }
  }
})
