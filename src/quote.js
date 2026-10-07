import { quoteMarkup } from "./quote-markup.js";

function shop() {
  const api = window.InmarShop;
  if (!api) throw new Error("Shop is not ready");
  return api;
}

export const FIND_DRAFT_BANNER = 'Draft — current rows';

export function findSearchText(raw) {
  return String(raw || '').replace(/[%_\\]/g, '').trim();
}

export function findReprintAllowed(kind, quoteStatus, invoiceStatus, parentStatus) {
  if (kind === 'quote') return quoteStatus !== 'void';
  if (kind === 'invoice') {
    if (invoiceStatus === 'approved') return true;
    return parentStatus !== 'void';
  }
  return false;
}

export function findVoidNoteText(kind, quoteNumber, quoteStatus, invoiceStatus, parentNumber, parentStatus) {
  if (kind === 'quote' && quoteStatus === 'void') {
    const n = String(quoteNumber || '').trim() || 'This quote';
    return `${n} is void. Start a new quote to bring this deal back.`;
  }
  if (kind === 'invoice' && invoiceStatus !== 'approved' && parentStatus === 'void') {
    const n = String(parentNumber || '').trim() || 'This quote';
    return `${n} is void. This invoice can't be approved.`;
  }
  return '';
}

export const SHOP_TZ = 'America/Chicago';
export const FIND_LIST_CAP = 50;

// Date-only values stay on that calendar day. Timestamps use America/Chicago, not UTC midnight.
export function shopCalendarDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return formatChicagoYmd(value);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return '';
  return formatChicagoYmd(new Date(ms));
}

export function shopToday(now) {
  return shopCalendarDate(now || new Date());
}

export function addCivilDays(ymd, delta) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta));
  return utc.toISOString().slice(0, 10);
}

export function shopDayStartIso(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  let guess = Date.UTC(y, mo - 1, d, 6, 0, 0);
  for (let i = 0; i < 6; i++) {
    const got = chicagoClock(new Date(guess));
    if (!got) return '';
    const want = Date.UTC(y, mo - 1, d, 0, 0, 0);
    const have = Date.UTC(got.y, got.m - 1, got.d, got.h, got.min, got.s);
    const diff = want - have;
    if (diff === 0) return new Date(guess).toISOString();
    guess += diff;
  }
  return '';
}

export function findDateWindow(fromRaw, toRaw) {
  let from = ymdOnly(fromRaw);
  let to = ymdOnly(toRaw);
  if (!from && !to) return null;
  if (!from) from = to;
  if (!to) to = from;
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  return { from, to };
}

export function quoteFindDate(row) {
  if (!row) return '';
  if (row.created_at) {
    const created = shopCalendarDate(row.created_at);
    if (created) return created;
  }
  if (row.quote_date) {
    const quoted = shopCalendarDate(row.quote_date);
    if (quoted) return quoted;
  }
  return shopCalendarDate(row.updated_at);
}

// Approved sale day is approved_at in Chicago when that stamp exists. Otherwise invoice_date.
export function invoiceFindDate(row) {
  if (!row) return '';
  if (row.status === 'approved' && row.approved_at) {
    const sold = shopCalendarDate(row.approved_at);
    if (sold) return sold;
  }
  return shopCalendarDate(row.invoice_date);
}

export function findNarrowCopy(hasWindow) {
  return hasWindow ? 'Narrow the dates.' : 'Narrow the search.';
}

export function assembleFindHits(items, window, cap) {
  const limit = cap > 0 ? cap : FIND_LIST_CAP;
  const seen = new Set();
  const rows = [];
  let truncated = false;
  (items || []).forEach(item => {
    if (!item) return;
    if (item.truncated) truncated = true;
    if (!item.row || item.row.id == null || item.row.id === '') return;
    const kind = item.kind === 'invoice' ? 'invoice' : 'quote';
    const key = kind + ':' + item.row.id;
    if (seen.has(key)) return;
    const when = kind === 'invoice' ? invoiceFindDate(item.row) : quoteFindDate(item.row);
    if (window && (!when || when < window.from || when > window.to)) return;
    seen.add(key);
    rows.push({
      kind,
      row: item.row,
      when,
      stamp: Number.isFinite(item.stamp) ? item.stamp : 0
    });
  });
  rows.sort((a, b) => {
    if (a.when !== b.when) return a.when < b.when ? 1 : -1;
    if (a.stamp !== b.stamp) return b.stamp - a.stamp;
    return String(b.row.number || '').localeCompare(String(a.row.number || ''), undefined, { numeric: true });
  });
  return { rows: rows.slice(0, limit), capped: truncated || rows.length > limit };
}

function ymdOnly(raw) {
  const s = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function formatChicagoYmd(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const pick = (type) => {
    const part = parts.find(p => p.type === type);
    return part ? part.value : '';
  };
  const y = pick('year');
  const m = pick('month').padStart(2, '0');
  const d = pick('day').padStart(2, '0');
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return '';
  return `${y}-${m}-${d}`;
}

function chicagoClock(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const num = (type) => {
    const part = parts.find(p => p.type === type);
    return part ? Number(part.value) : NaN;
  };
  let y = num('year');
  let mo = num('month');
  let d = num('day');
  let h = num('hour');
  let min = num('minute');
  let s = num('second');
  if (![y, mo, d, h, min, s].every(Number.isFinite)) return null;
  if (h === 24) {
    h = 0;
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    y = next.getUTCFullYear();
    mo = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return { y, m: mo, d, h, min, s };
}

let installed = false;

export function installQuote() {
  if (installed) return;
  installed = true;
  const root = document.getElementById("quote");
  if (root && !root.dataset.installed) {
    root.innerHTML = quoteMarkup;
    root.dataset.installed = "1";
  }

  let quotesListCache = [];
  let editingQuoteId = null;
  let loadedQuoteStatus = '';
  let currentQuoteInvoices = [];
  let printedDraftLines = null;
  let approvedInvoiceByQuote = {};
  let invoiceSaveBusy = false;
  let findView = null;

  // Save, print, packing, and draft invoices do not change qty. Approve does, on the server.
  let quoteCart = JSON.parse(localStorage.getItem('inv_quote') || '[]');

  function saveQuoteCart() {
    localStorage.setItem('inv_quote', JSON.stringify(quoteCart));
    renderQuotePanel();
    if (document.getElementById('quote-invoices')) {
      renderQuoteInvoiceRows(currentQuoteInvoices, { syncApproved: false });
    }
  }

  function emptyWorkingCart() {
    quoteCart = [];
    saveQuoteCart();
  }

  function addToQuote(id) {
    const item = shop().inventory.find(i => i.id === id);
    if (!item) return;
    const existing = quoteCart.find(c => c.id === id || (c.inventory_id && c.inventory_id === id));
    if (existing) {
      existing.qty = (existing.qty || 1) + 1;
    } else {
      quoteCart.push({
        id: item.id,
        inventory_id: item.id,
        part_number: item.part_number,
        name: item.name,
        qty: 1,
        unit_price: item.sell_price != null ? Number(item.sell_price) : 0
      });
    }
    const by = document.getElementById('quote-by');
    if (by && !by.value && shop().currentUser()) by.value = shop().currentUser();
    saveQuoteCart();
    shop().showStatus(`Added “${item.part_number}” to quote`, 'success');
  }

  function updateQuoteLine(idx, field, value) {
    if (!quoteCart[idx]) return;
    if (field === 'qty') quoteCart[idx].qty = Math.max(1, parseInt(value) || 1);
    if (field === 'unit_price') quoteCart[idx].unit_price = parseFloat(value) || 0;
    saveQuoteCart();
  }

  function removeQuoteLine(idx) {
    quoteCart.splice(idx, 1);
    saveQuoteCart();
  }

  function clearQuote() {
    if (quoteCart.length && !confirm('Clear the working cart? (Saved quotes in the database are kept.)')) return;
    quoteCart = [];
    editingQuoteId = null;
    const eid = document.getElementById('quote-edit-id');
    if (eid) eid.value = '';
    resetQuoteInvoiceUi();
    const st = document.getElementById('quote-status');
    if (st) st.value = 'draft';
    const num = document.getElementById('quote-number');
    if (num) num.value = '';
    saveQuoteCart();
    shop().showStatus('Cart cleared', 'info');
  }

  function lineShelfQty(c) {
    const key = c && (c.inventory_id || c.id);
    if (!key) return null;
    const item = (shop().inventory || []).find(i => i.id === key);
    if (!item || item.qty == null || item.qty === '') return null;
    const n = Number(item.qty);
    return Number.isFinite(n) ? n : null;
  }

  function renderQuotePanel() {
    const badge = document.getElementById('quote-count-badge');
    if (badge) badge.textContent = quoteCart.length ? `(${quoteCart.length} line${quoteCart.length > 1 ? 's' : ''})` : '';
    const el = document.getElementById('quote-lines');
    if (!el) return;
    if (quoteCart.length === 0) {
      el.innerHTML = '<p class="empty">No items yet — add from Home or Scan.</p>';
      return;
    }
    let total = 0;
    el.innerHTML = `
      <table>
        <thead><tr><th>Part</th><th>Qty</th><th>Unit $</th><th>Line</th><th></th></tr></thead>
        <tbody>
          ${quoteCart.map((c, idx) => {
            const line = (c.qty || 1) * (c.unit_price || 0);
            total += line;
            const want = Number(c.qty) || 0;
            const shelf = lineShelfQty(c);
            const shortNote = shelf != null && want > shelf
              ? `<div style="font-size:0.75rem;color:var(--warning);margin-top:0.2rem;">wants ${want} / shelf ${shelf}</div>`
              : '';
            return `<tr>
              <td><strong>${shop().escapeHtml(c.name)}</strong><br><code style="font-size:0.75rem;color:var(--muted)">${shop().escapeHtml(c.part_number)}</code></td>
              <td><input type="number" min="1" value="${c.qty}" style="width:70px;margin:0" onchange="updateQuoteLine(${idx},'qty',this.value)">${shortNote}</td>
              <td><input type="number" min="0" step="0.01" value="${c.unit_price}" style="width:90px;margin:0" onchange="updateQuoteLine(${idx},'unit_price',this.value)"></td>
              <td>${shop().money(line)}</td>
              <td><button class="danger" onclick="removeQuoteLine(${idx})">×</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="text-align:right;font-weight:700;margin-top:0.75rem;font-size:1.1rem;">Total: ${shop().money(total)}</div>
    `;
  }

  function quoteCartTotal() {
    return quoteCart.reduce((s, c) => s + (c.qty || 1) * (c.unit_price || 0), 0);
  }

  function addDaysIso(iso, days) {
    const d = iso ? new Date(iso + 'T12:00:00') : new Date();
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function defaultQuoteValid() {
    const dt = document.getElementById('quote-date')?.value;
    return addDaysIso(dt || new Date().toISOString().slice(0, 10), 90);
  }

  function lookupStoreKey(kind) {
    return 'inv_lookups_' + kind;
  }

  function localLookups(kind) {
    try {
      const arr = JSON.parse(localStorage.getItem(lookupStoreKey(kind)) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveLocalLookup(kind, value) {
    const v = String(value || '').trim();
    if (!v) return;
    const arr = localLookups(kind);
    if (!arr.some(x => x.toLowerCase() === v.toLowerCase())) {
      arr.push(v);
      try { localStorage.setItem(lookupStoreKey(kind), JSON.stringify(arr)); } catch (e) {}
    }
    if (shop().supabaseClient) {
      shop().supabaseClient.from('app_lookups').upsert({ kind, value: v }).then(() => {}, () => {});
    }
  }

  function comboValue(prefix) {
    const sel = document.getElementById('quote-' + prefix + '-select');
    const inp = document.getElementById('quote-' + prefix);
    if (sel && sel.value && sel.value !== '__custom__') return sel.value.trim();
    return (inp?.value || '').trim();
  }

  function setComboValue(prefix, value) {
    const sel = document.getElementById('quote-' + prefix + '-select');
    const inp = document.getElementById('quote-' + prefix);
    const v = String(value || '').trim();
    if (!sel) {
      if (inp) inp.value = v;
      return;
    }
    const match = [...sel.options].some(o => o.value === v && o.value !== '' && o.value !== '__custom__');
    if (match) {
      sel.value = v;
      if (inp) { inp.value = v; inp.style.display = 'none'; }
    } else if (v) {
      sel.value = '__custom__';
      if (inp) { inp.value = v; inp.style.display = ''; }
    } else {
      sel.value = '';
      if (inp) { inp.value = ''; inp.style.display = 'none'; }
    }
  }

  function onComboSelect(prefix) {
    const sel = document.getElementById('quote-' + prefix + '-select');
    const inp = document.getElementById('quote-' + prefix);
    if (!sel || !inp) return;
    if (sel.value === '__custom__') {
      inp.style.display = '';
      inp.value = '';
      inp.focus();
    } else {
      inp.value = sel.value;
      inp.style.display = 'none';
    }
  }

  async function fillComboSelect(prefix, extras) {
    const sel = document.getElementById('quote-' + prefix + '-select');
    if (!sel) return;
    const current = comboValue(prefix);
    const kind = prefix === 'fob' ? 'fob' : 'payment_terms';
    const set = new Set(extras || []);
    localLookups(kind).forEach(v => set.add(v));
    if (shop().supabaseClient) {
      try {
        const { data } = await shop().supabaseClient.from('app_lookups').select('value').eq('kind', kind);
        (data || []).forEach(r => { if (r.value) set.add(r.value); });
      } catch (e) {}
    }
    const opts = ['<option value="">— Select —</option>'];
    [...set].filter(Boolean).sort((a, b) => a.localeCompare(b)).forEach(v => {
      opts.push(`<option value="${shop().escapeHtml(v)}">${shop().escapeHtml(v)}</option>`);
    });
    opts.push('<option value="__custom__">Other (type and save)…</option>');
    sel.innerHTML = opts.join('');
    setComboValue(prefix, current);
  }

  async function refreshQuoteLookups() {
    await fillComboSelect('fob', ['Origin', 'Destination']);
    const termExtras = ['Due on receipt', 'Net 15', 'Net 30', 'Net 45', 'Net 60'];
    if (shop().supabaseClient && shop().hasQuotesTables) {
      try {
        const { data } = await shop().supabaseClient.from('customers').select('payment_terms');
        (data || []).forEach(c => { if (c.payment_terms) termExtras.push(c.payment_terms); });
      } catch (e) {}
    }
    await fillComboSelect('terms', termExtras);
  }

  async function findCustomerByName(name) {
    if (!name || !shop().supabaseClient || !shop().hasQuotesTables) return null;
    try {
      const { data } = await shop().supabaseClient.from('customers')
        .select('id,payment_terms,name').ilike('name', name).limit(1);
      return (data && data[0]) || null;
    } catch (e) {
      return null;
    }
  }

  async function onQuoteCustomerChange() {
    const name = (document.getElementById('quote-customer')?.value || '').trim();
    if (!name) return;
    const row = await findCustomerByName(name);
    if (row && row.payment_terms) setComboValue('terms', row.payment_terms);
  }

  async function nextDocNumber(docType) {
    const client = shop().supabaseClient;
    if (!client) {
      shop().showStatus("Couldn't assign a document number — try again", 'error');
      throw new Error('Not connected');
    }
    const { data, error } = await client.rpc('shop_next_doc_number', { doc_type: docType });
    if (error || data == null || data === '') {
      console.warn('shop_next_doc_number', error);
      shop().showStatus("Couldn't assign a document number — try again", 'error');
      throw error || new Error('no number');
    }
    return data;
  }

  async function ensureQuotesTables() {
    if (!shop().supabaseClient) return false;
    if (shop().hasQuotesTables) return true;
    const probe = await shop().supabaseClient.from('quotes').select('id').limit(1);
    shop().hasQuotesTables = !probe.error;
    return shop().hasQuotesTables;
  }

  async function loadCustomerSuggestions() {
    const list = document.getElementById('customer-suggestions');
    if (!list || !shop().supabaseClient || !shop().hasQuotesTables) return;
    const { data } = await shop().supabaseClient.from('customers').select('name,company').order('name').limit(200);
    const names = new Set();
    (data || []).forEach(c => {
      if (c.name) names.add(c.name);
      if (c.company) names.add(c.company);
    });
    list.innerHTML = [...names].sort().map(n => `<option value="${shop().escapeHtml(n)}">`).join('');
  }

  function quoteIsLiveStatus(status) {
    return status === 'draft' || status === 'sent' || status === 'accepted';
  }

  function quoteStatusLabel(status) {
    if (status === 'void') return 'Voided';
    if (status === 'expired') return 'Expired';
    if (status === 'sent') return 'Sent';
    if (status === 'accepted') return 'Accepted';
    if (status === 'draft' || !status) return 'Draft';
    return status;
  }

  async function loadQuotesList() {
    const hint = document.getElementById('quotes-schema-hint');
    const listEl = document.getElementById('quotes-list');
    if (!shop().supabaseClient) return;
    const ok = await ensureQuotesTables();
    if (!ok) {
      if (hint) hint.textContent = 'Run Phase 1 SQL on More to save quotes.';
      if (listEl) listEl.innerHTML = '<p class="empty">Install quotes SQL to save and list quotes.</p>';
      return;
    }
    if (hint) hint.textContent = 'Live unsold only.';
    const { data, error } = await shop().supabaseClient.from('quotes')
      .select('id,number,customer_name,status,quote_date,valid_until,prepared_by,updated_at')
      .in('status', ['draft', 'sent', 'accepted'])
      .order('updated_at', { ascending: false });
    if (error) {
      quotesListCache = [];
      if (listEl) listEl.innerHTML = `<p class="empty">${shop().escapeHtml(shop().plainDbError(error, 'load'))}</p>`;
      return;
    }
    const rows = data || [];
    const approved = await loadApprovedInvoiceNumbers(rows.map(q => q.id).filter(Boolean));
    if (approved.error) {
      // A failed approved-invoice check must not leave sold quotes on this list.
      quotesListCache = [];
      console.warn(approved.error);
      if (listEl) listEl.innerHTML = `<p class="empty">${shop().escapeHtml(shop().plainDbError(approved.error, 'load'))}</p>`;
      return;
    }
    quotesListCache = rows.filter(q => quoteIsLiveStatus(q.status) && !approvedInvoiceByQuote[q.id]);
    await loadCustomerSuggestions();
    renderQuotesList();
  }

  async function loadApprovedInvoiceNumbers(ids) {
    approvedInvoiceByQuote = {};
    const clean = (ids || []).filter(Boolean);
    if (!clean.length || !shop().supabaseClient) {
      rememberApprovedFromCurrent();
      return { error: null };
    }
    const chunkSize = 80;
    for (let i = 0; i < clean.length; i += chunkSize) {
      const slice = clean.slice(i, i + chunkSize);
      const { data, error } = await shop().supabaseClient.from('invoices')
        .select('quote_id,number,status')
        .eq('status', 'approved')
        .in('quote_id', slice);
      if (error) {
        rememberApprovedFromCurrent();
        return { error };
      }
      (data || []).forEach(row => {
        if (row && row.quote_id && row.status === 'approved' && !approvedInvoiceByQuote[row.quote_id]) {
          approvedInvoiceByQuote[row.quote_id] = row.number || 'This invoice';
        }
      });
    }
    rememberApprovedFromCurrent();
    return { error: null };
  }

  function rememberApprovedFromCurrent() {
    const id = currentQuoteId();
    if (!id) return;
    const row = currentQuoteInvoices.find(r => r && r.status === 'approved');
    if (row) approvedInvoiceByQuote[id] = row.number || approvedInvoiceByQuote[id] || 'This invoice';
  }

  function voidBlockedMessage(number) {
    const n = String(number || '').trim() || 'This invoice';
    return `${n} is approved. Voiding this quote won't undo the sale.`;
  }

  function linesLockedMessage(number) {
    const n = String(number || '').trim() || 'This invoice';
    return `${n} is approved. This quote's lines can't change after the sale.`;
  }

  function quoteVoidedMessage(number) {
    const n = String(number || '').trim() || 'This quote';
    return `${n} is void. This invoice can't be approved.`;
  }

  function openQuoteIsVoid() {
    return (document.getElementById('quote-status')?.value || '') === 'void';
  }

  function voidFinalMessage(number) {
    const n = String(number || '').trim() || 'This quote';
    return `${n} is void. Start a new quote to bring this deal back.`;
  }

  function quoteIsVoidFinal() {
    return !!currentQuoteId() && loadedQuoteStatus === 'void';
  }

  function dbErrorRaw(error) {
    return [error && error.message, error && error.details, error && error.hint]
      .filter(v => v != null && String(v).trim())
      .map(v => String(v))
      .join('\n');
  }

  function isVoidLockError(error) {
    return /is void/i.test(dbErrorRaw(error));
  }

  function showQuoteSaveError(error, kind) {
    if (isVoidLockError(error)) {
      loadedQuoteStatus = 'void';
      const st = document.getElementById('quote-status');
      if (st) st.value = 'void';
      renderQuoteInvoiceRows(currentQuoteInvoices);
      shop().showStatus(voidFinalMessage(document.getElementById('quote-number')?.value), 'error');
      return;
    }
    const raw = dbErrorRaw(error);
    const locked = shop().lockedShopSentence(raw);
    if (locked) {
      shop().showStatus(locked, 'error');
      return;
    }
    if (/project|rfq_number|fob_point|payment_terms|lead_time/i.test(error && error.message || '')) {
      shop().showStatus('Save failed — run Phase 2 SQL on More for the new quote fields', 'error');
      return;
    }
    shop().showStatus(shop().plainDbError(error, 'save'), 'error');
  }

  function quoteLineRows(quoteId) {
    return quoteCart.map((c, i) => ({
      quote_id: quoteId,
      line_no: i + 1,
      inventory_id: c.inventory_id || c.id || null,
      part_number: c.part_number || null,
      name: c.name || 'Item',
      qty: c.qty || 1,
      unit_price: c.unit_price || 0
    }));
  }

  async function writeQuoteHeader(quoteId, payload) {
    const run = (body) => {
      if (quoteId) return shop().supabaseClient.from('quotes').update(body).eq('id', quoteId);
      return shop().supabaseClient.from('quotes').insert(body).select('id').maybeSingle();
    };
    let res = await run(payload);
    if (res.error && /project|rfq_number|fob_point|payment_terms|lead_time/i.test(res.error.message || '')) {
      const slim = { ...payload };
      delete slim.project;
      delete slim.rfq_number;
      delete slim.fob_point;
      delete slim.payment_terms;
      delete slim.lead_time;
      res = await run(slim);
    }
    return { error: res.error || null, id: quoteId || (res.data && res.data.id) || null };
  }

  async function insertQuoteLines(quoteId) {
    const { error } = await shop().supabaseClient.from('quote_lines').insert(quoteLineRows(quoteId));
    return error || null;
  }

  // Lines are replaced while the parent is still not void. The seal update comes after.
  async function replaceQuoteLines(quoteId) {
    const removed = await shop().supabaseClient.from('quote_lines').delete().eq('quote_id', quoteId);
    if (removed.error) return removed.error;
    return insertQuoteLines(quoteId);
  }

  async function blockingApprovedNumber(quoteId) {
    if (!quoteId) return '';
    if (quoteId === currentQuoteId()) {
      const row = currentQuoteInvoices.find(r => r && r.status === 'approved');
      if (row) return row.number || approvedInvoiceByQuote[quoteId] || 'This invoice';
    }
    if (approvedInvoiceByQuote[quoteId]) return approvedInvoiceByQuote[quoteId];
    if (!shop().supabaseClient) return '';
    const { data, error } = await shop().supabaseClient.from('invoices')
      .select('number,status')
      .eq('quote_id', quoteId)
      .eq('status', 'approved')
      .limit(1);
    if (error) return null;
    const number = data && data[0] ? (data[0].number || 'This invoice') : '';
    if (number) approvedInvoiceByQuote[quoteId] = number;
    return number;
  }

  function renderQuotesList() {
    const listEl = document.getElementById('quotes-list');
    if (!listEl) return;
    const rows = quotesListCache.filter(q => quoteIsLiveStatus(q.status) && !approvedInvoiceByQuote[q.id]);
    if (!rows.length) {
      listEl.innerHTML = '<p class="empty">No live quotes.</p>';
      return;
    }
    listEl.innerHTML = `
      <table>
        <thead><tr><th>Number</th><th>Customer</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody>
          ${rows.map(q => `
            <tr>
              <td><code>${shop().escapeHtml(q.number)}</code></td>
              <td>${shop().escapeHtml(q.customer_name || '—')}</td>
              <td><span class="badge ${q.status === 'accepted' ? 'open-order' : 'source-tag'}">${shop().escapeHtml(quoteStatusLabel(q.status))}</span></td>
              <td style="font-size:0.8rem;color:var(--muted)">${shop().escapeHtml(q.quote_date || '')}</td>
              <td class="actions">
                <button type="button" class="secondary" onclick="openQuote('${q.id}')">Open</button>
                <button type="button" class="secondary" onclick="printQuoteById('${q.id}')">Print</button>
                <button type="button" class="secondary" onclick="duplicateQuoteById('${q.id}')">Dup</button>
                <button type="button" class="secondary" ${approvedInvoiceByQuote[q.id] ? 'disabled style="opacity:0.45"' : ''} onclick="voidQuoteById('${q.id}')">Void quote</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function startNewQuote(opts) {
    emptyWorkingCart();
    editingQuoteId = null;
    loadedQuoteStatus = '';
    document.getElementById('quote-edit-id').value = '';
    resetQuoteInvoiceUi();
    document.getElementById('quote-status').value = 'draft';
    document.getElementById('quote-number').value = '';
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('quote-date').value = today;
    document.getElementById('quote-valid').value = addDaysIso(today, 90);
    document.getElementById('quote-by').value = shop().currentUser() || '';
    document.getElementById('quote-project').value = '';
    document.getElementById('quote-rfq').value = '';
    document.getElementById('quote-lead').value = '';
    document.getElementById('quote-notes').value = '';
    document.getElementById('quote-customer').value = '';
    const invBox = document.getElementById('invoice-box');
    if (invBox) invBox.style.display = 'none';
    await refreshQuoteInvoices();
    if (shop().hasQuotesTables) {
      document.getElementById('quote-number').value = await nextDocNumber('quote');
    }
    await refreshQuoteLookups();
    setComboValue('fob', '');
    setComboValue('terms', '');
    renderQuotePanel();
    if (!opts || !opts.keepStatus) {
      shop().showStatus('Builder ready — add lines then Save quote', 'info');
    }
  }

  async function openQuote(id) {
    if (String(id || '') !== currentQuoteId()) resetQuoteInvoiceUi();
    if (!(await ensureQuotesTables())) {
      shop().showStatus('Quotes tables not installed', 'error');
      await refreshQuoteInvoices();
      return;
    }
    const { data: q, error } = await shop().supabaseClient.from('quotes').select('*').eq('id', id).maybeSingle();
    if (error || !q) {
      shop().showStatus(error ? shop().plainDbError(error, 'load') : 'Quote not found', 'error');
      await refreshQuoteInvoices();
      return;
    }
    const { data: lines } = await shop().supabaseClient.from('quote_lines')
      .select('*').eq('quote_id', id).order('line_no');
    editingQuoteId = q.id;
    loadedQuoteStatus = q.status || '';
    document.getElementById('quote-edit-id').value = q.id;
    document.getElementById('quote-number').value = q.number || '';
    document.getElementById('quote-status').value = q.status || 'draft';
    document.getElementById('quote-date').value = q.quote_date || '';
    document.getElementById('quote-valid').value = q.valid_until || '';
    document.getElementById('quote-customer').value = q.customer_name || '';
    const proj = document.getElementById('quote-project');
    if (proj) proj.value = q.project || '';
    const rfq = document.getElementById('quote-rfq');
    if (rfq) rfq.value = q.rfq_number || '';
    const lead = document.getElementById('quote-lead');
    if (lead) lead.value = q.lead_time || '';
    document.getElementById('quote-by').value = q.prepared_by || shop().currentUser() || '';
    document.getElementById('quote-notes').value = q.notes || '';
    await refreshQuoteLookups();
    setComboValue('fob', q.fob_point || '');
    setComboValue('terms', q.payment_terms || '');
    document.getElementById('quote-save-customer').checked = false;
    quoteCart = (lines || []).map(l => ({
      id: l.inventory_id || l.id,
      inventory_id: l.inventory_id,
      part_number: l.part_number,
      name: l.name,
      qty: Number(l.qty) || 1,
      unit_price: Number(l.unit_price) || 0
    }));
    saveQuoteCart();
    await refreshQuoteInvoices();
    shop().showStatus(`Opened ${q.number}`, 'success');
  }

  async function saveQuoteToDb() {
    if (!shop().requireUser('saving quotes')) return false;
    if (!(await ensureQuotesTables())) {
      shop().showStatus('Run Phase 1 quotes SQL on the More tab first', 'error');
      return false;
    }
    const existingId = editingQuoteId || document.getElementById('quote-edit-id').value || '';
    let storedStatus = '';
    if (existingId) {
      const { data: stored, error: storedErr } = await shop().supabaseClient.from('quotes')
        .select('number,status')
        .eq('id', existingId)
        .maybeSingle();
      if (storedErr) {
        shop().showStatus("Couldn't check the quote — it was not saved", 'error');
        return false;
      }
      if (stored && stored.status === 'void') {
        loadedQuoteStatus = 'void';
        const st = document.getElementById('quote-status');
        if (st) st.value = 'void';
        const numEl = document.getElementById('quote-number');
        if (numEl && stored.number) numEl.value = stored.number;
        renderQuoteInvoiceRows(currentQuoteInvoices);
        shop().showStatus(voidFinalMessage(stored.number || numEl?.value), 'error');
        return false;
      }
      storedStatus = stored && stored.status ? stored.status : '';
      const blockedNum = await blockingApprovedNumber(existingId);
      if (blockedNum === null) {
        shop().showStatus("Couldn't check invoices — quote was not saved", 'error');
        return false;
      }
      if (blockedNum) {
        applySaleLocks();
        shop().showStatus(linesLockedMessage(blockedNum), 'error');
        return false;
      }
    }
    if (quoteCart.length === 0) {
      shop().showStatus('Add at least one line before saving', 'error');
      return false;
    }
    const requestedStatus = document.getElementById('quote-status').value || 'draft';
    let number = (document.getElementById('quote-number').value || '').trim();
    if (!number) {
      number = await nextDocNumber('quote');
      document.getElementById('quote-number').value = number;
    }
    const customerName = (document.getElementById('quote-customer').value || '').trim();
    const project = (document.getElementById('quote-project')?.value || '').trim();
    const rfq = (document.getElementById('quote-rfq')?.value || '').trim();
    const fob = comboValue('fob');
    const terms = comboValue('terms');
    const lead = (document.getElementById('quote-lead')?.value || '').trim();
    if (fob) saveLocalLookup('fob', fob);
    if (terms) saveLocalLookup('payment_terms', terms);
    let customerId = null;
    if (document.getElementById('quote-save-customer')?.checked && customerName) {
      const existing = await findCustomerByName(customerName);
      if (existing?.id) {
        customerId = existing.id;
        await shop().supabaseClient.from('customers').update({ payment_terms: terms || null, updated_at: new Date().toISOString() }).eq('id', customerId);
      } else {
        const { data: created, error: cErr } = await shop().supabaseClient.from('customers')
          .insert({ name: customerName, payment_terms: terms || null }).select('id').maybeSingle();
        if (cErr) console.warn(cErr);
        else customerId = created?.id;
      }
    }
    const payload = {
      number,
      customer_id: customerId,
      customer_name: customerName || null,
      project: project || null,
      rfq_number: rfq || null,
      fob_point: fob || null,
      payment_terms: terms || null,
      lead_time: lead || null,
      status: requestedStatus,
      quote_date: document.getElementById('quote-date').value || null,
      valid_until: document.getElementById('quote-valid').value || null,
      prepared_by: (document.getElementById('quote-by').value || '').trim() || shop().currentUser() || null,
      notes: (document.getElementById('quote-notes').value || '').trim() || null,
      created_by: shop().currentUser(),
      updated_at: new Date().toISOString()
    };
    let quoteId = existingId || null;
    const sealingVoid = requestedStatus === 'void' && storedStatus !== 'void';
    if (quoteId && sealingVoid) {
      const lineErr = await replaceQuoteLines(quoteId);
      if (lineErr) {
        showQuoteSaveError(lineErr, 'before-header');
        return false;
      }
      const written = await writeQuoteHeader(quoteId, payload);
      if (written.error) {
        showQuoteSaveError(written.error, 'header');
        return false;
      }
    } else if (quoteId) {
      const written = await writeQuoteHeader(quoteId, payload);
      if (written.error) {
        showQuoteSaveError(written.error, 'header');
        return false;
      }
      const lineErr = await replaceQuoteLines(quoteId);
      if (lineErr) {
        showQuoteSaveError(lineErr, 'lines');
        return false;
      }
    } else if (sealingVoid) {
      const written = await writeQuoteHeader(null, { ...payload, status: 'draft' });
      if (written.error || !written.id) {
        showQuoteSaveError(written.error || { message: "Couldn't save the quote" }, 'header');
        return false;
      }
      quoteId = written.id;
      editingQuoteId = quoteId;
      document.getElementById('quote-edit-id').value = quoteId;
      loadedQuoteStatus = 'draft';
      const lineErr = await insertQuoteLines(quoteId);
      if (lineErr) {
        showQuoteSaveError(lineErr, 'lines');
        return false;
      }
      const sealed = await shop().supabaseClient.from('quotes')
        .update({ status: 'void', updated_at: new Date().toISOString() })
        .eq('id', quoteId);
      if (sealed.error) {
        showQuoteSaveError(sealed.error, 'header');
        return false;
      }
    } else {
      const written = await writeQuoteHeader(null, payload);
      if (written.error || !written.id) {
        showQuoteSaveError(written.error || { message: "Couldn't save the quote" }, 'header');
        return false;
      }
      quoteId = written.id;
      const lineErr = await insertQuoteLines(quoteId);
      if (lineErr) {
        showQuoteSaveError(lineErr, 'lines');
        return false;
      }
    }
    if (!quoteId) {
      shop().showStatus("Couldn't save the quote — invoice was not created", 'error');
      return false;
    }
    editingQuoteId = quoteId;
    document.getElementById('quote-edit-id').value = quoteId;
    loadedQuoteStatus = requestedStatus;
    shop().showStatus(`Quote ${number} saved (${shop().currentUser()})`, 'success');
    if (requestedStatus === 'void') emptyWorkingCart();
    await refreshQuoteInvoices();
    await loadQuotesList();
    return !!currentQuoteId();
  }

  async function saveAsNewQuote() {
    if (!shop().requireUser('saving quotes')) return false;
    if (!(await ensureQuotesTables())) {
      shop().showStatus('Run Phase 1 quotes SQL on the More tab first', 'error');
      return false;
    }
    if (!quoteCart.length) {
      shop().showStatus('Add at least one line before saving', 'error');
      return false;
    }
    const lines = quoteCart.map(c => ({ ...c }));
    editingQuoteId = null;
    loadedQuoteStatus = '';
    const edit = document.getElementById('quote-edit-id');
    if (edit) edit.value = '';
    resetQuoteInvoiceUi();
    const setVal = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };
    const today = new Date().toISOString().slice(0, 10);
    setVal('quote-status', 'draft');
    setVal('quote-number', '');
    setVal('quote-customer', '');
    setVal('quote-project', '');
    setVal('quote-rfq', '');
    setVal('quote-lead', '');
    setVal('quote-notes', '');
    setVal('quote-date', today);
    setVal('quote-valid', addDaysIso(today, 90));
    setVal('quote-by', shop().currentUser() || '');
    const saveCustomer = document.getElementById('quote-save-customer');
    if (saveCustomer) saveCustomer.checked = false;
    const invBox = document.getElementById('invoice-box');
    if (invBox) invBox.style.display = 'none';
    setComboValue('fob', '');
    setComboValue('terms', '');
    quoteCart = lines;
    saveQuoteCart();
    return saveQuoteToDb();
  }

  async function voidQuoteById(id) {
    if (!shop().requireUser('voiding quotes')) return;
    if (!id) {
      shop().showStatus('Open a saved quote to void it', 'error');
      return;
    }
    const blockedNum = await blockingApprovedNumber(id);
    if (blockedNum === null) {
      shop().showStatus("Couldn't check invoices — quote was not voided", 'error');
      return;
    }
    if (blockedNum) {
      applySaleLocks();
      renderQuotesList();
      shop().showStatus(voidBlockedMessage(blockedNum), 'error');
      return;
    }
    const row = quotesListCache.find(q => q.id === id);
    const num = row?.number || document.getElementById('quote-number')?.value || 'this quote';
    if (!confirm(`Void ${num}? The number stays. Stock is not put back.`)) return;
    const { error } = await shop().supabaseClient.from('quotes')
      .update({ status: 'void', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      if (isVoidLockError(error)) {
        const openNow = String(editingQuoteId || document.getElementById('quote-edit-id')?.value || '');
        if (openNow && openNow === String(id)) {
          loadedQuoteStatus = 'void';
          const st = document.getElementById('quote-status');
          if (st) st.value = 'void';
          await refreshQuoteInvoices();
        }
        shop().showStatus(voidFinalMessage(row?.number || document.getElementById('quote-number')?.value), 'error');
        return;
      }
      shop().showStatus(shop().plainDbError(error, 'save'), 'error');
      return;
    }
    const openId = String(editingQuoteId || document.getElementById('quote-edit-id')?.value || '');
    if (openId && openId === String(id)) {
      loadedQuoteStatus = 'void';
      const st = document.getElementById('quote-status');
      if (st) st.value = 'void';
      emptyWorkingCart();
      await refreshQuoteInvoices();
    }
    shop().showStatus(`${num} voided. Stock unchanged.`, 'success');
    await loadQuotesList();
  }

  async function voidCurrentQuote() {
    const id = editingQuoteId || document.getElementById('quote-edit-id')?.value;
    if (!id) {
      shop().showStatus('Open a saved quote to void it', 'error');
      return;
    }
    await voidQuoteById(id);
  }

  async function duplicateCurrentQuote() {
    if (!quoteCart.length) {
      shop().showStatus('Nothing to duplicate', 'error');
      return;
    }
    editingQuoteId = null;
    loadedQuoteStatus = '';
    document.getElementById('quote-edit-id').value = '';
    document.getElementById('quote-status').value = 'draft';
    resetQuoteInvoiceUi();
    if (!(await ensureQuotesTables())) return;
    document.getElementById('quote-number').value = await nextDocNumber('quote');
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('quote-date').value = today;
    document.getElementById('quote-valid').value = addDaysIso(today, 90);
    const by = document.getElementById('quote-by');
    if (by && shop().currentUser()) by.value = shop().currentUser();
    await refreshQuoteInvoices();
    shop().showStatus('Duplicated as new draft — click Save quote', 'info');
  }

  async function duplicateQuoteById(id) {
    await openQuote(id);
    await duplicateCurrentQuote();
  }

  async function printQuoteById(id) {
    await openQuote(id);
    generateQuote();
  }

  function collectQuoteHeader() {
    return {
      number: document.getElementById('quote-number')?.value || 'Q-XXXX',
      date: document.getElementById('quote-date')?.value || new Date().toISOString().slice(0, 10),
      valid: document.getElementById('quote-valid')?.value || '',
      customer: document.getElementById('quote-customer')?.value || '',
      project: document.getElementById('quote-project')?.value || '',
      rfq: document.getElementById('quote-rfq')?.value || '',
      by: document.getElementById('quote-by')?.value || shop().currentUser() || '',
      notes: document.getElementById('quote-notes')?.value || '',
      status: document.getElementById('quote-status')?.value || 'draft',
      fob: comboValue('fob'),
      terms: comboValue('terms'),
      lead: document.getElementById('quote-lead')?.value || ''
    };
  }

  function printDocWindow(title, bodyHtml) {
    const html = `<!DOCTYPE html>
  <html><head><meta charset="UTF-8"><title>${shop().escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #1e293b; margin: 0; padding: 24px; font-size: 13px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a5f; padding-bottom: 16px; margin-bottom: 20px; }
    .logo { max-height: 56px; width: auto; }
    .doc-title { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; color: #1e3a5f; }
    .meta { text-align: right; font-size: 13px; line-height: 1.5; }
    .info { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 20px; }
    .info span { color: #64748b; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #f1f5f9; text-align: left; padding: 8px; border: 1px solid #cbd5e1; font-size: 12px; }
    td { padding: 8px; border: 1px solid #cbd5e1; }
    .totals { margin-left: auto; width: 280px; }
    .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
    .totals .grand { font-size: 16px; font-weight: 700; border-top: 2px solid #1e3a5f; margin-top: 6px; padding-top: 6px; }
    .notes { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin-top: 16px; white-space: pre-wrap; }
    .legal { font-size: 11px; color: #475569; margin-top: 12px; }
    .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #64748b; }
    @media print { body { padding: 12px; } @page { margin: 0.6in; size: letter; } }
  </style></head><body>
  ${bodyHtml}
  <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 400); };<\/script>
  </body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      shop().showStatus('Pop-up blocked — allow pop-ups to print', 'error');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  function companyBlock() {
    return `<img class="logo" src="inmar-logo.jpg" alt="In-Mar Systems & Solutions" onerror="this.style.display='none'">
    <div style="font-size:11px;color:#64748b;margin-top:4px;">3011 S. Ruby Ave, Gonzales, LA 70737<br>(225) 430-9111 • info@inmarsystems.com</div>`;
  }

  function generateQuote() {
    if (quoteCart.length === 0) {
      shop().showStatus('Add at least one part to the quote first', 'error');
      return;
    }
    const data = collectQuoteHeader();
    if (!data.by) data.by = shop().currentUser();
    let total = 0;
    const rows = quoteCart.map(c => {
      const line = (c.qty || 1) * (c.unit_price || 0);
      total += line;
      return `<tr>
        <td style="font-family:monospace;font-size:12px;">${shop().escapeHtml(c.part_number)}</td>
        <td>${shop().escapeHtml(c.name)}</td>
        <td style="text-align:center;">${c.qty}</td>
        <td style="text-align:right;">${shop().money(c.unit_price)}</td>
        <td style="text-align:right;font-weight:600;">${shop().money(line)}</td>
      </tr>`;
    }).join('');
    printDocWindow('In-Mar Quote ' + data.number, `
    <div class="header">
  <div>${companyBlock()}</div>
  <div class="meta">
    <div class="doc-title">QUOTE</div>
    <div><strong>Quote #:</strong> ${shop().escapeHtml(data.number)}</div>
    ${data.rfq ? `<div><strong>RFQ #:</strong> ${shop().escapeHtml(data.rfq)}</div>` : ''}
    <div><strong>Status:</strong> ${shop().escapeHtml(data.status)}</div>
    <div><strong>Date:</strong> ${shop().escapeHtml(data.date)}</div>
    <div><strong>Valid Until:</strong> ${shop().escapeHtml(data.valid) || '—'}</div>
  </div>
    </div>
    <div class="info">
  <div><span>Customer:</span> ${shop().escapeHtml(data.customer) || '—'}</div>
  <div><span>Project:</span> ${shop().escapeHtml(data.project) || '—'}</div>
  <div><span>Prepared By:</span> ${shop().escapeHtml(data.by) || '—'}</div>
  <div><span>FOB:</span> ${shop().escapeHtml(data.fob) || '—'}</div>
  <div><span>Payment terms:</span> ${shop().escapeHtml(data.terms) || '—'}</div>
  <div><span>Lead time:</span> ${shop().escapeHtml(data.lead) || '—'}</div>
    </div>
    <table>
  <thead><tr><th>Part #</th><th>Description</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Total</th></tr></thead>
  <tbody>${rows}</tbody>
    </table>
    <div class="totals"><div class="grand"><span>Quoted total</span><span>${shop().money(total)}</span></div></div>
    <p class="legal">3.5% fee if paid by credit card. Prices in USD. Valid until the date shown.</p>
    <div><div style="font-weight:500;color:#64748b;margin-bottom:4px;">Notes</div><div class="notes">${shop().escapeHtml(data.notes) || '—'}</div></div>
    <div class="footer">Thank you for the opportunity to quote.<br>In-Mar Systems &amp; Solutions</div>`);
  }

  async function printPackingList() {
    if (quoteCart.length === 0) {
      shop().showStatus('Add quote lines first', 'error');
      return;
    }
    const data = collectQuoteHeader();
    let plNumber = '';
    try { plNumber = await nextDocNumber('packing_list'); } catch (e) { return; }
    const quoteId = editingQuoteId || document.getElementById('quote-edit-id')?.value || null;
    if (shop().supabaseClient && quoteId) {
      try {
        const { data: pl, error } = await shop().supabaseClient.from('packing_lists').insert({
          number: plNumber,
          quote_id: quoteId,
          customer_name: data.customer || null,
          project: data.project || null,
          pack_date: data.date,
          prepared_by: data.by || shop().currentUser(),
          notes: null,
          created_by: shop().currentUser()
        }).select('id').maybeSingle();
        if (!error && pl?.id) {
          await shop().supabaseClient.from('packing_list_lines').insert(quoteCart.map((c, i) => ({
            packing_list_id: pl.id,
            line_no: i + 1,
            inventory_id: c.inventory_id || c.id || null,
            part_number: c.part_number,
            name: c.name,
            qty: c.qty || 1
          })));
        }
      } catch (e) { /* print even if save tables missing */ }
    }
    const rows = quoteCart.map(c => `<tr>
      <td style="font-family:monospace;font-size:12px;">${shop().escapeHtml(c.part_number)}</td>
      <td>${shop().escapeHtml(c.name)}</td>
      <td style="text-align:center;font-weight:700;">${c.qty}</td>
    </tr>`).join('');
    printDocWindow('In-Mar Packing List ' + plNumber, `
    <div class="header">
  <div>${companyBlock()}</div>
  <div class="meta">
    <div class="doc-title">PACKING LIST</div>
    <div><strong>Packing list #:</strong> ${shop().escapeHtml(plNumber)}</div>
    <div><strong>Quote #:</strong> ${shop().escapeHtml(data.number)}</div>
    <div><strong>Date:</strong> ${shop().escapeHtml(data.date)}</div>
  </div>
    </div>
    <div class="info">
  <div><span>Customer / consignee:</span> ${shop().escapeHtml(data.customer) || '—'}</div>
  <div><span>Project:</span> ${shop().escapeHtml(data.project) || '—'}</div>
  <div><span>Prepared By:</span> ${shop().escapeHtml(data.by) || '—'}</div>
  <div><span>FOB / ship point:</span> ${shop().escapeHtml(data.fob) || '—'}</div>
    </div>
    <p class="legal">Contents only — not a quote or invoice.</p>
    <table>
  <thead><tr><th>Part #</th><th>Description</th><th style="text-align:center;">Qty shipped</th></tr></thead>
  <tbody>${rows}</tbody>
    </table>
    <div style="display:flex;gap:40px;margin-top:36px;">
  <div style="flex:1;border-top:1px solid #94a3b8;padding-top:6px;font-size:12px;color:#475569;">Packed by / date</div>
  <div style="flex:1;border-top:1px solid #94a3b8;padding-top:6px;font-size:12px;color:#475569;">Received by / date — contents checked</div>
    </div>
    <div class="footer">Check contents on receipt.<br>In-Mar Systems &amp; Solutions</div>`);
  }

  function invoiceMath() {
    const subtotal = quoteCartTotal();
    const shipping = parseFloat(document.getElementById('inv-shipfee')?.value) || 0;
    const duty = parseFloat(document.getElementById('inv-duty')?.value) || 0;
    const tariffs = parseFloat(document.getElementById('inv-tariffs')?.value) || 0;
    const goods = subtotal + shipping + duty + tariffs;
    const cc = document.getElementById('inv-cc')?.checked;
    const ccFee = cc ? Math.round(goods * 0.035 * 100) / 100 : 0;
    return { subtotal, shipping, duty, tariffs, ccFee, cc, total: goods + ccFee };
  }

  function updateInvoicePreview() {
    const el = document.getElementById('inv-preview');
    if (!el) return;
    const m = invoiceMath();
    el.innerHTML = `Merchandise ${shop().money(m.subtotal)} + shipping ${shop().money(m.shipping)} + duty ${shop().money(m.duty)} + tariffs ${shop().money(m.tariffs)}${m.cc ? ' + CC 3.5% ' + shop().money(m.ccFee) : ''} = <strong>${shop().money(m.total)}</strong> due`;
  }

  function currentQuoteId() {
    return String(editingQuoteId || document.getElementById('quote-edit-id')?.value || '').trim();
  }

  function quoteSaleBlocked() {
    if (!currentQuoteId()) return false;
    return currentQuoteInvoices.some(r => r && r.status === 'approved');
  }

  function newestOpenDraft() {
    const drafts = currentQuoteInvoices.filter(r => r && r.id && r.status !== 'approved');
    drafts.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    return drafts.length ? drafts[drafts.length - 1] : null;
  }

  function normLineId(value) {
    if (value == null) return '';
    return String(value).trim();
  }

  function normLineText(value) {
    return String(value ?? '').trim();
  }

  function normLineNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function lineFingerprint(line) {
    return [
      normLineId(line && line.inventory_id),
      normLineText(line && line.part_number),
      normLineText(line && line.name),
      String(normLineNum(line && line.qty)),
      String(normLineNum(line && line.unit_price))
    ].join('\u001f');
  }

  function draftMismatchMessage(number) {
    const n = String(number || '').trim() || 'this invoice';
    return `Quote changed since ${n} was printed. Save & print before Approve`;
  }

  // Approve still sells invoice_lines. This only compares the cart to that draft.
  function quoteDraftMismatch() {
    const draft = newestOpenDraft();
    if (!draft) return '';
    if (!printedDraftLines || printedDraftLines.id !== draft.id) return '';
    if (printedDraftLines.failed) return draftMismatchMessage(draft.number);
    const cartFp = quoteCart.map(lineFingerprint);
    const draftFp = (printedDraftLines.lines || []).map(lineFingerprint);
    if (cartFp.length !== draftFp.length) return draftMismatchMessage(draft.number);
    for (let i = 0; i < cartFp.length; i++) {
      if (cartFp[i] !== draftFp[i]) return draftMismatchMessage(draft.number);
    }
    return '';
  }

  function applySaleLocks() {
    const blocked = quoteSaleBlocked();
    const voidFinal = quoteIsVoidFinal();
    const voidBtn = document.getElementById('quote-void-btn');
    if (voidBtn) {
      voidBtn.disabled = blocked;
      voidBtn.style.opacity = blocked ? '0.45' : '';
    }
    const saveBtn = document.getElementById('quote-save-btn');
    if (saveBtn) {
      saveBtn.disabled = blocked;
      saveBtn.style.opacity = (blocked || voidFinal) ? '0.45' : '';
    }
    const saveNew = document.getElementById('quote-save-new-btn');
    if (saveNew) saveNew.hidden = !(blocked || voidFinal);
    const printBtn = document.getElementById('quote-save-print-btn');
    const voided = openQuoteIsVoid();
    if (printBtn) {
      printBtn.disabled = voided;
      printBtn.style.opacity = voided ? '0.45' : '';
    }
    const st = document.getElementById('quote-status');
    if (!st) return;
    st.disabled = voidFinal;
    st.style.opacity = voidFinal ? '0.45' : '';
    [...st.options].forEach(opt => {
      if (opt.value === 'void' || opt.value === 'expired') opt.disabled = blocked;
    });
  }

  function resetQuoteInvoiceUi() {
    currentQuoteInvoices = [];
    printedDraftLines = null;
    renderQuoteInvoiceRows([], { syncApproved: false });
  }

  async function ensureQuoteForInvoice() {
    if (currentQuoteId()) return true;
    if (!quoteCart.length) return false;
    try {
      const saved = await saveQuoteToDb();
      return saved === true && !!currentQuoteId();
    } catch (e) {
      return false;
    }
  }

  async function openInvoiceForm() {
    if (quoteCart.length === 0) {
      shop().showStatus('Add quote lines first', 'error');
      return;
    }
    if (!(await ensureQuoteForInvoice())) return;
    await refreshQuoteInvoices();
    if (quoteSaleBlocked()) {
      shop().showStatus('This quote already has an approved invoice.', 'error');
      return;
    }
    const box = document.getElementById('invoice-box');
    if (!box) return;
    const valid = document.getElementById('quote-valid')?.value;
    const due = document.getElementById('inv-due');
    if (due && !due.value) due.value = valid || '';
    box.style.display = 'block';
    updateInvoicePreview();
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderQuoteInvoiceRows(rows, opts) {
    const linked = !opts || opts.linked !== false;
    if (linked) {
      currentQuoteInvoices = rows || [];
      const syncApproved = !opts || opts.syncApproved !== false;
      const id = currentQuoteId();
      if (syncApproved && id) {
        const row = currentQuoteInvoices.find(r => r && r.status === 'approved');
        if (row) approvedInvoiceByQuote[id] = row.number || 'This invoice';
        else delete approvedInvoiceByQuote[id];
      }
    }
    const blocked = quoteSaleBlocked();
    applySaleLocks();
    if (linked && (!opts || opts.syncApproved !== false)) renderQuotesList();
    const btn = document.getElementById('quote-invoice-btn');
    if (btn) {
      btn.disabled = blocked;
      btn.style.opacity = blocked ? '0.45' : '';
    }
    const display = linked ? currentQuoteInvoices : (rows || []);
    const mismatchMsg = linked ? quoteDraftMismatch() : '';
    const note = document.getElementById('quote-sale-note');
    const list = document.getElementById('quote-invoices');
    if (note) {
      if (linked && blocked) {
        const approved = currentQuoteInvoices.find(r => r && r.status === 'approved');
        const num = approved && approved.number;
        note.style.display = 'block';
        note.style.whiteSpace = 'pre-line';
        note.textContent = `${voidBlockedMessage(num)}\n${linesLockedMessage(num)}`;
      } else if (linked && quoteIsVoidFinal()) {
        note.style.display = 'block';
        note.style.whiteSpace = '';
        note.textContent = voidFinalMessage(document.getElementById('quote-number')?.value);
      } else if (linked && openQuoteIsVoid() && display.some(r => r && r.status !== 'approved')) {
        note.style.display = 'block';
        note.style.whiteSpace = '';
        note.textContent = quoteVoidedMessage(document.getElementById('quote-number')?.value);
      } else if (linked && mismatchMsg) {
        note.style.display = 'block';
        note.style.whiteSpace = '';
        note.textContent = mismatchMsg;
      } else if (display.length) {
        note.style.display = 'block';
        note.style.whiteSpace = '';
        note.textContent = 'Drafts do not change stock. Approve does.';
      } else {
        note.style.display = 'none';
        note.style.whiteSpace = '';
        note.textContent = '';
      }
    }
    if (!list) return;
    if (!display.length) {
      list.innerHTML = '';
      return;
    }
    const quoteVoided = linked && openQuoteIsVoid();
    const quoteNum = document.getElementById('quote-number')?.value || '';
    list.innerHTML = display.map(r => {
      const isApproved = r.status === 'approved';
      const zombie = quoteVoided && !isApproved;
      const holdApprove = !isApproved && (zombie || !!mismatchMsg);
      return `<div class="btn-group" style="align-items:center;">
        <code>${shop().escapeHtml(r.number || '')}</code>
        <span class="badge ${isApproved ? 'open-order' : 'source-tag'}">${isApproved ? 'Approved' : 'Draft'}</span>
        ${zombie ? `<span>${shop().escapeHtml(quoteVoidedMessage(quoteNum))}</span>` : ''}
        <button type="button" class="tap" ${holdApprove ? 'disabled style="opacity:0.45"' : ''} onclick="approveInvoice('${r.id}')">Approve</button>
      </div>`;
    }).join('');
  }

  async function refreshQuoteInvoices() {
    const quoteId = currentQuoteId();
    if (!quoteId || !shop().supabaseClient) {
      currentQuoteInvoices = [];
      printedDraftLines = null;
      renderQuoteInvoiceRows([]);
      return;
    }
    const { data, error } = await shop().supabaseClient.from('invoices')
      .select('id,number,status,total,created_at')
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: true });
    if (currentQuoteId() !== quoteId) return;
    if (error) {
      console.warn(error);
      return;
    }
    currentQuoteInvoices = data || [];
    const draft = newestOpenDraft();
    if (!draft) {
      printedDraftLines = null;
    } else {
      const { data: lineData, error: lineErr } = await shop().supabaseClient.from('invoice_lines')
        .select('line_no,inventory_id,part_number,name,qty,unit_price')
        .eq('invoice_id', draft.id)
        .order('line_no', { ascending: true });
      if (currentQuoteId() !== quoteId) return;
      if (!newestOpenDraft() || newestOpenDraft().id !== draft.id) return;
      if (lineErr) {
        printedDraftLines = { id: draft.id, lines: [], failed: true };
      } else {
        const lines = (lineData || []).slice().sort((a, b) => (Number(a.line_no) || 0) - (Number(b.line_no) || 0));
        printedDraftLines = { id: draft.id, lines, failed: false };
      }
    }
    if (currentQuoteId() !== quoteId) return;
    renderQuoteInvoiceRows(currentQuoteInvoices);
  }

  function showApproveError(msg) {
    shop().showStatus(msg, 'error');
    const el = document.getElementById('status');
    if (!el || typeof el.scrollIntoView !== 'function') return;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    catch (e) { try { el.scrollIntoView(true); } catch (e2) {} }
  }

  function approveFailText(error) {
    const raw = [error && error.message, error && error.details, error && error.hint]
      .filter(v => v != null && String(v).trim())
      .map(v => String(v))
      .join('\n');
    if (/shop_approve_invoice/i.test(raw) && /schema cache|could not find the function|does not exist/i.test(raw)) {
      return "Couldn't approve — run the invoice SQL after every phone has been refreshed.";
    }
    const locked = shop().lockedShopSentence(raw);
    if (locked) return locked;
    return shop().plainDbError(error, 'approve');
  }

  async function approveInvoice(id) {
    if (!shop().requireUser('approving invoices')) return;
    if (!id || !shop().supabaseClient) {
      showApproveError("Couldn't approve — try again");
      return;
    }
    const row = currentQuoteInvoices.find(r => r && String(r.id) === String(id));
    const mismatchMsg = quoteDraftMismatch();
    if (mismatchMsg && (!row || row.status !== 'approved')) {
      showApproveError(mismatchMsg);
      return;
    }
    const { data, error } = await shop().supabaseClient.rpc('shop_approve_invoice', { p_invoice_id: id });
    const quoteId = currentQuoteId();
    if (error) {
      showApproveError(approveFailText(error));
      if (quoteId) await refreshQuoteInvoices();
      return;
    }
    const payload = data && typeof data === 'object' ? data : {};
    if (payload.already_approved) {
      shop().showStatus(`Already approved — ${payload.number || 'this invoice'}. Shelf unchanged.`, 'info');
      await startNewQuote({ keepStatus: true });
    } else if (payload.ok) {
      shop().showStatus(`${payload.number || 'Invoice'} approved. Parts left the shelf.`, 'success');
      await startNewQuote({ keepStatus: true });
    } else {
      showApproveError(approveFailText(payload));
      if (quoteId) await refreshQuoteInvoices();
      return;
    }
    await loadQuotesList();
  }

  function invoiceHeaderFields(data, m, po, shipTo, due, today) {
    return {
      customer_name: data.customer || null,
      project: data.project || null,
      po_number: po || null,
      ship_to: shipTo || null,
      invoice_date: today,
      due_date: due || null,
      fob_point: data.fob || null,
      payment_terms: data.terms || null,
      cc_used: !!m.cc,
      cc_fee_rate: 0.035,
      cc_fee_amount: m.ccFee,
      shipping_fee: m.shipping,
      duty: m.duty,
      tariffs: m.tariffs,
      subtotal: m.subtotal,
      total: m.total,
      prepared_by: data.by || shop().currentUser(),
      notes: data.notes || null,
      status: 'draft'
    };
  }

  function invoiceLinePayload(invoiceId) {
    return quoteCart.map((c, i) => ({
      invoice_id: invoiceId,
      line_no: i + 1,
      inventory_id: c.inventory_id || null,
      part_number: c.part_number || null,
      name: c.name || 'Item',
      qty: c.qty || 1,
      unit_price: c.unit_price || 0
    }));
  }

  function invoiceDocumentHtml(doc) {
    const rows = (doc.lines || []).map(c => {
      const line = (c.qty || 1) * (c.unit_price || 0);
      return `<tr>
        <td style="font-family:monospace;font-size:12px;">${shop().escapeHtml(c.part_number)}</td>
        <td>${shop().escapeHtml(c.name)}</td>
        <td style="text-align:center;">${c.qty}</td>
        <td style="text-align:right;">${shop().money(c.unit_price)}</td>
        <td style="text-align:right;font-weight:600;">${shop().money(line)}</td>
      </tr>`;
    }).join('');
    const banner = doc.banner
      ? `\n    <div><strong>${shop().escapeHtml(doc.banner)}</strong></div>`
      : '';
    const po = doc.po;
    const rfq = doc.rfq;
    return `
    <div class="header">
  <div>${companyBlock()}</div>
  <div class="meta">
    <div class="doc-title">INVOICE</div>${banner}
    <div><strong>Invoice #:</strong> ${shop().escapeHtml(doc.invNumber)}</div>
    <div><strong>Quote #:</strong> ${shop().escapeHtml(doc.quoteNumber)}</div>
    ${po ? `<div><strong>PO #:</strong> ${shop().escapeHtml(po)}</div>` : ''}
    ${rfq ? `<div><strong>RFQ #:</strong> ${shop().escapeHtml(rfq)}</div>` : ''}
    <div><strong>Invoice date:</strong> ${shop().escapeHtml(doc.invoiceDate)}</div>
    <div><strong>Due date:</strong> ${shop().escapeHtml(doc.due) || '—'}</div>
  </div>
    </div>
    <div class="info">
  <div><span>Bill to:</span> ${shop().escapeHtml(doc.customer) || '—'}</div>
  <div><span>Project:</span> ${shop().escapeHtml(doc.project) || '—'}</div>
  <div><span>Ship to:</span> ${shop().escapeHtml(doc.shipTo) || 'Same as bill to'}</div>
  <div><span>Prepared By:</span> ${shop().escapeHtml(doc.by) || '—'}</div>
  <div><span>FOB:</span> ${shop().escapeHtml(doc.fob) || '—'}</div>
  <div><span>Payment terms:</span> ${shop().escapeHtml(doc.terms) || '—'}</div>
    </div>
    <table>
  <thead><tr><th>Part #</th><th>Description</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
    </table>
    <div class="totals">
  <div><span>Merchandise</span><span>${shop().money(doc.subtotal)}</span></div>
  <div><span>Shipping</span><span>${shop().money(doc.shipping)}</span></div>
  <div><span>Duty</span><span>${shop().money(doc.duty)}</span></div>
  <div><span>Tariffs</span><span>${shop().money(doc.tariffs)}</span></div>
  ${doc.cc ? `<div><span>Credit card fee (3.5%)</span><span>${shop().money(doc.ccFee)}</span></div>` : ''}
  <div class="grand"><span>Amount due</span><span>${shop().money(doc.total)}</span></div>
    </div>
    <p class="legal">Please remit by the due date. Amounts in USD.${doc.cc ? ' Includes 3.5% card fee.' : ' 3.5% fee if paid by card.'}</p>
    <div><div style="font-weight:500;color:#64748b;margin-bottom:4px;">Notes</div><div class="notes">${shop().escapeHtml(doc.notes) || '—'}</div></div>
    <div class="footer">Please remit with invoice number ${shop().escapeHtml(doc.invNumber)}.<br>In-Mar Systems &amp; Solutions</div>`;
  }

  function printInvoiceDocument(doc) {
    printDocWindow('In-Mar Invoice ' + (doc.invNumber || ''), invoiceDocumentHtml(doc));
  }

  async function saveAndPrintInvoice() {
    if (invoiceSaveBusy) return;
    if (!shop().requireUser('creating invoices')) return;
    if (openQuoteIsVoid()) {
      shop().showStatus(quoteVoidedMessage(document.getElementById('quote-number')?.value), 'error');
      return;
    }
    if (quoteCart.length === 0) {
      shop().showStatus('Add quote lines first', 'error');
      return;
    }
    invoiceSaveBusy = true;
    try {
      if (!currentQuoteId()) {
        const saved = await ensureQuoteForInvoice();
        if (!saved || !currentQuoteId()) return;
      }
      await refreshQuoteInvoices();
      if (quoteSaleBlocked()) {
        shop().showStatus('This quote already has an approved invoice.', 'error');
        return;
      }
      const data = collectQuoteHeader();
      const m = invoiceMath();
      const po = (document.getElementById('inv-po')?.value || '').trim();
      const shipTo = (document.getElementById('inv-ship')?.value || '').trim();
      const due = document.getElementById('inv-due')?.value || data.valid || '';
      const today = new Date().toISOString().slice(0, 10);
      const quoteId = currentQuoteId() || null;
      if (!quoteId) {
        shop().showStatus("Couldn't save the quote — invoice was not created", 'error');
        return;
      }
      const draft = quoteId ? newestOpenDraft() : null;
      const header = invoiceHeaderFields(data, m, po, shipTo, due, today);
      let invNumber = '';
      if (!shop().supabaseClient) return;
      if (draft) {
        const { error } = await shop().supabaseClient.from('invoices').update(header).eq('id', draft.id);
        if (error) {
          console.warn(error);
          const raw = dbErrorRaw(error);
          if (/already has an approved invoice/i.test(raw)) {
            await refreshQuoteInvoices();
            shop().showStatus('This quote already has an approved invoice.', 'error');
          } else {
            shop().showStatus(shop().plainDbError(error, 'save'), 'error');
          }
          return;
        }
        const { error: delErr } = await shop().supabaseClient.from('invoice_lines').delete().eq('invoice_id', draft.id);
        if (delErr) {
          shop().showStatus("Couldn't update the draft invoice lines.", 'error');
          return;
        }
        const { error: lErr } = await shop().supabaseClient.from('invoice_lines').insert(invoiceLinePayload(draft.id));
        if (lErr) {
          shop().showStatus("Couldn't update the draft invoice lines.", 'error');
          return;
        }
        invNumber = draft.number || '';
        if (quoteId) await refreshQuoteInvoices();
        shop().showStatus(`Draft ${invNumber} updated. Stock unchanged until you Approve.`, 'success');
      } else {
        try { invNumber = await nextDocNumber('invoice'); } catch (e) { return; }
        const { data: inv, error } = await shop().supabaseClient.from('invoices').insert({
          number: invNumber,
          quote_id: quoteId || null,
          ...header,
          created_by: shop().currentUser()
        }).select('id').maybeSingle();
        if (error || !inv?.id) {
          console.warn(error);
          const raw = dbErrorRaw(error);
          if (/already has an approved invoice/i.test(raw)) {
            await refreshQuoteInvoices();
            shop().showStatus('This quote already has an approved invoice.', 'error');
          } else {
            shop().showStatus(shop().plainDbError(error, 'save'), 'error');
          }
          return;
        }
        const { error: lErr } = await shop().supabaseClient.from('invoice_lines').insert(invoiceLinePayload(inv.id));
        if (lErr) {
          await shop().supabaseClient.from('invoices').delete().eq('id', inv.id);
          shop().showStatus("Couldn't save the invoice lines. Draft was not kept.", 'error');
          return;
        }
        if (quoteId) await refreshQuoteInvoices();
        else renderQuoteInvoiceRows([{ id: inv.id, number: invNumber, status: 'draft', created_at: today }], { linked: false });
        shop().showStatus(`Draft ${invNumber} saved. Stock unchanged until you Approve.`, 'success');
      }
      printInvoiceDocument({
        invNumber,
        quoteNumber: data.number,
        po,
        rfq: data.rfq,
        invoiceDate: today,
        due,
        customer: data.customer,
        project: data.project,
        shipTo,
        by: data.by,
        fob: data.fob,
        terms: data.terms,
        notes: data.notes,
        lines: quoteCart,
        subtotal: m.subtotal,
        shipping: m.shipping,
        duty: m.duty,
        tariffs: m.tariffs,
        cc: m.cc,
        ccFee: m.ccFee,
        total: m.total,
        banner: ''
      });
    } finally {
      invoiceSaveBusy = false;
    }
  }

  const FIND_QUOTE_COLS = 'id,number,customer_name,status,quote_date,valid_until,prepared_by,notes,project,rfq_number,fob_point,payment_terms,lead_time';
  const FIND_INVOICE_COLS = 'id,number,quote_id,customer_name,project,po_number,ship_to,invoice_date,due_date,fob_point,payment_terms,cc_used,cc_fee_amount,shipping_fee,duty,tariffs,subtotal,total,prepared_by,notes,status';
  const FIND_LINE_COLS = 'line_no,part_number,name,qty,unit_price';

  function sortFindLines(lines) {
    return (lines || []).slice().sort((a, b) => (Number(a.line_no) || 0) - (Number(b.line_no) || 0));
  }

  function findDocId(id) {
    const s = String(id || '');
    return /^[0-9a-f-]{36}$/i.test(s) ? s : '';
  }

  function findStatusLabel(kind, status) {
    if (kind === 'invoice') return status === 'approved' ? 'Approved' : 'Draft';
    return quoteStatusLabel(status);
  }

  const FIND_QUOTE_LIST_COLS = 'id,number,customer_name,status,quote_date,created_at,updated_at';
  const FIND_INVOICE_LIST_COLS = 'id,number,quote_id,customer_name,status,invoice_date,approved_at,total';

  function findRowStamp(raw) {
    const s = String(raw || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 0;
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : 0;
  }

  function quoteListStamp(row) {
    return findRowStamp(row.created_at || row.quote_date || row.updated_at);
  }

  function invoiceListStamp(row) {
    const raw = row.status === 'approved' && row.approved_at ? row.approved_at : row.invoice_date;
    return findRowStamp(raw);
  }

  function readFindWindow() {
    const fromEl = document.getElementById('find-from');
    const toEl = document.getElementById('find-to');
    const dateWindow = findDateWindow(fromEl && fromEl.value, toEl && toEl.value);
    if (dateWindow && fromEl && toEl && fromEl.value && toEl.value && fromEl.value > toEl.value) {
      fromEl.value = dateWindow.from;
      toEl.value = dateWindow.to;
    }
    return dateWindow;
  }

  function findWindowBounds(dateWindow) {
    if (!dateWindow) return { startIso: '', endIso: '', from: '', to: '' };
    const endDay = addCivilDays(dateWindow.to, 1);
    return {
      startIso: shopDayStartIso(dateWindow.from),
      endIso: shopDayStartIso(endDay),
      from: dateWindow.from,
      to: dateWindow.to
    };
  }

  function quoteFindSpecs(bounds) {
    return [
      (q) => {
        let next = q.not('created_at', 'is', null);
        if (bounds.startIso) next = next.gte('created_at', bounds.startIso);
        if (bounds.endIso) next = next.lt('created_at', bounds.endIso);
        return next.order('created_at', { ascending: false });
      },
      (q) => {
        let next = q.is('created_at', null).not('quote_date', 'is', null);
        if (bounds.from) next = next.gte('quote_date', bounds.from);
        if (bounds.to) next = next.lte('quote_date', bounds.to);
        return next.order('quote_date', { ascending: false });
      },
      (q) => {
        let next = q.is('created_at', null).is('quote_date', null).not('updated_at', 'is', null);
        if (bounds.startIso) next = next.gte('updated_at', bounds.startIso);
        if (bounds.endIso) next = next.lt('updated_at', bounds.endIso);
        return next.order('updated_at', { ascending: false });
      }
    ];
  }

  function invoiceFindSpecs(bounds) {
    const specs = [
      (q) => {
        let next = q.eq('status', 'approved').not('approved_at', 'is', null);
        if (bounds.startIso) next = next.gte('approved_at', bounds.startIso);
        if (bounds.endIso) next = next.lt('approved_at', bounds.endIso);
        return next.order('approved_at', { ascending: false });
      },
      (q) => {
        let next = q.eq('status', 'approved').is('approved_at', null).not('invoice_date', 'is', null);
        if (bounds.from) next = next.gte('invoice_date', bounds.from);
        if (bounds.to) next = next.lte('invoice_date', bounds.to);
        return next.order('invoice_date', { ascending: false });
      },
      (q) => {
        let next = q.or('status.is.null,status.neq.approved').not('invoice_date', 'is', null);
        if (bounds.from) next = next.gte('invoice_date', bounds.from);
        if (bounds.to) next = next.lte('invoice_date', bounds.to);
        return next.order('invoice_date', { ascending: false });
      }
    ];
    if (!bounds.from && !bounds.to) {
      specs.push((q) => q.is('invoice_date', null).or('status.neq.approved,approved_at.is.null').order('created_at', { ascending: false }));
    }
    return specs;
  }

  async function runFindBuckets(table, columns, specs, pattern) {
    const columnsToSearch = pattern ? ['number', 'customer_name'] : [null];
    const rows = [];
    let truncated = false;
    for (const spec of specs) {
      for (const column of columnsToSearch) {
        let q = shop().supabaseClient.from(table).select(columns);
        q = spec(q);
        if (column) q = q.ilike(column, pattern);
        const { data, error } = await q.limit(FIND_LIST_CAP + 1);
        if (error) return { error, rows: [], truncated: false };
        const batch = data || [];
        if (batch.length > FIND_LIST_CAP) truncated = true;
        rows.push(...batch);
      }
    }
    return { error: null, rows, truncated };
  }

  function fillFindLast7() {
    const today = shopToday(new Date());
    const from = addCivilDays(today, -6);
    const fromEl = document.getElementById('find-from');
    const toEl = document.getElementById('find-to');
    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = today;
  }

  async function runFindLast7() {
    fillFindLast7();
    await runFindSearch();
  }

  function openFindFromQuotes() {
    if (typeof window.showPanel === 'function') window.showPanel('find');
    const box = document.getElementById('find-q');
    if (box) box.focus();
  }

  async function runFindSearch() {
    const results = document.getElementById('find-results');
    const detail = document.getElementById('find-detail');
    findView = null;
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = '';
    }
    if (results) results.hidden = false;
    const q = findSearchText(document.getElementById('find-q')?.value);
    const dateWindow = readFindWindow();
    if (!q && !dateWindow) {
      if (results) results.innerHTML = '<p class="empty">Type a number or customer, or pick dates. An empty search with no dates does not list the book.</p>';
      return;
    }
    if (!shop().supabaseClient) {
      if (results) results.innerHTML = '<p class="empty">Couldn\'t load — try again</p>';
      return;
    }
    if (!(await ensureQuotesTables())) {
      if (results) results.innerHTML = '<p class="empty">Run Phase 1 SQL on More to find quotes.</p>';
      return;
    }
    const bounds = findWindowBounds(dateWindow);
    if (dateWindow && (!bounds.startIso || !bounds.endIso)) {
      if (results) results.innerHTML = '<p class="empty">Couldn\'t load — try again</p>';
      return;
    }
    const pattern = q ? `%${q}%` : '';
    const quoteRes = await runFindBuckets('quotes', FIND_QUOTE_LIST_COLS, quoteFindSpecs(bounds), pattern);
    if (quoteRes.error) {
      console.warn(quoteRes.error);
      if (results) results.innerHTML = `<p class="empty">${shop().escapeHtml(shop().plainDbError(quoteRes.error, 'load'))}</p>`;
      return;
    }
    const invoiceRes = await runFindBuckets('invoices', FIND_INVOICE_LIST_COLS, invoiceFindSpecs(bounds), pattern);
    if (invoiceRes.error) {
      console.warn(invoiceRes.error);
      if (results) results.innerHTML = `<p class="empty">${shop().escapeHtml(shop().plainDbError(invoiceRes.error, 'load'))}</p>`;
      return;
    }
    const items = [];
    quoteRes.rows.forEach(row => items.push({ kind: 'quote', row, stamp: quoteListStamp(row) }));
    invoiceRes.rows.forEach(row => items.push({ kind: 'invoice', row, stamp: invoiceListStamp(row) }));
    if (quoteRes.truncated || invoiceRes.truncated) items.push({ truncated: true });
    const picked = assembleFindHits(items, dateWindow, FIND_LIST_CAP);
    const narrow = picked.capped ? `<p class="hint">${findNarrowCopy(!!dateWindow)}</p>` : '';
    if (!picked.rows.length) {
      if (results) results.innerHTML = `<p class="empty">No quotes or invoices match.</p>${narrow}`;
      return;
    }
    const hit = (entry) => {
      const row = entry.row;
      const id = findDocId(row.id);
      if (!id) return '';
      const extra = entry.kind === 'invoice'
        ? `${entry.when || ''} · ${shop().money(Number(row.total) || 0)}`
        : (entry.when || '');
      return `<button type="button" class="secondary tap find-hit" onclick="openFindDoc('${entry.kind}','${id}')">
        <code>${shop().escapeHtml(row.number || '')}</code>
        ${shop().escapeHtml(row.customer_name || '—')}
        · ${shop().escapeHtml(findStatusLabel(entry.kind, row.status))}
        ${extra ? `<div style="font-size:0.8rem;color:var(--muted);">${shop().escapeHtml(extra)}</div>` : ''}
      </button>`;
    };
    const quoteRows = picked.rows.filter(entry => entry.kind === 'quote');
    const invoiceRows = picked.rows.filter(entry => entry.kind === 'invoice');
    if (results) {
      results.innerHTML = `
        ${quoteRows.length ? `<h2>Quotes</h2>${quoteRows.map(hit).join('')}` : ''}
        ${invoiceRows.length ? `<h2>Invoices</h2>${invoiceRows.map(hit).join('')}` : ''}
        ${narrow}`;
    }
  }

  function showFindResults() {
    findView = null;
    const detail = document.getElementById('find-detail');
    const results = document.getElementById('find-results');
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = '';
    }
    if (results) results.hidden = false;
  }

  async function loadFindInvoice(id) {
    const client = shop().supabaseClient;
    const { data: inv, error } = await client.from('invoices').select(FIND_INVOICE_COLS).eq('id', id).maybeSingle();
    if (error) return { error };
    if (!inv) return { missing: true };
    const { data: lines, error: lineErr } = await client.from('invoice_lines').select(FIND_LINE_COLS).eq('invoice_id', id).order('line_no');
    if (lineErr) return { error: lineErr };
    let parent = null;
    if (inv.quote_id) {
      const { data: q, error: qErr } = await client.from('quotes').select('id,number,status,rfq_number').eq('id', inv.quote_id).maybeSingle();
      if (qErr) return { error: qErr };
      parent = q || null;
    }
    return { invoice: inv, lines: sortFindLines(lines), parent };
  }

  async function loadFindDoc(kind, id) {
    const client = shop().supabaseClient;
    if (!client) return { error: { message: "Couldn't load — try again" } };
    if (kind === 'invoice') return loadFindInvoice(id);
    const { data: quote, error } = await client.from('quotes').select(FIND_QUOTE_COLS).eq('id', id).maybeSingle();
    if (error) return { error };
    if (!quote) return { missing: true };
    const { data: lines, error: lineErr } = await client.from('quote_lines').select(FIND_LINE_COLS).eq('quote_id', id).order('line_no');
    if (lineErr) return { error: lineErr };
    const { data: invRows, error: invErr } = await client.from('invoices').select('id,number,status').eq('quote_id', id);
    if (invErr) return { error: invErr };
    const approved = (invRows || []).find(row => row && row.status === 'approved');
    let sold = null;
    if (approved && approved.id) {
      sold = await loadFindInvoice(approved.id);
      if (sold.error) return sold;
    }
    return { quote, lines: sortFindLines(lines), invoices: invRows || [], sold };
  }

  function findLoadedState(kind, loaded) {
    if (kind === 'quote') {
      return {
        quoteStatus: loaded.quote && loaded.quote.status,
        invoiceStatus: loaded.sold && loaded.sold.invoice ? loaded.sold.invoice.status : '',
        parentStatus: ''
      };
    }
    return {
      quoteStatus: '',
      invoiceStatus: loaded.invoice && loaded.invoice.status,
      parentStatus: loaded.parent && loaded.parent.status
    };
  }

  function renderFindLines(lines) {
    if (!lines || !lines.length) return '<p class="empty">No lines.</p>';
    return `<table>
      <thead><tr><th>Part</th><th>Qty</th><th>Unit $</th><th>Amount</th></tr></thead>
      <tbody>
        ${lines.map(line => {
          const qty = Number(line.qty) || 0;
          const price = Number(line.unit_price) || 0;
          return `<tr>
            <td><code>${shop().escapeHtml(line.part_number || '')}</code> ${shop().escapeHtml(line.name || '')}</td>
            <td>${qty}</td>
            <td>${shop().money(price)}</td>
            <td>${shop().money(qty * price)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }

  function renderFindDetail(kind, loaded) {
    const detail = document.getElementById('find-detail');
    const results = document.getElementById('find-results');
    if (!detail) return;
    if (results) results.hidden = true;
    detail.hidden = false;
    const state = findLoadedState(kind, loaded);
    const quoteNumber = kind === 'quote'
      ? (loaded.quote && loaded.quote.number)
      : (loaded.parent && loaded.parent.number);
    const parentNumber = loaded.parent && loaded.parent.number;
    const note = findVoidNoteText(kind, quoteNumber, state.quoteStatus, state.invoiceStatus, parentNumber, state.parentStatus);
    const allowed = findReprintAllowed(kind, state.quoteStatus, state.invoiceStatus, state.parentStatus);
    const dupId = kind === 'invoice'
      ? findDocId(loaded.invoice && loaded.invoice.quote_id)
      : findDocId(loaded.quote && loaded.quote.id);
    const reprintingSold = kind === 'quote' && loaded.sold && loaded.sold.invoice && loaded.sold.invoice.status === 'approved';
    const headerBits = [];
    const addBit = (label, value) => {
      headerBits.push(`<div><span style="color:var(--muted);">${label}</span> ${shop().escapeHtml(value || '—')}</div>`);
    };
    if (kind === 'invoice' && loaded.invoice) {
      const inv = loaded.invoice;
      addBit('Invoice', inv.number);
      addBit('Quote', parentNumber || '');
      addBit('Status', findStatusLabel('invoice', inv.status));
      addBit('Customer', inv.customer_name);
      addBit('Project', inv.project);
      addBit('PO', inv.po_number);
      addBit('Ship to', inv.ship_to);
      addBit('Invoice date', inv.invoice_date);
      addBit('Due', inv.due_date);
      addBit('Amount due', shop().money(Number(inv.total) || 0));
    } else if (loaded.quote) {
      const q = loaded.quote;
      addBit('Quote', q.number);
      addBit('Status', findStatusLabel('quote', q.status));
      addBit('Customer', q.customer_name);
      addBit('Project', q.project);
      addBit('RFQ', q.rfq_number);
      addBit('Date', q.quote_date);
      addBit('Valid until', q.valid_until);
      addBit('FOB', q.fob_point);
      addBit('Terms', q.payment_terms);
      addBit('Lead time', q.lead_time);
      addBit('Prepared by', q.prepared_by);
    }
    const lines = reprintingSold ? (loaded.sold.lines || []) : (kind === 'invoice' ? loaded.lines : loaded.lines);
    const readOnlyNote = reprintingSold
      ? `Reprint prints ${loaded.sold.invoice.number || 'the approved invoice'} as sold. Stock does not change.`
      : (allowed ? 'Reprint does not save and does not change stock.' : '');
    detail.innerHTML = `
      <button type="button" class="secondary tap" onclick="showFindResults()">Back</button>
      <div class="info" style="margin-top:0.75rem;">${headerBits.join('')}</div>
      ${loaded.quote && loaded.quote.notes ? `<div class="notes">${shop().escapeHtml(loaded.quote.notes)}</div>` : ''}
      ${loaded.invoice && loaded.invoice.notes ? `<div class="notes">${shop().escapeHtml(loaded.invoice.notes)}</div>` : ''}
      ${renderFindLines(lines)}
      ${kind === 'quote' && (loaded.invoices || []).length ? `<p class="hint">On this quote: ${shop().escapeHtml((loaded.invoices || []).map(row => `${row.number || ''} ${findStatusLabel('invoice', row.status)}`).join(', '))}</p>` : ''}
      ${note ? `<p class="hint">${shop().escapeHtml(note)}</p>` : ''}
      ${readOnlyNote ? `<p class="hint">${shop().escapeHtml(readOnlyNote)}</p>` : ''}
      ${findDetailActions(allowed, dupId)}`;
    const btn = document.getElementById('find-reprint');
    if (btn) btn.addEventListener('click', () => { reprintFindDoc(); });
    const dupBtn = document.getElementById('find-dup');
    if (dupBtn) dupBtn.addEventListener('click', () => { duplicateFindDoc(); });
  }

  function findDetailActions(allowed, dupId) {
    const buttons = [
      allowed ? '<button type="button" class="tap" id="find-reprint">Reprint</button>' : '',
      dupId ? '<button type="button" class="secondary tap" id="find-dup">Dup</button>' : ''
    ].filter(Boolean);
    return buttons.length ? `<div class="btn-group">${buttons.join('')}</div>` : '';
  }

  async function duplicateFindDoc() {
    if (!findView || !findView.loaded) return;
    const id = findView.kind === 'invoice'
      ? findDocId(findView.loaded.invoice && findView.loaded.invoice.quote_id)
      : findDocId(findView.loaded.quote && findView.loaded.quote.id);
    if (!id) return;
    await duplicateQuoteById(id);
    if (typeof window.showPanel === 'function') window.showPanel('quote');
  }

  async function openFindDoc(kind, id) {
    const safeKind = kind === 'invoice' ? 'invoice' : 'quote';
    const safe = findDocId(id);
    if (!safe) return;
    const loaded = await loadFindDoc(safeKind, safe);
    if (!loaded || loaded.error) {
      shop().showStatus(shop().plainDbError(loaded && loaded.error, 'load'), 'error');
      return;
    }
    if (loaded.missing) {
      shop().showStatus(safeKind === 'invoice' ? 'Invoice not found' : 'Quote not found', 'error');
      return;
    }
    findView = { kind: safeKind, id: safe, loaded };
    renderFindDetail(safeKind, loaded);
  }

  function lineAmount(line) {
    return (Number(line.qty) || 0) * (Number(line.unit_price) || 0);
  }

  function printDocFromInvoice(inv, lines, parent, banner) {
    return {
      invNumber: inv.number || '',
      quoteNumber: (parent && parent.number) || '',
      po: inv.po_number || '',
      rfq: (parent && parent.rfq_number) || '',
      invoiceDate: inv.invoice_date || '',
      due: inv.due_date || '',
      customer: inv.customer_name || '',
      project: inv.project || '',
      shipTo: inv.ship_to || '',
      by: inv.prepared_by || '',
      fob: inv.fob_point || '',
      terms: inv.payment_terms || '',
      notes: inv.notes || '',
      lines: lines || [],
      subtotal: Number(inv.subtotal) || 0,
      shipping: Number(inv.shipping_fee) || 0,
      duty: Number(inv.duty) || 0,
      tariffs: Number(inv.tariffs) || 0,
      cc: !!inv.cc_used,
      ccFee: Number(inv.cc_fee_amount) || 0,
      total: Number(inv.total) || 0,
      banner: banner || ''
    };
  }

  function printDocFromQuote(quote, lines) {
    const subtotal = (lines || []).reduce((sum, line) => sum + lineAmount(line), 0);
    return {
      invNumber: '',
      quoteNumber: quote.number || '',
      po: '',
      rfq: quote.rfq_number || '',
      invoiceDate: quote.quote_date || '',
      due: quote.valid_until || '',
      customer: quote.customer_name || '',
      project: quote.project || '',
      shipTo: '',
      by: quote.prepared_by || '',
      fob: quote.fob_point || '',
      terms: quote.payment_terms || '',
      notes: quote.notes || '',
      lines: lines || [],
      subtotal,
      shipping: 0,
      duty: 0,
      tariffs: 0,
      cc: false,
      ccFee: 0,
      total: subtotal,
      banner: FIND_DRAFT_BANNER
    };
  }

  async function reprintFindDoc() {
    if (!findView) return;
    const loaded = await loadFindDoc(findView.kind, findView.id);
    if (!loaded || loaded.error) {
      shop().showStatus(shop().plainDbError(loaded && loaded.error, 'load'), 'error');
      return;
    }
    if (loaded.missing) {
      shop().showStatus(findView.kind === 'invoice' ? 'Invoice not found' : 'Quote not found', 'error');
      return;
    }
    findView = { kind: findView.kind, id: findView.id, loaded };
    renderFindDetail(findView.kind, loaded);
    const state = findLoadedState(findView.kind, loaded);
    const quoteNumber = findView.kind === 'quote' ? (loaded.quote && loaded.quote.number) : (loaded.parent && loaded.parent.number);
    const note = findVoidNoteText(
      findView.kind,
      quoteNumber,
      state.quoteStatus,
      state.invoiceStatus,
      loaded.parent && loaded.parent.number,
      state.parentStatus
    );
    if (note || !findReprintAllowed(findView.kind, state.quoteStatus, state.invoiceStatus, state.parentStatus)) {
      if (note) shop().showStatus(note, 'error');
      return;
    }
    let doc = null;
    if (findView.kind === 'invoice' && loaded.invoice) {
      const banner = loaded.invoice.status === 'approved' ? '' : FIND_DRAFT_BANNER;
      doc = printDocFromInvoice(loaded.invoice, loaded.lines, loaded.parent, banner);
    } else if (loaded.sold && loaded.sold.invoice && loaded.sold.invoice.status === 'approved') {
      doc = printDocFromInvoice(loaded.sold.invoice, loaded.sold.lines, loaded.sold.parent || loaded.quote, '');
    } else if (loaded.quote) {
      if (!(loaded.lines || []).length) {
        shop().showStatus('Nothing to reprint', 'error');
        return;
      }
      doc = printDocFromQuote(loaded.quote, loaded.lines);
    }
    if (!doc) return;
    printInvoiceDocument(doc);
  }

  Object.assign(window, {
    saveQuoteCart,
    addToQuote,
    updateQuoteLine,
    removeQuoteLine,
    clearQuote,
    renderQuotePanel,
    quoteCartTotal,
    addDaysIso,
    defaultQuoteValid,
    lookupStoreKey,
    localLookups,
    saveLocalLookup,
    comboValue,
    setComboValue,
    onComboSelect,
    fillComboSelect,
    refreshQuoteLookups,
    findCustomerByName,
    onQuoteCustomerChange,
    nextDocNumber,
    ensureQuotesTables,
    loadCustomerSuggestions,
    loadQuotesList,
    openFindFromQuotes,
    renderQuotesList,
    startNewQuote,
    openQuote,
    saveQuoteToDb,
    saveAsNewQuote,
    voidCurrentQuote,
    voidQuoteById,
    duplicateCurrentQuote,
    duplicateQuoteById,
    printQuoteById,
    collectQuoteHeader,
    printDocWindow,
    companyBlock,
    generateQuote,
    printPackingList,
    invoiceMath,
    updateInvoicePreview,
    openInvoiceForm,
    saveAndPrintInvoice,
    refreshQuoteInvoices,
    approveInvoice,
    runFindSearch,
    openFindDoc,
    showFindResults,
    reprintFindDoc,
    printInvoiceDocument
  });

  // Init quote date + panel
  (function() {
    const d = document.getElementById('quote-date');
    const today = new Date().toISOString().slice(0, 10);
    if (d && !d.value) d.value = today;
    const v = document.getElementById('quote-valid');
    if (v && !v.value) v.value = addDaysIso(today, 90);
    if (d) d.addEventListener('change', () => {
      const valid = document.getElementById('quote-valid');
      if (valid) valid.value = addDaysIso(d.value, 90);
    });
    ['inv-shipfee', 'inv-duty', 'inv-tariffs'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateInvoicePreview);
    });
    renderQuotePanel();
    const findForm = document.getElementById('find-form');
    if (findForm) findForm.addEventListener('submit', (e) => {
      e.preventDefault();
      runFindSearch();
    });
    const findLast7 = document.getElementById('find-last7');
    if (findLast7) findLast7.addEventListener('click', () => { runFindLast7(); });
    const statusSel = document.getElementById('quote-status');
    if (statusSel) statusSel.addEventListener('change', () => applySaleLocks());
  })();

  // Refresh quote panel when switching to Quote tab
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'quote') {
        renderQuotePanel();
        loadQuotesList();
      }
    });
  });

  if (window.InmarShop && typeof window.InmarShop.updateUserUI === "function") {
    window.InmarShop.updateUserUI();
  }
  if (window.__shopEntered && typeof refreshQuoteLookups === "function") {
    refreshQuoteLookups();
  }
}
