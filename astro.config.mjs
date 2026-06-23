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
    "connect-src 'self' http: https: ws: wss:",
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
    worker: {
      format: 'es',
    },
    define: {
      global: 'globalThis',
      'process.env': {},
    },
    resolve: {
      alias: {
        // Absolute paths so file:-linked warthog-js resolves crypto shims correctly
        crypto: path.resolve(projectRoot, 'node_modules/crypto-browserify'),
        stream: path.resolve(projectRoot, 'node_modules/stream-browserify'),
        buffer: path.resolve(projectRoot, 'node_modules/buffer'),
        process: path.resolve(projectRoot, 'src/shims/process.js'),
        vm: path.resolve(projectRoot, 'node_modules/vm-browserify'),
        '@': path.resolve(projectRoot, 'src'),
        // Workers ignore package "browser" fields — force ethers to use @noble/hashes shims.
        [path.resolve(projectRoot, 'node_modules/ethers/lib.esm/crypto/crypto.js')]: path.resolve(
          projectRoot,
          'node_modules/ethers/lib.esm/crypto/crypto-browser.js',
        ),
      },
    },
    optimizeDeps: {
      include: ['buffer', 'warthog-js', 'crypto-browserify', 'elliptic', 'ethers'],
    },
    ssr: {
      external: ['warthog-js', 'buffer', 'elliptic', 'crypto-browserify'],
      noExternal: [],
    },

    plugins: [tailwindcss(), devCspOverride()],
  },
});