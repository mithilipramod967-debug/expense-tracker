const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const EventEmitter = require('events');

const DATA = path.join(__dirname, 'logs', 'core-expenses.json');
const UPLOADS = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
if (!fs.existsSync(DATA)) fs.writeFileSync(DATA, '[]');

const bus = new EventEmitter();
bus.on('saved', (what) => fs.appendFile(path.join(__dirname, 'logs', 'core.log'), `${new Date().toISOString()} ${what}\n`, () => {}));

const read = () => JSON.parse(fs.readFileSync(DATA, 'utf8'));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};

const page = () => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Core Node</title></head>
<body style="font-family:system-ui;max-width:640px;margin:2rem auto;padding:0 1rem">
<h1>Node.js core modules</h1>
<form method="post" action="/expenses"><input name="title" required pattern="[A-Za-z0-9 ]{2,40}" placeholder="Title"> <input name="amount" type="number" min="1" step="0.01" required placeholder="Amount"> <button>Add</button></form>
<p><input type="file" id="f"> <button onclick="fetch('/upload?name='+encodeURIComponent(f.files[0].name),{method:'PUT',body:f.files[0]}).then(r=>r.text()).then(alert)">Upload</button></p>
<p><a href="/summary?min=100">/summary?min=100</a> · <a href="/files">/files</a></p>
<ol>${read().map((e) => `<li>${esc(e.title)} – ₹${e.amount}</li>`).join('')}</ol></body></html>`;

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /') return send(res, 200, page(), 'text/html');
  if (route === 'POST /expenses') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      const f = new URLSearchParams(body);
      const title = String(f.get('title')).trim();
      const amount = Number(f.get('amount'));
      if (!/^[A-Za-z0-9 ]{2,40}$/.test(title) || !(amount > 0)) return send(res, 400, { error: 'Invalid input' });
      fs.writeFileSync(DATA, JSON.stringify([...read(), { title, amount, date: new Date() }]));
      bus.emit('saved', `expense ${title} ${amount}`);
      res.writeHead(303, { Location: '/' }).end();
    });
  }
  if (route === 'GET /summary') {
    const min = Number(url.searchParams.get('min')) || 0;
    const list = read().filter((e) => e.amount >= min);
    const total = list.reduce((s, e) => s + e.amount, 0);
    return send(res, 200, { min, count: list.length, total, average: list.length ? +(total / list.length).toFixed(2) : 0 });
  }
  if (route === 'PUT /upload') {
    const name = `${Date.now()}-${path.basename(url.searchParams.get('name') || 'file').replace(/[^\w.-]/g, '_')}`;
    return req.pipe(fs.createWriteStream(path.join(UPLOADS, name))).on('finish', () => {
      bus.emit('saved', `upload ${name}`);
      send(res, 201, `Saved ${name}`, 'text/plain');
    });
  }
  if (route === 'GET /files') return send(res, 200, fs.readdirSync(UPLOADS).map((n) => ({ name: n, bytes: fs.statSync(path.join(UPLOADS, n)).size })));
  send(res, 404, { error: `${route} not found` });
}).listen(4000, () => console.log('http://localhost:4000'));
