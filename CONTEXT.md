# Parts Inventory App — Project Context

**For Grok Build / future sessions.** Read this file + `README.md` + `index.html` before making changes.

**Local project folder:** `/Users/kylegrantham/Inmar Parts Inventory`  
Git repo for GitHub Pages: this folder’s `.git` → `KG3924/parts-inventory` (`main`).  
Push to `main` when the user asks (GitHub Pages serves the live app).

---

## What this is

Internal inventory + parts tracker for **In-Mar Systems / In-Mar Solutions** (Gonzales, LA).

- Live app: https://kg3924.github.io/parts-inventory/
- GitHub: https://github.com/KG3924/parts-inventory (public, GitHub Pages from `main`)
- Data backend: **Supabase** (Postgres + realtime)
- Frontend: single-file `index.html` (vanilla JS, no build step)
- Logo for quotes: `inmar-logo.jpg`
- Label printer: **Brother QL-710W** with **DK-1201** die-cut labels (1.1″ × 3.5″)

---

## Critical rules for agents

1. **Never overwrite or reset** `SUPABASE_URL` or `SUPABASE_ANON_KEY` in `index.html`.
2. Prefer editing the existing file in place over rewriting the whole app.
3. Part numbers must **not** contain spaces. Display part # as human text; **labels encode stable `barcode`**, not part #.
4. Placeholders for missing part numbers: include `PLACEHOLDER` in the part number (e.g. `WYNN-PLACEHOLDER-008`).
5. After meaningful feature changes, update this file + `README.md`. **Push only when the user asks.**
6. **Do not alter** original supplier spreadsheets under `inmarinventory/`.
7. **User required before mutations.** User selection is **session-only** (in-memory `sessionUser`); **do not** restore from `localStorage` (legacy `inv_user` is cleared on load so the UI always starts at “— Select —”).

---

## Tech stack

| Piece | Detail |
|-------|--------|
| UI | Single `index.html`, light theme |
| Backend | Supabase JS v2: `inventory`, `inventory_adjustments`, Phase 1 quotes, Phase 2 packing lists / invoices / `app_settings` / `app_lookups` |
| Labels | QR (`qrcode` CDN) deep-link `?part=` stable `barcode` ID; human part # printed beside QR |
| Camera scan | html5-qrcode; QR URL or plain ID; lookup **barcode or part_number**; commit separate; deep-link `?part=` |
| Hosting | GitHub Pages from `main` |
| Auth | None; open RLS for trusted internal use |
| Users | Glynn Grantham, Kyle Grantham, Toby Whitfield, Grant Adams, Ricky Whitfield — must select each session |

---

## Supabase schema

### `inventory`

```
id (uuid, pk)
name (text, not null)
part_number (text, unique, not null)   -- human / catalog PN; may change
barcode (text, unique)                 -- STABLE label code; never change on edit
qty, reorder_level, buy_price, sell_price
list_price, list_currency, sell_factor
exclude_from_valuation
source, category, location, notes
open_order, date_ordered, estimated_delivery, ordered_qty
updated_by, created_at, updated_at
```

### `inventory_adjustments` (history for reports)

```
id (uuid, pk)
inventory_id (uuid, nullable)
part_number, name (text snapshots)
action (text)  -- stock_in | stock_out | set_qty | create | update | delete | notes
qty_before, qty_after (integer)
changed_by (text)
details (text)
created_at (timestamptz)
```

**One-time SQL** is on the **More** tab in the app (Copy SQL). Also:
- `schema/quotes_phase1.sql` — customers / quotes / quote_lines / document_counters
- `schema/quotes_phase2.sql` — quote extras, packing lists, invoices, settings, lookups

App probes on load: `hasCategoryColumn`, `hasBarcodeColumn`, `hasAdjustmentsTable`, `hasQuotesTables`, `hasPhase2Tables`, `hasListPriceColumn`.  
If `barcode` exists, missing values are **backfilled** on load (`ensureBarcodes`).

### Phase 1 sales docs (additive — safe alongside inventory)

```
customers (name, company, email, phone, notes, payment_terms)
quotes (number Q-YYYY-###, customer_id?, customer_name, status, dates, prepared_by, notes, created_by)
quote_lines (quote_id, line_no, inventory_id?, part_number, name, qty, unit_price)
document_counters (doc_type, year, last_value)
```

### Phase 2 (additive — run after Phase 1)

```
quotes extras: project, rfq_number, fob_point, payment_terms, lead_time
customers.payment_terms
app_settings (key, value)           -- global Wynn / FFS sell factors
app_lookups (kind, value)           -- saved FOB points and payment terms
packing_lists / packing_list_lines  -- PL-YYYY-###, no prices
invoices / invoice_lines            -- INV-YYYY-### + PO, ship-to, due date, fees
```

Status enum (app): draft | sent | accepted | expired | void.  
**Main branch safety:** only CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — does not drop inventory. Old Pages builds ignore new tables. User must run Phase 2 SQL for packing/invoice saves and global factors in Supabase.

---

## Features (current)

### User selection
- Header dropdown always defaults to **— Select —** on open
- Full names: Glynn Grantham, Kyle Grantham, Toby Whitfield, Grant Adams, Ricky Whitfield
- Not persisted across browser restarts (clears `localStorage.inv_user`)
- Banner + red outline when empty; blocks qty/save/delete/scan commit/import/clear

### Home
- Search includes barcode
- Source + Category filter chips
- Source/category badges; stable BC shown under part #
- **Clickable tiles:** Open Orders, Low, Needs Delivery Date (value card), Parts (clears filter)
- Home filter bar with Clear filter
- +/− qty logs adjustments; Quote / Edit / Del

### Scan
- Lookup by **barcode or part number**
- Found card: notes (view/edit), **Quote**, **Edit part**, Commit / Save notes / Scan again
- Commit logs stock_in / stock_out / set_qty

### Add / Edit
- Same form; **barcode never edited by user** — generated on create, shown as read-only hint on edit
- Create / update / qty change on form → adjustment log

### Pricing
- List currency follows source: **Wynn = £ GBP**, **FFS = € EUR**, else **$ USD**
- Sell $ = list × sell factor, then **rounded up to the next $5** (130.01 → 135.00; 129.99 → 130.00; 130.00 stays 130.00)
- Per-item sell factor can still be edited on Add/Edit
- **More → Global sell factors:** Wynn and FFS fields; Save factors, or **Apply to all Wynn / FFS parts** that have a list price (other sources untouched)
- **Wynn buy $** auto-fills as converted list minus 30% (`list × factor × 0.70`), still editable
- FFS EUR factor is a field only until a number is known

### Quote (Phase 2 — quote / packing list / invoice)
- Working **cart** still in `localStorage` (`inv_quote`) until Save
- **Saved Quotes** list from Supabase (status filter chips)
- Builder fields: number, status, date, **valid until (default +90 days)**, **Customer** and **Project** (separate), **RFQ #**, **Prepared By** (defaults to logged-in full name), FOB dropdown (Origin / Destination / type-and-save), payment terms dropdown (customer-specific when saved), lead time, notes
- Printed quote includes a **3.5% credit-card fee** notice
- **Save quote** / **Print quote** / **Packing list** / **Invoice…** / Duplicate / Void (no hard delete)
- Packing list (`PL-YYYY-###`): items + qty only. No prices, CC note, lead time, or payment terms. Packed-by / received-by lines.
- Invoice (`INV-YYYY-###`): adds PO, ship-to, due date (from quote valid-until), optional 3.5% CC fee, shipping, duty, tariffs. Same visual family as the quote.
- Customer free-text + optional “Also save this customer (and payment terms)”
- Document numbers via `document_counters` (fallback: max existing)
- Line snapshots: part_number, name, qty, unit_price (+ optional inventory_id)
- **Does not change inventory qty**
- Tables optional: if missing, inventory still works; print still works; save of extra fields / packing / invoices prompts for Phase 2 SQL

### Labels (QR deep-links)
- QR codes (library: `qrcode` CDN), **not** Code 128
- QR payload = full app URL + `?part=` **stable label ID** (`inventory.barcode`, e.g. `IM…`) — **does not change** when name or part # is edited
- Fallback key is `part_number` only if barcode column/value missing
- Phone **Camera** opens the URL → app deep-links to Scan UI for that part (**Commit** still required)
- In-app scanner: if decoded text is a URL with `part`/`pn`, extract key; else treat as plain ID/part #
- Lookup matches `barcode` **or** `part_number` (case-insensitive)
- Layout DK-1201: horizontal — QR left (~0.85″), name small + **large part #** right
- Print via **popup** (Brother one-per-page; letter paper 8-up with larger QR)
- Deep link on load: read `?part=` / `?pn=`, open Scan found card, `history.replaceState` cleans URL

### Reports (tab order)
1. **Inventory Valuation**
2. **Inventory Adjustment Report** (directly under valuation) — user/date/action filters → Generate, CSV, Print  
   - Requires `inventory_adjustments` table
3. **Items Needing Attention** — All | Out of Stock | Needs Delivery Date | Low Stock | Open Orders
4. About these numbers

### More
- Export/Import JSON (import generates barcode if column exists)
- **Global sell factors** (Wynn GBP → $, FFS EUR → $) + apply-all
- Schema status line (includes quotes + docs/factors)
- Full setup SQL (inventory extras + Phase 1 + Phase 2) + clear all inventory

---

## Data / spreadsheets (local)

| Path | Role |
|------|------|
| `Consolidated Parts Inventory.xlsx` | Master clean list (also under `inmarinventory/`) |
| `consolidated-import.json` | Import payload (~609 parts) |
| `inmarinventory/` | Original supplier sheets (read-only) |

Conventions: empty category → **Unclassified**; missing PN → `{SOURCE}-PLACEHOLDER-NNN`.

---

## Import conventions

```json
[
  {
    "part_number": "54540248",
    "name": "Gas struts for column - 530 chair",
    "source": "Alu Design",
    "category": "Spring/Strut",
    "notes": "optional",
    "qty": 0
  }
]
```

- Optional `barcode` in JSON; otherwise app generates on insert
- Existing part numbers skipped
- User must be selected before import

---

## Quote / company details

- Company: In-Mar Systems & Solutions  
- Address: 3011 S. Ruby Ave, Gonzales, LA 70737  
- Phone: (225) 430-9111 · Email: info@inmarsystems.com  
- Prepared By: defaults to the **logged-in user** (full name) when the quote is generated

---

## Design preferences

- Light theme; source + category chips; easy delete
- Scan: lookup → review → commit (no silent stock change)
- Employee name required each session for future audit reports
- Labels must scan on QL-710W; prefer short stable barcodes over long part #s
- Prefer not reprinting labels when only name/PN text changes
- Shelf tags: letter paper, 8/sheet, laminate as needed

---

## Possible next work

- User must run **More-tab / `schema/quotes_phase2.sql`** so packing lists, invoices, and global factors persist
- Enter FFS EUR → $ factor when known, then Apply on More
- Sales orders from accepted quotes
- Email / multi-page terms
- Real auth / tighter RLS
- `config.js` + gitignore for secrets
- Optional helper scripts: export-from-supabase, sheet-to-json, db-vs-sheet diff

---

## File map

| File | Role |
|------|------|
| `index.html` | Entire app |
| `inmar-logo.jpg` | Quote logo |
| `README.md` | Setup docs |
| `CONTEXT.md` | This file |
| `Consolidated Parts Inventory.xlsx` | Clean parts workbook |
| `consolidated-import.json` | Bulk import |
| `count.html` | Mobile physical-count capture (no Supabase writes) |
| `count-seed.json` | Known-parts lookup for the count tool |
| `COUNT.md` | How to count on phone and import JSON |
| `schema/quotes_phase1.sql` | Additive quotes + customers |
| `schema/quotes_phase2.sql` | Quote extras, packing lists, invoices, settings |

---

*Last updated: 2026-08-17 — global Wynn/FFS sell factors, Wynn buy auto-fill, $5 sell rounding, quote extras, packing lists, invoices.*
