// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cspGuard from 'vite-plugin-csp-guard'; // New import

export default defineConfig({
  plugins: [
    react(),
    cspGuard({ // New plugin
      algorithm: 'sha256',
      dev: { run: true },
      policy: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src-elem': ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        'font-src': ["'self'", "data:", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
        'img-src': ["'self'", "data:"],
      },
    }),
  ],
  html: { // New optional nonce
    cspNonce: 'your-static-nonce',
  },
  build: { // New optional to disable inlining
    assetsInlineLimit: 0,
  },
  server: {
    proxy: {
      '/api/proxy': {
        target: 'http://localhost:8888/.netlify/functions',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/proxy/, '/proxy'),
      },
    },
    headers: { // New headers for dev
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com;",
    },
  },
});