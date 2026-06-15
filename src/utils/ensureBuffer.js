/** Browser polyfills required by warthog-js and its crypto deps. */
export async function ensureBuffer() {
  if (typeof globalThis.global === 'undefined') {
    globalThis.global = globalThis;
  }

  if (typeof globalThis.process === 'undefined') {
    const processShim = await import('process');
    globalThis.process = processShim.default ?? processShim;
  }

  if (typeof globalThis.Buffer === 'undefined') {
    const { Buffer } = await import('buffer');
    globalThis.Buffer = Buffer;
  }
}