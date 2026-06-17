/** Browser polyfills required by warthog-js and its crypto deps. */
export async function ensureBuffer() {
  if (typeof globalThis.global === 'undefined') {
    globalThis.global = globalThis;
  }

  if (typeof globalThis.process === 'undefined') {
    if (typeof process !== 'undefined') {
      globalThis.process = process;
    } else {
      const processShim = await import('../shims/process.js');
      globalThis.process = processShim.default ?? processShim;
    }
  }

  if (typeof globalThis.Buffer === 'undefined') {
    if (typeof Buffer !== 'undefined') {
      globalThis.Buffer = Buffer;
    } else {
      const { Buffer: BufferPolyfill } = await import('buffer');
      globalThis.Buffer = BufferPolyfill;
    }
  }
}