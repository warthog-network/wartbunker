/**
 * Minimal Netlify Function (Astro API route) for server-side token gating.
 *
 * This is the key difference from pure frontend:
 * - The secret content lives ONLY on the server.
 * - The balance check happens on the server (authoritative).
 * - The client never receives the secret unless the server says the wallet holds the required token.
 *
 * Usage from frontend:
 *   const res = await fetch('/api/verify-token-gate', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       address: wallet.address,
 *       assetHash: 'b92b88...',
 *       minBalance: '1',
 *       // Optional but recommended:
 *       message: 'I own this address and want to unlock the gated content',
 *       signature: '0x...' // signature of the message by the wallet
 *     })
 *   });
 */

import { ethers } from 'ethers';

const DEFAULT_NODE = 'https://warthognode.duckdns.org';

// The secret is never sent to the browser unless the check passes.
// For production, set this in Netlify Dashboard → Environment variables → GATED_SECRET
const SECRET_CONTENT = process.env.GATED_SECRET || 
  "Congratulations — this content came from the server after a successful on-chain balance check.\n\n" +
  "In a real app this could be:\n" +
  "- A private download link\n" +
  "- A member-only API key\n" +
  "- Encrypted data that the server also returns the key for\n" +
  "- Access to a real-time feature\n\n" +
  "The important part: this string was never present in the frontend JavaScript bundle.";

export async function POST({ request }) {
  try {
    const body = await request.json();
    const { address, assetHash, minBalance = '1', nodeBase, message, signature } = body;

    if (!address || !assetHash) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Missing address or assetHash' 
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const cleanAddress = address.toLowerCase().replace(/^0x/, '');
    const cleanAsset = assetHash.toLowerCase().replace(/^0x/, '');
    const node = nodeBase || DEFAULT_NODE;

    // === OPTIONAL: Verify the user actually controls this address ===
    // This prevents someone from just asking "does any address hold the token?"
    // and getting the secret for a rich address they don't control.
    if (message && signature) {
      try {
        const recovered = ethers.verifyMessage(message, signature);
        // Warthog addresses are not 0x-prefixed Ethereum style, but we can still verify control.
        // For simplicity we check that the recovered address (when treated as ETH) matches in spirit,
        // or we just trust that the client signed with the private key it holds.
        // In a stricter version you would derive the Warthog address from the public key and compare.
        if (!recovered) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'Invalid signature' 
          }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        // For this demo we accept any valid signature format as proof of key control.
      } catch (e) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Signature verification failed' 
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // === Server-side balance check (authoritative) ===
    // We call the Warthog node directly from the serverless function.
    const balanceUrl = `${node.replace(/\/$/, '')}/account/${cleanAddress}/balance/asset:${cleanAsset}`;

    const nodeRes = await fetch(balanceUrl, {
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!nodeRes.ok) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to query node' 
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const nodeData = await nodeRes.json();
    const data = nodeData?.data || nodeData;

    const balanceInfo = data?.balance?.total || data?.balance || {};
    let balanceStr = '0';

    if (balanceInfo.str) {
      balanceStr = balanceInfo.str;
    } else if (balanceInfo.u64 !== undefined) {
      // We don't know decimals here, so we do a rough parse.
      // For production you'd want to also fetch the asset metadata for correct decimals.
      balanceStr = (Number(balanceInfo.u64) / 1e8).toFixed(8);
    } else if (balanceInfo.E8 !== undefined) {
      balanceStr = (Number(balanceInfo.E8) / 1e8).toFixed(8);
    }

    const balanceNum = parseFloat(balanceStr);
    const minNum = parseFloat(minBalance);

    const hasAccess = balanceNum >= minNum;

    if (hasAccess) {
      // Success — return the secret that was never in the frontend
      return new Response(JSON.stringify({
        success: true,
        balance: balanceStr,
        secret: SECRET_CONTENT,
        // You could also return a short-lived signed URL, an encrypted blob + key, etc.
        servedAt: new Date().toISOString()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        balance: balanceStr,
        error: `Insufficient balance. Need at least ${minBalance}, have ${balanceStr}`,
        requiredAsset: cleanAsset
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (err) {
    console.error('Token gate verification error:', err);
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Internal error during gate check' 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
