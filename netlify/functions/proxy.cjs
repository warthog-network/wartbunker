const https = require('https');
const fetch = require('node-fetch');

const agent = new https.Agent({
  rejectUnauthorized: false,
});

const isFakeMineNodePath = (nodePath) =>
  /^debug\/fakemine(?:\/|$)/i.test(String(nodePath || '').replace(/^\//, ''));

const isFakeMineAllowed = (node) => {
  if (!node) return false;
  try {
    const host = new URL(node).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    const n = String(node).toLowerCase();
    return n.includes('localhost') || n.includes('127.0.0.1');
  }
};

exports.handler = async (event, context) => {
  const { httpMethod, queryStringParameters, body } = event;
  const nodePath = queryStringParameters.nodePath;
  const nodeBase = queryStringParameters.nodeBase || process.env.NODE_BASE || 'https://node.wartscan.io';

  if (!nodePath) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing nodePath query parameter' }) };
  }

  if (isFakeMineNodePath(nodePath) && !isFakeMineAllowed(nodeBase)) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        code: 1,
        error: 'Fake mining is disabled for remote nodes. Use a local node (localhost) for dev mining.',
      }),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  }

  const targetUrl = `${nodeBase}/${nodePath}`;

  try {
    if (httpMethod === 'GET') {
      const response = await fetch(targetUrl, {
        headers: { 'Content-Type': 'application/json' },
        agent: targetUrl.startsWith('https') ? agent : undefined,
      });
      const data = await response.text();
      return {
        statusCode: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
        body: data,
      };
    } else if (httpMethod === 'POST') {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        agent: targetUrl.startsWith('https') ? agent : undefined,
      });
      const data = await response.text();
      return {
        statusCode: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
        body: data,
      };
    } else if (httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      };
    }
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    console.error(`[${httpMethod}] Proxy error:`, err.message, err.stack);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};