# Parts Inventory App — Project Context

**For Grok Build / future sessions.** Read this file + `README.md` + `index.html` before making changes.

**Local project folder:** `/Users/kylegrantham/Inmar Parts Inventory`  
(Git repo for GitHub Pages is this folder’s own `.git` → `KG3924/parts-inventory`. Do not confuse with a git root higher in the home directory.)

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
3. Part numbers must **not** contain spaces. Use the real alphanumeric part numbers (Code 128 barcodes).
4. Placeholders for missing part numbers: include `PLACEHOLDER` in the part number so they are searchable (e.g. `WYNN-PLACEHOLDER-008`, `IN-MAR-PLACEHOLDER-003`, `UNK-PLACEHOLDER-001` when source is blank). Notes should say the PN was auto-generated and needs a real number later.
5. After meaningful feature changes, update `README.md` / this file and **push** `index.html` (+ docs/logo as needed) to `KG3924/parts-inventory` `main` for GitHub Pages.
6. **Do not alter** original supplier spreadsheets under `inmarinventory/`. Work in `Consolidated Parts Inventory.xlsx` or new JSON only.
7. **User required before mutations:** qty +/−, save, delete, scan commit, save notes, import, clear-all. Stamps `updated_by`.

---

## Tech stack

| Piece | Detail |
|-------|--------|
| UI | Single `index.html`, light theme (white background) |
| Backend | Supabase JS client v2, table `inventory`, realtime enabled |
| Barcodes | JsBarcode, format **CODE128**, encodes the real `part_number` |
| Camera scan | html5-qrcode — stops on successful lookup; commit is separate |
| Hosting | GitHub Pages from `main` |
| Auth | None (trusted internal users). Anon key + open RLS policy for now |
| Users (dropdown) | Toby, Glynn, Ricky, Grant, Kyle — `localStorage` key `inv_user` + `updated_by` |

---

## Supabase `inventory` table (current columns)

```
id (uuid, pk)
name (text, not null)
part_number (text, unique, not null)   -- no spaces; unique constraint
qty (integer, default 0)
reorder_level (integer, default 5)
buy_price (numeric)
sell_price (numeric)
source (text)                          -- Alu Design, FFS, Wynn, In-Mar, etc.
category (text)                        -- Valve, Blade, Unclassified, etc.
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

**If `category` is missing**, run once in Supabase SQL Editor (also on More tab in the app):

```sql
alter table inventory add column if not exists category text;
create index if not exists inventory_category_idx on inventory (category);
create index if not exists inventory_source_idx on inventory (source);
```

App probes for the column on load (`hasCategoryColumn`) and skips writing `category` if absent (with a schema status message on More).

---

## Features already built

### Home
- Live list from Supabase
- Search (name, part #, source, category, location, notes)
- **Source** + **Category** filter chips (All + dynamic from data)
- Source (blue) / category (teal) badges on each row
- Quick + / − qty (**requires user selected**)
- Cost value column
- Open Order + “Needs Delivery Date” badges
- **Quote** / **Edit** / **Del** (mutations require user)

### Scan
- Phone camera or type/paste part number
- Camera **stops on find** so user can review
- Found card shows: name, part #, source/category badges, location, qty
- **Notes** textarea — view/edit; **Save notes** alone, or notes included with **Commit change**
- **Edit part** → full Add/Edit form (identifiers, category, prices, open order, etc.)
- Qty action: stock out / stock in / set exact → **Commit change** (requires user)
- After commit: confirmation + Edit part still available
- Unknown code: **Add this part** (pre-fills part # on Add form)

### Add / Edit
- Same form for create and edit (`edit-id` hidden field)
- Fields: name, part #, qty, reorder, buy/sell, source, category (datalists), location, notes, open order
- Save requires user; part numbers strip spaces on save

### Quote tab
- Cart in `localStorage` (`inv_quote`)
- Editable qty + unit price (defaults to sell_price)
- Generate branded printable quote (logo + company address)

### Labels tab
- Brother **DK-1201** (1.1″ × 3.5″); one label per page; Code 128 of real part number

### Reports
- Inventory at Cost / Sell / Margin; items needing attention

### More
- Export / Import JSON (skips existing part numbers; supports `category`; requires user)
- Connection + schema status
- SQL to add `category`
- **Clear all inventory** (type `DELETE ALL`; requires user)

---

## Data / spreadsheets (local)

| Path | Role |
|------|------|
| `Consolidated Parts Inventory.xlsx` | Master clean list — **do not treat as app runtime data** |
| `consolidated-import.json` | Ready-to-import JSON (also `JSON/consolidated-import.json`) |
| `inmarinventory/` | Original supplier sheets (**read-only**) |
| `inmarinventory/Uploaded/` | Alu, FFS, Wynn V-Belt sources (already merged into consolidated) |
| `JSON/` | Older partial imports (alu/ffs/vbelt) + new consolidated import |

### Consolidated spreadsheet conventions
- Columns: Part #, Item Name, Source, Category, Notes, Source File, Review Flag, Clean Action
- Sheets: **Data Quality Review**, **Summary & Legend**, **Consolidated Inventory**
- Empty category → **`Unclassified`**
- Missing part # → `{SOURCE}-PLACEHOLDER-NNN` (e.g. `WYNN-PLACEHOLDER-008`); blank source → `UNK-PLACEHOLDER-NNN`
- Duplicate part numbers across source rows were disambiguated for import (`3000006-2`, `1279-486-2`, …) with notes explaining original PN
- Highlight legend: red missing (should be none after placeholder pass), orange incomplete PN, green/pink/blue cleaned, etc.
- **~609 unique parts** in the consolidated set (as of Aug 2026 cleanup)

### Sources used in consolidated data
`Alu Design`, `FFS`, `In-Mar`, `Skum`, `Triplex`, `Versa`, `Wynn`, `Amazon`, `Uline`, plus a few packaging rows with blank source.

### Categories (examples)
Valve, Blade, Arm, Control Unit, O-Ring, V-Belt, Packaging, Complete System, Cylinder Seal Kit, Filter, Fitting/Hose, Hardware, Motor, Unclassified, …

### DB status (Aug 2026)
- Prior test/import rows were **cleared** for a fresh import with categories.
- Re-import via More → Import JSON using `consolidated-import.json` after `category` column exists and a user is selected.

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

- Ready file: `consolidated-import.json` (609 items, unique part numbers, qty 0)
- Existing part numbers are **skipped** on import (safe re-run)
- Search **placeholder** in the app to find rows still needing real PNs
- User must be selected before import (`updated_by` stamped)

---

## Quote / company details

- Company: In-Mar Systems & Solutions  
- Address: 3011 S. Ruby Ave, Gonzales, LA 70737  
- Phone: (225) 430-9111  
- Email: info@inmarsystems.com  
- Default “Prepared By”: Glynn Grantham  

---

## Design preferences (from owner)

- Light theme (not dark)
- Uncluttered Home — **source + category** chips over a long raw list
- Easy delete for obsolete parts
- Labels must fit **DK-1201** and stay readable
- Quote professional/printable (logo + clean layout)
- Keep the app easy; no heavy frameworks
- Scan flow: look up → review notes/details → commit qty (don’t auto-change stock on scan alone)
- Employee name required so future reports can show who changed what

---

## Git / deploy notes

- Push from local project folder:  
  `git -C "/Users/kylegrantham/Inmar Parts Inventory" push origin main`
- Pages serves `index.html` + `inmar-logo.jpg` from repo root on `main`
- Spreadsheets and bulk JSON can stay local; only app files need to be on GitHub for the live site (JSON can be uploaded via More in the browser)

---

## Possible next work

- Run Supabase `category` SQL if not done; import `consolidated-import.json`
- Inventory adjustment **history** table (who / when / old qty / new qty / action)
- Stronger quotes (multi-page, terms, saved history)
- Real auth / tighter RLS
- `config.js` + `.gitignore` so secrets never sit in `index.html`
- Replace PLACEHOLDER part numbers with real manufacturer numbers over time

---

## File map

| File | Role |
|------|------|
| `index.html` | Entire app |
| `inmar-logo.jpg` | Quote header logo |
| `README.md` | Setup + user docs |
| `CONTEXT.md` | This file — agent continuity |
| `Consolidated Parts Inventory.xlsx` | Master cleaned parts list |
| `consolidated-import.json` | App import payload |
| `JSON/` | Import JSON copies + older partials |
| `inmarinventory/` | Original supplier spreadsheets (do not modify) |

---

*Last updated: 2026-08-02 — scan notes + Edit part; required user; categories; clear-all; consolidated spreadsheet + import JSON (~609 parts); DB wiped for clean re-import.*
