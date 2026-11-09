// NEXORA AI - Optimized Backend
// Requires Node.js 18 or newer

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env file if available
try {
  const envFile = fs.readFileSync('.env', 'utf8');

  for (const line of envFile.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();

    if (key && !process.env[key]) {
      process.env[key] = value.replace(/^["']|["']$/g, '');
    }
  }
} catch (_) {}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_BODY_SIZE = 1024 * 1024;
const MAX_MESSAGES = 30;

function send(res, status, data) {
  if (res.writableEnded) return;

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(data));
}

function getMimeType(file) {
  const ext = path.extname(file).toLowerCase();

  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
  };

  return types[ext] || 'application/octet-stream';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;

      if (size > MAX_BODY_SIZE) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }

      body += chunk.toString('utf8');
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}// Gemini AI connection with timeout and retry

async function gemini(contents) {
  if (!API_KEY) {
    return {
      ok: false,
      status: 500,
      message: 'AI service is not configured.'
    };
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens: 2048
    }
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeout);

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const reply =
          data.candidates?.[0]?.content?.parts
            ?.map(part => part.text || '')
            .join('')
            .trim();

        if (reply) return { ok: true, reply };

        return {
          ok: false,
          status: 502,
          message: 'AI returned an empty response.'
        };
      }

      console.error('[Gemini] API error:', response.status, data);

      if (
        attempt === 0 &&
        (response.status === 429 ||
         response.status === 500 ||
         response.status === 503)
      ) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      return {
        ok: false,
        status: response.status,
        message: data.error?.message || 'Gemini API request failed.'
      };

    } catch (error) {
      clearTimeout(timeout);

      console.error('[Gemini] Connection error:', error.message);

      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      return {
        ok: false,
        status: 502,
        message: 'Could not connect to the AI service.'
      };
    }
  }
}// Chat API

async function chat(req, res) {
  try {
    console.log('[Chat] Request received');

    const body = await readBody(req);
    const parsed = JSON.parse(body);

    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      return send(res, 400, {
        message: 'Please send a valid message.'
      });
    }

    const messages = parsed.messages.slice(-MAX_MESSAGES);

    const contents = messages.map(message => ({
      role: message.role === 'assistant' || message.role === 'model'
        ? 'model'
        : 'user',
      parts: [{
        text: String(message.text || '').slice(0, 12000)
      }]
    })).filter(message => message.parts[0].text.trim());

    if (!contents.length || contents[contents.length - 1].role !== 'user') {
      return send(res, 400, {
        message: 'Please send a user message.'
      });
    }

    const result = await gemini(contents);

    if (!result.ok) {
      return send(res, result.status || 502, {
        message: result.message
      });
    }

    return send(res, 200, {
      reply: result.reply
    });

  } catch (error) {
    console.error('[Chat] Error:', error);

    return send(res, 500, {
      message: 'Something went wrong. Please try again.'
    });
  }
}

// Static website files

async function serveStatic(req, res) {
  let requestedPath;

  try {
    requestedPath = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname
    );
  } catch (_) {
    return send(res, 400, { message: 'Invalid URL.' });
  }

  if (requestedPath === '/') requestedPath = '/index.html';

  const filePath = path.resolve(PUBLIC_DIR, '.' + requestedPath);

  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, { message: 'Access denied.' });
  }

  try {
    const data = await fs.promises.readFile(filePath);

    res.writeHead(200, {
      'Content-Type': getMimeType(filePath),
      'Cache-Control': 'no-cache'
    });

    res.end(data);
  } catch (_) {
    send(res, 404, { message: 'File not found.' });
  }
}

// Main server

const server = http.createServer(async (req, res) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);

  if (req.method === 'GET' && req.url === '/api/health') {
    return send(res, 200, {
      ok: true,
      configured: Boolean(API_KEY),
      model: MODEL
    });
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    return chat(req, res);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res);
  }

  return send(res, 405, {
    message: 'Method not allowed.'
  });
});

server.listen(PORT, HOST, () => {
  console.log('================================');
  console.log('       NEXORA AI ONLINE');
  console.log('================================');
  console.log(`Port: ${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(`API key: ${API_KEY ? 'Configured' : 'MISSING'}`);
  console.log('Server ready.');
});

server.on('error', error => {
  console.error('[Server] Fatal error:', error);
});
