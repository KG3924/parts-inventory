/* Read-only archive of the old Logs quotes and invoices.
   Reaches the database only through archive_list, archive_record, and archive_lookups. */

const BANNER = 'Records through Nov 23, 2026. Newer quotes and invoices are on the Logs site.';
const NOT_READY = "Archive isn't available yet.";
const LOAD_ERROR = "Couldn't load — try again.";
const REMEMBER_KEY = 'inmar_archive_company';
const VIEWS = ['search', 'record', 'hull', 'serial', 'customer', 'lists'];

const QUOTE_FIELDS = [
  { key: 'quote_number', label: 'Quote #', kind: 'text' },
  { key: 'quote_date', label: 'Date', kind: 'date', typed: 'quote_day' },
  { key: 'customer', label: 'Customer', kind: 'customer' },
  { key: 'contact', label: 'Contact', kind: 'text' },
  { key: 'project', label: 'Project / hull', kind: 'hull' },
  { key: 'manufacturer', label: 'Manufacturer', kind: 'text' },
  { key: 'part_number', label: 'Part #', kind: 'text' },
  { key: 'mfg_drawing_no', label: 'Mfg drawing #', kind: 'text' },
  { key: 'quoted_by', label: 'Quoted by', kind: 'text' },
  { key: 'payment_terms', label: 'Payment terms', kind: 'text' },
  { key: 'customer_po', label: 'Customer PO', kind: 'text' },
  { key: 'vendor_order_number', label: 'Vendor order #', kind: 'text' }
];

const SYS_INVOICE_FIELDS = [
  { key: 'invoice_number', label: 'Invoice #', kind: 'text' },
  { key: 'invoice_date', label: 'Invoice date', kind: 'date', typed: 'invoice_day' },
  { key: 'customer', label: 'Customer', kind: 'customer' },
  { key: 'po_number', label: 'PO #', kind: 'text' },
  { key: 'project', label: 'Project / hull', kind: 'hull' },
  { key: 'invoice_amount', label: 'Invoice amount', kind: 'money', typed: 'invoice_amount_num' },
  { key: 'date_received', label: 'Date received', kind: 'date', typed: 'date_received_day' },
  { key: 'payment_type', label: 'Payment type', kind: 'text' },
  { key: 'vendor', label: 'Vendor (name)', kind: 'vendor' },
  { key: 'serial_number', label: 'Serial #', kind: 'serial' }
];

const SOL_INVOICE_FIELDS = [
  { key: 'invoice_number', label: 'Invoice #', kind: 'text' },
  { key: 'invoice_date', label: 'Invoice date', kind: 'date', typed: 'invoice_day' },
  { key: 'customer', label: 'Customer', kind: 'customer' },
  { key: 'po_number', label: 'PO #', kind: 'text' },
  { key: 'project', label: 'Project / hull', kind: 'hull' },
  { key: 'location', label: 'Location', kind: 'text' },
  { key: 'goods_amount', label: 'Goods', kind: 'money', typed: 'goods_amount_num' },
  { key: 'sh_amount', label: 'S&H', kind: 'money', typed: 'sh_amount_num' },
  { key: 'service_charge', label: 'Service charge', kind: 'money', typed: 'service_charge_num' },
  { key: 'tax_amount', label: 'Tax', kind: 'money', typed: 'tax_amount_num' },
  { key: 'total_amount', label: 'Total', kind: 'money', typed: 'total_amount_num' },
  { key: 'deposit_amount', label: 'Deposit', kind: 'money', typed: 'deposit_amount_num' },
  { key: 'date_received', label: 'Date received', kind: 'date', typed: 'date_received_day' },
  { key: 'payment_type', label: 'Payment type', kind: 'text' },
  { key: 'payment_id', label: 'Payment ID', kind: 'text' },
  { key: 'vendor', label: 'Vendor (name)', kind: 'vendor' },
  { key: 'industry', label: 'Industry (name)', kind: 'industry' },
  { key: 'serial_number', label: 'Serial #', kind: 'serial' },
  { key: 'sundry', label: 'Sundry', kind: 'text' },
  { key: 'comments', label: 'Comments', kind: 'comments' }
];

let seq = 0;
let current = null;
const cache = { systems: null, solutions: null };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function remembered() {
  try {
    const value = localStorage.getItem(REMEMBER_KEY);
    if (value === 'systems' || value === 'solutions') return value;
  } catch (e) { /* this phone may block storage */ }
  return '';
}

function remember(co) {
  try { localStorage.setItem(REMEMBER_KEY, co); } catch (e) { /* ignore */ }
}

function companyName(co) {
  return co === 'systems' ? 'In-Mar Systems' : 'In-Mar Solutions';
}

function pageNum(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function isoOrBlank(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  const asked = params.get('co');
  const co = asked === 'systems' || asked === 'solutions' ? asked : (remembered() || 'solutions');
  const askedView = params.get('view') || 'search';
  const view = VIEWS.indexOf(askedView) === -1 ? 'search' : askedView;
  const askedType = params.get('type');
  const type = askedType === 'quote' || askedType === 'invoice' ? askedType : 'all';
  const kind = params.get('kind') === 'invoice' ? 'invoice' : (params.get('kind') === 'quote' ? 'quote' : '');
  const id = parseInt(params.get('id') || '', 10);
  return {
    co: co,
    view: view,
    q: params.get('q') || '',
    type: type,
    from: isoOrBlank(params.get('from')),
    to: isoOrBlank(params.get('to')),
    page: pageNum(params.get('page')),
    kind: kind,
    id: Number.isInteger(id) ? id : null
  };
}

function urlFor(state) {
  const params = new URLSearchParams();
  params.set('co', state.co);
  params.set('view', state.view);
  if (state.view === 'search') {
    if (state.q) params.set('q', state.q);
    if (state.type && state.type !== 'all') params.set('type', state.type);
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
    if (state.page > 1) params.set('page', String(state.page));
  } else if (state.view === 'hull' || state.view === 'serial' || state.view === 'customer') {
    if (state.q) params.set('q', state.q);
    if (state.page > 1) params.set('page', String(state.page));
  } else if (state.view === 'record') {
    if (state.kind) params.set('kind', state.kind);
    if (state.id != null) params.set('id', String(state.id));
  }
  const qs = params.toString();
  return location.pathname + (qs ? '?' + qs : '');
}

function here() {
  return location.pathname + location.search;
}

function blankState(co) {
  return { co: co, view: 'search', q: '', type: 'all', from: '', to: '', page: 1, kind: '', id: null };
}

function nameKey(value) {
  const collapsed = String(value == null ? '' : value).replace(/[ \f\n\r\t\v\u00a0]+/g, ' ').trim().toLowerCase();
  return collapsed;
}

function formatIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!match) return '';
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return month + '/' + day + '/' + Number(match[1]);
}

function formatMoney(value) {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n).toFixed(2).split('.');
  abs[0] = abs[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + '$' + abs[0] + '.' + abs[1];
}

function dash(value) {
  if (value == null || String(value).trim() === '') return '\u2014';
  return String(value);
}

function showDate(rec, typedKey, rawKey) {
  const typed = typedKey ? rec[typedKey] : null;
  if (typed != null && String(typed).trim() !== '') {
    const formatted = formatIso(typed);
    if (formatted) return formatted;
  }
  const raw = rec[rawKey];
  if (raw == null || String(raw).trim() === '') return '\u2014';
  return String(raw);
}

function showRawDate(raw) {
  if (raw == null || String(raw).trim() === '') return '\u2014';
  return formatIso(raw) || String(raw);
}

function showMoney(rec, typedKey, rawKey) {
  const typed = rec[typedKey];
  if (typed != null && String(typed).trim() !== '') {
    const formatted = formatMoney(typed);
    if (formatted) return formatted;
  }
  const raw = rec[rawKey];
  if (raw == null || String(raw).trim() === '') return '\u2014';
  return String(raw);
}

function lookupText(rec, rawKey, idKey, nameKeyName, phrase) {
  const name = rec[nameKeyName];
  if (name != null && String(name).trim() !== '') return String(name);
  let id = '';
  const raw = rec[rawKey];
  if (raw != null && String(raw).trim() !== '') id = String(raw);
  else if (rec[idKey] != null && String(rec[idKey]).trim() !== '') id = String(rec[idKey]);
  if (!id) return '\u2014';
  return id + ' ' + phrase;
}

function isMissing(error) {
  const code = (error && (error.code || error.error_code)) || '';
  return code === 'PGRST202' || code === '42883' || code === '42P01' || code === '3F000';
}

function showGate(error) {
  const missing = isMissing(error);
  document.body.classList.remove('archive-booting');
  document.body.classList.toggle('archive-unavailable', missing);
  document.body.classList.toggle('archive-load-error', !missing);
  document.getElementById('archive-gate').textContent = missing ? NOT_READY : LOAD_ERROR;
  document.getElementById('screen').replaceChildren();
}

async function rpc(name, args) {
  try {
    const client = window.InmarAuth && window.InmarAuth.client;
    if (!client || typeof client.rpc !== 'function') return { error: { code: '' } };
    return await client.rpc(name, args);
  } catch (e) {
    return { error: e || { code: '' } };
  }
}

function syncChrome(state) {
  const systems = document.getElementById('co-systems');
  const solutions = document.getElementById('co-solutions');
  systems.classList.toggle('picked', state.co === 'systems');
  solutions.classList.toggle('picked', state.co === 'solutions');
  systems.setAttribute('aria-pressed', state.co === 'systems' ? 'true' : 'false');
  solutions.setAttribute('aria-pressed', state.co === 'solutions' ? 'true' : 'false');
  document.getElementById('search-q').value = state.view === 'search' ? state.q : '';
  document.getElementById('search-from').value = state.view === 'search' ? state.from : '';
  document.getElementById('search-to').value = state.view === 'search' ? state.to : '';
  ['all', 'quote', 'invoice'].forEach((type) => {
    const button = document.getElementById('type-' + type);
    const on = (state.type || 'all') === type;
    button.classList.toggle('picked', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const nameEl = document.getElementById('signed-in-name');
  if (nameEl && window.InmarAuth) nameEl.textContent = window.InmarAuth.currentName() || '';
}

function pickedType() {
  if (document.getElementById('type-quote').classList.contains('picked')) return 'quote';
  if (document.getElementById('type-invoice').classList.contains('picked')) return 'invoice';
  return 'all';
}

function formState() {
  const co = current && current.co ? current.co : (remembered() || 'solutions');
  return {
    co: co,
    view: 'search',
    q: document.getElementById('search-q').value,
    type: pickedType(),
    from: document.getElementById('search-from').value,
    to: document.getElementById('search-to').value,
    page: 1,
    kind: '',
    id: null
  };
}

function navigate(state, replace) {
  const url = urlFor(state);
  if (url !== here()) {
    if (replace) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
  }
  return render(state);
}

async function loadLookups(co, my) {
  const res = await rpc('archive_lookups', { p_company: co });
  if (my !== seq) return false;
  if (!res || res.error) {
    showGate(res && res.error);
    return false;
  }
  cache[co] = res.data || {};
  document.getElementById('archive-gate').textContent = '';
  document.body.classList.remove('archive-unavailable', 'archive-load-error');
  return true;
}

function showScreenError(error) {
  if (isMissing(error)) {
    showGate(error);
    return;
  }
  document.getElementById('screen').replaceChildren(el('p', 'msg', LOAD_ERROR));
}

function addBanner(parent) {
  parent.appendChild(el('p', 'banner', BANNER));
}

function pager(state, page, end, total) {
  const bar = el('div', 'pager no-print');
  const prev = el('button', 'secondary', 'Previous');
  prev.type = 'button';
  prev.disabled = page <= 1;
  prev.addEventListener('click', () => navigate(Object.assign({}, state, { page: page - 1 })));
  const next = el('button', 'secondary', 'Next');
  next.type = 'button';
  next.disabled = !(Number.isFinite(total) && total > end);
  next.addEventListener('click', () => navigate(Object.assign({}, state, { page: page + 1 })));
  bar.append(prev, next);
  return bar;
}

function rowButton(row, co) {
  const kind = row.kind === 'invoice' ? 'invoice' : 'quote';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hit';
  btn.addEventListener('click', () => {
    navigate({
      co: co,
      view: 'record',
      kind: kind,
      id: row.old_id,
      q: '',
      type: 'all',
      from: '',
      to: '',
      page: 1
    });
  });
  const top = document.createElement('div');
  const dayText = row.day == null || String(row.day).trim() === '' ? '\u2014' : (formatIso(row.day) || String(row.day));
  top.append(
    el('span', 'tag', kind === 'invoice' ? 'Invoice' : 'Quote'),
    document.createTextNode(' '),
    el('span', null, dash(row.doc_number)),
    document.createTextNode(' '),
    el('span', null, dayText)
  );
  btn.appendChild(top);
  btn.appendChild(el('div', null, dash(row.customer)));
  btn.appendChild(el('div', null, dash(row.project)));
  if (kind === 'quote') btn.appendChild(el('div', null, dash(row.item)));
  else {
    btn.appendChild(el('div', null, dash(row.serial_number)));
    const amount = row.amount == null || String(row.amount).trim() === '' ? '\u2014' : (formatMoney(row.amount) || String(row.amount));
    btn.appendChild(el('div', null, amount));
  }
  return btn;
}

function addCustomerBlurb(parent, state) {
  if (state.co !== 'solutions') {
    parent.appendChild(el('p', 'note', 'Names spelled differently show separately.'));
    return;
  }
  const customers = (cache.solutions && cache.solutions.customers) || [];
  const want = nameKey(state.q);
  const hits = want ? customers.filter((row) => row && (nameKey(row.name) === want || row.name_key === want)) : [];
  if (!hits.length) {
    parent.appendChild(el('p', 'note', 'Not in the Solutions customer list.'));
    return;
  }
  hits.forEach((row) => {
    parent.appendChild(el('div', 'lbl', 'Customer ID'));
    parent.appendChild(el('div', null, row.id == null ? '\u2014' : String(row.id)));
    parent.appendChild(el('div', 'lbl', 'Tax certificate expiration'));
    parent.appendChild(el('div', null, showRawDate(row.tax_certificate_expiration)));
  });
}

async function showList(state, my) {
  const screen = document.getElementById('screen');
  if (String(state.q || '').trim() === '') return;
  if (state.view === 'hull') screen.appendChild(el('h2', null, 'Hull history: ' + state.q));
  if (state.view === 'serial') {
    screen.appendChild(el('h2', null, 'Serial history: ' + state.q));
    screen.appendChild(el('p', 'note', "Invoices only. Quotes don't record serials."));
  }
  if (state.view === 'customer') {
    screen.appendChild(el('h2', null, state.q));
    addCustomerBlurb(screen, state);
  }
  const kind = state.view === 'serial' ? 'invoice' : (state.view === 'search' ? (state.type || 'all') : 'all');
  const res = await rpc('archive_list', {
    p_company: state.co,
    p_mode: state.view === 'search' ? 'search' : state.view,
    p_q: state.q,
    p_kind: kind,
    p_from: state.view === 'search' ? (state.from || null) : null,
    p_to: state.view === 'search' ? (state.to || null) : null,
    p_page: state.page || 1
  });
  if (my !== seq) return;
  if (!res || res.error) {
    showScreenError(res && res.error);
    return;
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  addBanner(screen);
  if (!rows.length) {
    screen.appendChild(el('p', 'msg', 'No matches.'));
    return;
  }
  const total = Number(rows[0].total);
  const page = state.page || 1;
  const start = (page - 1) * 50 + 1;
  const end = start + rows.length - 1;
  const shown = Number.isFinite(total) ? String(total) : String(rows.length);
  screen.appendChild(el('p', 'count', 'Showing ' + start + '\u2013' + end + ' of ' + shown));
  rows.forEach((row) => screen.appendChild(rowButton(row, state.co)));
  screen.appendChild(pager(state, page, end, total));
}

function linkButton(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'linkish';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function fieldNode(rec, field, co) {
  if (field.kind === 'date') return el('div', null, showDate(rec, field.typed, field.key));
  if (field.kind === 'money') return el('div', null, showMoney(rec, field.typed, field.key));
  if (field.kind === 'vendor') return el('div', null, lookupText(rec, 'vendor', 'vendor_id', 'vendor_name', '(not in vendor list)'));
  if (field.kind === 'industry') return el('div', null, lookupText(rec, 'industry', 'industry_id', 'industry_name', '(not in industry list)'));
  const text = rec[field.key];
  const missing = text == null || String(text).trim() === '';
  if (field.kind === 'customer' && !missing) {
    return linkButton(String(text), () => navigate(Object.assign(blankState(co), { view: 'customer', q: String(text) })));
  }
  if (field.kind === 'hull' && !missing) {
    return linkButton(String(text), () => navigate(Object.assign(blankState(co), { view: 'hull', q: String(text) })));
  }
  if (field.kind === 'serial' && !missing) {
    return linkButton(String(text), () => navigate(Object.assign(blankState(co), { view: 'serial', q: String(text) })));
  }
  if (field.kind === 'comments') return el('div', 'pre', missing ? '\u2014' : String(text));
  return el('div', null, missing ? '\u2014' : String(text));
}

function fieldsFor(co, kind) {
  if (kind === 'invoice') return co === 'solutions' ? SOL_INVOICE_FIELDS : SYS_INVOICE_FIELDS;
  return QUOTE_FIELDS;
}

function renderRecord(parent, co, kind, rec) {
  parent.replaceChildren();
  if (!rec) {
    addBanner(parent);
    parent.appendChild(el('p', 'msg', 'No matches.'));
    return;
  }
  const number = kind === 'invoice' ? rec.invoice_number : rec.quote_number;
  const heading = (kind === 'invoice' ? 'Invoice ' : 'Quote ') + (number == null || String(number).trim() === '' ? '\u2014' : String(number));
  parent.appendChild(el('h2', null, heading));
  parent.appendChild(el('p', null, companyName(co)));
  addBanner(parent);
  fieldsFor(co, kind).forEach((field) => {
    const wrap = el('div', 'field');
    wrap.appendChild(el('div', 'lbl', field.label));
    wrap.appendChild(fieldNode(rec, field, co));
    parent.appendChild(wrap);
  });
  const idWrap = el('div', 'field');
  idWrap.appendChild(el('div', 'lbl', 'Old site ID'));
  idWrap.appendChild(el('div', null, rec.old_id == null ? '\u2014' : String(rec.old_id)));
  parent.appendChild(idWrap);
  const bar = el('div', 'toolbar no-print');
  const printBtn = el('button', null, 'Print');
  printBtn.type = 'button';
  printBtn.addEventListener('click', () => window.print());
  const copyBtn = el('button', 'secondary', 'Copy link');
  copyBtn.type = 'button';
  const note = el('p', 'note no-print', '');
  copyBtn.addEventListener('click', () => copyLink(note));
  const backBtn = el('button', 'secondary', 'Back');
  backBtn.type = 'button';
  backBtn.addEventListener('click', () => history.back());
  bar.append(printBtn, copyBtn, backBtn);
  parent.append(bar, note);
}

async function copyLink(note) {
  const url = location.href;
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      ok = true;
    }
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    const area = document.createElement('textarea');
    area.value = url;
    area.setAttribute('readonly', '');
    document.body.appendChild(area);
    area.select();
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    area.remove();
  }
  note.textContent = ok ? 'Link copied.' : '';
}

async function showRecord(state, my) {
  const screen = document.getElementById('screen');
  if ((state.kind !== 'quote' && state.kind !== 'invoice') || state.id == null) {
    renderRecord(screen, state.co, state.kind, null);
    return;
  }
  const res = await rpc('archive_record', {
    p_company: state.co,
    p_kind: state.kind,
    p_old_id: state.id
  });
  if (my !== seq) return;
  if (!res || res.error) {
    showScreenError(res && res.error);
    return;
  }
  renderRecord(screen, state.co, state.kind, res.data);
}

function addLookup(parent, title, rows) {
  parent.appendChild(el('h2', null, title));
  (rows || []).forEach((row) => {
    const line = el('div', 'lookup');
    const id = row && row.id != null && String(row.id).trim() !== '' ? String(row.id) : '\u2014';
    const name = row && row.name != null && String(row.name).trim() !== '' ? String(row.name) : '\u2014';
    line.append(el('span', null, id), document.createTextNode(' '), el('span', null, name));
    parent.appendChild(line);
  });
}

function renderLists(state) {
  const screen = document.getElementById('screen');
  const data = cache[state.co] || {};
  addBanner(screen);
  addLookup(screen, 'Vendors', data.vendors);
  addLookup(screen, 'Payment types', data.payment_types);
  addLookup(screen, 'Quoted by', data.quoted_by);
  addLookup(screen, 'Company', data.companies);
  if (state.co !== 'solutions') return;
  addLookup(screen, 'Industries', data.industries);
  screen.appendChild(el('h2', null, 'Customers'));
  (data.customers || []).forEach((row) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hit';
    const id = row && row.id != null ? String(row.id) : '\u2014';
    const name = row && row.name != null && String(row.name).trim() !== '' ? String(row.name) : '\u2014';
    btn.append(
      el('span', null, id),
      document.createTextNode(' '),
      el('span', null, name),
      document.createTextNode(' '),
      el('span', null, showRawDate(row && row.tax_certificate_expiration))
    );
    if (row && row.name != null && String(row.name).trim() !== '') {
      const customerName = String(row.name);
      btn.addEventListener('click', () => navigate(Object.assign(blankState('solutions'), { view: 'customer', q: customerName })));
    }
    screen.appendChild(btn);
  });
}

async function renderBody(state, my) {
  if (state.view === 'lists') {
    renderLists(state);
    return;
  }
  if (state.view === 'record') {
    await showRecord(state, my);
    return;
  }
  await showList(state, my);
}

async function render(state) {
  const my = ++seq;
  current = state;
  remember(state.co);
  syncChrome(state);
  document.getElementById('screen').replaceChildren();
  if (!cache[state.co]) {
    const ok = await loadLookups(state.co, my);
    if (!ok || my !== seq) return;
  }
  if (my !== seq) return;
  document.body.classList.remove('archive-booting');
  await renderBody(state, my);
}

async function enter() {
  document.body.classList.remove('auth-locked');
  document.body.classList.add('archive-booting');
  document.body.classList.remove('archive-unavailable', 'archive-load-error');
  const state = readUrl();
  remember(state.co);
  const url = urlFor(state);
  if (url !== here()) history.replaceState(state, '', url);
  await render(state);
}

function bindChrome() {
  document.getElementById('search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const next = formState();
    if (String(next.q).trim() === '') {
      const my = ++seq;
      current = next;
      remember(next.co);
      syncChrome(next);
      document.getElementById('screen').replaceChildren();
      const url = urlFor(next);
      if (url !== here()) history.pushState(next, '', url);
      if (my !== seq) return;
      return;
    }
    navigate(next);
  });
  document.getElementById('lists-btn').addEventListener('click', () => {
    const co = current && current.co ? current.co : (remembered() || 'solutions');
    navigate(Object.assign(blankState(co), { view: 'lists' }));
  });
  document.getElementById('co-systems').addEventListener('click', () => {
    if (current && current.co === 'systems') return;
    remember('systems');
    navigate(blankState('systems'));
  });
  document.getElementById('co-solutions').addEventListener('click', () => {
    if (current && current.co === 'solutions') return;
    remember('solutions');
    navigate(blankState('solutions'));
  });
  ['all', 'quote', 'invoice'].forEach((type) => {
    document.getElementById('type-' + type).addEventListener('click', () => {
      ['all', 'quote', 'invoice'].forEach((name) => {
        const button = document.getElementById('type-' + name);
        const on = name === type;
        button.classList.toggle('picked', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  });
  document.getElementById('sign-out-btn').addEventListener('click', async () => {
    seq += 1;
    if (window.InmarAuth) await window.InmarAuth.signOut();
    location.reload();
  });
  window.addEventListener('popstate', () => {
    if (document.body.classList.contains('auth-locked')) return;
    render(readUrl());
  });
}

bindChrome();
window.InmarArchive = { enter: enter, renderRecord: renderRecord };
if (window.InmarAuth) {
  window.InmarAuth.bindLoginForm(() => { enter(); });
  window.InmarAuth.restore().then((ok) => { if (ok) enter(); });
}
