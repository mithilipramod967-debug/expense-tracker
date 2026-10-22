require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const nodemailer = require('nodemailer');

const { Schema, model, Types } = mongoose;
const dir = (...p) => path.join(__dirname, ...p);
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
fs.mkdirSync(dir('logs/emails'), { recursive: true });

const RX = {
  name: /^[A-Za-z][A-Za-z .'-]{1,49}$/,
  email: /^[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,64}$/,
  amount: /^(?!0+(\.0+)?$)\d{1,9}(\.\d{1,2})?$/,
  date: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  month: /^\d{4}-(0[1-9]|1[0-2])$/,
  id: /^[a-f\d]{24}$/i,
  tag: /^[a-z0-9-]{1,20}$/,
};
const CATEGORIES = { Food: '#f97316', Transport: '#0ea5e9', Shopping: '#ec4899', Bills: '#eab308', Health: '#22c55e', Entertainment: '#8b5cf6', Education: '#14b8a6', Other: '#64748b' };
const METHODS = ['UPI', 'Cash', 'Card', 'Net Banking'];
const FILES = { 'image/jpeg': 'ffd8ff', 'image/png': '89504e47', 'application/pdf': '25504446' };

const clean = (v, n = 100) => String(v ?? '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, '').replace(/javascript:|on\w+\s*=/gi, '').trim().slice(0, n);
const noOps = (o) => (Array.isArray(o) ? o.map(noOps) : o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, noOps(v)])) : o);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const log = (m) => fs.appendFile(dir('logs/app.log'), `${new Date().toISOString()} ${m}\n`, () => {});
const monthRange = (m) => {
  const now = new Date();
  const [y, mo] = RX.month.test(m || '') ? m.split('-').map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  return { key: `${y}-${String(mo).padStart(2, '0')}`, start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 1)) };
};

const User = model('User', new Schema({ name: String, email: { type: String, unique: true }, password: String }, { timestamps: true }));
const Profile = model('Profile', new Schema({ user: { ...ref('User'), unique: true }, budget: { type: Number, default: 20000 }, alerts: { type: Boolean, default: true }, alerted: String }));
const Category = model('Category', new Schema({ user: ref('User'), name: String, color: String }).index({ user: 1, name: 1 }, { unique: true }));
const Tag = model('Tag', new Schema({ user: ref('User'), name: String }).index({ user: 1, name: 1 }, { unique: true }));
const Expense = model('Expense', new Schema({
  user: ref('User'), title: String, amount: Number, date: Date, category: ref('Category'), tags: [ref('Tag')], method: String, receipt: String,
}, { timestamps: true }).index({ user: 1, date: -1 }).index({ title: 'text' }));

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587, secure: process.env.SMTP_PORT === '465', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
  : nodemailer.createTransport({ streamTransport: true, buffer: true });

async function mail(to, subject, html) {
  const info = await mailer.sendMail({ from: process.env.MAIL_FROM || 'MyLedger <no-reply@myledger.local>', to, subject, html });
  if (info.message) fs.writeFileSync(dir('logs/emails', `${Date.now()}.eml`), info.message);
  log(`mail ${to} "${subject}"`);
}

async function report(user, month) {
  const { key, start, end } = monthRange(month);
  const rows = await Expense.aggregate([
    { $match: { user: user._id, date: { $gte: start, $lt: end } } },
    { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'c' } },
    { $project: { name: { $first: '$c.name' }, total: 1, count: 1 } },
    { $sort: { total: -1 } },
  ]);
  const total = rows.reduce((s, r) => s + r.total, 0);
  await mail(user.email, `Your expense report for ${key}`, `<h2>${esc(user.name)}, your spending in ${key}</h2><table border="1" cellpadding="6">${rows
    .map((r) => `<tr><td>${esc(r.name)}</td><td>${r.count}</td><td>₹${r.total.toFixed(2)}</td></tr>`).join('')}</table><h3>Total: ₹${total.toFixed(2)}</h3>`);
}

const bus = new EventEmitter();
bus.on('register', (user) => mail(user.email, 'Welcome to MyLedger', `<p>Hi ${esc(user.name)}, your account is ready.</p>`).catch((e) => log(e.message)));
bus.on('expense', async (user, action, e) => {
  log(`${user.email} ${action} "${e.title}" ${e.amount}`);
  if (action === 'deleted') return;
  const { key, start, end } = monthRange();
  const [p, [s]] = await Promise.all([Profile.findOne({ user: user._id }), Expense.aggregate([
    { $match: { user: user._id, date: { $gte: start, $lt: end } } }, { $group: { _id: null, total: { $sum: '$amount' } } }])]);
  if (!p?.alerts || !s || s.total < p.budget * 0.8) return;
  const level = `${key}${s.total >= p.budget ? 'b' : 'a'}`;
  if ((p.alerted || '') >= level) return;
  await Profile.updateOne({ _id: p._id }, { alerted: level });
  await mail(user.email, `Budget alert: ${Math.round((s.total / p.budget) * 100)}% used`, `<p>You have spent ₹${s.total.toFixed(2)} of your ₹${p.budget} budget for ${key}.</p>`);
});

async function createUser(name, email, password) {
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 10) });
  await Profile.create({ user: user._id });
  await Category.insertMany(Object.entries(CATEGORIES).map(([n, color]) => ({ user: user._id, name: n, color })));
  return user;
}

const sign = (u) => ({ token: jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: '7d' }), user: { name: u.name, email: u.email } });
const fail = (res, error, code = 400) => res.status(code).json({ error });

async function auth(req, res, next) {
  try {
    req.user = await User.findById(jwt.verify((req.headers.authorization || '').slice(7), process.env.JWT_SECRET).id);
  } catch { req.user = null; }
  return req.user ? next() : fail(res, 'Please log in', 401);
}

const upload = multer({
  storage: multer.diskStorage({ destination: dir('uploads'), filename: (_q, f, cb) => cb(null, `${crypto.randomUUID()}.${f.mimetype.split('/')[1]}`) }),
  limits: { fileSize: 2e6 },
  fileFilter: (_q, f, cb) => cb(FILES[f.mimetype] ? null : new Error('type'), true),
}).single('receipt');

function withFile(req, res, next) {
  upload(req, res, (err) => {
    if (!err && req.file && !fs.readFileSync(req.file.path).subarray(0, 4).toString('hex').startsWith(FILES[req.file.mimetype])) {
      fs.unlinkSync(req.file.path);
      err = true;
    }
    if (err) return fail(res, 'Receipt must be a real JPG, PNG or PDF under 2 MB');
    req.body = noOps(req.body || {});
    next();
  });
}

async function expenseData(req) {
  const b = req.body;
  const title = clean(b.title, 80);
  if (title.length < 2 || !RX.amount.test(b.amount) || !RX.date.test(b.date) || !RX.id.test(b.category)) return null;
  if (!(await Category.exists({ _id: b.category, user: req.user._id }))) return null;
  const names = [...new Set(String(b.tags || '').toLowerCase().split(',').map((t) => t.trim().replace(/\s+/g, '-')).filter((t) => RX.tag.test(t)))].slice(0, 8);
  const tags = await Promise.all(names.map((name) => Tag.findOneAndUpdate({ user: req.user._id, name }, { $setOnInsert: { name } }, { upsert: true, new: true })));
  return { title, amount: +b.amount, date: new Date(b.date), category: b.category, method: METHODS.includes(b.method) ? b.method : 'UPI', tags: tags.map((t) => t._id) };
}

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; frame-src blob:; connect-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || 'http://localhost:8080',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.body) req.body = noOps(req.body);
  next();
});

app.post('/api/register', async (req, res) => {
  const name = clean(req.body.name, 50);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!RX.name.test(name) || !RX.email.test(email) || !RX.password.test(password)) return fail(res, 'Enter a valid name, email and strong password');
  if (await User.exists({ email })) return fail(res, 'Email already registered', 409);
  const user = await createUser(name, email, password);
  bus.emit('register', user);
  res.status(201).json(sign(user));
});

app.post('/api/login', async (req, res) => {
  const user = await User.findOne({ email: String(req.body.email || '').trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password))) return fail(res, 'Invalid email or password', 401);
  res.json(sign(user));
});

app.get('/api/me', auth, async (req, res) => {
  const p = await Profile.findOne({ user: req.user._id });
  res.json({ name: req.user.name, email: req.user.email, budget: p.budget, alerts: p.alerts });
});

app.put('/api/me', auth, async (req, res) => {
  const name = clean(req.body.name, 50);
  const budget = Number(req.body.budget);
  if (!RX.name.test(name) || !(budget >= 0 && budget <= 1e9)) return fail(res, 'Enter a valid name and budget');
  await User.updateOne({ _id: req.user._id }, { name });
  await Profile.updateOne({ user: req.user._id }, { budget, alerts: !!req.body.alerts, alerted: '' });
  res.json({ name, budget });
});

app.get('/api/categories', auth, async (req, res) => {
  res.json(await Category.aggregate([
    { $match: { user: req.user._id } },
    { $lookup: { from: 'expenses', localField: '_id', foreignField: 'category', as: 'e' } },
    { $project: { name: 1, color: 1, count: { $size: '$e' }, total: { $sum: '$e.amount' } } },
    { $sort: { name: 1 } },
  ]));
});

app.post('/api/categories', auth, async (req, res) => {
  const name = clean(req.body.name, 30);
  if (name.length < 2) return fail(res, 'Category name must be 2-30 characters');
  if (await Category.exists({ user: req.user._id, name })) return fail(res, 'Category already exists', 409);
  res.status(201).json(await Category.create({ user: req.user._id, name, color: /^#[\da-f]{6}$/i.test(req.body.color) ? req.body.color : '#64748b' }));
});

app.delete('/api/categories/:id', auth, async (req, res) => {
  if (!RX.id.test(req.params.id)) return fail(res, 'Invalid id');
  if (await Expense.exists({ category: req.params.id })) return fail(res, 'Category is in use', 409);
  await Category.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ ok: true });
});

app.get('/api/tags', auth, async (req, res) => res.json(await Tag.find({ user: req.user._id }).sort({ name: 1 })));

app.get('/api/expenses', auth, async (req, res) => {
  const q = req.query;
  const f = { user: req.user._id };
  const search = clean(q.q, 50);
  if (search) f.$text = { $search: search };
  if (RX.month.test(q.month || '')) { const r = monthRange(q.month); f.date = { $gte: r.start, $lt: r.end }; }
  if (RX.id.test(q.category || '')) f.category = new Types.ObjectId(String(q.category));
  if (RX.id.test(q.tag || '')) f.tags = new Types.ObjectId(String(q.tag));
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const [items, total, [s]] = await Promise.all([
    Expense.find(f).sort({ date: -1, _id: -1 }).skip((page - 1) * 10).limit(10).populate('category tags', 'name color'),
    Expense.countDocuments(f),
    Expense.aggregate([{ $match: f }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / 10) || 1, sum: s?.sum || 0 });
});

app.post('/api/expenses', auth, withFile, async (req, res) => {
  const data = await expenseData(req);
  if (!data) { if (req.file) fs.unlinkSync(req.file.path); return fail(res, 'Check title, amount, date and category'); }
  const e = await Expense.create({ ...data, user: req.user._id, receipt: req.file?.filename });
  bus.emit('expense', req.user, 'added', e);
  res.status(201).json(e);
});

app.put('/api/expenses/:id', auth, withFile, async (req, res) => {
  const e = RX.id.test(req.params.id) && await Expense.findOne({ _id: req.params.id, user: req.user._id });
  const data = e && await expenseData(req);
  if (!data) { if (req.file) fs.unlinkSync(req.file.path); return fail(res, e ? 'Check title, amount, date and category' : 'Not found', e ? 400 : 404); }
  if (req.file && e.receipt) fs.unlink(dir('uploads', e.receipt), () => {});
  Object.assign(e, data, req.file && { receipt: req.file.filename });
  await e.save();
  bus.emit('expense', req.user, 'updated', e);
  res.json(e);
});

app.delete('/api/expenses/:id', auth, async (req, res) => {
  const e = RX.id.test(req.params.id) && await Expense.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!e) return fail(res, 'Not found', 404);
  if (e.receipt) fs.unlink(dir('uploads', e.receipt), () => {});
  bus.emit('expense', req.user, 'deleted', e);
  res.json({ ok: true });
});

app.get('/api/expenses/:id/receipt', auth, async (req, res) => {
  const e = RX.id.test(req.params.id) && await Expense.findOne({ _id: req.params.id, user: req.user._id });
  if (!e?.receipt || !fs.existsSync(dir('uploads', e.receipt))) return fail(res, 'No receipt', 404);
  res.type(path.extname(e.receipt));
  fs.createReadStream(dir('uploads', e.receipt)).pipe(res);
});

app.get('/api/report', auth, async (req, res) => {
  const { key, start, end } = monthRange(req.query.month);
  const user = req.user._id;
  const [[r], trend, p] = await Promise.all([
    Expense.aggregate([{ $match: { user, date: { $gte: start, $lt: end } } }, {
      $facet: {
        stats: [{ $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 }, max: { $max: '$amount' } } }],
        categories: [
          { $group: { _id: '$category', total: { $sum: '$amount' } } },
          { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'c' } },
          { $project: { name: { $first: '$c.name' }, color: { $first: '$c.color' }, total: 1 } },
          { $sort: { total: -1 } },
        ],
        methods: [{ $group: { _id: '$method', total: { $sum: '$amount' } } }, { $sort: { total: -1 } }],
        tags: [
          { $unwind: '$tags' },
          { $group: { _id: '$tags', total: { $sum: '$amount' } } },
          { $lookup: { from: 'tags', localField: '_id', foreignField: '_id', as: 't' } },
          { $project: { name: { $first: '$t.name' }, total: 1 } },
          { $sort: { total: -1 } }, { $limit: 5 },
        ],
      },
    }]),
    Expense.aggregate([
      { $match: { user, date: { $gte: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 5, 1)), $lt: end } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]),
    Profile.findOne({ user }),
  ]);
  res.json({ month: key, budget: p.budget, total: 0, count: 0, max: 0, ...r.stats[0], categories: r.categories, methods: r.methods, tags: r.tags, trend });
});

app.post('/api/report', auth, async (req, res) => {
  await report(req.user, req.body.month);
  res.json({ message: process.env.SMTP_HOST ? `Report sent to ${req.user.email}` : 'Report saved in logs/emails' });
});

app.use(express.static(dir('public')));
app.use((err, req, res, _next) => {
  log(`${req.method} ${req.url} ${err.stack}`);
  fail(res, 'Server error', 500);
});

async function seed() {
  const old = await User.findOne({ email: 'demo@expense.app' });
  if (old) await Promise.all([Profile, Category, Tag, Expense].map((m) => m.deleteMany({ user: old._id })).concat(old.deleteOne()));
  const user = await createUser('Demo Student', 'demo@expense.app', 'Demo@1234');
  const cats = await Category.find({ user: user._id });
  const tags = await Tag.insertMany(['college', 'friends', 'weekend', 'monthly', 'trip'].map((name) => ({ user: user._id, name })));
  const titles = { Food: 'Lunch', Transport: 'Metro card', Shopping: 'T-shirt', Bills: 'Phone bill', Health: 'Pharmacy', Entertainment: 'Movie', Education: 'Books', Other: 'Gift' };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const now = new Date();
  const docs = Array.from({ length: 120 }, () => {
    const c = pick(cats);
    const back = Math.floor(Math.random() * 4);
    const day = 1 + Math.floor(Math.random() * (back ? 28 : now.getUTCDate()));
    return { user: user._id, title: titles[c.name], amount: 50 + Math.round(Math.random() * 120) * 5, category: c._id, tags: [pick(tags)._id], method: pick(METHODS), date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, day)) };
  });
  await Expense.insertMany(docs);
  await Profile.updateOne({ user: user._id }, { budget: 15000 });
  console.log('Seeded. Log in with demo@expense.app / Demo@1234');
}

async function main(cmd) {
  await mongoose.connect(process.env.MONGO_URI);
  if (cmd === 'seed') await seed();
  else if (cmd === 'report') for (const u of await User.find()) await report(u);
  else return http.createServer(app).listen(process.env.PORT || 5000, () => console.log(`http://localhost:${process.env.PORT || 5000}`));
  await mongoose.disconnect();
}

main(process.argv[2]).catch((e) => { console.error(e.message); process.exit(1); });
