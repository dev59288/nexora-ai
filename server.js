// NEXORA AI backend — no npm packages needed (Node 18+). The API key stays here, never in the browser.
const http = require('http'), fs = require('fs'), path = require('path');
try { // tiny .env loader
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const PORT = +process.env.PORT || 3000, HOST = process.env.HOST || '127.0.0.1';
const PER_MIN = +process.env.RATE_PER_MIN || 10;   // per visitor
const DAILY = +process.env.DAILY_LIMIT || 300;     // total per day, protects your free quota
const SYS = `You are NEXORA, a helpful, accurate assistant. Reply in the language the user writes in: English, Hindi (Devanagari) or Hinglish (Hindi in Latin letters) — match their script. Be clear and concise, use short paragraphs and light markdown only. If you are unsure, say so instead of inventing facts. For medical, legal or financial questions give general information and suggest a qualified professional.`;
const MSG = {
  rate: 'NEXORA has reached the free usage limit for now. Please wait a minute and try again. If it keeps happening, today’s free quota may be used up and it will reset tomorrow.',
  daily: 'NEXORA’s daily free limit has been reached. Please come back tomorrow.',
  busy: 'The AI service is busy right now. Please try again in a few seconds.',
  config: 'NEXORA isn’t set up correctly yet. The site owner needs to check the API key and model name.',
  net: 'Couldn’t reach the AI service. Check your connection and try again.',
  blocked: 'I can’t help with that request. Try rephrasing it.',
  slow: 'You’re sending messages quickly. Please wait a few seconds.',
  bad: 'That message couldn’t be read. Please try again.'
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hits = new Map(); let day = '', count = 0;
function limited(ip) {
  const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 60000);
  a.push(now); hits.set(ip, a);
  if (hits.size > 5000) hits.clear();
  return a.length > PER_MIN;
}
function dailyUsed() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; count = 0; }
  return ++count > DAILY;
}
async function gemini(contents) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  for (let a = 0; a < 2; a++) {
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYS }] }, contents, generationConfig: { maxOutputTokens: 1024, temperature: 0.7 } }),
        signal: AbortSignal.timeout(30000)
      });
    } catch { if (a === 0) { await sleep(1500); continue; } return { net: true }; }
    if ((r.status === 500 || r.status === 503) && a === 0) { await sleep(1500); continue; }
    return { status: r.status, j: await r.json().catch(() => ({})) };
  }
}
function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }
async function chat(req, res) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (!KEY) return send(res, 500, { message: MSG.config });
  if (limited(ip)) return send(res, 429, { message: MSG.slow });
  let body = '';
  for await (const c of req) { body += c; if (body.length > 100000) return send(res, 413, { message: MSG.bad }); }
  let msgs;
  try { msgs = JSON.parse(body).messages; } catch {}
  if (!Array.isArray(msgs) || !msgs.length || msgs[msgs.length - 1].role !== 'user') return send(res, 400, { message: MSG.bad });
  const contents = msgs.slice(-20).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.text || '').slice(0, 4000) }] }));
  if (dailyUsed()) return send(res, 429, { message: MSG.daily });
  const out = await gemini(contents);
  if (out.net) return send(res, 502, { message: MSG.net });
  const { status, j } = out;
  if (status === 200) {
    const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    return text ? send(res, 200, { reply: text }) : send(res, 200, { reply: MSG.blocked });
  }
  console.error('Gemini error', status, JSON.stringify(j.error || j).slice(0, 300)); // owner-only log; never sent to browser
  if (status === 429) return send(res, 429, { message: MSG.rate });
  if (status === 500 || status === 503) return send(res, 503, { message: MSG.busy });
  return send(res, 500, { message: MSG.config }); // 400/403/404: bad key, no access or wrong model name
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/chat') return await chat(req, res);
    if (req.url === '/api/health') return send(res, 200, { ok: true, configured: !!KEY });
    const rel = req.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(__dirname, 'public', path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
    if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).on('error', () => { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { message: MSG.busy }); }
}).listen(PORT, HOST, () => console.log(`NEXORA AI running: http://localhost:${PORT}  (model: ${MODEL}, key ${KEY ? 'found' : 'MISSING'})`));
