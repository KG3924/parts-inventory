// Purchase order screen. Typed, printed, and thrown away. Nothing is saved.

function shop() {
  const api = window.InmarShop;
  if (!api) throw new Error("Shop is not ready");
  return api;
}

export const PO_INVOICE_TO_START = "In-Mar Systems, Inc.\n3011 S. Ruby Ave.\nGonzales, LA 70737";

export const PO_FIELDS = [
  { id: "po-number", key: "number", label: "PO number (required)", kind: "text" },
  { id: "po-date", key: "date", label: "Date", kind: "text" },
  { id: "po-to", key: "to", label: "To (vendor name and address)", kind: "area" },
  { id: "po-attn", key: "attn", label: "Attn", kind: "text" },
  { id: "po-ship", key: "ship", label: "Ship To", kind: "area" },
  { id: "po-project", key: "project", label: "Project", kind: "text" },
  { id: "po-invoice", key: "invoice", label: "Invoice To", kind: "area" },
  { id: "po-ref", key: "ref", label: "Customer PO ref", kind: "text" },
  { id: "po-delivery", key: "delivery", label: "Delivery time", kind: "text" },
  { id: "po-thanks", key: "thanks", label: "Thank You name", kind: "text" },
  { id: "po-notes", key: "notes", label: "Notes", kind: "area" }
];

// Local calendar date. A UTC stamp rolls forward to tomorrow after about 7 PM Central.
export function localPoDate(now) {
  const d = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return month + "/" + day + "/" + d.getFullYear();
}

export function poStartValues(today) {
  return {
    number: "",
    date: today,
    to: "",
    attn: "",
    ship: "",
    project: "",
    invoice: PO_INVOICE_TO_START,
    ref: "",
    delivery: "",
    thanks: "",
    notes: ""
  };
}

export function poLineFromPart(item) {
  return { part_number: String((item && item.part_number) || ""), name: String((item && item.name) || ""), qty: 1 };
}

export function addPartToPoLines(lines, item) {
  const made = poLineFromPart(item);
  const list = Array.isArray(lines) ? lines : [];
  const idx = list.findIndex(line => line && line.part_number === made.part_number);
  if (idx >= 0) {
    return list.map((line, i) => {
      const kept = poLineFromPart(line);
      kept.qty = i === idx ? (Number(line.qty) || 0) + 1 : line.qty;
      return kept;
    });
  }
  return list.map(line => {
    const kept = poLineFromPart(line);
    kept.qty = line.qty;
    return kept;
  }).concat([made]);
}

// Whole number, 1 or more. 0, blanks, and 2.5 are refused.
export function poQtyOrNull(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!/^[0-9]+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

export function poPrintProblem(number, lines) {
  if (!String(number == null ? "" : number).trim()) return "Type the PO number first.";
  if (!lines || !lines.length) return "Add at least one part to the PO first.";
  return "";
}

export function poIsPristine(fields, lines, search, today) {
  if (lines && lines.length) return false;
  if (String(search || "") !== "") return false;
  const start = poStartValues(today);
  return PO_FIELDS.every(f => String(fields && fields[f.key] != null ? fields[f.key] : "") === start[f.key]);
}

export function poPanelHtml() {
  const fields = PO_FIELDS.map(f => {
    const label = `<label for="${f.id}">${f.label}</label>`;
    const control = f.kind === "area"
      ? `<textarea id="${f.id}" rows="3" autocomplete="off"></textarea>`
      : `<input type="text" id="${f.id}" autocomplete="off">`;
    return label + "\n  " + control;
  }).join("\n  ");
  return `<div class="card">
  <h2>PO</h2>
  ${fields}
  <label for="po-search">Add a part</label>
  <input type="search" id="po-search" autocomplete="off" placeholder="Type 2 or more letters of the name or part number">
  <div id="po-matches" aria-live="polite"></div>
  <div id="po-lines"></div>
  <div class="btn-group">
    <button type="button" class="tap" id="po-print">Print PO</button>
    <button type="button" class="secondary tap" id="po-clear">Clear PO</button>
  </div>
</div>`;
}

function poMatchButton(line, index, escape) {
  return `<button type="button" class="customer-pick-row" data-add="${index}"><span class="po-hit">${escape(line.name)}</span><span class="po-hit-pn">${escape(line.part_number)}</span></button>`;
}

function poPrintStyle() {
  return `<style>
    body, .po-page, .po-page table, .po-page th, .po-page td { font-family: "Times New Roman", Times, serif; color: #000; }
    .po-page { font-size: 12pt; line-height: 1.25; }
    .po-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .po-letter { flex: 1 1 auto; min-width: 0; }
    .po-letter .logo { max-height: 0.78in; width: auto; }
    .po-id { flex: 0 0 auto; text-align: right; padding-top: 2px; }
    .po-kicker { font-size: 18pt; font-weight: 700; letter-spacing: 0.04em; line-height: 1.05; white-space: nowrap; }
    .po-pono { margin-top: 6px; font-size: 12pt; }
    table.po-meta { width: 100%; border-collapse: collapse; margin-top: 14px; }
    table.po-meta td, table.po-fields td, table.po-foot td { border: none; background: transparent; padding: 0; }
    table.po-fields { width: 100%; border-collapse: collapse; }
    table.po-meta td.po-side { width: 50%; vertical-align: top; }
    table.po-meta td.po-side-right { padding-left: 0.28in; }
    table.po-fields td.po-lab { font-weight: 700; text-align: right; vertical-align: top; white-space: nowrap; padding: 2px 10px 8px 0; width: 1%; }
    table.po-fields td.po-val { vertical-align: top; white-space: pre-wrap; padding: 0 0 8px 0; }
    .po-bar { height: 10px; background: #c8c8c8; margin: 8px 0 8px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .po-please { font-style: italic; margin: 0 0 8px; }
    table.po-items { width: 100%; border-collapse: collapse; }
    table.po-items th, table.po-items td { border: 1px solid #000; background: #fff; padding: 4px 6px; vertical-align: top; font-weight: 400; }
    table.po-items th { font-weight: 700; text-align: center; white-space: nowrap; }
    td.po-num, td.po-qty { text-align: center; }
    tr.po-gap td { height: 0.9in; }
    td.po-notes { white-space: pre-wrap; }
    table.po-foot { width: 100%; border-collapse: collapse; margin-top: 10px; }
    table.po-foot td.po-del { vertical-align: top; padding-top: 10px; white-space: pre-wrap; }
    table.po-foot td.po-ty { vertical-align: top; text-align: right; width: 42%; padding-top: 10px; white-space: pre-wrap; }
    .po-sign { font-weight: 700; font-style: italic; }
  </style>`;
}

export function poPrintHtml(fields, lines, letterhead, escape) {
  const src = fields || {};
  const e = v => escape(v == null ? "" : String(v).replace(/\r\n/g, "\n"));
  const rows = (lines || []).map((line, i) => `<tr>
      <td class="po-num">${i + 1}</td>
      <td class="po-qty">${e(line.qty)}</td>
      <td>${e(line.part_number)}</td>
      <td>${e(line.name)}</td>
    </tr>`).join("");
  const field = (label, value) => `<tr><td class="po-lab">${label}</td><td class="po-val">${value}</td></tr>`;
  return `${poPrintStyle()}
  <div class="po-page">
    <div class="po-top">
      <div class="po-letter">${letterhead || ""}</div>
      <div class="po-id">
        <div class="po-kicker">PURCHASE ORDER</div>
        <div class="po-pono">Purchase Order No: <strong>${e(src.number)}</strong></div>
      </div>
    </div>
    <table class="po-meta">
      <tr>
        <td class="po-side">
          <table class="po-fields">
            ${field("Date:", e(src.date))}
            ${field("To:", e(src.to))}
            ${field("Attn:", e(src.attn))}
            ${field("Project:", e(src.project))}
            ${field("Customer PO ref:", e(src.ref))}
          </table>
        </td>
        <td class="po-side po-side-right">
          <table class="po-fields">
            ${field("Ship To:", e(src.ship))}
            ${field("Invoice To:", e(src.invoice))}
          </table>
        </td>
      </tr>
    </table>
    <div class="po-bar"></div>
    <p class="po-please">Please process the following order for In-Mar Systems:</p>
    <table class="po-items">
      <colgroup><col style="width:0.55in"><col style="width:0.7in"><col style="width:1.65in"><col></colgroup>
      <thead>
        <tr><th>ITEM</th><th>QTY.</th><th>PART NO.</th><th>DESCRIPTION</th></tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="po-gap"><td></td><td></td><td></td><td></td></tr>
        <tr>
          <td></td>
          <td></td>
          <td><strong>Notes:</strong></td>
          <td class="po-notes">${e(src.notes)}</td>
        </tr>
      </tbody>
    </table>
    <table class="po-foot">
      <tr>
        <td class="po-del"><strong>Delivery Time:</strong> ${e(src.delivery)}</td>
        <td class="po-ty">Thank You,<br><span class="po-sign">${e(src.thanks)}</span></td>
      </tr>
    </table>
  </div>`;
}

export function installPo() {
  const panel = document.getElementById("po");
  if (!panel) return;
  panel.innerHTML = poPanelHtml();
  const $ = id => document.getElementById(id);
  const esc = s => shop().escapeHtml(s == null ? "" : String(s));
  let lines = [];
  let picked = [];
  let startDate = "";

  function readFields() {
    const out = {};
    for (const f of PO_FIELDS) out[f.key] = $(f.id).value;
    return out;
  }
  function renderLines() {
    $("po-lines").innerHTML = lines.map((line, i) => `<div class="po-line">
      <div class="po-line-main"><div>${esc(line.name)}</div><div class="po-hit-pn">${esc(line.part_number)}</div></div>
      <input type="text" inputmode="numeric" autocomplete="off" aria-label="Qty" data-qty="${i}" value="${esc(line.qty)}">
      <button type="button" class="secondary tap" data-remove="${i}" aria-label="Remove">×</button>
    </div>`).join("");
  }
  function renderMatches() {
    const box = $("po-matches");
    const raw = $("po-search").value;
    if (raw.trim().length < 2) {
      picked = [];
      box.innerHTML = "";
      return;
    }
    const found = shop().searchInventoryMatches(raw).slice(0, 8).map(poLineFromPart);
    picked = found;
    if (!found.length) {
      box.innerHTML = '<p class="hint">No matching part.</p>';
      return;
    }
    box.innerHTML = '<div class="customer-pick">' + found.map((line, i) => poMatchButton(line, i, esc)).join("") + "</div>";
  }
  function applyStart() {
    startDate = localPoDate();
    const start = poStartValues(startDate);
    for (const f of PO_FIELDS) $(f.id).value = start[f.key];
    $("po-search").value = "";
    lines = [];
    picked = [];
    renderMatches();
    renderLines();
  }

  $("po-search").addEventListener("input", renderMatches);
  $("po-matches").addEventListener("click", e => {
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    const line = picked[Number(btn.getAttribute("data-add"))];
    if (!line) return;
    lines = addPartToPoLines(lines, line);
    renderLines();
  });
  $("po-lines").addEventListener("change", e => {
    const input = e.target.closest("[data-qty]");
    if (!input) return;
    const i = Number(input.getAttribute("data-qty"));
    const line = lines[i];
    if (!line) return;
    const n = poQtyOrNull(input.value);
    if (n == null) {
      shop().showStatus("Qty must be a whole number, 1 or more.", "error");
      input.value = String(line.qty);
      return;
    }
    lines[i] = { part_number: line.part_number, name: line.name, qty: n };
    input.value = String(n);
  });
  $("po-lines").addEventListener("click", e => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    lines.splice(Number(btn.getAttribute("data-remove")), 1);
    renderLines();
  });
  $("po-print").addEventListener("click", () => {
    const fields = readFields();
    const problem = poPrintProblem(fields.number, lines);
    if (problem) {
      shop().showStatus(problem, "error");
      return;
    }
    const html = poPrintHtml(fields, lines, window.companyBlock("S"), s => shop().escapeHtml(s));
    const banner = document.getElementById("status");
    if (banner) {
      banner.textContent = "";
      banner.className = "status";
    }
    window.printDocWindow("In-Mar PO " + fields.number, html);
  });
  $("po-clear").addEventListener("click", () => {
    if (!poIsPristine(readFields(), lines, $("po-search").value, startDate)) {
      if (!confirm("Clear this PO? Nothing is saved, so it can't be brought back.")) return;
    }
    applyStart();
  });
  applyStart();
}
