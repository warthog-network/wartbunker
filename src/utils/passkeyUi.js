/**
 * Paint helpers for passkey UX.
 * WebAuthn prompts can take a moment; flush React state and yield a frame so
 * spinners appear immediately on click before navigator.credentials.* blocks.
 */

import { flushSync } from 'react-dom';

/**
 * Force React to commit waiting state(s), then wait until the browser can paint.
 * @param  {...(function(boolean): void)} setters  e.g. setAwaitingPasskey, setIsBusy
 */
export async function paintPasskeyWaiting(...setters) {
  const list = setters.filter((s) => typeof s === 'function');
  if (list.length) {
    flushSync(() => {
      for (const set of list) set(true);
    });
  }
  // Double rAF: after layout + paint. Fallback to timeout if rAF unavailable.
  await new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    } else {
      setTimeout(resolve, 16);
    }
  });
}

export function clearPasskeyWaiting(...setters) {
  for (const set of setters) {
    if (typeof set === 'function') set(false);
  }
}
