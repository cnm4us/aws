import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Build into public/app without wiping the whole public directory
export default defineConfig({
  root: path.resolve(__dirname),
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../public/app'),
    emptyOutDir: false,
  },
})
