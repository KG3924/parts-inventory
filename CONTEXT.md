# Parts Inventory App — Project Context

**For Grok Build / future sessions.** Read this file + `README.md` + `index.html` before making changes.

**Local project folder:** `/Users/kylegrantham/Inmar Parts Inventory`  
Git repo for GitHub Pages: this folder’s `.git` → `KG3924/parts-inventory` (`main`).  
**Do not push until the user reviews** (they may request local-only changes first).

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
| Backend | Supabase JS v2, `inventory` + `inventory_adjustments` |
| Barcodes | JsBarcode **CODE128** of stable `barcode` field (short `IM…` codes) |
| Camera scan | html5-qrcode; lookup by **barcode or part_number**; commit separate |
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

**One-time SQL** is on the **More** tab in the app (Copy SQL). Run in Supabase SQL Editor if schema status shows missing pieces.

App probes on load: `hasCategoryColumn`, `hasBarcodeColumn`, `hasAdjustmentsTable`.  
If `barcode` exists, missing values are **backfilled** on load (`ensureBarcodes`).

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

### Quote
- **Prepared By** starts **blank**
- Add from Home or Scan

### Labels (QL-710W / DK-1201)
- Encode short stable **`barcode`** (`IM` + 8 chars; never changes with name/PN)
- Fallback to part_number only if no barcode
- **Thick modules** (width ~2.2–3.0) so thermal bars don’t smear together — do **not** scale SVG down after render
- Short payload keeps overall width on-label; long part # only as fallback
- Height ~42px; quiet zone margin 8; centered on DK-1201
- Human-readable **part number** under bars (truncated if long)
- Print: 100% scale, no fit-to-page

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

---

## Possible next work

- User runs More-tab SQL if barcode/adjustments not yet in Supabase
- Reprint labels once after barcodes backfilled (one-time migration)
- Stronger quotes (saved history, multi-page)
- Real auth / tighter RLS
- `config.js` + gitignore for secrets

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

*Last updated: 2026-08-02 — adjustment report under Valuation; label barcode max-width + quiet zones + shorter IM codes. Not pushed until user reviews.*
