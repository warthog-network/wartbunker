/**
 * Copy text to the clipboard with Clipboard API + legacy fallback.
 * Returns true when the write likely succeeded.
 */
export async function copyTextToClipboard(text) {
  const value = text == null ? '' : String(text);
  if (!value) return false;

  // Preferred: async Clipboard API (secure contexts: https / localhost)
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to execCommand path
  }

  // Fallback: temporary textarea + document.execCommand('copy')
  // Works in more HTTP / older-browser cases when triggered from a user gesture.
  if (typeof document === 'undefined') return false;

  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.padding = '0';
  ta.style.border = 'none';
  ta.style.outline = 'none';
  ta.style.boxShadow = 'none';
  ta.style.background = 'transparent';
  ta.style.opacity = '0';

  document.body.appendChild(ta);

  let ok = false;
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(ta);
  }

  return ok;
}
