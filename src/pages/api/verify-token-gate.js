import { ethers, SigningKey } from 'ethers';
import { deriveWarthogAddress } from '../../utils/warthogWalletUtils.js';

const DEFAULT_NODE = 'https://warthognode.duckdns.org';

const SECRET_CONTENT = process.env.GATED_SECRET
  || 'Congratulations — this content came from the server after a successful on-chain balance check.\n\n'
  + 'In a real app this could be a private download link, API key, or member-only feature.\n\n'
  + 'This string was never present in the frontend JavaScript bundle.';

export async function POST({ request }) {
  try {
    const body = await request.json();
    const { address, assetHash, minBalance = '1', nodeBase, message, signature } = body;

    if (!address || !assetHash) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing address or assetHash',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanAddress = address.toLowerCase().replace(/^0x/, '');
    const cleanAsset = assetHash.toLowerCase().replace(/^0x/, '');
    const node = nodeBase || DEFAULT_NODE;

    if (!message || !signature) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Signature required. Provide message and signature to prove address ownership.',
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    let derivedAddr;
    try {
      ethers.verifyMessage(message, signature);
      const digest = ethers.hashMessage(message);
      const recoveredPub = SigningKey.recoverPublicKey(digest, signature);
      derivedAddr = deriveWarthogAddress(recoveredPub);
    } catch {
      return new Response(JSON.stringify({
        success: false,
        error: 'Signature verification or address derivation failed',
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (!derivedAddr || derivedAddr.toLowerCase() !== cleanAddress) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Signature does not prove ownership of the claimed address',
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const balanceUrl = `${node.replace(/\/$/, '')}/account/${cleanAddress}/balance/asset:${cleanAsset}`;
    const nodeRes = await fetch(balanceUrl, {
      headers: { 'Cache-Control': 'no-cache' },
    });

    if (!nodeRes.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to query node',
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const nodeData = await nodeRes.json();
    const data = nodeData?.data || nodeData;
    const balanceInfo = data?.balance?.total || data?.balance || {};
    let balanceStr = '0';

    if (balanceInfo.str) {
      balanceStr = balanceInfo.str;
    } else if (balanceInfo.u64 !== undefined) {
      balanceStr = (Number(balanceInfo.u64) / 1e8).toFixed(8);
    } else if (balanceInfo.E8 !== undefined) {
      balanceStr = (Number(balanceInfo.E8) / 1e8).toFixed(8);
    }

    const balanceNum = parseFloat(balanceStr);
    const minNum = parseFloat(minBalance);
    const hasAccess = balanceNum >= minNum;

    if (hasAccess) {
      return new Response(JSON.stringify({
        success: true,
        balance: balanceStr,
        secret: SECRET_CONTENT,
        servedAt: new Date().toISOString(),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      balance: balanceStr,
      error: `Insufficient balance. Need at least ${minBalance}, have ${balanceStr}`,
      requiredAsset: cleanAsset,
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Token gate verification error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal error during gate check',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}