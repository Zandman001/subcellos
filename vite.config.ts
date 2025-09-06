import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'rpsx',
  // Use relative paths so Tauri can load assets from the dist folder
  // when using the file:// protocol in production builds.
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
