export function stripPrivateKey(wallet) {
  if (!wallet) return null;
  const { address, publicKey } = wallet;
  return address ? { address, publicKey } : null;
}

export function persistPublicSession(wallet, walletName = null) {
  const publicWallet = stripPrivateKey(wallet);
  if (!publicWallet) return null;

  try {
    sessionStorage.setItem('warthogWalletDecrypted', JSON.stringify(publicWallet));
    if (walletName) {
      sessionStorage.setItem('warthogCurrentWalletName', walletName);
    } else {
      sessionStorage.removeItem('warthogCurrentWalletName');
    }
    sessionStorage.removeItem('warthogSigningUnlocked');
  } catch {
    // ignore storage errors
  }

  return publicWallet;
}

export function readPublicSession() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const saved = sessionStorage.getItem('warthogWalletDecrypted');
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    return stripPrivateKey(parsed);
  } catch {
    return null;
  }
}

export function clearWalletSession() {
  try {
    sessionStorage.removeItem('warthogWalletDecrypted');
    sessionStorage.removeItem('warthogCurrentWalletName');
    sessionStorage.removeItem('warthogSigningUnlocked');
  } catch {
    // ignore storage errors
  }
}