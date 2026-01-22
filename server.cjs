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

// In dev mode (with Vite), use port 3001 for API proxy
// Vite runs on 3000 and proxies /api/* to 3001
const PORT = parseInt(process.argv[2]) || 3001;
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
      // Log which controlnets are included (SDXL style)
      const controlnets = ['control_image_url', 'canny_image_url', 'segmentation_image_url', 'depth_image_url', 'openpose_image_url'];
      const included = controlnets.filter(k => parsed[k]);
      logMsg.push(`[fal.ai] ControlNets (SDXL): ${included.length > 0 ? JSON.stringify(included) : 'none'}`);
      // Log FLUX easycontrols
      if (parsed.easycontrols && Array.isArray(parsed.easycontrols)) {
        const controls = parsed.easycontrols.map(c => ({
          method: c.control_method_url,
          type: c.image_control_type,
          hasImage: !!c.image_url,
          imageLen: c.image_url?.length || 0
        }));
        logMsg.push(`[fal.ai] easycontrols: ${JSON.stringify(controls)}`);
      }
      // Log image_url size and image_size parameter
      logMsg.push(`[fal.ai] image_url length: ${parsed.image_url?.length || 0}`);
      logMsg.push(`[fal.ai] image_size: ${JSON.stringify(parsed.image_size)}`);
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
        // Log response details
        try {
          const respJson = JSON.parse(responseData);
          if (respJson.images?.[0]) {
            const img = respJson.images[0];
            console.log(`[fal.ai] Response: ${img.width}x${img.height}, url length: ${img.url?.length || 0}`);
            fs.appendFileSync(path.join(__dirname, 'fal-debug.log'),
              `[fal.ai] Response: ${img.width}x${img.height}\n`);
          }
        } catch (e) { /* ignore parse errors */ }

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

  // Upload image to fal.ai CDN (must be before general /api/fal/ handler)
  if (req.url === '/api/fal/upload' && req.method === 'POST') {
    if (!FAL_API_KEY) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'FAL_API_KEY not configured in .env' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { dataUrl, filename, contentType } = JSON.parse(body);

        // Step 1: Initiate upload to get presigned URL
        const initiateRes = await new Promise((resolve, reject) => {
          const postData = JSON.stringify({
            content_type: contentType || 'image/png',
            file_name: filename || 'image.png'
          });

          const options = {
            hostname: 'rest.alpha.fal.ai',
            port: 443,
            path: '/storage/upload/initiate?storage_type=fal-cdn-v3',
            method: 'POST',
            headers: {
              'Authorization': `Key ${FAL_API_KEY}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              if (res.statusCode === 200) {
                resolve(JSON.parse(data));
              } else {
                reject(new Error(`Initiate failed: ${res.statusCode} ${data}`));
              }
            });
          });
          req.on('error', reject);
          req.write(postData);
          req.end();
        });

        console.log('[fal upload] Got presigned URL:', initiateRes.file_url);

        // Step 2: Extract binary data from data URL
        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const binaryData = Buffer.from(base64Data, 'base64');

        // Step 3: Upload to presigned URL
        const uploadUrl = new URL(initiateRes.upload_url);
        await new Promise((resolve, reject) => {
          const options = {
            hostname: uploadUrl.hostname,
            port: 443,
            path: uploadUrl.pathname + uploadUrl.search,
            method: 'PUT',
            headers: {
              'Content-Type': contentType || 'image/png',
              'Content-Length': binaryData.length
            }
          };

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve();
              } else {
                reject(new Error(`Upload failed: ${res.statusCode} ${data}`));
              }
            });
          });
          req.on('error', reject);
          req.write(binaryData);
          req.end();
        });

        console.log('[fal upload] Upload complete:', initiateRes.file_url);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: initiateRes.file_url }));
      } catch (err) {
        console.error('[fal upload] Error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Proxy fal.ai API calls (uses server-side API key from .env)
  if (req.url.startsWith('/api/fal/')) {
    const apiPath = '/' + req.url.replace('/api/fal/', '');
    return proxyToFal(req, res, apiPath);
  }

  // Save image to output folder
  if (req.url === '/api/save-image' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filename, dataUrl } = JSON.parse(body);
        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        // Extract base64 data and save as PNG
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        const filePath = path.join(outputDir, filename);
        fs.writeFileSync(filePath, base64Data, 'base64');
        console.log(`[save] Saved image: ${filePath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: filePath }));
      } catch (err) {
        console.error('[save] Error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
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
