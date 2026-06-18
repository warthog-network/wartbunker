import { rejectFakeMineIfRemote, rejectLocalNodeInProxy } from '../../utils/proxyGuards.js';

async function forwardToNode({ nodeBase, nodePath, method = 'GET', body = null }) {
  if (!nodePath || !nodeBase) {
    return new Response('Missing params', { status: 400 });
  }

  const localNodeRejection = rejectLocalNodeInProxy(nodeBase);
  if (localNodeRejection) {
    return new Response(localNodeRejection.body, {
      status: localNodeRejection.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const fakeMineRejection = rejectFakeMineIfRemote(nodePath, nodeBase);
  if (fakeMineRejection) {
    return new Response(fakeMineRejection.body, {
      status: fakeMineRejection.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const targetUrl = nodeBase.replace(/\/$/, '') + '/' + nodePath.replace(/^\//, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const fetchOptions = {
    method,
    signal: controller.signal,
    headers: { 'Cache-Control': 'no-cache' },
  };

  if (method !== 'GET' && method !== 'HEAD' && body != null) {
    fetchOptions.body = body;
    fetchOptions.headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeoutId);
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Cache-Control', 'no-cache');
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return new Response('Request timeout', { status: 408 });
    }
    return new Response('Upstream fetch failed', { status: 502 });
  }
}

export async function GET({ request }) {
  const url = new URL(request.url);
  return forwardToNode({
    nodeBase: url.searchParams.get('nodeBase'),
    nodePath: url.searchParams.get('nodePath'),
    method: 'GET',
  });
}

export async function POST({ request }) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const envelope = await request.json();
      if (envelope?.nodeBase && envelope?.nodePath != null) {
        const forwardBody = envelope.body != null
          ? JSON.stringify(envelope.body)
          : null;
        return forwardToNode({
          nodeBase: envelope.nodeBase,
          nodePath: envelope.nodePath,
          method: envelope.method || 'GET',
          body: forwardBody,
        });
      }
    } catch {
      // fall through to legacy query-param POST
    }
  }

  const url = new URL(request.url);
  const nodePath = url.searchParams.get('nodePath');
  const nodeBase = url.searchParams.get('nodeBase');
  if (!nodePath || !nodeBase) {
    return new Response('Missing params', { status: 400 });
  }

  const body = await request.text();
  return forwardToNode({
    nodeBase,
    nodePath,
    method: 'POST',
    body: body || null,
  });
}