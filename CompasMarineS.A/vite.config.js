import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cambiamos el target a tu nueva URL de cPanel
const apiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET || 'https://compasmarinenotificaciones.com/backendapi/'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: true
      }
    }
  }
})