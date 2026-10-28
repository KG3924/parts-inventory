// Customers screen (CL1b): find a customer and edit their details.
// Reads and writes public.customers only. No Delete. Merged customers are left out of the search
// and open read-only. The database still owns the rules: one name per customer (capitals and
// extra spaces don't count), no "Cash sale" customer, and who may mark In QuickBooks.

function shop() {
  const api = window.InmarShop;
  if (!api) throw new Error("Shop is not ready");
  return api;
}

export const CUSTOMER_FIELDS = [
  { key: "name", label: "Customer name (required)", kind: "text" },
  { key: "contact_name", label: "Contact person", kind: "text" },
  { key: "phone", label: "Phone", kind: "tel" },
  { key: "email", label: "Email", kind: "email" },
  { key: "billing_address", label: "Billing address", kind: "area" },
  { key: "ship_to_address", label: "Ship-to address", kind: "area" },
  { key: "payment_terms", label: "Payment terms", kind: "text" },
  { key: "tax_exempt_number", label: "Tax-exempt or resale number", kind: "text" },
  { key: "notes", label: "Notes", kind: "area" }
];
export const CUSTOMER_COLS = "id,name,contact_name,phone,email,billing_address,ship_to_address,payment_terms,tax_exempt_number,notes,qb_status,merged_into,updated_at";
export const CUSTOMER_SEARCH_CAP = 8;

// '' and null both mean blank (the list import left some of each). Line endings compare equal.
export function fieldText(v) {
  return v == null ? "" : String(v).replace(/\r\n?/g, "\n").trim();
}

export function cleanCustomerName(v) {
  return fieldText(v).replace(/\s+/g, " ");
}

// Only fields the person changed are sent. A blank that was blank stays as it was ('' or null).
// A field cleared on purpose is saved as null.
export function customerPatch(original, form) {
  const patch = {};
  for (const { key } of CUSTOMER_FIELDS) {
    const clean = key === "name" ? cleanCustomerName : fieldText;
    const before = clean(original && original[key]);
    const after = clean(form && form[key]);
    if (before === after) continue;
    patch[key] = after === "" ? null : after;
  }
  return patch;
}

export function customerFormProblem(form) {
  const name = cleanCustomerName(form && form.name);
  if (!name) return "Type the customer name first.";
  if (name.toLowerCase() === "cash sale") return "Cash sale is not a customer. Tap Cash sale instead.";
  return "";
}

// The database refuses a second customer with the same name. Say so in plain words; never echo the raw error.
export function customerSaveError(error, typedName, plain) {
  const raw = [error && error.code, error && error.message, error && error.details]
    .filter(Boolean).map(String).join(" ");
  if (/23505|customers_name_key_unique|duplicate key/i.test(raw)) {
    return `Not saved. “${cleanCustomerName(typedName)}” is already on the customer list (capitals and extra spaces don't count). Use a different name.`;
  }
  return plain ? plain(error, "save") : "Couldn't save — try again";
}

// QuickBooks keeps its own copy of the name and terms. When those change on a customer already
// in QuickBooks, remind the person to change it there too. Other boxes and New customers: no reminder.
export function customerSavedMessage(before, patch, savedName) {
  const qbCopy = before && before.qb_status === "in_qb" && patch && ("name" in patch || "payment_terms" in patch);
  return `${savedName} saved.` + (qbCopy ? " Update it in QuickBooks too." : "");
}

export const customersMarkup = `
<div class="card" id="cust-list-view">
  <h2>Customers</h2>
  <label for="cust-search">Find a customer</label>
  <input type="search" id="cust-search" autocomplete="off" placeholder="Type 2 or more letters of the name">
  <div id="cust-results" aria-live="polite"></div>
</div>
<div class="card" id="cust-form-view" hidden>
  <div class="btn-group"><button type="button" class="secondary tap" id="cust-back">‹ Back</button></div>
  <h2 id="cust-form-title">Customer</h2>
  <p id="cust-loading" class="hint" hidden>Loading…</p>
  <div id="cust-qb" class="cust-qb"></div>
  <p id="cust-merged" class="hint" hidden></p>
  <form id="cust-form" novalidate>
    ${CUSTOMER_FIELDS.map(f => `<label for="cust-f-${f.key}">${f.label}</label>`
      + (f.kind === "area"
        ? `<textarea id="cust-f-${f.key}" name="${f.key}" rows="3"></textarea>`
        : `<input type="${f.kind}" id="cust-f-${f.key}" name="${f.key}" autocomplete="off"${f.key === "payment_terms" ? ' placeholder="Net 30"' : ""}>`)).join("\n    ")}
    <p id="cust-form-error" class="status error" role="alert" hidden></p>
    <div class="btn-group">
      <button type="submit" class="tap" id="cust-save">Save</button>
      <button type="button" class="secondary tap" id="cust-cancel">Cancel</button>
    </div>
  </form>
</div>`;

export function installCustomers() {
  const panel = document.getElementById("customers");
  if (!panel) return;
  panel.innerHTML = customersMarkup;
  const $ = id => document.getElementById(id);
  const esc = s => shop().escapeHtml(s == null ? "" : String(s));
  const form = $("cust-form");
  let results = [];
  let searchSeq = 0;
  let searchTimer = null;
  let loaded = null;   // row as last read from the database
  let busy = false;

  function readForm() {
    const out = {};
    for (const { key } of CUSTOMER_FIELDS) out[key] = $("cust-f-" + key).value;
    return out;
  }
  function fillForm(row) {
    for (const { key } of CUSTOMER_FIELDS) $("cust-f-" + key).value = fieldText(row && row[key]);
  }
  function isDirty() {
    return !!loaded && !loaded.merged_into && Object.keys(customerPatch(loaded, readForm())).length > 0;
  }
  function setFormError(msg) {
    const el = $("cust-form-error");
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  function setEditable(on) {
    form.querySelectorAll("input, textarea").forEach(el => { el.disabled = !on; });
    $("cust-save").hidden = !on;
  }
  function renderQb() {
    const el = $("cust-qb");
    if (!loaded || loaded.merged_into) { el.innerHTML = ""; return; }
    el.innerHTML = loaded.qb_status === "new_not_in_qb"
      ? '<span class="badge badge-new-qb">New, not in QuickBooks yet</span><button type="button" class="secondary" id="cust-mark-qb">Mark In QuickBooks</button>'
      : '<span class="badge badge-in-qb">In QuickBooks</span>';
  }

  // ---- list ----
  function renderResults(state, q) {
    const box = $("cust-results");
    if (state === "short") { box.innerHTML = '<p class="hint">Type 2 or more letters of the customer\'s name.</p>'; return; }
    if (state === "signin") { box.innerHTML = '<p class="hint">Sign in to see customers.</p>'; return; }
    if (state === "loading") { box.innerHTML = '<p class="hint">Searching…</p>'; return; }
    if (state === "error") {
      box.innerHTML = '<p class="cust-error">Couldn\'t load customers — try again.</p><button type="button" class="secondary tap" id="cust-retry">Try again</button>';
      return;
    }
    if (!results.length) { box.innerHTML = `<p class="hint">No customer matches “${esc(q)}”. New customers are added from the Quote screen.</p>`; return; }
    box.innerHTML = '<div class="customer-pick cust-list">'
      + results.map((r, i) => `<button type="button" class="customer-pick-row" data-i="${i}">${esc(r.name)}`
        + (r.qb_status === "new_not_in_qb" ? ' <span class="badge badge-new-qb">New, not in QuickBooks yet</span>' : "") + "</button>").join("")
      + "</div>"
      + (results.length >= CUSTOMER_SEARCH_CAP ? '<p class="hint">Showing the closest 8. Type more of the name to narrow it.</p>' : "");
  }
  async function runSearch() {
    clearTimeout(searchTimer);
    const q = $("cust-search").value.trim();
    const seq = ++searchSeq;
    if (q.length < 2) { results = []; renderResults("short"); return; }
    if (!shop().supabaseClient || !shop().currentUser()) { results = []; renderResults("signin"); return; }
    renderResults("loading");
    const { data, error } = await shop().supabaseClient.rpc("shop_customer_suggest", { p_q: q });
    if (seq !== searchSeq) return;
    if (error) { results = []; renderResults("error"); return; }
    results = data || [];
    renderResults("list", q);
  }
  function showList() {
    loaded = null;
    setFormError("");
    $("cust-form-view").hidden = true;
    $("cust-list-view").hidden = false;
    runSearch();
  }

  // ---- one customer ----
  async function openCustomer(id) {
    loaded = null;
    setFormError("");
    fillForm(null);
    setEditable(false);
    $("cust-qb").innerHTML = "";
    $("cust-merged").hidden = true;
    $("cust-form-title").textContent = "Customer";
    $("cust-list-view").hidden = true;
    $("cust-form-view").hidden = false;
    $("cust-loading").hidden = false;
    window.scrollTo(0, 0);
    const { data, error } = await shop().supabaseClient.from("customers").select(CUSTOMER_COLS).eq("id", id).maybeSingle();
    $("cust-loading").hidden = true;
    if (error || !data) { setFormError("Couldn't load this customer — tap Back and try again."); return; }
    showLoaded(data);
  }
  async function showLoaded(row) {
    loaded = row;
    fillForm(row);
    $("cust-form-title").textContent = row.name;
    renderQb();
    if (row.merged_into) {
      setEditable(false);
      const el = $("cust-merged");
      el.textContent = "This customer was merged into another one and can't be edited here.";
      el.hidden = false;
      const { data } = await shop().supabaseClient.from("customers").select("name").eq("id", row.merged_into).maybeSingle();
      if (data && loaded === row) el.textContent = `This customer was merged into “${data.name}”. Search for that name to edit it.`;
      return;
    }
    $("cust-merged").hidden = true;
    setEditable(true);
  }
  // Nothing came back from a save: say why in plain words.
  async function whyNotSaved(id) {
    const { data } = await shop().supabaseClient.from("customers").select("merged_into").eq("id", id).maybeSingle();
    if (!data) return "Not saved. This customer is no longer on the list. Tap Back.";
    if (data.merged_into) return "Not saved. This customer was merged into another one. Tap Back and search again.";
    return "Not saved. Someone else changed this customer just now. Tap Back, open it again, and redo your change.";
  }
  // Only this exact version of an unmerged row is written.
  function guardedUpdate(patch) {
    let q = shop().supabaseClient.from("customers").update(patch).eq("id", loaded.id).is("merged_into", null);
    q = loaded.updated_at == null ? q.is("updated_at", null) : q.eq("updated_at", loaded.updated_at);
    return q.select(CUSTOMER_COLS).maybeSingle();
  }

  async function save(ev) {
    ev.preventDefault();
    if (busy || !loaded || loaded.merged_into) return;
    setFormError("");
    if (!shop().requireUser("updating customers")) return;
    const values = readForm();
    const problem = customerFormProblem(values);
    if (problem) { setFormError(problem); return; }
    const patch = customerPatch(loaded, values);
    if (!Object.keys(patch).length) { shop().showStatus("No changes to save.", "info"); showList(); return; }
    busy = true;
    $("cust-save").disabled = true;
    $("cust-save").textContent = "Saving…";
    try {
      const { data, error } = await guardedUpdate(patch);
      if (error) { setFormError(customerSaveError(error, values.name, shop().plainDbError)); return; }
      if (!data) { setFormError(await whyNotSaved(loaded.id)); return; }
      shop().showStatus(customerSavedMessage(loaded, patch, data.name), "success");
      showList();
    } catch (e) {
      setFormError("Couldn't save — try again");
    } finally {
      busy = false;
      $("cust-save").disabled = false;
      $("cust-save").textContent = "Save";
    }
  }

  async function markInQb() {
    if (busy || !loaded || loaded.merged_into) return;
    setFormError("");
    if (!shop().requireUser("updating customers")) return;
    if (isDirty()) { setFormError("Save or cancel your changes first, then Mark In QuickBooks."); return; }
    if (!confirm(`Mark “${loaded.name}” as entered in QuickBooks?`)) return;
    busy = true;
    try {
      const { data, error } = await guardedUpdate({ qb_status: "in_qb" });
      if (error) { setFormError(shop().plainDbError(error, "save")); return; }
      if (!data) { setFormError(await whyNotSaved(loaded.id)); return; }
      showLoaded(data);
      shop().showStatus(`${data.name} marked In QuickBooks.`, "success");
    } finally {
      busy = false;
    }
  }

  function leave() {
    if (busy) return;
    if (isDirty() && !confirm("Leave without saving? Your changes will be lost.")) return;
    showList();
  }

  $("cust-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });
  $("cust-results").addEventListener("click", ev => {
    if (ev.target.closest("#cust-retry")) { runSearch(); return; }
    const row = ev.target.closest("button.customer-pick-row");
    if (!row) return;
    const r = results[Number(row.dataset.i)];
    if (r) openCustomer(r.id);
  });
  $("cust-qb").addEventListener("click", ev => { if (ev.target.closest("#cust-mark-qb")) markInQb(); });
  $("cust-back").addEventListener("click", leave);
  $("cust-cancel").addEventListener("click", leave);
  form.addEventListener("submit", save);
  renderResults("short");
}
