const fetch = require('node-fetch');
const { buildSafeProxyTarget } = require('./proxyTargetGuards.cjs');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-cache',
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const { httpMethod, queryStringParameters = {}, body } = event;

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (httpMethod !== 'GET' && httpMethod !== 'POST') {
    return jsonResponse(405, { code: 1, error: 'Method Not Allowed' });
  }

  const nodePath = queryStringParameters.nodePath;
  const nodeBase =
    queryStringParameters.nodeBase || process.env.NODE_BASE || 'https://node.wartscan.io';

  const safe = buildSafeProxyTarget(nodeBase, nodePath);
  if (!safe.ok) {
    return jsonResponse(safe.status, { code: 1, error: safe.error });
  }

  const targetUrl = safe.targetUrl;

  try {
    const fetchOptions = {
      method: httpMethod,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      // TLS verification ON (no rejectUnauthorized: false)
      timeout: 10000,
    };

    if (httpMethod === 'POST' && body) {
      fetchOptions.body = body;
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();
    return {
      statusCode: response.status,
      headers: CORS_HEADERS,
      body: data,
    };
  } catch (err) {
    console.error(`[${httpMethod}] Proxy error:`, err.message);
    return jsonResponse(502, {
      code: 1,
      error: `Upstream fetch failed: ${err.message || 'network error'}`,
    });
  }
};
