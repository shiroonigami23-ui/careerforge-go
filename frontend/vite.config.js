import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  build: {
    outDir: '../cmd/careerforge/web/dist',
    emptyOutDir: true,
  },
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setupTests.js',
    globals: true,
    css: true,
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
  },
})
