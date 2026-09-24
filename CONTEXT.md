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

1. **Never put a service-role or `sb_secret_` key in the repo.** The public anon key lives only in `public-config.js`. Do not paste the database password into HTML.
2. Prefer editing the existing file in place over rewriting the whole app.
3. Part numbers must **not** contain spaces. Display part # as human text; **labels encode stable `barcode`**, not part #.
4. Placeholders for missing part numbers: include `PLACEHOLDER` in the part number (e.g. `WYNN-PLACEHOLDER-008`).
5. After meaningful feature changes, update this file + `README.md`. **Push only when the user asks.**
6. **Do not alter** original supplier spreadsheets under `inmarinventory/`.
7. **Sign-in is the only identity.** There is no header name dropdown. `currentUser()` / quote Prepared By / adjustment `changed_by` are the signed-in person’s full name. Do not restore `localStorage.inv_user`. A shift lasts 12 hours on that phone only.
8. **Keep on-screen hints to one short line.** Explain the field; do not fill the screen with tooltips. Printed quote / packing list / invoice legal lines stay short too.
9. **Do not show the stable label ID (barcode)** on Home, Scan, or Add/Edit. It is internal to QR labels only.

---

## Tech stack

| Piece | Detail |
|-------|--------|
| UI | Single `index.html`, light theme |
| Backend | Supabase JS v2: `inventory` (+ `qty_used`), `inventory_adjustments`, quotes/packing/invoices, `app_settings` / `app_lookups`, `inventory_price_history`, `inventory_cost_layers` |
| Labels | QR (`qrcode` CDN) deep-link `?part=` stable `barcode` ID; human part # printed beside QR |
| Camera scan | html5-qrcode; QR URL or plain ID; lookup **barcode or part_number**; commit separate; deep-link `?part=` |
| Hosting | GitHub Pages from `main` |
| Auth | Email + password for five accounts. Browser saved-password / Face ID fills the next unlock. Public signup off. Anon key stays in `public-config.js`. Service key never in the repo. |
| Users | Glynn Grantham, Kyle Grantham, Toby Whitfield, Grant Adams, Ricky Whitfield — each has their own login |

---

## Supabase schema

### `inventory`

```
id (uuid, pk)
name (text, not null)
part_number (text, unique, not null)   -- human / catalog PN; may change
barcode (text, unique)                 -- STABLE label code; never change on edit
qty                  -- NEW stock (valued)
qty_used             -- used/salvage on the SAME SKU; $0 for valuation
reorder_level        -- default 0; Low only if > 0 and new qty ≤ reorder
buy_price, sell_price
list_price, list_currency, sell_factor
exclude_from_valuation  -- whole SKU (consignment). Used qty is already excluded.
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
- `schema/inventory_costing.sql` — qty_used, price history, LIFO/FIFO cost layers

App probes on load: `hasCategoryColumn`, `hasBarcodeColumn`, `hasAdjustmentsTable`, `hasQuotesTables`, `hasPhase2Tables`, `hasListPriceColumn`, `hasQtyUsedColumn`, `hasPriceHistoryTable`, `hasCostLayersTable`.  
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

### Phase 3 (additive — run after Phase 2; **already applied** on production)

```
inventory.qty_used
inventory_price_history   -- buy/sell/list snapshots
inventory_cost_layers     -- FIFO/LIFO layers for NEW stock
```

`app_settings` keys: `wynn_sell_factor`, `ffs_sell_factor`, `fx_gbp_usd`, `fx_eur_usd`, `fx_nok_usd`, `costing_method` (`fifo` | `lifo`).

Status enum (app): draft | sent | accepted | expired | void.  
**Main branch safety:** only CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — does not drop inventory. Old Pages builds ignore new tables.

---

## Features (current)

### Sign-in
- Unsigned visitors see a login wall. The app does not load inventory, quotes, packing lists, or invoices until unlock.
- Accounts (no public signup): `glynn.grantham@inmarsystems.com`, `kyle.grantham@inmarsystems.com`, `toby.whitfield@inmarsystems.com`, `grant.adams@inmarsystems.com`, `ricky.whitfield@inmarsystems.com` — full names on `profiles` after the lock SQL.
- First open on a phone: pick the name, type the password, let the phone **save the password**. Next open, Face ID / Touch ID / fingerprint fills it. That is the biometric unlock. There is no in-app fake Face ID button.
- Session lasts **12 hours** on that phone (`inmar_shift_expires_at`). Five phones can be signed in as five people at once.
- **Sign out** is in the header. `count.html` uses the same gate and still does not write Supabase.
- Passkeys were not turned on: Supabase passkeys are experimental and the relying-party id is one domain. Preview and live Pages are different addresses, so a passkey enrolled on preview would not be the live one anyway.

### Database lock (not applied yet)
- `schema/auth_lock_after_merge.sql` drops the open policies and allows only `authenticated`.
- **Do not run it until this login app is on `main`.** The live site is still the old page until merge.

### Home
- Search includes barcode
- Source + Category filter chips
- Source/category badges (label ID is not shown)
- **Clickable tiles:** Open Orders, Low, Needs Delivery Date (value card), Parts (clears filter)
- Home filter bar with Clear filter
- +/− qty logs adjustments on **new** stock only; Quote / Edit / Del / Adjust (Scan, New vs Used)

### Scan
- Lookup by **barcode or part number** (label ID not displayed)
- Found card: New vs Used, action, qty; **Quote**, **Edit part**, Commit / Save notes / Scan again
- Commit logs stock_in / stock_out / set_qty against the chosen condition

### Add / Edit
- Same form; **barcode never shown** on the form (still generated on create for QR labels)
- Source, category, location: **dropdown + typeahead**. Matching existing values snap to the stored spelling; new values can still be kept
- Qty (new) and Qty (used) on the same SKU
- Reorder default **0**. Edit must load the saved value (`0` is valid — never treat as missing)
- Create / update / qty change on form → adjustment log + cost layers + price history

### Pricing
- List currency follows source: **Wynn = £ GBP**, **FFS = € EUR**, **Alu Design = kr NOK**, else **$ USD**
- **Sell $** = list × sell factor, then **rounded up to the next $5**
- **Buy $** = list × **exchange rate** (not sell factor) × 0.70 (minus 30%). Auto-fills for Wynn / FFS / Alu when a rate exists
- **More → Global sell factors:** Wynn and FFS; Apply updates sell $ only
- **More → Exchange rates:** GBP, EUR, NOK → USD (USD per 1 foreign unit). **Fetch current rates** calls `api.frankfurter.dev` (not `.app` — that host 301s without CORS, which looks like a GitHub Pages failure but is not). Fallback: `open.er-api.com`. Manual entry always works. Apply buy $ to Wynn / FFS / Alu

### New vs used (same part #)
- `qty` = new (counts in inventory $). `qty_used` = salvage from paid-off systems ($0)
- Do **not** create a second SKU. Scan **Adjust / Commit** asks New vs Used
- Tax/accounting: original system cost already paid; recovered parts are not added to inventory asset value
- Whole-SKU **Exclude from valuation** remains for consignment

### Cost layers / LIFO / FIFO
- Tables `inventory_price_history`, `inventory_cost_layers`
- Stock in (new) adds a layer at current buy $; stock out consumes layers FIFO or LIFO (More toggle)
- Used movements are tracked at $0 and never enter valued layers
- Reports: **Price history**, **Ending inventory (LIFO/FIFO)**

### Quote (Phase 2 — quote / packing list / invoice)
- Working **cart** still in `localStorage` (`inv_quote`) until Save
- **Saved Quotes** list from Supabase (status filter chips)
- Builder fields: number, status, date, **valid until (default +90 days)**, **Customer** and **Project** (separate), **RFQ #**, **Prepared By** (defaults to logged-in full name), FOB dropdown (Origin / Destination / type-and-save), payment terms dropdown (customer-specific when saved), lead time, notes
- Printed quote includes a **3.5% credit-card fee** notice
- **Save quote** / **Print quote** / **Packing list** / **Invoice…** / Duplicate / Void (no hard delete)
- Packing list (`PL-YYYY-###`): items + qty only. No prices, CC note, lead time, or payment terms. Packed-by / received-by lines.
- Invoice (`INV-YYYY-###`): adds PO, ship-to, due date (from quote valid-until), optional 3.5% CC fee, shipping, duty, tariffs. Same visual family as the quote.
- Customer free-text + optional “Also save this customer” (stores name + payment terms)
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
1. **Inventory Valuation** (new qty × buy; used excluded)
2. **Inventory Adjustment Report**
3. **Price history**
4. **Ending inventory (LIFO / FIFO)**
5. **Items Needing Attention** — Low only if reorder > 0
6. About these numbers

### More
- Export/Import JSON (import generates barcode if column exists)
- **Global sell factors** (Wynn / FFS) + apply sell $
- **Exchange rates** GBP / EUR / NOK + fetch + apply buy $
- **Costing method** FIFO or LIFO
- Schema status line (quotes, docs/factors, used-qty, price-history, cost-layers)
- Full setup SQL (inventory extras + Phase 1 + Phase 2 + Phase 3) + clear all inventory

---

## Data / spreadsheets (local)

Workbooks live **on this Mac only** (not in git). Full list is in the local-only file map below.

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
- Optional `qty_used`, `list_price`, `list_currency`, `sell_factor`, `exclude_from_valuation`
- Existing part numbers skipped
- User must be selected before import
- Reorder default on import is **0** if omitted

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
- Labels must scan on QL-710W + **DK-1201** (1.1″ × 3.5″). **DK-11240 does not fit** the QL-710W
- Prefer not reprinting labels when only name/PN text changes
- Shelf tags: letter paper, 8/sheet, laminate as needed
- Hints/tooltips: one short line; useful, not wordy

---

## Where data lives (sessions disappearing does not wipe this)

Grok chat sessions are **not** the source of truth. Recover from GitHub + this file + Supabase.

| What | Where it actually lives |
|------|-------------------------|
| App source, docs, count tool, SQL | GitHub `KG3924/parts-inventory` `main` (Pages). Head includes `51f4b97` (used/FX/LIFO), `37e1e52` (FX fetch via frankfurter.dev) |
| Live inventory, quotes, packing lists, invoices, settings, cost layers | **Supabase** (realtime). Phase 1–3 SQL has been run on production |
| Working quote **cart** (unsaved) | Browser `localStorage` key `inv_quote` — device/browser only until Save quote |
| Sell factors / FX / costing method | `localStorage` + `app_settings` in Supabase |
| Physical count **draft** | That phone/browser only (`count.html` localStorage). **Export JSON** is the backup. Safari ≠ Chrome |
| Original supplier sheets, 2026 catalogs, helper xlsx/json | **This Mac only** (not in git — see local file map). Do not rely on GitHub for those |

Default Wynn sell factor: **2.585**. FFS factor: enter when known.

---

## Login cutover (do not skip the order)

1. QA on the phone preview `https://kg3924.github.io/parts-inventory-preview/` — login wall, saved-password unlock, scan → new/used → Commit → label still scans. **Pass before merge.**
2. Merge to `main`. Live Pages becomes the login app. The old open database rules are still in place during this step, so do not treat preview as a test of the lock.
3. Run `schema/auth_lock_after_merge.sql` in Supabase. Confirm dashboard signup is off.
4. On each phone, open the **live** URL and save the login again. Preview and live are different addresses.
5. Smoke the live URL: unlock → scan → new or used → Commit → printed label still scans.

## Possible next work

- Enter FFS sell factor when known; fetch or type FX rates, then Apply buy $
- Review existing Alu rows: list should be **NOK**, not USD, before applying NOK rates
- Sales orders from accepted quotes
- Email / multi-page terms
- Real auth / tighter RLS
- `config.js` + gitignore for secrets
- Optional helper scripts: export-from-supabase, sheet-to-json, db-vs-sheet diff

---

## File map (on GitHub / Pages)

| File | Role |
|------|------|
| `index.html` | Entire app |
| `public-config.js` | Public Supabase URL + anon key only |
| `shop-auth.js` | Shared login wall for the app and count tool |
| `schema/auth_lock_after_merge.sql` | Run only after the login app is on main |
| `inmar-logo.jpg` | Quote / packing list / invoice logo |
| `README.md` | Setup docs |
| `CONTEXT.md` | This file — read first in a new session |
| `count.html` | Mobile physical-count capture (no Supabase writes) |
| `count-seed.json` | Known-parts lookup for the count tool |
| `COUNT.md` | How to count on phone and import JSON |
| `schema/quotes_phase1.sql` | Additive quotes + customers |
| `schema/quotes_phase2.sql` | Quote extras, packing lists, invoices, settings |
| `schema/inventory_costing.sql` | Used qty, price history, cost layers |

## Local-only (this Mac, not in git)

Do **not** add these unless the user asks. Do **not** alter `inmarinventory/`.

| Path | Role |
|------|------|
| `inmarinventory/` | Original supplier sheets (read-only) |
| `Consolidated Parts Inventory.xlsx` | Master clean list |
| `consolidated-import.json` | Bulk import payload (~609 parts) |
| `2026 Price List-i2.xlsx` | Hepworth 2026 price list |
| `Inventory Price Match 2026.xlsx` | Price-match workbook (GBP→USD; does not overwrite live inventory) |
| `Wynn Master Catalog 2026.xlsx` | 2026 catalog (internal vs manufacturer PN) |
| `build_wynn_master.py` | Catalog builder |
| `JSON/` | Older import JSON splits |
| `OLD Working files/` | Archived HTML |

---

*Last updated: 2026-09-21 — sign-in wall (not merged). Database lock SQL is written and must wait until main has the login app.*
