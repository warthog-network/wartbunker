export async function GET({ request }) {
  const url = new URL(request.url);
  const nodePath = url.searchParams.get('nodePath');
  const nodeBase = url.searchParams.get('nodeBase');
  if (!nodePath || !nodeBase) {
    return new Response('Missing params', { status: 400 });
  }
  const targetUrl = nodeBase.replace(/\/$/, '') + '/' + nodePath.replace(/^\//, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout
  try {
    const response = await fetch(targetUrl, { signal: controller.signal, headers: { 'Cache-Control': 'no-cache' } });
    clearTimeout(timeoutId);
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Cache-Control', 'no-cache');
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return new Response('Request timeout', { status: 408 });
    }
    // For other fetch errors (network, invalid URL, etc.)
    return new Response('Upstream fetch failed', { status: 502 });
  }
}

export async function POST({ request }) {
  const url = new URL(request.url);
  const nodePath = url.searchParams.get('nodePath');
  const nodeBase = url.searchParams.get('nodeBase');
  if (!nodePath || !nodeBase) {
    return new Response('Missing params', { status: 400 });
  }
  const targetUrl = nodeBase.replace(/\/$/, '') + '/' + nodePath.replace(/^\//, '');
  const body = await request.text();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout
  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return new Response('Request timeout', { status: 408 });
    }
    // For other fetch errors (network, invalid URL, etc.)
    return new Response('Upstream fetch failed', { status: 502 });
  }
}
