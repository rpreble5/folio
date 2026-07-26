import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Relative asset paths for the production build, so the same output works at
  // the root during local preview and under /<repo>/ on GitHub Pages — without
  // hardcoding the repo name, which would break on a rename or custom domain.
  base: command === 'build' ? './' : '/',
  server: { port: 5173, host: true },
}))
