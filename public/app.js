const API = location.port === '8080' ? 'http://localhost:5000/api' : '/api';
const $ = (s, r = document) => r.querySelector(s);
const RX = {
  name: /^[A-Za-z][A-Za-z .'-]{1,49}$/,
  email: /^[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,64}$/,
  amount: /^(?!0+(\.0+)?$)\d{1,9}(\.\d{1,2})?$/,
  unsafe: /<|>|javascript:|on\w+\s*=/i,
};
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const token = () => localStorage.getItem('token');

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.flat().filter((k) => k != null));
  return n;
}

async function api(path, { method = 'GET', body, blob } = {}) {
  const headers = { Authorization: `Bearer ${token()}` };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body instanceof FormData ? body : body && JSON.stringify(body) });
  if (res.status === 401 && token()) { localStorage.clear(); location.href = 'index.html'; }
  if (blob && res.ok) return res.blob();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function check(form, rules = {}) {
  let ok = true;
  for (const input of form.querySelectorAll('input:not([type=hidden]), select')) {
    const v = input.value;
    input.setCustomValidity('');
    let msg = input.validity.valid ? '' : input.validationMessage;
    if (!msg && input.type !== 'file' && RX.unsafe.test(v)) msg = 'HTML or script content is not allowed';
    if (!msg && rules[input.name]) msg = rules[input.name](v) || '';
    input.setCustomValidity(msg);
    input.classList.toggle('invalid', !!msg);
    if (msg && ok) { ok = false; input.reportValidity(); }
  }
  return ok;
}

function home() {
  if (token()) location.href = 'app.html';
  const error = $('#auth-error');
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
    $('#login').hidden = t.dataset.show !== 'login';
    $('#register').hidden = t.dataset.show !== 'register';
    error.textContent = '';
  }));
  const submit = (form, path, rules) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (!check(form, rules)) return;
    try {
      const data = await api(path, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      localStorage.setItem('token', data.token);
      location.href = 'app.html';
    } catch (err) { error.textContent = err.message; }
  });
  submit($('#login'), '/login', { email: (v) => !RX.email.test(v) && 'Enter a valid email' });
  submit($('#register'), '/register', {
    name: (v) => !RX.name.test(v) && 'Use 2-50 letters',
    email: (v) => !RX.email.test(v) && 'Enter a valid email',
    password: (v) => !RX.password.test(v) && '8+ characters with upper, lower, number and symbol',
    confirm: (v) => v !== $('#register').password.value && 'Passwords do not match',
  });
}

function dash() {
  if (!token()) { location.href = 'index.html'; return; }
  const form = $('#expense');
  const filters = $('#filters');
  let page = 1;
  let pages = 1;
  let categories = [];

  const option = (value, text) => el('option', { value, textContent: text });

  async function loadLists() {
    categories = await api('/categories');
    const tags = await api('/tags');
    form.category.replaceChildren(option('', 'Choose…'), ...categories.map((c) => option(c._id, c.name)));
    filters.category.replaceChildren(option('', 'All categories'), ...categories.map((c) => option(c._id, c.name)));
    filters.tag.replaceChildren(option('', 'All tags'), ...tags.map((t) => option(t._id, `#${t.name}`)));
    $('#tag-list').replaceChildren(...tags.map((t) => option(t.name, '')));
    const max = Math.max(1, ...categories.map((c) => c.total));
    $('#cats').replaceChildren(...categories.map((c) => el('li', {},
      el('span', { textContent: `${c.name} (${c.count})` }),
      el('span', {}, money(c.total), ' ', c.count ? null : el('button', { type: 'button', className: 'ghost', textContent: '✕', onclick: () => removeCategory(c) })),
      el('i', { style: `width:${(c.total / max) * 100}%;background:${c.color}` }))));
  }

  async function loadExpenses() {
    const params = new URLSearchParams([...new FormData(filters)].filter(([, v]) => v));
    params.set('page', page);
    const data = await api(`/expenses?${params}`);
    pages = data.pages;
    $('#sum').textContent = `${data.total} items · ${money(data.sum)}`;
    $('#page').textContent = `Page ${data.page} of ${data.pages}`;
    $('#prev').disabled = page <= 1;
    $('#next').disabled = page >= pages;
    $('#rows').replaceChildren(...(data.items.length ? data.items.map((e) => el('tr', {},
      el('td', { textContent: e.date.slice(0, 10) }),
      el('td', { textContent: e.title }),
      el('td', { textContent: e.category?.name || '–' }),
      el('td', {}, e.tags.map((t) => el('span', { className: 'tag', textContent: `#${t.name}` }))),
      el('td', { className: 'num', textContent: money(e.amount) }),
      el('td', {},
        e.receipt ? el('button', { type: 'button', className: 'ghost', textContent: '🧾', title: 'Receipt', onclick: () => showReceipt(e) }) : null,
        el('button', { type: 'button', className: 'ghost', textContent: '✎', title: 'Edit', onclick: () => edit(e) }),
        el('button', { type: 'button', className: 'ghost', textContent: '🗑', title: 'Delete', onclick: () => remove(e) }))))
      : [el('tr', {}, el('td', { colSpan: 6, textContent: 'No expenses found' }))]));
  }

  const bars = (list, label, color) => {
    const max = Math.max(1, ...list.map((x) => x.total));
    return list.length ? list.map((x) => el('li', {}, el('span', { textContent: label(x) }), el('span', { textContent: money(x.total) }),
      el('i', { style: `width:${(x.total / max) * 100}%;background:${color?.(x) || ''}` }))) : [el('li', { className: 'muted', textContent: 'No data' })];
  };

  async function loadReport() {
    const r = await api(`/report?month=${$('#r-month').value}`);
    const current = await api('/report');
    $('#s-total').textContent = money(current.total);
    $('#s-left').textContent = money(current.budget - current.total);
    $('#s-count').textContent = current.count;
    $('#s-max').textContent = money(current.max);
    const pct = current.budget ? (current.total / current.budget) * 100 : 0;
    $('#meter').style.width = `${Math.min(100, pct)}%`;
    $('#meter').classList.toggle('over', pct >= 100);
    $('#r-cat').replaceChildren(...bars(r.categories, (x) => x.name, (x) => x.color));
    $('#r-method').replaceChildren(...bars(r.methods, (x) => x._id));
    $('#r-tags').replaceChildren(...bars(r.tags, (x) => `#${x.name}`));
    $('#r-trend').replaceChildren(...bars(r.trend, (x) => x._id));
  }

  async function loadProfile() {
    const me = await api('/me');
    const f = $('#me');
    f.name.value = me.name;
    f.email.value = me.email;
    f.budget.value = me.budget;
    f.alerts.checked = me.alerts;
  }

  const refresh = () => Promise.all([loadExpenses(), loadReport(), loadLists()]).catch((err) => alert(err.message));

  const reset = () => form.reset();

  function edit(e) {
    $('#form-error').textContent = '';
    form.id.value = e._id;
    form.title.value = e.title;
    form.amount.value = e.amount;
    form.date.value = e.date.slice(0, 10);
    form.category.value = e.category?._id || '';
    form.tags.value = e.tags.map((t) => t.name).join(', ');
    form.querySelector(`[name=method][value="${e.method}"]`).checked = true;
    $('#form-title').textContent = 'Edit expense';
    form.scrollIntoView({ behavior: 'smooth' });
  }

  async function remove(e) {
    if (!confirm(`Delete "${e.title}" (${money(e.amount)})?`)) return;
    await api(`/expenses/${e._id}`, { method: 'DELETE' });
    refresh();
  }

  async function removeCategory(c) {
    if (!confirm(`Delete category "${c.name}"?`)) return;
    await api(`/categories/${c._id}`, { method: 'DELETE' }).catch((err) => alert(err.message));
    loadLists();
  }

  async function showReceipt(e) {
    const url = URL.createObjectURL(await api(`/expenses/${e._id}/receipt`, { blob: true }));
    $('#receipt').replaceChildren(e.receipt.endsWith('.pdf') ? el('iframe', { src: url, title: 'Receipt' }) : el('img', { src: url, alt: `Receipt for ${e.title}` }));
    $('#viewer').showModal();
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('#form-error').textContent = '';
    const rules = {
      amount: (v) => !RX.amount.test(v) && 'Positive amount with up to 2 decimals',
      date: (v) => v > today() && 'Date cannot be in the future',
      receipt: () => form.receipt.files[0]?.size > 2e6 && 'Receipt must be 2 MB or smaller',
    };
    if (!check(form, rules)) return;
    const body = new FormData(form);
    if (!form.receipt.files.length) body.delete('receipt');
    try {
      await api(form.id.value ? `/expenses/${form.id.value}` : '/expenses', { method: form.id.value ? 'PUT' : 'POST', body });
      reset();
      refresh();
    } catch (err) { $('#form-error').textContent = err.message; }
  });
  form.addEventListener('reset', () => setTimeout(() => {
    form.date.value = today();
    $('#form-title').textContent = 'Add expense';
    $('#form-error').textContent = '';
  }));

  $('#quick').addEventListener('click', async () => {
    const input = prompt('Quick add: title, amount (e.g. "Chai, 20")');
    if (!input) return;
    const [title, amount] = input.split(',').map((s) => s.trim());
    if (!title || title.length < 2 || RX.unsafe.test(title) || !RX.amount.test(amount || '')) { alert('Please type a valid title and amount, like: Chai, 20'); return; }
    const other = categories.find((c) => c.name === 'Other') || categories[0];
    await api('/expenses', { method: 'POST', body: { title, amount, date: today(), category: other._id, method: 'UPI' } }).catch((err) => alert(err.message));
    refresh();
  });

  let timer;
  filters.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; loadExpenses(); }, 300); });
  filters.addEventListener('submit', (e) => e.preventDefault());
  $('#prev').addEventListener('click', () => { page -= 1; loadExpenses(); });
  $('#next').addEventListener('click', () => { page += 1; loadExpenses(); });
  $('#r-month').addEventListener('change', loadReport);
  $('#close').addEventListener('click', () => $('#viewer').close());
  $('#logout').addEventListener('click', () => { if (confirm('Log out?')) { localStorage.clear(); location.href = 'index.html'; } });
  $('#email').addEventListener('click', async () => alert((await api('/report', { method: 'POST', body: { month: $('#r-month').value } })).message));

  $('#me').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!check(e.target, { name: (v) => !RX.name.test(v) && 'Use 2-50 letters' })) return;
    const f = e.target;
    await api('/me', { method: 'PUT', body: { name: f.name.value, budget: f.budget.value, alerts: f.alerts.checked } }).catch((err) => alert(err.message));
    alert('Profile saved');
    loadReport();
  });

  $('#cat').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!check(e.target)) return;
    await api('/categories', { method: 'POST', body: { name: e.target.name.value, color: e.target.color.value } }).catch((err) => alert(err.message));
    e.target.reset();
    loadLists();
  });

  $('#r-month').value = today().slice(0, 7);
  reset();
  refresh();
  loadProfile();
}

({ home, dash })[document.body.id]();
