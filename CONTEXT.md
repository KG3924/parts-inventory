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
| Backend | Supabase JS v2: `inventory`, `inventory_adjustments`, Phase 1 `customers` / `quotes` / `quote_lines` / `document_counters` |
| Labels | QR (`qrcode` CDN) deep-link `?part=` stable `barcode` ID; human part # printed beside QR |
| Camera scan | html5-qrcode; QR URL or plain ID; lookup **barcode or part_number**; commit separate; deep-link `?part=` |
| Hosting | GitHub Pages from `main` |
| Auth | None; open RLS for trusted internal use |
| Users | Toby, Glynn, Ricky, Grant, Kyle — must select each session |

---

## Supabase schema

### `inventory`

```
id (uuid, pk)
name (text, not null)
part_number (text, unique, not null)   -- human / catalog PN; may change
barcode (text, unique)                 -- STABLE label code; never change on edit
qty, reorder_level, buy_price, sell_price
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

**One-time SQL** is on the **More** tab in the app (Copy SQL). Also `schema/quotes_phase1.sql` for quotes.

App probes on load: `hasCategoryColumn`, `hasBarcodeColumn`, `hasAdjustmentsTable`, `hasQuotesTables`.  
If `barcode` exists, missing values are **backfilled** on load (`ensureBarcodes`).

### Phase 1 sales docs (additive — safe alongside inventory)

```
customers (name, company, email, phone, notes)
quotes (number Q-YYYY-###, customer_id?, customer_name, status, dates, prepared_by, notes, created_by)
quote_lines (quote_id, line_no, inventory_id?, part_number, name, qty, unit_price)
document_counters (doc_type, year, last_value)
```

Status enum (app): draft | sent | accepted | expired | void.  
**Main branch safety:** only CREATE TABLE IF NOT EXISTS — does not drop/alter inventory. Old Pages builds ignore new tables.

---

## Features (current)

### User selection
- Header dropdown always defaults to **— Select —** on open
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

### Quote (Phase 1 — saved quotes)
- Working **cart** still in `localStorage` (`inv_quote`) until Save
- **Saved Quotes** list from Supabase (status filter chips)
- Builder: number, status (draft/sent/accepted/expired/void), dates, customer free-text, prepared by, notes, lines
- **Save quote** / Print / Duplicate / Void (no hard delete)
- Customer free-text + optional “Also save to Customers”
- Document numbers: `Q-YYYY-###` via `document_counters` (fallback: max existing)
- Line snapshots: part_number, name, qty, unit_price (+ optional inventory_id)
- **Does not change inventory qty**
- Tables optional: if missing, inventory app still works; quote list prompts for SQL

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
- Schema status line
- Full setup SQL + clear all inventory

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
- Prepared By: **blank by default** (user fills in)

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

- User runs More-tab SQL if barcode/adjustments not yet in Supabase
- Reprint Brother labels once after barcodes backfilled (one-time migration)
- Optional future: further Brother barcode size tuning (user asked to hold for now)
- Phase 2 sales orders from accepted quotes
- Phase 3 invoices; Phase 4 purchase orders
- Quote multi-page terms / email
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

---

*Last updated: 2026-08-09 — QR deep-link labels (?part= stable barcode ID); Camera app opens Scan with Commit.*
