# Parts Inventory App — Project Context

**For Grok Build / future sessions.** Read this file + `README.md` + `index.html` before making changes.

---

## What this is

Internal inventory + parts tracker for **In-Mar Systems / In-Mar Solutions** (Gonzales, LA).

- Live app: https://kg3924.github.io/parts-inventory/
- GitHub: https://github.com/KG3924/parts-inventory (public, GitHub Pages from `main`)
- Data backend: **Supabase** (Postgres + realtime)
- Frontend: single-file `index.html` (vanilla JS, no build step)
- Logo for quotes: `inmar-logo.jpg`

---

## Critical rules for agents

1. **Never overwrite or reset** `SUPABASE_URL` or `SUPABASE_ANON_KEY` in `index.html`. Keep whatever values are already in the file.
2. Prefer editing the existing file in place over rewriting the whole app.
3. Part numbers must **not** contain spaces. Use the real alphanumeric part numbers (Code 128 barcodes). Do **not** invent new SKUs unless the user asks for a placeholder.
4. Placeholders for missing part numbers: use names/numbers containing `PLACEHOLDER` so they are searchable (e.g. `ALU-PLACEHOLDER-001`, name starts with `PLACEHOLDER –`).
5. After meaningful feature changes, update `README.md` and push to `KG3924/parts-inventory`.

---

## Tech stack

| Piece | Detail |
|-------|--------|
| UI | Single `index.html`, light theme (white background) |
| Backend | Supabase JS client v2, table `inventory`, realtime enabled |
| Barcodes | JsBarcode, format **CODE128**, encodes the real `part_number` |
| Camera scan | html5-qrcode |
| Hosting | GitHub Pages |
| Auth | None (trusted internal users). Anon key + open RLS policy for now |
| Users (dropdown) | Toby, Glynn, Ricky, Grant, Kyle — stamped via `updated_by` / localStorage |

---

## Supabase `inventory` table (current columns)

```
id (uuid, pk)
name (text, not null)
part_number (text, unique, not null)   -- no spaces
qty (integer, default 0)
reorder_level (integer, default 5)
buy_price (numeric)
sell_price (numeric)
source (text)                          -- e.g. Alu Design, FFS, Wynn
category (text)                        -- e.g. Valve, Blade, O-Ring (ADD if missing)
location (text)
notes (text)
open_order (boolean)
date_ordered (date)
estimated_delivery (date)
ordered_qty (integer)
updated_by (text)                      -- required in app UI before mutations
created_at, updated_at (timestamptz)
```

Realtime publication is enabled on this table.

If `category` is missing, run once in Supabase SQL Editor:

```sql
alter table inventory add column if not exists category text;
create index if not exists inventory_category_idx on inventory (category);
create index if not exists inventory_source_idx on inventory (source);
```

---

## Features already built

### Home
- Live list from Supabase
- Search (name, part #, source, category, location, notes)
- **Source** + **Category** filter chips (All + dynamic from data)
- Source/category badges on each row
- Quick + / − qty (**requires user selected**)
- Cost value column
- Open Order + “Needs Delivery Date” badges
- **Quote** button (adds to quote cart)
- **Edit** / **Del** (delete confirms first; requires user)

### Scan
- Phone camera barcode scan or manual part number entry
- Lookup only until **Commit change** (requires user)
- Source/category badges on found item

### Add / Edit
- Full form: name, part #, qty, reorder level, source, **category**, location, notes
- Buy price, sell price
- Open Order checkbox → shows order date, estimated delivery, qty ordered
- Missing delivery date is flagged on Home/Reports
- Save requires user name selected

### Quote tab
- Cart stored in `localStorage` (`inv_quote`)
- Editable qty + unit price (defaults to sell_price when present)
- Customer/project, quote #, dates, prepared by, notes
- **Generate Quote** opens a print window with In-Mar logo + company address
- Logo file: `inmar-logo.jpg` (must sit next to `index.html` on Pages)

### Labels tab
- Multi-select + search, Select All / Clear
- Batch generate → Print
- **Target printer media: Brother DK-1201**
  - Size: **1.1 in high × 3.5 in wide** (29 mm × 90.3 mm)
  - Each label = its own printed page so the QL advances one-by-one
  - Content: truncated name, Code 128 barcode, part number (large)
- Print dialog: choose DK-1201, scale 100%, no headers/footers

### Reports
- Inventory at Cost = Σ (qty × buy_price)
- At Sell Price = Σ (qty × sell_price)
- Potential margin
- List of items needing attention (low/out, needs delivery date)

### More
- Export JSON / Import JSON (skips existing part numbers; supports `category`; requires user)
- Connection + schema status (detects `category` column)
- SQL snippet to add `category` column
- **Clear all inventory** (danger zone; type `DELETE ALL`; requires user)

---

## Data / spreadsheets

- Master clean workbook: `Consolidated Parts Inventory.xlsx` (Part #, Name, Source, Category, Notes, Source File + data-quality review)
- Source sheets under `inmarinventory/` (do not alter originals)
- Prior test data was cleared Aug 2026 for a clean re-import with categories

Prefer JSON import via More tab; agent can generate import JSON from the consolidated spreadsheet.

---

## Import conventions

```json
[
  {
    "part_number": "54540248",
    "name": "Gas struts for column - 530 chair",
    "source": "Alu Design",
    "category": "Spring/Strut",
    "qty": 0,
    "notes": "optional"
  }
]
```

- Qty usually starts at 0 (physical count later via scan)
- Source filled from spreadsheet origin
- Category from consolidated sheet (Valve, Blade, etc.)
- Notes used for extra text that is not the main name
- User must be selected in the app before import / qty changes (stamps `updated_by`)

---

## Quote / company details (for generated quotes)

- Company: In-Mar Systems & Solutions
- Address: 3011 S. Ruby Ave, Gonzales, LA 70737
- Phone: (225) 430-9111
- Email: info@inmarsystems.com
- Default “Prepared By”: Glynn Grantham

---

## Design preferences (from owner)

- Light theme (not dark)
- Uncluttered Home — source filters over a long raw list
- Easy delete for obsolete parts from old spreadsheets
- Labels must fit **DK-1201** and stay readable
- Quote should look professional and printable (logo + clean layout)
- Keep the app easy; avoid heavy frameworks

---

## Possible next work (not yet built)

- Inventory adjustment report (who / when / qty delta) via `updated_by` + history table
- Stronger quote features (multi-page, terms, save quote history in Supabase)
- Real user auth / tighter RLS
- `config.js` for keys + `.gitignore` so secrets never sit in `index.html`
- Import JSON generated from consolidated spreadsheet

---

## File map

| File | Role |
|------|------|
| `index.html` | Entire app |
| `inmar-logo.jpg` | Quote header logo |
| `README.md` | Setup + user docs |
| `CONTEXT.md` | This file — agent continuity |
| `Consolidated Parts Inventory.xlsx` | Master clean parts list for import |
| `inmarinventory/` | Original supplier spreadsheets |

---

*Last updated: 2026-08-01 — category filters, required user, clear-all inventory, consolidated spreadsheet workflow.*
