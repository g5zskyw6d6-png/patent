import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/epo/auth': {
        target: 'https://ops.epo.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/epo\/auth/, '/3.2/auth'),
      },
      '/api/epo': {
        target: 'https://ops.epo.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/epo/, '/3.2/rest-services'),
      },
    }
  }
})
