import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS=1 exposes the dev server on the LAN with a self-signed certificate:
// phones only allow microphone access on secure origins.
const https = process.env.HTTPS === '1';
const apiTarget = `http://localhost:${process.env.PORT ?? '8787'}`;

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(https ? [basicSsl()] : [])],
  server: {
    host: https ? true : 'localhost',
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  preview: {
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
});
