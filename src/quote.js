import { quoteMarkup } from "./quote-markup.js";

function shop() {
  const api = window.InmarShop;
  if (!api) throw new Error("Shop is not ready");
  return api;
}

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
    return `${n} is cancelled. Start a new quote to bring this deal back.`;
  }
  if (kind === 'invoice' && invoiceStatus !== 'approved' && parentStatus === 'void') {
    const n = String(parentNumber || '').trim() || 'This quote';
    return `${n} is cancelled. This invoice can't be approved.`;
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
  let dueEditedByHand = false;
  let invoiceBoxDraftId = 'none';
  let findView = null;
  let findSeq = 0;
  let findKind = 'quote';

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
        unit_price: item.sell_price != null ? shop().toCents(item.sell_price) : 0
      });
    }
    const by = document.getElementById('quote-by');
    if (by && !by.value && shop().currentUser()) by.value = shop().currentUser();
    saveQuoteCart();
    shop().showStatus(`Added “${item.part_number}” to quote`, 'success');
  }

  function updateQuoteLine(idx, field, value) {
    if (!quoteCart[idx]) return;
    if (field === 'qty') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) {
        shop().showStatus('Qty must be a whole number, 1 or more.', 'error');
        renderQuotePanel();
        return;
      }
      quoteCart[idx].qty = n;
    }
    if (field === 'unit_price') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        shop().showStatus("Price can't be negative.", 'error');
        renderQuotePanel();
        return;
      }
      quoteCart[idx].unit_price = shop().toCents(n);
    }
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
              <td><input type="number" min="0" step="0.01" value="${priceBox(c.unit_price)}" style="width:90px;margin:0" onchange="updateQuoteLine(${idx},'unit_price',this.value)"></td>
              <td>${shop().money(line)}</td>
              <td><button class="danger" onclick="removeQuoteLine(${idx})">×</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="text-align:right;font-weight:700;margin-top:0.75rem;font-size:1.1rem;">Total: ${shop().money(total)}</div>
    `;
  }

  function priceBox(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '';
    if (shop().toCents(x) === x) return x.toFixed(2);
    return String(x);
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

  // Customer list: type-ahead pick, "Did you mean", add new, "New, not in QuickBooks yet" tag.
  // The typed name is still what quotes and invoices store and print. customer_id is the link.
  const CASH_SALE = 'Cash sale';
  let pickedCustomer = null; // { id, name, qb_status, qb_status_systems, payment_terms, forText }
  let quoteCompany = ''; // '' until picked, then 'L' or 'S'. Locked after the first save.
  let quoteCompanyLocked = false;
  const NEW_QUOTE_NUMBER = 'New — number on first save';
  const SAVE_QUOTE_FIRST = 'Save the quote first.';
  const DRAFT_INVOICE_NUMBER = 'Draft — number at Approve';
  const PICK_COMPANY_MSG = 'Pick In-Mar Solutions or In-Mar Systems first. The quote was not saved.';
  let customerPickRows = [];
  let customerPickTimer = null;
  let customerPickSeq = 0;
  let customerListReady = false;

  function customerKey(s) {
    return String(s || '').replace(/[\s\u00a0]+/g, ' ').trim().toLowerCase();
  }

  function customerBoxText() {
    return document.getElementById('quote-customer')?.value || '';
  }

  // The link holds only while the box still says what it said when the link was made.
  function linkedCustomerId() {
    return pickedCustomer && customerKey(customerBoxText()) === pickedCustomer.forText ? pickedCustomer.id : null;
  }

  function setPickedCustomer(row) {
    pickedCustomer = row && row.id
      ? {
        id: row.id,
        name: row.name,
        qb_status: row.qb_status,
        qb_status_systems: row.qb_status_systems,
        payment_terms: row.payment_terms,
        forText: customerKey(customerBoxText())
      }
      : null;
    const idEl = document.getElementById('quote-customer-id');
    if (idEl) idEl.value = pickedCustomer ? pickedCustomer.id : '';
    renderCustomerTag();
  }

  function companyName(code) {
    if (code === 'L') return 'In-Mar Solutions';
    if (code === 'S') return 'In-Mar Systems';
    return '';
  }

  function qbColumnForCompany() {
    return quoteCompany === 'S' ? 'qb_status_systems' : 'qb_status';
  }

  // Solutions reads qb_status. Systems reads qb_status_systems. No company picked: no badge.
  function activeQbStatus() {
    if (!pickedCustomer || !linkedCustomerId()) return '';
    if (quoteCompany !== 'L' && quoteCompany !== 'S') return '';
    const status = pickedCustomer[qbColumnForCompany()];
    return status || '';
  }

  function renderCustomerTag() {
    const el = document.getElementById('quote-customer-tag');
    if (!el) return;
    if (activeQbStatus() !== 'new_not_in_qb') {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.innerHTML = '<span class="badge badge-new-qb">New, not in QuickBooks yet</span>'
      + '<button type="button" class="secondary" onclick="markCustomerInQb()">Mark In QuickBooks</button>';
    el.hidden = false;
  }

  function setQuoteNumberDisplay(number) {
    const el = document.getElementById('quote-number');
    if (!el) return;
    el.readOnly = true;
    const text = String(number || '').trim();
    el.value = text || NEW_QUOTE_NUMBER;
  }

  function renderCompanyPicker() {
    const pick = document.getElementById('quote-company-pick');
    const locked = document.getElementById('quote-company-locked');
    const lBtn = document.getElementById('quote-company-l');
    const sBtn = document.getElementById('quote-company-s');
    if (lBtn) lBtn.classList.toggle('company-picked', !quoteCompanyLocked && quoteCompany === 'L');
    if (sBtn) sBtn.classList.toggle('company-picked', !quoteCompanyLocked && quoteCompany === 'S');
    if (pick) pick.hidden = !!quoteCompanyLocked;
    if (locked) {
      locked.hidden = !quoteCompanyLocked;
      locked.textContent = quoteCompanyLocked ? companyName(quoteCompany) : '';
    }
    renderCustomerTag();
  }

  function pickQuoteCompany(code) {
    if (quoteCompanyLocked) return;
    if (code !== 'L' && code !== 'S') return;
    quoteCompany = code;
    renderCompanyPicker();
    refreshPickedQb();
  }

  // The suggest list does not return qb_status_systems. Read it from the customer row.
  async function refreshPickedQb() {
    const id = linkedCustomerId();
    if (!id || !shop().supabaseClient) return;
    if (quoteCompany !== 'L' && quoteCompany !== 'S') return;
    const { data } = await shop().supabaseClient.from('customers')
      .select('id,qb_status,qb_status_systems,payment_terms')
      .eq('id', id)
      .maybeSingle();
    if (!data || !pickedCustomer || pickedCustomer.id !== data.id) return;
    pickedCustomer.qb_status = data.qb_status;
    pickedCustomer.qb_status_systems = data.qb_status_systems;
    renderCustomerTag();
  }

  function hideCustomerPick() {
    const box = document.getElementById('customer-pick');
    if (box) { box.hidden = true; box.innerHTML = ''; }
  }

  async function ensureCustomerList() {
    if (customerListReady) return true;
    if (!shop().supabaseClient) return false;
    const { error } = await shop().supabaseClient.from('invoices').select('customer_id').limit(1);
    customerListReady = !error;
    return customerListReady;
  }

  async function suggestCustomers(text) {
    if (!shop().supabaseClient || !shop().hasQuotesTables) return null;
    const { data, error } = await shop().supabaseClient.rpc('shop_customer_suggest', { p_q: text });
    return error ? null : (data || []);
  }

  async function findCustomerByName(name) {
    if (!customerKey(name) || customerKey(name) === customerKey(CASH_SALE)) return null;
    const rows = await suggestCustomers(name);
    return (rows || []).find(r => r.exact) || null;
  }

  function onQuoteCustomerInput() {
    if (pickedCustomer && !linkedCustomerId()) setPickedCustomer(null);
    clearTimeout(customerPickTimer);
    const text = customerBoxText();
    customerPickTimer = setTimeout(() => showCustomerPick(text), 200);
  }

  async function showCustomerPick(text) {
    const box = document.getElementById('customer-pick');
    if (!box) return;
    const key = customerKey(text);
    if (key.length < 2 || key === customerKey(CASH_SALE) || linkedCustomerId()) { customerPickSeq++; hideCustomerPick(); return; }
    const seq = ++customerPickSeq;
    const rows = await suggestCustomers(text);
    if (seq !== customerPickSeq) return; // a later keystroke wins
    if (!rows) { hideCustomerPick(); return; } // customer SQL not run yet: plain text box, as before
    customerPickRows = rows;
    const esc = shop().escapeHtml;
    const exact = rows.some(r => r.exact);
    const clean = text.replace(/[\s\u00a0]+/g, ' ').trim();
    const showSolutionsNew = quoteCompany === 'L';
    const items = rows.map((r, i) => `<button type="button" class="customer-pick-row" onclick="pickCustomer(${i})">${esc(r.name)}`
      + (showSolutionsNew && r.qb_status === 'new_not_in_qb' ? ' <span class="badge badge-new-qb">New, not in QuickBooks yet</span>' : '') + '</button>');
    const head = rows.length && !exact ? '<div class="customer-pick-head">Did you mean</div>' : '';
    const add = exact ? '' : `<button type="button" class="customer-pick-row customer-pick-add" onclick="addCustomerFromQuote()">+ Add “${esc(clean)}” as a new customer</button>`;
    box.innerHTML = head + items.join('') + add;
    box.hidden = false;
  }

  function pickCustomer(i) {
    const row = customerPickRows[i];
    if (!row) return;
    const el = document.getElementById('quote-customer');
    if (el) el.value = row.name;
    setPickedCustomer(row);
    hideCustomerPick();
    if (row.payment_terms) setComboValue('terms', row.payment_terms);
    refreshPickedQb();
  }

  async function addCustomerFromQuote() {
    if (!shop().requireUser('adding customers')) return;
    const text = customerBoxText();
    const { data, error } = await shop().supabaseClient.rpc('shop_add_customer', { p_name: text });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.id) {
      shop().showStatus(error ? shop().plainDbError(error, 'save') : "Couldn't save — try again", 'error');
      showCustomerPick(text); // someone else may have just added it: show it to pick
      return;
    }
    const el = document.getElementById('quote-customer');
    if (el) el.value = row.name;
    setPickedCustomer(row);
    hideCustomerPick();
    refreshPickedQb();
    shop().showStatus(`${row.name} added. Tagged New, not in QuickBooks yet.`, 'success');
  }

  async function markCustomerInQb() {
    if (!shop().requireUser('updating customers')) return;
    const id = linkedCustomerId();
    if (!id) return;
    if (quoteCompany !== 'L' && quoteCompany !== 'S') return;
    const which = companyName(quoteCompany);
    if (!confirm(`Mark “${pickedCustomer.name}” as entered in QuickBooks for ${which}?`)) return;
    const column = qbColumnForCompany();
    const { data, error } = await shop().supabaseClient.from('customers')
      .update({ [column]: 'in_qb' }).eq('id', id)
      .select('id,name,qb_status,qb_status_systems,payment_terms').maybeSingle();
    if (error || !data) {
      shop().showStatus(error ? shop().plainDbError(error, 'save') : "Couldn't save — try again", 'error');
      return;
    }
    setPickedCustomer(data);
    shop().showStatus(`${data.name} marked In QuickBooks for ${which}.`, 'success');
  }

  // Leaving the box: link an exact name typed in full, and fill its saved terms.
  async function onQuoteCustomerChange() {
    const text = customerBoxText();
    if (!customerKey(text) || customerKey(text) === customerKey(CASH_SALE)) { setPickedCustomer(null); return; }
    if (linkedCustomerId()) return;
    const row = await findCustomerByName(text);
    if (!row || customerKey(customerBoxText()) !== customerKey(text)) return;
    setPickedCustomer(row);
    if (row.payment_terms) setComboValue('terms', row.payment_terms);
    refreshPickedQb();
  }

  async function loadQuoteCustomer(customerId) {
    setPickedCustomer(null);
    if (!customerId || !shop().supabaseClient) return;
    const cols = 'id,name,qb_status,qb_status_systems,payment_terms,merged_into';
    const older = 'id,name,qb_status,payment_terms,merged_into';
    let res = await shop().supabaseClient.from('customers').select(cols).eq('id', customerId).maybeSingle();
    if (res.error && /qb_status_systems/i.test([res.error.message, res.error.details].filter(Boolean).join(' '))) {
      res = await shop().supabaseClient.from('customers').select(older).eq('id', customerId).maybeSingle();
    }
    let { data } = res;
    if (data?.merged_into) {
      const keep = res.error ? older : cols;
      ({ data } = await shop().supabaseClient.from('customers').select(keep).eq('id', data.merged_into).maybeSingle());
    }
    if (data) setPickedCustomer(data);
  }

  function setCashSale() {
    const el = document.getElementById('quote-customer');
    if (el) el.value = CASH_SALE;
    setPickedCustomer(null);
    hideCustomerPick();
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

  function quoteIsLiveStatus(status) {
    return status === 'draft' || status === 'sent' || status === 'accepted';
  }

  function quoteStatusLabel(status) {
    if (status === 'void') return 'Cancelled';
    if (status === 'expired') return 'Expired';
    if (status === 'sent') return 'Sent';
    if (status === 'accepted') return 'Accepted';
    if (status === 'draft' || !status) return 'Open';
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
    return `${n} is approved. Cancelling this quote won't undo the sale.`;
  }

  function linesLockedMessage(number) {
    const n = String(number || '').trim() || 'This invoice';
    return `${n} is approved. This quote's lines can't change after the sale.`;
  }

  function quoteVoidedMessage(number) {
    const n = String(number || '').trim() || 'This quote';
    return `${n} is cancelled. This invoice can't be approved.`;
  }

  function openQuoteIsVoid() {
    return (document.getElementById('quote-status')?.value || '') === 'void';
  }

  function voidFinalMessage(number) {
    const n = String(number || '').trim() || 'This quote';
    return `${n} is cancelled. Start a new quote to bring this deal back.`;
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
    const clean = { ...payload };
    delete clean.number;
    delete clean.company;
    delete clean.id;
    if (!quoteId) return { error: { message: "Couldn't save the quote" }, id: null };
    const run = (body) => shop().supabaseClient.from('quotes').update(body).eq('id', quoteId);
    let res = await run(clean);
    if (res.error && /project|rfq_number|fob_point|payment_terms|lead_time/i.test(res.error.message || '')) {
      const slim = { ...clean };
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
                <button type="button" class="secondary" onclick="openQuote('${q.id}')">Edit</button>
                <button type="button" class="secondary" onclick="printQuoteById('${q.id}')">Print</button>
                <button type="button" class="secondary" onclick="duplicateQuoteById('${q.id}')">Dup</button>
                <button type="button" class="secondary" ${approvedInvoiceByQuote[q.id] ? 'disabled style="opacity:0.45"' : ''} onclick="voidQuoteById('${q.id}')">Cancel quote</button>
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
    setPickedCustomer(null);
    hideCustomerPick();
    quoteCompany = '';
    quoteCompanyLocked = false;
    setQuoteNumberDisplay('');
    renderCompanyPicker();
    const invBox = document.getElementById('invoice-box');
    if (invBox) invBox.style.display = 'none';
    await refreshQuoteInvoices();
    await refreshQuoteLookups();
    setComboValue('fob', '');
    setComboValue('terms', '');
    renderQuotePanel();
    if (!opts || !opts.keepStatus) {
      shop().showStatus('Builder ready — add lines then Save quote', 'info');
    }
  }

  async function openQuote(id) {
    resetInvoiceBox();
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
    quoteCompany = q.company === 'L' || q.company === 'S' ? q.company : '';
    quoteCompanyLocked = true;
    setQuoteNumberDisplay(q.number || '');
    renderCompanyPicker();
    document.getElementById('quote-status').value = q.status || 'draft';
    document.getElementById('quote-date').value = q.quote_date || '';
    document.getElementById('quote-valid').value = q.valid_until || '';
    document.getElementById('quote-customer').value = q.customer_name || '';
    hideCustomerPick();
    await loadQuoteCustomer(q.customer_id);
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
    if (currentQuoteId() === String(q.id)) {
      if (quoteSaleBlocked() || quoteIsVoidFinal()) resetInvoiceBox();
      else fillInvoiceBoxFromDraft(newestOpenDraft());
    }
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
    const dateProblem = quoteDateProblem();
    if (dateProblem) {
      shop().showStatus(dateProblem, 'error');
      return false;
    }
    const requestedStatus = document.getElementById('quote-status').value || 'draft';
    const customerName = (document.getElementById('quote-customer').value || '').trim();
    const project = (document.getElementById('quote-project')?.value || '').trim();
    const rfq = (document.getElementById('quote-rfq')?.value || '').trim();
    const fob = comboValue('fob');
    const terms = comboValue('terms');
    const lead = (document.getElementById('quote-lead')?.value || '').trim();
    if (fob) saveLocalLookup('fob', fob);
    if (terms) saveLocalLookup('payment_terms', terms);
    if (customerName && !linkedCustomerId()) await onQuoteCustomerChange();
    const customerId = linkedCustomerId();
    const payload = {
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
    let number = '';
    const sealingVoid = requestedStatus === 'void' && storedStatus !== 'void';
    const firstSave = !quoteId;
    if (firstSave) {
      if (quoteCompany !== 'L' && quoteCompany !== 'S') {
        shop().showStatus(PICK_COMPANY_MSG, 'error');
        return false;
      }
      const { data, error } = await shop().supabaseClient.rpc('shop_save_new_quote', {
        p_company: quoteCompany,
        p_quote: payload,
        p_lines: quoteLineRows(null)
      });
      let saved = data;
      if (typeof saved === 'string') {
        try { saved = JSON.parse(saved); } catch (e) { saved = null; }
      }
      if (error || !saved || !saved.id) {
        showQuoteSaveError(error || { message: "Couldn't save the quote" }, 'header');
        return false;
      }
      quoteId = saved.id;
      number = saved.number || '';
      if (saved.company === 'L' || saved.company === 'S') quoteCompany = saved.company;
      quoteCompanyLocked = true;
      editingQuoteId = quoteId;
      document.getElementById('quote-edit-id').value = quoteId;
      setQuoteNumberDisplay(number);
      renderCompanyPicker();
    } else if (quoteId && sealingVoid) {
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
    }
    if (!firstSave) {
      const shown = (document.getElementById('quote-number')?.value || '').trim();
      if (shown && shown !== NEW_QUOTE_NUMBER) number = shown;
    }
    if (!quoteId) {
      shop().showStatus("Couldn't save the quote — invoice was not created", 'error');
      return false;
    }
    if (number === NEW_QUOTE_NUMBER) number = '';
    editingQuoteId = quoteId;
    document.getElementById('quote-edit-id').value = quoteId;
    loadedQuoteStatus = requestedStatus;
    shop().showStatus(firstSave ? `Saved ${number}` : `Quote ${number} saved (${shop().currentUser()})`, 'success');
    if (requestedStatus === 'void') {
      emptyWorkingCart();
      resetInvoiceBox();
    }
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
    setPickedCustomer(null);
    hideCustomerPick();
    const invBox = document.getElementById('invoice-box');
    if (invBox) invBox.style.display = 'none';
    setComboValue('fob', '');
    setComboValue('terms', '');
    quoteCompanyLocked = false;
    setQuoteNumberDisplay('');
    renderCompanyPicker();
    quoteCart = lines;
    saveQuoteCart();
    return saveQuoteToDb();
  }

  async function voidQuoteById(id) {
    if (!shop().requireUser('cancelling quotes')) return;
    if (!id) {
      shop().showStatus('Open a saved quote to cancel it', 'error');
      return;
    }
    const blockedNum = await blockingApprovedNumber(id);
    if (blockedNum === null) {
      shop().showStatus("Couldn't check invoices — quote was not cancelled", 'error');
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
    if (num === NEW_QUOTE_NUMBER) {
      shop().showStatus('Open a saved quote to cancel it', 'error');
      return;
    }
    if (!confirm(`Cancel ${num}? The number stays. Stock is not put back.`)) return;
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
          applySaleLocks();
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
      resetInvoiceBox();
      applySaleLocks();
      await refreshQuoteInvoices();
    }
    shop().showStatus(`${num} cancelled. Stock unchanged.`, 'success');
    await loadQuotesList();
  }

  async function voidCurrentQuote() {
    const id = editingQuoteId || document.getElementById('quote-edit-id')?.value;
    if (!id) {
      shop().showStatus('Open a saved quote to cancel it', 'error');
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
    quoteCompanyLocked = false;
    setQuoteNumberDisplay('');
    renderCompanyPicker();
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('quote-date').value = today;
    document.getElementById('quote-valid').value = addDaysIso(today, 90);
    const by = document.getElementById('quote-by');
    if (by && shop().currentUser()) by.value = shop().currentUser();
    await refreshQuoteInvoices();
    shop().showStatus('Duplicated as a new quote. Tap Save quote.', 'info');
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
      customerId: linkedCustomerId(),
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

  function printDocWindow(title, bodyHtml, opts) {
    const autoPrint = opts && opts.view
      ? ''
      : '<script>window.onload=function(){ setTimeout(function(){ window.print(); }, 400); };<\/script>';
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
    .draft-stamp { position: fixed; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 120px; font-weight: 800; color: rgba(220, 38, 38, 0.18); border: 8px solid rgba(220, 38, 38, 0.18); padding: 0 24px; pointer-events: none; z-index: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #64748b; }
    @media print { body { padding: 12px; } @page { margin: 0.6in; size: letter; } }
  </style></head><body>
  ${bodyHtml}
  ${autoPrint}
  </body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      shop().showStatus('Pop-up blocked — allow pop-ups to print', 'error');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  function companyBlock(company) {
    const logo = company === 'L'
      ? { src: 'In-Mar-Solutions-logo-v4.png', alt: 'In-Mar Solutions' }
      : company === 'S'
        ? { src: 'In-Mar-Systems-logo-v4.png', alt: 'In-Mar Systems' }
        : null;
    const img = logo ? `<img class="logo" src="${logo.src}" alt="${shop().escapeHtml(logo.alt)}">` : '';
    return `${img}
    <div style="font-size:11px;color:#64748b;margin-top:4px;">3011 S. Ruby Ave, Gonzales, LA 70737<br>(225) 430-9111 • info@inmarsystems.com</div>`;
  }

  function letterheadName(company) {
    const name = companyName(company);
    return name ? `<br>${shop().escapeHtml(name)}` : '';
  }

  function quoteDocumentHtml(header, lines) {
    const data = header || {};
    let total = 0;
    const rows = (lines || []).map(c => {
      const qty = Number(c.qty) || 1;
      const price = Number(c.unit_price) || 0;
      const line = qty * price;
      total += line;
      return `<tr>
        <td style="font-family:monospace;font-size:12px;">${shop().escapeHtml(c.part_number)}</td>
        <td>${shop().escapeHtml(c.name)}</td>
        <td style="text-align:center;">${qty}</td>
        <td style="text-align:right;">${shop().money(price)}</td>
        <td style="text-align:right;font-weight:600;">${shop().money(line)}</td>
      </tr>`;
    }).join('');
    return `
    <div class="header">
  <div>${companyBlock(data.company)}</div>
  <div class="meta">
    <div class="doc-title">QUOTE</div>
    <div><strong>Quote #:</strong> ${shop().escapeHtml(data.number)}</div>
    ${data.rfq ? `<div><strong>RFQ #:</strong> ${shop().escapeHtml(data.rfq)}</div>` : ''}
    <div><strong>Quote date:</strong> ${shop().escapeHtml(data.date)}</div>
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
    <div class="footer">Thank you for the opportunity to quote.${letterheadName(data.company)}</div>`;
  }

  function quoteHeaderFromSaved(quote) {
    const row = quote || {};
    return {
      number: row.number || '',
      date: row.quote_date || '',
      valid: row.valid_until || '',
      customer: row.customer_name || '',
      project: row.project || '',
      rfq: row.rfq_number || '',
      by: row.prepared_by || '',
      notes: row.notes || '',
      status: row.status || '',
      fob: row.fob_point || '',
      terms: row.payment_terms || '',
      lead: row.lead_time || '',
      company: row.company || ''
    };
  }

  function generateQuote() {
    if (!currentQuoteId()) {
      shop().showStatus(SAVE_QUOTE_FIRST, 'error');
      return;
    }
    if (quoteCart.length === 0) {
      shop().showStatus('Add at least one part to the quote first', 'error');
      return;
    }
    const data = collectQuoteHeader();
    data.company = quoteCompany;
    if (!data.by) data.by = shop().currentUser();
    printDocWindow('In-Mar Quote ' + data.number, quoteDocumentHtml(data, quoteCart));
  }

  async function printPackingList() {
    if (!currentQuoteId()) {
      shop().showStatus(SAVE_QUOTE_FIRST, 'error');
      return;
    }
    if (quoteCart.length === 0) {
      shop().showStatus('Add quote lines first', 'error');
      return;
    }
    const data = collectQuoteHeader();
    data.company = quoteCompany;
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
  <div>${companyBlock(data.company)}</div>
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
    <div class="footer">Check contents on receipt.${letterheadName(data.company)}</div>`);
  }

  function invoiceMath() {
    const subtotal = quoteCartTotal();
    const shipping = parseFloat(document.getElementById('inv-shipfee')?.value) || 0;
    const duty = parseFloat(document.getElementById('inv-duty')?.value) || 0;
    const tariffs = parseFloat(document.getElementById('inv-tariffs')?.value) || 0;
    const goods = subtotal + shipping + duty + tariffs;
    const cc = document.getElementById('inv-cc')?.checked;
    const ccFee = cc ? shop().toCents(goods * 0.035) : 0;
    return { subtotal, shipping, duty, tariffs, ccFee, cc, total: goods + ccFee };
  }

  function readInvoiceFee(id) {
    const raw = document.getElementById(id)?.value;
    if (raw == null || String(raw).trim() === '') return 0;
    return Number(raw);
  }

  function invoiceFeeProblem() {
    const fees = [readInvoiceFee('inv-shipfee'), readInvoiceFee('inv-duty'), readInvoiceFee('inv-tariffs')];
    if (fees.some(n => !Number.isFinite(n) || n < 0)) return "Shipping, duty and tariffs can't be negative.";
    return '';
  }

  function quoteDateProblem() {
    const date = document.getElementById('quote-date')?.value || '';
    const valid = document.getElementById('quote-valid')?.value || '';
    if (date && valid && valid < date) return "Valid Until can't be before the quote Date.";
    return '';
  }

  function syncDueFromValid() {
    if (dueEditedByHand) return;
    const due = document.getElementById('inv-due');
    const valid = document.getElementById('quote-valid');
    if (due && valid) due.value = valid.value || '';
  }

  function updateInvoicePreview() {
    const el = document.getElementById('inv-preview');
    if (!el) return;
    const problem = invoiceFeeProblem();
    if (problem) {
      el.textContent = problem;
      return;
    }
    const m = invoiceMath();
    el.innerHTML = `Merchandise ${shop().money(m.subtotal)} + shipping ${shop().money(m.shipping)} + duty ${shop().money(m.duty)} + tariffs ${shop().money(m.tariffs)}${m.cc ? ' + CC 3.5% ' + shop().money(m.ccFee) : ''} = <strong>${shop().money(m.total)}</strong> due`;
  }

  function resetInvoiceBox() {
    const po = document.getElementById('inv-po');
    if (po) po.value = '';
    const ship = document.getElementById('inv-ship');
    if (ship) ship.value = '';
    ['inv-shipfee', 'inv-duty', 'inv-tariffs'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '0';
    });
    const cc = document.getElementById('inv-cc');
    if (cc) cc.checked = false;
    dueEditedByHand = false;
    syncDueFromValid();
    const box = document.getElementById('invoice-box');
    if (box) box.style.display = 'none';
    updateInvoicePreview();
    invoiceBoxDraftId = 'none';
  }

  function invoiceFeeBoxValue(value) {
    if (value == null || value === '') return '0';
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '0';
    return n.toFixed(2);
  }

  function fillInvoiceBoxFromDraft(inv) {
    if (!inv) {
      resetInvoiceBox();
      return;
    }
    const po = document.getElementById('inv-po');
    if (po) po.value = inv.po_number || '';
    const ship = document.getElementById('inv-ship');
    if (ship) ship.value = inv.ship_to || '';
    const cc = document.getElementById('inv-cc');
    if (cc) cc.checked = !!inv.cc_used;
    const shipFee = document.getElementById('inv-shipfee');
    if (shipFee) shipFee.value = invoiceFeeBoxValue(inv.shipping_fee);
    const duty = document.getElementById('inv-duty');
    if (duty) duty.value = invoiceFeeBoxValue(inv.duty);
    const tariffs = document.getElementById('inv-tariffs');
    if (tariffs) tariffs.value = invoiceFeeBoxValue(inv.tariffs);
    const due = document.getElementById('inv-due');
    const valid = document.getElementById('quote-valid')?.value || '';
    if (inv.due_date) {
      if (due) due.value = inv.due_date;
      dueEditedByHand = inv.due_date !== valid;
    } else {
      dueEditedByHand = false;
      syncDueFromValid();
    }
    invoiceBoxDraftId = inv.id || 'none';
    updateInvoicePreview();
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

  function draftNotesText(value) {
    return String(value ?? '').trim();
  }

  // Approve still sells invoice_lines. This compares the cart and the notes to that draft.
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
    const screenNotes = draftNotesText(document.getElementById('quote-notes')?.value);
    const savedNotes = draftNotesText(printedDraftLines.notes);
    if (screenNotes !== savedNotes) return draftMismatchMessage(draft.number);
    return '';
  }

  function applySaleLocks() {
    const blocked = quoteSaleBlocked();
    const voidFinal = quoteIsVoidFinal();
    const hideActions = voidFinal && !blocked;
    const voidBtn = document.getElementById('quote-void-btn');
    if (voidBtn) {
      voidBtn.hidden = hideActions;
      voidBtn.disabled = blocked || hideActions;
      voidBtn.style.opacity = blocked ? '0.45' : '';
    }
    const saveBtn = document.getElementById('quote-save-btn');
    const invoiceBtn = document.getElementById('quote-invoice-btn');
    [saveBtn, invoiceBtn].forEach(btn => {
      if (!btn) return;
      btn.hidden = hideActions;
      btn.disabled = blocked || hideActions;
      btn.style.opacity = blocked ? '0.45' : '';
    });
    const saveNew = document.getElementById('quote-save-new-btn');
    if (saveNew) saveNew.hidden = !(blocked || voidFinal);
    const printBtn = document.getElementById('quote-save-print-btn');
    const voided = openQuoteIsVoid();
    if (printBtn) {
      printBtn.disabled = voided;
      printBtn.style.opacity = voided ? '0.45' : '';
    }
    const cashBtn = document.getElementById('quote-cash-sale-btn');
    if (cashBtn) {
      const cashOff = blocked || voidFinal;
      cashBtn.disabled = cashOff;
      cashBtn.style.opacity = cashOff ? '0.45' : '';
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
    dueEditedByHand = false;
    renderQuoteInvoiceRows([], { syncApproved: false });
    resetInvoiceBox();
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
    const d = newestOpenDraft();
    if ((d ? String(d.id) : 'none') !== String(invoiceBoxDraftId)) fillInvoiceBoxFromDraft(d);
    const box = document.getElementById('invoice-box');
    if (!box) return;
    const valid = document.getElementById('quote-valid')?.value;
    const due = document.getElementById('inv-due');
    if (due && !dueEditedByHand) due.value = valid || '';
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
        <div><code>${shop().escapeHtml(r.number || DRAFT_INVOICE_NUMBER)}</code><div>From quote ${shop().escapeHtml(quoteNum)}</div></div>
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
      .select('id,number,status,total,created_at,notes,po_number,ship_to,due_date,shipping_fee,duty,tariffs,cc_used')
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
        printedDraftLines = { id: draft.id, lines: [], notes: draft.notes, failed: true };
      } else {
        const lines = (lineData || []).slice().sort((a, b) => (Number(a.line_no) || 0) - (Number(b.line_no) || 0));
        printedDraftLines = { id: draft.id, lines, notes: draft.notes, failed: false };
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
    const customerNow = (document.getElementById('quote-customer')?.value || '').trim();
    if (!customerNow) {
      showApproveError('This invoice has no customer. Add a customer or tap Cash sale, then Save & print before Approve.');
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
      const approvedNumber = payload.number || 'Invoice';
      const marked = payload.quote_marked_accepted
        ? `Approved ${approvedNumber}. Parts left the shelf. Quote marked Accepted.`
        : `Approved ${approvedNumber}. Parts left the shelf.`;
      shop().showStatus(marked, 'success');
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
    const stamp = doc.draft ? '<div class="draft-stamp">DRAFT</div>' : '';
    const invLabel = doc.invNumber || DRAFT_INVOICE_NUMBER;
    return `${stamp}
    <div class="header">
  <div>${companyBlock(doc.company)}</div>
  <div class="meta">
    <div class="doc-title">INVOICE</div>${banner}
    <div><strong>Invoice #:</strong> ${shop().escapeHtml(invLabel)}</div>
    ${doc.quoteNumber ? `<div>From quote ${shop().escapeHtml(doc.quoteNumber)}</div>` : ''}
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
    <div class="footer">Please remit with invoice number ${shop().escapeHtml(invLabel)}.${letterheadName(doc.company)}</div>`;
  }

  function printInvoiceDocument(doc, opts) {
    printDocWindow('In-Mar Invoice ' + (doc.invNumber || ''), invoiceDocumentHtml(doc), opts);
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
    const dateProblem = quoteDateProblem();
    if (dateProblem) {
      shop().showStatus(dateProblem, 'error');
      return;
    }
    const feeProblem = invoiceFeeProblem();
    if (feeProblem) {
      shop().showStatus(feeProblem, 'error');
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
      const live = newestOpenDraft();
      if (live && String(live.id) !== String(invoiceBoxDraftId)) {
        shop().showStatus("This invoice changed or didn't load. Close and tap Invoice… again to reload it before saving.", 'error');
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
      if (await ensureCustomerList()) header.customer_id = data.customerId || null; // column exists only after the customer SQL
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
          const plain = shop().plainDbError(lErr, 'save');
          shop().showStatus(plain === "Couldn't save — try again" ? "Couldn't update the draft invoice lines." : plain, 'error');
          return;
        }
        invNumber = draft.number || '';
        if (quoteId) await refreshQuoteInvoices();
        if (currentQuoteId() === quoteId) fillInvoiceBoxFromDraft({ ...header, id: draft.id });
        shop().showStatus(invNumber
          ? `Draft ${invNumber} updated. Stock unchanged until you Approve.`
          : 'Draft updated. Stock unchanged until you Approve.', 'success');
      } else {
        const { data: inv, error } = await shop().supabaseClient.from('invoices').insert({
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
          const plain = shop().plainDbError(lErr, 'save');
          shop().showStatus(plain === "Couldn't save — try again" ? "Couldn't save the invoice lines. Draft was not kept." : plain, 'error');
          return;
        }
        if (quoteId) await refreshQuoteInvoices();
        else renderQuoteInvoiceRows([{ id: inv.id, number: invNumber, status: 'draft', created_at: today }], { linked: false });
        if (currentQuoteId() === quoteId) fillInvoiceBoxFromDraft({ ...header, id: inv.id });
        shop().showStatus('Draft saved. Stock unchanged until you Approve.', 'success');
      }
      printInvoiceDocument({
        invNumber,
        company: quoteCompany,
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
        draft: true,
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

  const FIND_QUOTE_COLS = 'id,number,company,customer_name,status,quote_date,valid_until,prepared_by,notes,project,rfq_number,fob_point,payment_terms,lead_time';
  const FIND_INVOICE_COLS = 'id,number,company,quote_id,customer_name,project,po_number,ship_to,invoice_date,due_date,fob_point,payment_terms,cc_used,cc_fee_amount,shipping_fee,duty,tariffs,subtotal,total,prepared_by,notes,status';
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

  function openFindKind(kind) {
    findKind = kind === 'invoice' ? 'invoice' : 'quote';
    findSeq += 1;
    findView = null;
    const box = document.getElementById('find-q');
    const fromEl = document.getElementById('find-from');
    const toEl = document.getElementById('find-to');
    if (box) box.value = '';
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    const results = document.getElementById('find-results');
    const detail = document.getElementById('find-detail');
    if (results) {
      results.hidden = false;
      results.innerHTML = '';
    }
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = '';
      detail.removeAttribute('aria-busy');
    }
    const title = document.getElementById('find-title');
    if (title) title.textContent = findKind === 'invoice' ? 'Find invoices' : 'Find quotes';
    const hint = document.getElementById('find-hint');
    if (hint) {
      const lead = findKind === 'invoice' ? 'Type an invoice number or customer.' : 'Type a quote number or customer.';
      hint.textContent = `${lead} Last 7 days and From–To use Chicago time. An empty search with no dates does not list everything.`;
    }
    if (typeof window.showPanel === 'function') window.showPanel('find');
    if (box) box.focus();
  }

  function openFindFromQuotes() {
    openFindKind('quote');
  }

  async function runFindSearch() {
    const seq = ++findSeq;
    const results = document.getElementById('find-results');
    const detail = document.getElementById('find-detail');
    findView = null;
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = '';
      detail.removeAttribute('aria-busy');
    }
    if (results) {
      results.hidden = false;
      results.innerHTML = '<p class="empty">Searching…</p>';
    }
    const q = findSearchText(document.getElementById('find-q')?.value);
    const dateWindow = readFindWindow();
    if (!q && !dateWindow) {
      if (seq !== findSeq) return;
      if (results) results.innerHTML = '<p class="empty">Type a number or customer, or pick dates. An empty search with no dates does not list the book.</p>';
      return;
    }
    if (!shop().supabaseClient) {
      if (seq !== findSeq) return;
      if (results) results.innerHTML = '<p class="empty">Couldn\'t load — try again</p>';
      return;
    }
    if (!(await ensureQuotesTables())) {
      if (seq !== findSeq) return;
      if (results) results.innerHTML = '<p class="empty">Run Phase 1 SQL on More to find quotes.</p>';
      return;
    }
    if (seq !== findSeq) return;
    const bounds = findWindowBounds(dateWindow);
    if (dateWindow && (!bounds.startIso || !bounds.endIso)) {
      if (seq !== findSeq) return;
      if (results) results.innerHTML = '<p class="empty">Couldn\'t load — try again</p>';
      return;
    }
    const pattern = q ? `%${q}%` : '';
    const kind = findKind === 'invoice' ? 'invoice' : 'quote';
    const found = kind === 'invoice'
      ? await runFindBuckets('invoices', FIND_INVOICE_LIST_COLS, invoiceFindSpecs(bounds), pattern)
      : await runFindBuckets('quotes', FIND_QUOTE_LIST_COLS, quoteFindSpecs(bounds), pattern);
    if (seq !== findSeq) return;
    if (found.error) {
      console.warn(found.error);
      if (results) results.innerHTML = `<p class="empty">${shop().escapeHtml(shop().plainDbError(found.error, 'load'))}</p>`;
      return;
    }
    const items = [];
    const stampOf = kind === 'invoice' ? invoiceListStamp : quoteListStamp;
    found.rows.forEach(row => items.push({ kind, row, stamp: stampOf(row) }));
    if (found.truncated) items.push({ truncated: true });
    const picked = assembleFindHits(items, dateWindow, FIND_LIST_CAP);
    const narrow = picked.capped ? `<p class="hint">${findNarrowCopy(!!dateWindow)}</p>` : '';
    if (!picked.rows.length) {
      const none = kind === 'invoice' ? 'No invoices match.' : 'No quotes match.';
      if (results) results.innerHTML = `<p class="empty">${none}</p>${narrow}`;
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
    if (results) results.innerHTML = `${picked.rows.map(hit).join('')}${narrow}`;
  }

  function showFindResults() {
    findSeq += 1;
    findView = null;
    const detail = document.getElementById('find-detail');
    const results = document.getElementById('find-results');
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = '';
      detail.removeAttribute('aria-busy');
    }
    if (results) results.hidden = false;
  }

  async function loadFindInvoice(id) {
    const client = shop().supabaseClient;
    const { data: inv, error } = await selectFindRow('invoices', FIND_INVOICE_COLS, id);
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
    const { data: quote, error } = await selectFindRow('quotes', FIND_QUOTE_COLS, id);
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
    detail.removeAttribute('aria-busy');
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
    const lines = loaded.lines;
    const readOnlyNote = !allowed
      ? ''
      : (kind === 'quote'
        ? 'Reprint shows this quote. Stock does not change.'
        : 'Reprint does not save and does not change stock.');
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
    const seq = ++findSeq;
    const results = document.getElementById('find-results');
    const detail = document.getElementById('find-detail');
    if (results) results.hidden = true;
    if (detail) {
      detail.hidden = false;
      detail.setAttribute('aria-busy', 'true');
      detail.innerHTML = '<button type="button" class="secondary tap" onclick="showFindResults()">Back</button><p class="empty">Opening…</p>';
    }
    const loaded = await loadFindDoc(safeKind, safe);
    if (seq !== findSeq) return;
    if (!loaded || loaded.error) {
      showFindResults();
      shop().showStatus(shop().plainDbError(loaded && loaded.error, 'load'), 'error');
      return;
    }
    if (loaded.missing) {
      showFindResults();
      shop().showStatus(safeKind === 'invoice' ? 'Invoice not found' : 'Quote not found', 'error');
      return;
    }
    findView = { kind: safeKind, id: safe, loaded };
    renderFindDetail(safeKind, loaded);
  }

  function missingCompanyColumn(error) {
    const raw = [error && error.message, error && error.details, error && error.hint].filter(Boolean).join(' ');
    return /company/i.test(raw) && /does not exist|schema cache|could not find/i.test(raw);
  }

  async function selectFindRow(table, cols, id) {
    const client = shop().supabaseClient;
    let res = await client.from(table).select(cols).eq('id', id).maybeSingle();
    if (res.error && missingCompanyColumn(res.error)) {
      const slim = cols.split(',').filter(col => col !== 'company').join(',');
      res = await client.from(table).select(slim).eq('id', id).maybeSingle();
    }
    return res;
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
      banner: banner || '',
      draft: false,
      company: inv.company || ''
    };
  }

  async function reprintFindDoc() {
    if (!findView) return;
    const viewAtStart = findView;
    const loaded = await loadFindDoc(viewAtStart.kind, viewAtStart.id);
    if (findView !== viewAtStart) return;
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
      doc = printDocFromInvoice(loaded.invoice, loaded.lines, loaded.parent, '');
      doc.draft = loaded.invoice.status !== 'approved';
    } else if (loaded.quote) {
      if (!(loaded.lines || []).length) {
        shop().showStatus('Nothing to reprint', 'error');
        return;
      }
      const header = quoteHeaderFromSaved(loaded.quote);
      printDocWindow('In-Mar Quote ' + (header.number || ''), quoteDocumentHtml(header, loaded.lines), { view: true });
      return;
    }
    if (!doc) return;
    printInvoiceDocument(doc, { view: true });
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
    setCashSale,
    onQuoteCustomerInput,
    pickCustomer,
    addCustomerFromQuote,
    markCustomerInQb,
    pickQuoteCompany,
    nextDocNumber,
    ensureQuotesTables,
    loadQuotesList,
    openFindFromQuotes,
    openFindKind,
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
    quoteDocumentHtml,
    invoiceDocumentHtml,
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
      syncDueFromValid();
    });
    const validInput = document.getElementById('quote-valid');
    if (validInput) validInput.addEventListener('change', () => {
      const problem = quoteDateProblem();
      if (problem) shop().showStatus(problem, 'error');
      syncDueFromValid();
    });
    const dueInput = document.getElementById('inv-due');
    if (dueInput) dueInput.addEventListener('input', () => { dueEditedByHand = true; });
    const notesInput = document.getElementById('quote-notes');
    if (notesInput) notesInput.addEventListener('input', () => {
      if (document.getElementById('quote-invoices')) renderQuoteInvoiceRows(currentQuoteInvoices);
    });
    ['inv-shipfee', 'inv-duty', 'inv-tariffs'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateInvoicePreview);
    });
    renderQuotePanel();
    if (!document.getElementById('quote-edit-id')?.value) {
      setQuoteNumberDisplay('');
      renderCompanyPicker();
    }
    const findForm = document.getElementById('find-form');
    if (findForm) findForm.addEventListener('submit', (e) => {
      e.preventDefault();
      runFindSearch();
    });
    const findLast7 = document.getElementById('find-last7');
    if (findLast7) findLast7.addEventListener('click', () => { runFindLast7(); });
    const statusSel = document.getElementById('quote-status');
    if (statusSel) statusSel.addEventListener('change', () => applySaleLocks());
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#customer-pick, #quote-customer')) hideCustomerPick();
    });
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
