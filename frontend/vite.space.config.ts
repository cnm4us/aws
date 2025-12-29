import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname, 'space'),
  base: '/space-app/',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../public/space-app'),
    emptyOutDir: false,
  },
})

