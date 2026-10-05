# Parts Inventory App — Project Context

**For Grok Build / future sessions.** Read this file, `README.md`, and `src/quote.js` before quote work. Stock, scan, labels, reports, More, and sign-in still live in `index.html`.

**Local project folder:** `/Users/kylegrantham/Inmar Parts Inventory`  
Git repo for GitHub Pages: this folder’s `.git` → `KG3924/parts-inventory` (`main`).  
Push to `main` only when the user asks. GitHub Actions builds `dist/` and publishes that. Pages is not a raw branch deploy.

---

## What this is

Internal inventory + parts tracker for **In-Mar Systems / In-Mar Solutions** (Gonzales, LA).

- Live app: https://kg3924.github.io/parts-inventory/
- GitHub: https://github.com/KG3924/parts-inventory (public). **Settings → Pages → Source** is **GitHub Actions** (`.github/workflows/pages.yml`), not “Deploy from a branch.”
- Data backend: **Supabase** (Postgres + realtime)
- Frontend: Vite. `index.html` is the shell. The Quote screen is `src/quote.js` and `src/quote-markup.js`, started from `src/main.js`. No React. There is no separate Invoice tab.
- Logo for quotes: `public/inmar-logo.jpg` (copied into the Pages build)
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
| UI | Vite. `index.html` shell + `src/quote.js`. Light theme. `npm run build` writes `dist/` |
| Backend | Supabase JS v2: `inventory` (+ `qty_used`), `inventory_adjustments`, quotes/packing/invoices, `app_settings` / `app_lookups`, `inventory_price_history`, `inventory_cost_layers` |
| Labels | QR (`qrcode` CDN) deep-link `?part=` stable `barcode` ID; human part # printed beside QR |
| Camera scan | html5-qrcode; QR URL or plain ID; lookup **barcode or part_number**; commit separate; deep-link `?part=` |
| Hosting | GitHub Actions publishes `dist/` to Pages |
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
- `schema/a1_stock_doc_referee.sql` — qty and document-number referee (already applied)
- `schema/a2_approve_invoice.sql` — Approve invoice debits stock (run only after this page is on the phones)

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
invoices.approved_at / approved_by  -- schema/a2_approve_invoice.sql (after the Approve page is on phones)
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
- Five accounts, no public signup: `glynn@inmarsystems.com`, `ricky@inmarsystems.com`, `grant@inmarsystems.com`, `toby@inmarsystems.com`, `kyle.grantham.kg@gmail.com`. Stamps and Prepared By use that signed-in full name. There is no header name dropdown.
- First open on a phone: pick the name, type the password, let the phone **save the password**. Next open, Face ID / Touch ID / fingerprint fills it. That is the biometric unlock. There is no in-app fake Face ID button.
- Session lasts **12 hours** on that phone (`inmar_shift_expires_at`). Five phones can be signed in as five people at once.
- **Sign out** is in the header. `count.html` uses the same gate and still does not write Supabase.
- **More → Passwords** lets a signed-in person set a new password for any of the five. The admin key stays on Supabase (edge function `set-staff-password`), not in the page. That person unlocks once on their phone and saves the new password.
- Passkeys were not turned on: Supabase passkeys are experimental and the relying-party id is one domain. Preview and live Pages are different addresses, so a passkey enrolled on preview would not be the live one anyway.

### Database lock (already applied on live)
- `schema/auth_lock_after_merge.sql` has been run. Unsigned (anon) cannot read or change stock. Signed-in shop accounts can.
- Do not paste “allow all” or anon policies. More → Copy SQL does not create them.

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
- **Saved Quotes** opens on **Open** (Draft / Sent / Accepted). **Archive** is Voided / Expired. Row actions: Open, Print, Dup, **Void quote**. Void quote keeps the Q- number. There is no Delete.
- Builder fields: number, status, date, **valid until (default +90 days)**, **Customer** and **Project** (separate), **RFQ #**, **Prepared By** (defaults to logged-in full name), FOB dropdown (Origin / Destination / type-and-save), payment terms dropdown (customer-specific when saved), lead time, notes
- Printed quote includes a **3.5% credit-card fee** notice
- **Save quote** / **Print quote** / **Packing list** / **Invoice…** / Duplicate / **Void quote** do **not** change stock. Void quote does not restock and does not clear `approved_at`, so a second invoice for that quote is still refused. The **Void quote** button sits outside the Invoice… buttons. The status dropdown says **Void quote** and still saves `void`. There is no draft-invoice void.
- Packing list (`PL-YYYY-###`): items + qty only. No prices, CC note, lead time, or payment terms. Packed-by / received-by lines. Doc only.
- Invoice (`INV-YYYY-###`): adds PO, ship-to, due date (from quote valid-until), optional 3.5% CC fee, shipping, duty, tariffs. **Save & print** stores a **draft** and does not change stock. **Approve** calls `shop_approve_invoice` and is the only sale.
- **Invoice…** follows the quote on screen. It is available when no quote is open, and when the open quote has no approved invoice. **New**, **Duplicate**, **Clear cart**, and opening another quote unlock it immediately. Reopening a quote that already has an approved invoice leaves it grey. The lock is not remembered separately from that quote’s invoices.
- A quote line that wants more than the live new-shelf qty shows `wants N / shelf M` before Save & print. That is a warning only. Save & print and Approve stay available. Nothing is reserved.
- **Save & print** reuses the newest open draft invoice on this quote: it refreshes that header and its lines from the cart and reprints the same INV- number. A new INV- is minted only when the quote has no open draft. An approved invoice still blocks another invoice.
- **Invoice…** on a cart that is not saved yet runs **Save quote** first. **Save & print** does the same if there is still no quote. If that save fails, the invoice box stays closed and no INV- is minted. Draft reuse still needs that quote id.
- **New quote** clears the working cart (no confirm) and starts a blank header. **Approve** success does the same to the cart after the success message, and leaves the quote open. Approve failure, Save quote, and Save & print do not clear the cart.
- If this quote has an approved invoice, **Void quote** is grey on the builder and on the list, and the note names that INV: `INV-… is approved. Voiding this quote won't undo the sale.` Void and Expired cannot be chosen or saved. A quote with only a draft, or no invoice, can still be voided. Void does not restock and does not change the invoice.
- An Approve failure (short shelf, missing shelf id, quote already sold, or anything else) shows a red message fixed at the top of the screen and scrolls that banner into view. Approve stays tappable, including when a line is short. The shelf does not change and the draft stays a draft. The banner still clears after a few seconds.
- Customer free-text + optional “Also save this customer” (stores name + payment terms)
- Document numbers come from `shop_next_doc_number` (Q- / INV- / PL-).
- Line snapshots: part_number, name, qty, unit_price (+ optional inventory_id)
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
- Sign in before import. The stamp is the signed-in person. There is no name dropdown.
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
- Audit stamps come from the signed-in person, not a name dropdown
- Labels must scan on QL-710W + **DK-1201** (1.1″ × 3.5″). **DK-11240 does not fit** the QL-710W
- Prefer not reprinting labels when only name/PN text changes
- Shelf tags: letter paper, 8/sheet, laminate as needed
- Hints/tooltips: one short line; useful, not wordy

---

## Where data lives (sessions disappearing does not wipe this)

Grok chat sessions are **not** the source of truth. Recover from GitHub + this file + Supabase.

| What | Where it actually lives |
|------|-------------------------|
| App source, docs, count tool, SQL | GitHub `KG3924/parts-inventory` `main`. Actions publishes the Vite build. `main` includes the stock referee, Approve invoice, and the quote-screen follow-up through draft reuse (PR #8). Save-before-invoice and the fixed fail banner are the open follow-up on top of that. |
| Live inventory, quotes, packing lists, invoices, settings, cost layers | **Supabase** (realtime). Phase 1–3 SQL has been run on production |
| Working quote **cart** (unsaved) | Browser `localStorage` key `inv_quote` — device/browser only until Save quote |
| Sell factors / FX / costing method | `localStorage` + `app_settings` in Supabase |
| Physical count **draft** | That phone/browser only (`count.html` localStorage). **Export JSON** is the backup. Safari ≠ Chrome |
| Original supplier sheets, 2026 catalogs, helper xlsx/json | **This Mac only** (not in git — see local file map). Do not rely on GitHub for those |

Default Wynn sell factor: **2.585**. FFS factor: enter when known.

---

## A1 stock and document numbers (live)

`schema/a1_stock_doc_referee.sql` is already applied. Commit and new Q- / INV- / PL- numbers go through `shop_commit_qty` and `shop_next_doc_number`. Floor Commit still floors a short remove at zero. Do not re-run A1 after Approve SQL unless you run `schema/a2_approve_invoice.sql` again afterward (A1 now includes the same strict-remove check, so a re-run stays safe).

## Approve invoice (run SQL only after this page is on the phones)

Stock leaves the shelf only when someone taps **Approve** on a draft invoice. The database function `shop_approve_invoice` debits every stock line or none, through the same referee as Commit. A second tap does not debit again. A short line fails the whole invoice and leaves the shelf as it was. Fee lines with no part number are not debited. A stock line missing a shelf id fails the whole Approve.

Run `schema/a2_approve_invoice.sql` **once**, and only after the Approve page is on the phones and every phone has hard-refreshed. Order: Approve build on Pages → hard-refresh → run that SQL → smoke on throwaway part numbers. Do not re-run it for later screen fixes. This file does not record whether production already has that SQL — check Supabase before running it again. Running it before the phones show **Approve** does not fix the shelf.

## Quote screen (no new SQL)

Invoice… follows the quote on screen and saves the cart first when that cart is not a saved quote yet. A short line warns `wants N / shelf M` and does not block Save & print or Approve. Save & print updates the newest open draft instead of minting another INV-. Approve failures stay on screen at the top and leave the shelf and the draft alone. The quote action is labeled **Void quote**. None of that changes `shop_approve_invoice` or `schema/a2_approve_invoice.sql`. Smoke after the page is on Pages and every phone has hard-refreshed. Do not run SQL for these screen fixes.

## Login and lock (live)

The login app is on `main`. `schema/auth_lock_after_merge.sql` is already applied. Do not leave or restore open policies. Smoke after any later merge: unlock → scan → new or used → Commit → printed label still scans.

## Possible next work

- Later: block Save & print / Approve when a line wants more than the shelf. This cut only warns `wants N / shelf M`.
- Enter FFS sell factor when known; fetch or type FX rates, then Apply buy $
- Review existing Alu rows: list should be **NOK**, not USD, before applying NOK rates
- Sales orders from accepted quotes
- Email / multi-page terms
- Optional helper scripts: export-from-supabase, sheet-to-json, db-vs-sheet diff

---

## File map (on GitHub / Pages)

| File | Role |
|------|------|
| `index.html` | App shell: stock, scan, labels, reports, More, sign-in. Empty `#quote` mount |
| `src/main.js` | Loads the quote screen |
| `src/quote.js` | Quote, packing list, and invoice behavior |
| `src/quote-markup.js` | Quote screen HTML |
| `vite.config.js` | Build. Base path `/parts-inventory/`. Output `dist/` |
| `package.json` | `npm run dev` / `npm run build` |
| `.github/workflows/pages.yml` | `npm ci`, build, secret scan, publish `dist/` |
| `scripts/refuse-shipped-secrets.sh` | Fails the Pages build if a real secret is in `dist/` |
| `public/public-config.js` | Public Supabase URL + anon key only (copied into the Pages build) |
| `public/shop-auth.js` | Shared login wall for the app and count tool |
| `schema/auth_lock_after_merge.sql` | Live lock (already applied). Do not re-open with allow-all policies |
| `public/inmar-logo.jpg` | Quote / packing list / invoice logo |
| `README.md` | Setup docs |
| `CONTEXT.md` | This file — read first in a new session |
| `public/count.html` | Mobile physical-count capture (no Supabase writes) |
| `public/count-seed.json` | Known-parts lookup for the count tool |
| `COUNT.md` | How to count on phone and import JSON |
| `schema/quotes_phase1.sql` | Additive quotes + customers |
| `schema/quotes_phase2.sql` | Quote extras, packing lists, invoices, settings |
| `schema/inventory_costing.sql` | Used qty, price history, cost layers |
| `schema/a1_stock_doc_referee.sql` | Live qty + document-number referee |
| `schema/a2_approve_invoice.sql` | Approve invoice. Run after phones hard-refresh onto this page |

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

*Last updated: 2026-10-05 — New quote and a successful Approve clear the working cart. An approved invoice blocks Void and Expired. No new SQL.*
