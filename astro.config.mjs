import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import netlify from '@astrojs/netlify';
import path from 'path';
import { fileURLToPath } from 'url';

import tailwindcss from '@tailwindcss/vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** Relaxed CSP for local dev — @astrojs/netlify applies netlify.toml headers via Netlify Dev emulation. */
function devCspOverride() {
  const devCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
  ].join('; ') + ';';

  return {
    name: 'dev-csp-override',
    enforce: 'pre',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => {
          if (typeof name === 'string' && name.toLowerCase() === 'content-security-policy') {
            return setHeader('Content-Security-Policy', devCsp);
          }
          return setHeader(name, value);
        };
        next();
      });
    },
  };
}

// https://astro.build/config
export default defineConfig({
  output: 'server',
  integrations: [react()],
  adapter: netlify({
    functionPerRoute: false,
    cacheOnDemandPages: true,
  }),
  vite: {
    define: {
      global: 'globalThis',
      'process.env': {},
    },
    resolve: {
      alias: {
        crypto: 'crypto-browserify',
        stream: 'stream-browserify',
        buffer: 'buffer',
        process: 'process/browser.js',
        vm: 'vm-browserify',
        '@': '/src',
      },
    },
    optimizeDeps: {
      include: ['buffer', 'process', 'warthog-js'],
    },
    ssr: {
      external: ['warthog-js', 'buffer', 'elliptic'],
    },

    plugins: [tailwindcss(), devCspOverride()],
  },
});