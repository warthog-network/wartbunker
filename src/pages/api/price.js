export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=warthog&vs_currencies=usd',
      {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'WartBunker/1.0'
        }
      }
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch price', usd: null }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    const price = data?.warthog?.usd ?? null;

    return new Response(JSON.stringify({
      usd: price,
      timestamp: Date.now()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30'
      }
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Timeout', usd: null }), {
        status: 408,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ error: 'Upstream error', usd: null }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
