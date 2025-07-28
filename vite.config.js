import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/proxy': {
        target: 'http://localhost:5173/.netlify/functions',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/proxy/, '/proxy'),
      },
    },
  },
});