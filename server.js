#!/usr/bin/env node
/**
 * Small Gods - Development Server
 *
 * HTTP server with API proxies for Replicate and fal.ai
 * Usage: node server.js [port]
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

const PORT = parseInt(process.argv[2]) || 3000;
const FAL_API_KEY = process.env.FAL_API_KEY;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Proxy request to Replicate API
function proxyToReplicate(req, res, apiPath) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const options = {
      hostname: 'api.replicate.com',
      port: 443,
      path: apiPath,
      method: req.method,
      headers: {
        'Authorization': req.headers.authorization || '',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}

// Proxy request to fal.ai API (uses server-side API key)
function proxyToFal(req, res, apiPath) {
  if (!FAL_API_KEY) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'FAL_API_KEY not configured in .env' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const bodySize = Buffer.byteLength(body);
    const options = {
      hostname: 'fal.run',
      port: 443,
      path: apiPath,
      method: req.method,
      headers: {
        'Authorization': `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': bodySize
      }
    };

    const logMsg = [];
    logMsg.push(`[fal.ai] ${req.method} ${apiPath}`);
    logMsg.push(`[fal.ai] Request body size: ${(bodySize / 1024 / 1024).toFixed(2)} MB`);

    // Log request keys (not the full body which is huge)
    try {
      const parsed = JSON.parse(body);
      logMsg.push(`[fal.ai] Request keys: ${JSON.stringify(Object.keys(parsed))}`);
      // Log which controlnets are included
      const controlnets = ['canny_image_url', 'segmentation_image_url', 'depth_image_url', 'openpose_image_url'];
      const included = controlnets.filter(k => parsed[k]);
      logMsg.push(`[fal.ai] ControlNets included: ${included.length > 0 ? JSON.stringify(included) : 'none'}`);
      // Check segmentation specifically
      logMsg.push(`[fal.ai] segmentation_image_url present: ${!!parsed.segmentation_image_url}`);
      logMsg.push(`[fal.ai] segmentation_image_url length: ${parsed.segmentation_image_url?.length || 0}`);
    } catch (e) {
      logMsg.push(`[fal.ai] Could not parse request body`);
    }

    // Write to log file AND console
    const logOutput = logMsg.join('\n');
    console.log(logOutput);
    fs.appendFileSync(path.join(__dirname, 'fal-debug.log'), logOutput + '\n---\n');

    const proxyReq = https.request(options, (proxyRes) => {
      let responseData = '';
      proxyRes.on('data', chunk => responseData += chunk);
      proxyRes.on('end', () => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(responseData);
      });
    });

    proxyReq.on('error', (e) => {
      console.error('[fal.ai] Error:', e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}

const server = http.createServer((req, res) => {
  // Enable CORS for API calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Proxy Replicate API calls
  if (req.url.startsWith('/api/replicate/')) {
    const apiPath = req.url.replace('/api/replicate', '');
    return proxyToReplicate(req, res, apiPath);
  }

  // Proxy fal.ai API calls (uses server-side API key from .env)
  if (req.url.startsWith('/api/fal/')) {
    const apiPath = '/' + req.url.replace('/api/fal/', '');
    return proxyToFal(req, res, apiPath);
  }

  let filePath = req.url === '/' ? '/index.html' : req.url;

  // Try public folder first, then root
  let fullPath = path.join(__dirname, 'public', filePath);
  if (!fs.existsSync(fullPath)) {
    fullPath = path.join(__dirname, filePath);
  }

  // Also serve from output folder
  if (!fs.existsSync(fullPath) && filePath.startsWith('/output')) {
    fullPath = path.join(__dirname, filePath);
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║       SMALL GODS - Development Server      ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  🌍 http://localhost:${PORT}                   ║`);
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
  console.log('Press Ctrl+C to stop');
});
