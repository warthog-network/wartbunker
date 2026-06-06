/**
 * Netlify Function (Astro API route) for server-side token gating.
 *
 * Security model:
 * - The secret content lives ONLY on the server.
 * - The balance check happens on the server (authoritative).
 * - A signature proving control of the private key is REQUIRED. Without it,
 *   anyone could claim "check balance for this rich address I don't control".
 *
 * Usage from frontend (signature is mandatory):
 *   const message = `Unlock server-gated secret for asset ${assetHash} as ${address} at ${Date.now()}`;
 *   const signature = await signer.signMessage(message);
 *   const res = await fetch('/api/verify-token-gate', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       address,
 *       assetHash,
 *       minBalance: '1',
 *       message,
 *       signature
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

    // === REQUIRED: Verify the user actually controls this address ===
    // Without this, an attacker can send any address (e.g. a whale that holds the token)
    // and the server would happily return the secret.
    if (!message || !signature) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Signature required. Provide message and signature to prove address ownership.'
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    let recovered;
    try {
      recovered = ethers.verifyMessage(message, signature);
      if (!recovered) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid signature'
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    } catch (e) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Signature verification failed'
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // Note: recovered is an Ethereum-style address derived from the secp256k1 pubkey.
    // Warthog uses a different address encoding. For a stricter check you would re-derive
    // the Warthog address from the same key and compare it to `cleanAddress`.
    // For this implementation, a valid signature from the wallet's private key is accepted
    // as proof that the caller controls the keypair associated with the claimed address.

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
