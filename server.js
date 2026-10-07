// Yahtzee Scoreblok: serves the web app and keeps every game in one JSON file.
// Clients send ops to POST /api/ops and hear about changes over Server-Sent Events.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { apply, validOp, migrate } = require('./public/apply.js');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
// Forgiving on purpose: a code typed on a phone keyboard, or pasted into Coolify with quotes or a
// trailing space, should still match. Case, surrounding whitespace and surrounding quotes are ignored.
const normalizeCode = s => String(s || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim().toLowerCase();
const SPELCODE = normalizeCode(process.env.SPELCODE);
const PUBLIC = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'games.json');

function load() {
  let data;
  try { data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { data = { version: 0, games: [], players: [] }; }
  return migrate(data);
}
let db = load();

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

const listeners = new Set();
function broadcast() {
  const msg = `data: ${JSON.stringify({ version: db.version })}\n\n`;
  for (const res of listeners) res.write(msg);
}

function authorized(req, url) {
  if (!SPELCODE) return true;
  const given = req.headers['x-spelcode'] || url.searchParams.get('code') || '';
  const a = Buffer.from(normalizeCode(given)), b = Buffer.from(SPELCODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// Cloudflare overrides our no-cache on .js with a 4 hour browser TTL, so a phone could pair a new
// index.html with an old apply.js and hang on "Laden". index.html therefore asks for
// apply.js?v=<content hash>: a new version is a new URL that no cache has seen yet.
const APPLY_VERSION = crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC, 'apply.js'))).digest('hex').slice(0, 12);
const INDEX_HTML = Buffer.from(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
  .replace('<script src="apply.js"></script>', `<script src="apply.js?v=${APPLY_VERSION}"></script>`));

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/index.html') {
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
    return res.end(INDEX_HTML);
  }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Niet gevonden'); }
    const ext = path.extname(file);
    const cache = ext === '.png' ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') return json(res, 200, { ok: true });
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
  if (!authorized(req, url)) return json(res, 401, { error: 'Onjuiste spelcode' });

  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, db);

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ version: db.version })}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); listeners.delete(res); });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ops') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'Ongeldig verzoek' }); }
    const ops = Array.isArray(body && body.ops) ? body.ops : null;
    if (!ops || ops.length > 500) return json(res, 400, { error: 'Ongeldig verzoek' });
    let data = { games: db.games, players: db.players }, applied = 0;
    for (const op of ops) { if (validOp(op)) { data = apply(data, op); applied++; } }
    if (applied) {
      db = { version: db.version + 1, games: data.games.slice(0, 1000), players: data.players.slice(0, 200) };
      save();
      broadcast();
    }
    return json(res, 200, db);
  }

  json(res, 404, { error: 'Niet gevonden' });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Yahtzee Scoreblok op poort ${PORT}${SPELCODE ? '' : ' (zonder spelcode)'}`));
}
module.exports = { server };
