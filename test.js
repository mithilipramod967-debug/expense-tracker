const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { app, RX, clean, noOps } = require('./server');

test('regex validation', () => {
  assert.ok(RX.email.test('a.b@college.edu.in') && !RX.email.test('a@b'));
  assert.ok(RX.password.test('Demo@1234') && !RX.password.test('demo1234'));
  assert.ok(RX.amount.test('99.50') && !RX.amount.test('0') && !RX.amount.test('1.234'));
});

test('sanitization', () => {
  assert.equal(clean('<script>alert(1)</script><b>Pizza</b>'), 'Pizza');
  assert.deepEqual(noOps({ email: { $gt: '' }, a: [{ $where: 1, b: 2 }] }), { email: {}, a: [{ b: 2 }] });
});

const uri = process.env.MONGO_URI_TEST;
let base;
let server;
const call = async (path, method = 'GET', body, token) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  if (!uri) return;
  process.env.JWT_SECRET ||= 'test';
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  server = http.createServer(app).listen(0);
  base = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  if (!uri) return;
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('api flow', { skip: !uri && 'set MONGO_URI_TEST to run' }, async () => {
  assert.equal((await call('/register', 'POST', { name: 'x', email: 'bad', password: '1' })).status, 400);
  const reg = await call('/register', 'POST', { name: 'Test User', email: 't@x.com', password: 'Test@1234' });
  assert.equal(reg.status, 201);
  assert.equal((await call('/login', 'POST', { email: { $gt: '' }, password: 'x' })).status, 401);
  const { token } = (await call('/login', 'POST', { email: 't@x.com', password: 'Test@1234' })).body;
  assert.equal((await call('/expenses')).status, 401);
  const cats = (await call('/categories', 'GET', null, token)).body;
  const e = await call('/expenses', 'POST', { title: 'Lunch', amount: '150', date: '2026-10-01', category: cats[0]._id, tags: 'college' }, token);
  assert.equal(e.status, 201);
  assert.equal((await call('/expenses', 'POST', { title: 'x', amount: '-1' }, token)).status, 400);
  assert.equal((await call(`/expenses/${e.body._id}`, 'PUT', { title: 'Dinner', amount: '200', date: '2026-10-01', category: cats[0]._id }, token)).body.amount, 200);
  assert.equal((await call('/report?month=2026-10', 'GET', null, token)).body.total, 200);
  assert.equal((await call(`/expenses/${e.body._id}`, 'DELETE', null, token)).status, 200);
});
