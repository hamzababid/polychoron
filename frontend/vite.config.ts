import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // The browser always talks to localhost:5173 (the published
    // port) — this proxy target is a server-to-server call made by
    // the Vite dev server process itself, so inside Docker it needs
    // the app-api *service* name, not localhost. Set by
    // infra/docker-compose.yml; falls back to localhost for running
    // `npm run dev` directly on the host.
    proxy: {
      '/api': process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
    },
  },
})
