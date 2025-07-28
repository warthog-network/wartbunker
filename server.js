import express from 'express';
import https from 'https';
import fetch from 'node-fetch'; // Remove if using Node 18+ native fetch

const app = express();
app.use(express.json());

const agent = new https.Agent({
  rejectUnauthorized: false,
});

app.get('/', async (req, res) => {
  try {
    const nodePath = req.query.nodePath;
    const nodeBase = req.query.nodeBase || process.env.NODE_BASE || 'https://node.wartscan.io';
    if (!nodePath) {
      return res.status(400).json({ error: 'Missing nodePath query parameter' });
    }
    const targetUrl = `${nodeBase}/${nodePath}`;
    const response = await fetch(targetUrl, {
      headers: { 'Content-Type': 'application/json' },
      agent: targetUrl.startsWith('https') ? agent : undefined,
    });
    const data = await response.text();
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(response.status).send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/', async (req, res) => {
  try {
    const nodePath = req.query.nodePath;
    const nodeBase = req.query.nodeBase || process.env.NODE_BASE || 'https://node.wartscan.io';
    if (!nodePath) {
      return res.status(400).json({ error: 'Missing nodePath query parameter' });
    }
    const body = req.body;
    const targetUrl = `${nodeBase}/${nodePath}`;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      agent: targetUrl.startsWith('https') ? agent : undefined,
    });
    const data = await response.text();
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(response.status).send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.options('/', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(204).send();
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});