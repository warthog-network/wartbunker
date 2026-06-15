/** Browser stub for Node's `vm` module (used by asn1.js via crypto-browserify). */
export function runInThisContext(code) {
  return (0, eval)(code);
}

export default { runInThisContext };