import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/session': { target: 'ws://localhost:4000', ws: true },
      '/rdp-session': { target: 'ws://localhost:4000', ws: true },
      '/ssh-direct-session': { target: 'ws://localhost:4000', ws: true },
      '/db-session': { target: 'ws://localhost:4000', ws: true },
      '/watch-session': { target: 'ws://localhost:4000', ws: true },
    },
  },
})
