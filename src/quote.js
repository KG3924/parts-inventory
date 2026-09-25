import { quoteMarkup } from "./quote-markup.js";

function shop() {
  const api = window.InmarShop;
  if (!api) throw new Error("Shop is not ready");
  return api;
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
  let quoteStatusFilter = "all";
  let editingQuoteId = null;

  // ===== QUOTES (Phase 1: save to Supabase; no inventory qty impact) =====
  let quoteCart = JSON.parse(localStorage.getItem('inv_quote') || '[]');

  function saveQuoteCart() {
    localStorage.setItem('inv_quote', JSON.stringify(quoteCart));
    renderQuotePanel();
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
    const st = document.getElementById('quote-status');
    if (st) st.value = 'draft';
    const num = document.getElementById('quote-number');
    if (num) num.value = '';
    saveQuoteCart();
    shop().showStatus('Cart cleared', 'info');
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
            return `<tr>
              <td><strong>${shop().escapeHtml(c.name)}</strong><br><code style="font-size:0.75rem;color:var(--muted)">${shop().escapeHtml(c.part_number)}</code></td>
              <td><input type="number" min="1" value="${c.qty}" style="width:70px;margin:0" onchange="updateQuoteLine(${idx},'qty',this.value)"></td>
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
    const year = new Date().getFullYear();
    const prefix = docType === 'quote' ? 'Q' : docType === 'order' ? 'SO' : docType === 'invoice' ? 'INV' : docType === 'packing_list' ? 'PL' : 'DOC';
    if (!shop().supabaseClient || !shop().hasQuotesTables) {
      return `${prefix}-${year}-001`;
    }
    // Prefer document_counters; fall back to max existing quote number
    try {
      const { data: row } = await shop().supabaseClient.from('document_counters')
        .select('last_value').eq('doc_type', docType).eq('year', year).maybeSingle();
      let next = (row?.last_value || 0) + 1;
      if (!row) {
        await shop().supabaseClient.from('document_counters').insert({ doc_type: docType, year, last_value: next });
      } else {
        await shop().supabaseClient.from('document_counters').update({ last_value: next }).eq('doc_type', docType).eq('year', year);
      }
      return `${prefix}-${year}-${String(next).padStart(3, '0')}`;
    } catch (e) {
      console.warn('counter failed', e);
    }
    const table = docType === 'invoice' ? 'invoices' : docType === 'packing_list' ? 'packing_lists' : 'quotes';
    try {
      const { data: existing } = await shop().supabaseClient.from(table).select('number').like('number', `${prefix}-${year}-%`);
      let max = 0;
      (existing || []).forEach(r => {
        const m = String(r.number || '').match(/-(\d+)$/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
      return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`;
    } catch (e2) {
      return `${prefix}-${year}-001`;
    }
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

  function renderQuoteStatusFilters() {
    const el = document.getElementById('quote-status-filters');
    if (!el) return;
    const chips = [
      { id: 'all', label: 'All' },
      { id: 'draft', label: 'Draft' },
      { id: 'sent', label: 'Sent' },
      { id: 'accepted', label: 'Accepted' },
      { id: 'expired', label: 'Expired' },
      { id: 'void', label: 'Void' }
    ];
    el.innerHTML = chips.map(c =>
      `<button type="button" class="filter-chip ${quoteStatusFilter === c.id ? 'active' : ''}" onclick="setQuoteStatusFilter('${c.id}')">${c.label}</button>`
    ).join('');
  }

  function setQuoteStatusFilter(id) {
    quoteStatusFilter = id;
    renderQuoteStatusFilters();
    renderQuotesList();
  }

  async function loadQuotesList() {
    const hint = document.getElementById('quotes-schema-hint');
    const listEl = document.getElementById('quotes-list');
    renderQuoteStatusFilters();
    if (!shop().supabaseClient) return;
    const ok = await ensureQuotesTables();
    if (!ok) {
      if (hint) hint.textContent = 'Run Phase 1 SQL on More to save quotes.';
      if (listEl) listEl.innerHTML = '<p class="empty">Install quotes SQL to save and list quotes.</p>';
      return;
    }
    if (hint) hint.textContent = 'Saving a quote does not change stock.';
    const { data, error } = await shop().supabaseClient.from('quotes')
      .select('id,number,customer_name,status,quote_date,valid_until,prepared_by,updated_at')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) {
      if (listEl) listEl.innerHTML = `<p class="empty">Could not load quotes: ${shop().escapeHtml(error.message)}</p>`;
      return;
    }
    quotesListCache = data || [];
    await loadCustomerSuggestions();
    renderQuotesList();
  }

  function renderQuotesList() {
    const listEl = document.getElementById('quotes-list');
    if (!listEl) return;
    let rows = quotesListCache;
    if (quoteStatusFilter !== 'all') {
      rows = rows.filter(q => q.status === quoteStatusFilter);
    }
    if (!rows.length) {
      listEl.innerHTML = '<p class="empty">No saved quotes for this filter.</p>';
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
              <td><span class="badge ${q.status === 'void' ? 'needs-date' : q.status === 'accepted' ? 'open-order' : 'source-tag'}">${shop().escapeHtml(q.status)}</span></td>
              <td style="font-size:0.8rem;color:var(--muted)">${shop().escapeHtml(q.quote_date || '')}</td>
              <td class="actions">
                <button class="secondary" onclick="openQuote('${q.id}')">Open</button>
                <button class="secondary" onclick="duplicateQuoteById('${q.id}')">Dup</button>
                <button class="secondary" onclick="printQuoteById('${q.id}')">Print</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function startNewQuote() {
    editingQuoteId = null;
    document.getElementById('quote-edit-id').value = '';
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
    if (shop().hasQuotesTables) {
      document.getElementById('quote-number').value = await nextDocNumber('quote');
    }
    await refreshQuoteLookups();
    setComboValue('fob', '');
    setComboValue('terms', '');
    renderQuotePanel();
    shop().showStatus('Builder ready — add lines then Save quote', 'info');
  }

  async function openQuote(id) {
    if (!(await ensureQuotesTables())) {
      shop().showStatus('Quotes tables not installed', 'error');
      return;
    }
    const { data: q, error } = await shop().supabaseClient.from('quotes').select('*').eq('id', id).maybeSingle();
    if (error || !q) {
      shop().showStatus(error?.message || 'Quote not found', 'error');
      return;
    }
    const { data: lines } = await shop().supabaseClient.from('quote_lines')
      .select('*').eq('quote_id', id).order('line_no');
    editingQuoteId = q.id;
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
    shop().showStatus(`Opened ${q.number}`, 'success');
  }

  async function saveQuoteToDb() {
    if (!shop().requireUser('saving quotes')) return;
    if (!(await ensureQuotesTables())) {
      shop().showStatus('Run Phase 1 quotes SQL on the More tab first', 'error');
      return;
    }
    if (quoteCart.length === 0) {
      shop().showStatus('Add at least one line before saving', 'error');
      return;
    }
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
      status: document.getElementById('quote-status').value || 'draft',
      quote_date: document.getElementById('quote-date').value || null,
      valid_until: document.getElementById('quote-valid').value || null,
      prepared_by: (document.getElementById('quote-by').value || '').trim() || shop().currentUser() || null,
      notes: (document.getElementById('quote-notes').value || '').trim() || null,
      created_by: shop().currentUser(),
      updated_at: new Date().toISOString()
    };
    let quoteId = editingQuoteId || document.getElementById('quote-edit-id').value || null;
    let error;
    if (quoteId) {
      ({ error } = await shop().supabaseClient.from('quotes').update(payload).eq('id', quoteId));
      if (!error) {
        await shop().supabaseClient.from('quote_lines').delete().eq('quote_id', quoteId);
      }
    } else {
      const res = await shop().supabaseClient.from('quotes').insert(payload).select('id').maybeSingle();
      error = res.error;
      quoteId = res.data?.id;
    }
    if (error && /project|rfq_number|fob_point|payment_terms|lead_time/i.test(error.message || '')) {
      delete payload.project;
      delete payload.rfq_number;
      delete payload.fob_point;
      delete payload.payment_terms;
      delete payload.lead_time;
      if (quoteId) {
        ({ error } = await shop().supabaseClient.from('quotes').update(payload).eq('id', quoteId));
        if (!error) await shop().supabaseClient.from('quote_lines').delete().eq('quote_id', quoteId);
      } else {
        const retry = await shop().supabaseClient.from('quotes').insert(payload).select('id').maybeSingle();
        error = retry.error;
        quoteId = retry.data?.id;
      }
    }
    if (error) {
      shop().showStatus('Save failed: ' + error.message + ' — run Phase 2 SQL on the More tab for new quote fields', 'error');
      return;
    }
    const lineRows = quoteCart.map((c, i) => ({
      quote_id: quoteId,
      line_no: i + 1,
      inventory_id: c.inventory_id || c.id || null,
      part_number: c.part_number || null,
      name: c.name || 'Item',
      qty: c.qty || 1,
      unit_price: c.unit_price || 0
    }));
    const { error: lErr } = await shop().supabaseClient.from('quote_lines').insert(lineRows);
    if (lErr) {
      shop().showStatus('Quote header saved but lines failed: ' + lErr.message, 'error');
      return;
    }
    editingQuoteId = quoteId;
    document.getElementById('quote-edit-id').value = quoteId;
    shop().showStatus(`Quote ${number} saved (${shop().currentUser()})`, 'success');
    await loadQuotesList();
  }

  async function voidCurrentQuote() {
    if (!shop().requireUser('voiding quotes')) return;
    const id = editingQuoteId || document.getElementById('quote-edit-id').value;
    if (!id) {
      shop().showStatus('Open a saved quote to void it', 'error');
      return;
    }
    if (!confirm('Void this quote? It will be kept for history with status void.')) return;
    const { error } = await shop().supabaseClient.from('quotes')
      .update({ status: 'void', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      shop().showStatus(error.message, 'error');
      return;
    }
    document.getElementById('quote-status').value = 'void';
    shop().showStatus('Quote voided', 'success');
    await loadQuotesList();
  }

  async function duplicateCurrentQuote() {
    if (!(await ensureQuotesTables())) return;
    if (!quoteCart.length) {
      shop().showStatus('Nothing to duplicate', 'error');
      return;
    }
    editingQuoteId = null;
    document.getElementById('quote-edit-id').value = '';
    document.getElementById('quote-status').value = 'draft';
    document.getElementById('quote-number').value = await nextDocNumber('quote');
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('quote-date').value = today;
    document.getElementById('quote-valid').value = addDaysIso(today, 90);
    const by = document.getElementById('quote-by');
    if (by && shop().currentUser()) by.value = shop().currentUser();
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
    try { plNumber = await nextDocNumber('packing_list'); } catch (e) { plNumber = 'PL-' + data.number; }
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

  function openInvoiceForm() {
    if (quoteCart.length === 0) {
      shop().showStatus('Add quote lines first', 'error');
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

  async function saveAndPrintInvoice() {
    if (!shop().requireUser('creating invoices')) return;
    if (quoteCart.length === 0) {
      shop().showStatus('Add quote lines first', 'error');
      return;
    }
    const data = collectQuoteHeader();
    const m = invoiceMath();
    const po = (document.getElementById('inv-po')?.value || '').trim();
    const shipTo = (document.getElementById('inv-ship')?.value || '').trim();
    const due = document.getElementById('inv-due')?.value || data.valid || '';
    const today = new Date().toISOString().slice(0, 10);
    let invNumber = await nextDocNumber('invoice');
    const quoteId = editingQuoteId || document.getElementById('quote-edit-id')?.value || null;
    if (shop().supabaseClient) {
      try {
        const { data: inv, error } = await shop().supabaseClient.from('invoices').insert({
          number: invNumber,
          quote_id: quoteId || null,
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
          status: 'draft',
          created_by: shop().currentUser()
        }).select('id').maybeSingle();
        if (!error && inv?.id) {
          await shop().supabaseClient.from('invoice_lines').insert(quoteCart.map((c, i) => ({
            invoice_id: inv.id,
            line_no: i + 1,
            inventory_id: c.inventory_id || c.id || null,
            part_number: c.part_number,
            name: c.name,
            qty: c.qty || 1,
            unit_price: c.unit_price || 0
          })));
        } else if (error) {
          console.warn(error);
          shop().showStatus('Invoice printed locally. Run Phase 2 SQL to save invoices to the database.', 'info');
        }
      } catch (e) {
        console.warn(e);
      }
    }
    const rows = quoteCart.map(c => {
      const line = (c.qty || 1) * (c.unit_price || 0);
      return `<tr>
        <td style="font-family:monospace;font-size:12px;">${shop().escapeHtml(c.part_number)}</td>
        <td>${shop().escapeHtml(c.name)}</td>
        <td style="text-align:center;">${c.qty}</td>
        <td style="text-align:right;">${shop().money(c.unit_price)}</td>
        <td style="text-align:right;font-weight:600;">${shop().money(line)}</td>
      </tr>`;
    }).join('');
    printDocWindow('In-Mar Invoice ' + invNumber, `
    <div class="header">
  <div>${companyBlock()}</div>
  <div class="meta">
    <div class="doc-title">INVOICE</div>
    <div><strong>Invoice #:</strong> ${shop().escapeHtml(invNumber)}</div>
    <div><strong>Quote #:</strong> ${shop().escapeHtml(data.number)}</div>
    ${po ? `<div><strong>PO #:</strong> ${shop().escapeHtml(po)}</div>` : ''}
    ${data.rfq ? `<div><strong>RFQ #:</strong> ${shop().escapeHtml(data.rfq)}</div>` : ''}
    <div><strong>Invoice date:</strong> ${shop().escapeHtml(today)}</div>
    <div><strong>Due date:</strong> ${shop().escapeHtml(due) || '—'}</div>
  </div>
    </div>
    <div class="info">
  <div><span>Bill to:</span> ${shop().escapeHtml(data.customer) || '—'}</div>
  <div><span>Project:</span> ${shop().escapeHtml(data.project) || '—'}</div>
  <div><span>Ship to:</span> ${shop().escapeHtml(shipTo) || 'Same as bill to'}</div>
  <div><span>Prepared By:</span> ${shop().escapeHtml(data.by) || '—'}</div>
  <div><span>FOB:</span> ${shop().escapeHtml(data.fob) || '—'}</div>
  <div><span>Payment terms:</span> ${shop().escapeHtml(data.terms) || '—'}</div>
    </div>
    <table>
  <thead><tr><th>Part #</th><th>Description</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
    </table>
    <div class="totals">
  <div><span>Merchandise</span><span>${shop().money(m.subtotal)}</span></div>
  <div><span>Shipping</span><span>${shop().money(m.shipping)}</span></div>
  <div><span>Duty</span><span>${shop().money(m.duty)}</span></div>
  <div><span>Tariffs</span><span>${shop().money(m.tariffs)}</span></div>
  ${m.cc ? `<div><span>Credit card fee (3.5%)</span><span>${shop().money(m.ccFee)}</span></div>` : ''}
  <div class="grand"><span>Amount due</span><span>${shop().money(m.total)}</span></div>
    </div>
    <p class="legal">Please remit by the due date. Amounts in USD.${m.cc ? ' Includes 3.5% card fee.' : ' 3.5% fee if paid by card.'}</p>
    <div><div style="font-weight:500;color:#64748b;margin-bottom:4px;">Notes</div><div class="notes">${shop().escapeHtml(data.notes) || '—'}</div></div>
    <div class="footer">Please remit with invoice number ${shop().escapeHtml(invNumber)}.<br>In-Mar Systems &amp; Solutions</div>`);
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
    renderQuoteStatusFilters,
    setQuoteStatusFilter,
    loadQuotesList,
    renderQuotesList,
    startNewQuote,
    openQuote,
    saveQuoteToDb,
    voidCurrentQuote,
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
    saveAndPrintInvoice
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
