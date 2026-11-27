# Parts Inventory App — Project Context

**For Grok Build / future sessions.** Read this file, `README.md`, and `src/quote.js` before quote work. Stock, scan, labels, reports, More, and sign-in still live in `index.html`.

**Local project folder:** `/Users/kylegrantham/Inmar Parts Inventory`  
Git repo for GitHub Pages: this folder’s `.git` → `KG3924/parts-inventory` (`main`).  
Push to `main` only when the user asks. GitHub Actions builds `dist/` and publishes that. Pages is not a raw branch deploy.

---

## What this is

Internal inventory + parts tracker for **In-Mar Systems / In-Mar Solutions** (Gonzales, LA).

- Live app: https://inventory.inmarsystems.com/
- GitHub: https://github.com/KG3924/parts-inventory (public). **Settings → Pages → Source** is **GitHub Actions** (`.github/workflows/pages.yml`), not “Deploy from a branch.”
- Data backend: **Supabase** (Postgres + realtime)
- Frontend: Vite. `index.html` is the shell. The Quote screen is `src/quote.js` and `src/quote-markup.js`, started from `src/main.js`. No React. There is no separate Invoice tab.
- Logos follow the company stored on that document. L uses `public/In-Mar-Solutions-logo-v4.png` (alt In-Mar Solutions). S uses `public/In-Mar-Systems-logo-v4.png` (alt In-Mar Systems). A blank company prints no logo. Do not substitute `inmar-logo.jpg`. The address line stays 3011 S. Ruby Ave, Gonzales, LA 70737, (225) 430-9111, info@inmarsystems.com.
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
9. **Do not show the stable label ID (barcode)** on Home, Inventory, Scan, or Add/Edit. It is internal to QR labels only.

---

## Tech stack

| Piece | Detail |
|-------|--------|
| UI | Vite. `index.html` shell + `src/quote.js`. Light theme. `npm run build` writes `dist/` |
| Backend | Supabase JS v2: `inventory` (+ `qty_used`), `inventory_adjustments`, quotes/packing/invoices, `app_settings` / `app_lookups`, `inventory_price_history`, `inventory_cost_layers` |
| Labels | QR (`qrcode` CDN) deep-link `?p=` stable `barcode` ID. `?part=` and `?pn=` are still accepted. Human part # is printed beside the QR |
| Camera scan | html5-qrcode; QR URL or plain ID; lookup **barcode or part_number**; commit separate. After sign-in a label opens Scan and the address is cleaned to `?view=scan` |
| Hosting | GitHub Actions publishes `dist/` to Pages |
| Auth | Name + password for five accounts, through the `staff-sign-in` Edge Function. Login emails stay in `public.profiles`. Browser saved-password / Face ID fills the next unlock. Public signup off. No lockout. Anon key stays in `public-config.js`. Service key never in the repo. |
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
- `schema/a2_4_void_quote_approve_lock.sql` — Approve refuses a void or missing quote (run once after the A2.4 page is on the phones)
- `schema/a2_4b_void_quote_final.sql` — a void quote stays void. Line edits are refused. Deleting the quote removes its lines (run once after the A2.4b page is on the phones)
- `schema/a2_6_freeze_approved_invoice.sql` — an approved invoice and its lines stay as sold (run once after this build is on the phones)
- `schema/r1_round1_guards.sql` — Round 1 guards. Run once after this build is on Pages and every phone has hard-refreshed. Re-run it if A1, A2, or A2.4 is re-run after it. Do not VALIDATE the new checks.
- `schema/b038_part_delete_guard.sql` — a part on an open quote can't be deleted (run once after this build is on Pages and every phone has hard-refreshed; safe to re-run)
- schema/c1_customer_list.sql — customer list: unique name, type-ahead / Did you mean, New-not-in-QB tag, merge by pointer (run once after this build is on Pages and every phone has hard-refreshed; safe to re-run)
- `schema/vd1_void_invoice.sql` — voids an approved invoice and puts its stock back once at the original cost (Kyle runs it once by hand after this build is on Pages and every phone has hard-refreshed)
- `schema/ql1_lock_quote_lines.sql` — quote lines lock (run SQL only after this page is on the phones; safe to re-run)
- `schema/sv1_save_quote.sql` — save an existing quote in one step (run SQL only after this page is on the phones; safe to re-run)

App probes on load: `hasCategoryColumn`, `hasBarcodeColumn`, `hasAdjustmentsTable`, `hasQuotesTables`, `hasPhase2Tables`, `hasListPriceColumn`, `hasQtyUsedColumn`, `hasPriceHistoryTable`, `hasCostLayersTable`.  
If `barcode` exists, missing values are **backfilled** on load (`ensureBarcodes`).

### Phase 1 sales docs (additive — safe alongside inventory)

```
customers (name, company, email, phone, contact_name, billing_address, ship_to_address, tax_exempt_number, notes, payment_terms, qb_status, merged_into)
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
- Five accounts, no public signup. Sign-in is by name through the `staff-sign-in` Edge Function; login emails live only in `public.profiles` and are never written in the repo. Stamps and Prepared By use that signed-in full name. There is no header name dropdown.
- First open on a phone: pick the name, type the password, let the phone **save the password**. Next open, Face ID / Touch ID / fingerprint fills it. That is the biometric unlock. There is no in-app fake Face ID button.
- Session lasts **12 hours** on that phone (`inmar_shift_expires_at`). Five phones can be signed in as five people at once.
- **Sign out** is in the header. Count is shelved. `count.html` only redirects to the shop home (`?view=dashboard`) and cannot read or write stock. There is no public catalog file.
- **More → Passwords** lets a signed-in person set a new password for any of the five. The admin key stays on Supabase (edge function `set-staff-password`), not in the page. That person unlocks once on their phone and saves the new password.
- Passkeys were not turned on: Supabase passkeys are experimental and the relying-party id is one domain. Preview and live Pages are different addresses, so a passkey enrolled on preview would not be the live one anyway.

SEC1 signs in by name. The `staff-sign-in` Edge Function looks the login email up on the server and returns only the session. There is no lockout of any kind; Supabase Auth's own rate limit is the only throttle. Run `schema/sec1_sign_in_lookup.sql` once before the merge (the old page keeps working), deploy `staff-sign-in` with JWT verification off, merge, hard-refresh every phone, redeploy `set-staff-password`, then run `schema/sec1_after_merge.sql` once. Do not change a password between the merge and that redeploy.

### Database lock (already applied on live)
- `schema/auth_lock_after_merge.sql` has been run. Unsigned (anon) cannot read or change stock. Signed-in shop accounts can.
- Do not paste “allow all” or anon policies. More → Copy SQL does not create them.

### Shop navigation
- Front row, left to right: **Home · Scan · Inventory · Labels**. Each target is at least 44×44px.
- The second row is **Quote · Customers · PO**, always visible. Quote is not inside More and not only a button on Inventory.
- Header **‹ Back** is hidden on the first screen. Each screen you open is one history step, and the address is `?view=` plus that screen (dashboard, inventory, scan, quote, find, data, reports, labels, customers, po, or add). An unknown `?view=` opens Inventory. A missing one opens Home. **Back** returns one step. Find stores the open document on that step, so Back inside Find returns one document at a time. Leaving an unsaved Add form, an unsaved customer, or a typed invoice-void reason asks `Leave without saving? Your changes will be lost.`
- Add to Home Screen uses `public/manifest.webmanifest`. The name is In-Mar Systems Parts. The short name is Parts. The icons are the Systems marks `icon-180.png`, `icon-192.png`, and `icon-512.png`. The Apple touch icon is `icon-180.png` and the Apple title is Parts.
- **+ Add part** is at the top of Inventory. Add is not a tab.
- **More** is a link on Home, not the front row. Schema/SQL, sell factors, exchange rates, export/import, costing, Passwords, and **Reports** are there.

### Home
- Stats row: **Parts**, **Units**, **Low**, **Open Orders**. Until the parts list loads, these tiles and the value cards show —. They then fill from that list and do not wait for settings. Parts, Low, and Open Orders open Inventory on that list. Parts opens the full list. Units is a count only. A failed parts list says `Couldn't load — try again.` The connection line says `Couldn't load — try again`. It does not stay on `Loading…`.
- **Find Quotes** and **Find Invoices** are two tiles side by side under that row and above the value cards. Each opens its own Find area, fresh every time. **Back** returns one screen, to wherever Find was opened from. They are not inside the stats grid, not on the front row, not in More, and not on the Quote row.
- Value cards: **Inventory at Cost**, **At Sell Price**, **Potential Margin**, **Needs Delivery Date**. Needs Delivery Date opens Inventory on that list. They show — until the parts list loads.
- **More** sits under the tiles

### Find & reprint
- **Find Quotes** and **Find Invoices** are separate areas. Entering either one, even the same one again, starts fresh: empty search, empty From and To, no list, and no open document. **Back** on an open document returns one document at a time (an invoice to its quote, then the list), then to the screen Find was opened from. Search text, dates, a list, or an open document in one area does not show in the other. A quote lists each invoice as a button (the number, or —, plus the status). An invoice's quote number is a button back to that quote.
- Search needs a number fragment, a customer name, or a part on the lines. Find quotes searches quotes. Find invoices searches invoices. A part match uses the part number or the name. Dashes, spaces and capitals don't matter. Cancelled quotes are included. Find Invoices includes drafts, including a draft with no number yet. Partial match is enough. An empty search with no dates does not list the book.
- `schema/bl3a_find_by_part.sql` is run once in the Supabase SQL editor after this build is on Pages and every phone has hard-refreshed. It is safe to re-run. It reads only. The merge does not run it. Until then Find adds `Search needs an update. Only numbers and customers were searched.` and still searches numbers and customers.
- **Last 7 days** and **From–To** browse that area only. Dates are shop-local America/Chicago, not UTC midnight. Last 7 is Chicago today and the six days before it, inclusive. From and To are inclusive. One filled date is that one day. Empty search plus a date window lists that window.
- A quote's date is `created_at` in Chicago, then `quote_date`, then `updated_at`. An invoice uses `invoice_date`. An approved invoice uses the Chicago date of `approved_at` when that stamp is set.
- Typed search and date browse both show about 50, newest first by that date. More than that shows the newest 50 and `Narrow the dates.` A typed search with no dates says `Narrow the search.`
- A match opens Find only until **Open**. **Open** is on a live unsold quote (Open, Sent, or Accepted, and no approved invoice). It loads that quote in the builder. **Back** returns to the Find document. It has Reprint and Dup. An approved invoice whose number starts with I- also has **Packing list**, next to Reprint. A quote, a draft invoice, and an invoice with no I- number do not. There is no Approve on Find. A quote there has no Void button. An approved invoice whose number starts with I- can be voided, and that void is the only Find action that changes stock.
- Find says `Searching…` on the list as soon as search starts, and `Opening…` on the detail as soon as a row is tapped. A newer search, or Back, wins. A slow older request does not paint over that.
- **Reprint** opens the document to look at. It does not open the print dialog. **Print quote** and **Save & print invoice** still do. **Packing list** is on an approved invoice in Find Invoices. It opens the print dialog, shows the I- number and `From quote`, takes no number, and writes nothing. The quote builder has no Packing list button. **Reprint** of a quote shows that saved quote: heading QUOTE, Quote #, Quote date, Valid Until, Quoted total, and the quote footer. It has no Status line. It does not use the open quote form. It does not say INVOICE, Invoice #, or Amount due, and it has no DRAFT stamp.
- **Reprint** of an invoice uses the same invoice builder as **Save & print**, opened to look at. It does not save a PDF and does not write a row.
- An **approved** invoice reprint shows the stored header and `invoice_lines` (the sold paper), with no DRAFT stamp. A quote that already sold reprints the quote. Open the invoice row in Find Invoices for the sold paper.
- A **draft** invoice reprint shows the stored draft. With no number yet it says `Draft — number at Approve`. `From quote` and the quote number sit under that. It shows a DRAFT stamp and does not say `Draft — current rows`.
- A **void** quote hides Reprint and shows `Q-… is cancelled. Start a new quote to bring this deal back.` A draft invoice under that void quote hides Reprint and shows `Q-… is cancelled. This invoice can't be approved.` An approved invoice under a void quote can still be reprinted as sold.
- **Dup** starts a new draft only. It uses the quote, or the invoice's parent quote. It does not void and does not approve.

### Inventory
- Search includes barcode (label ID is not shown). Inventory, Labels, Price history, Scan, the quote builder's **Add a part**, and the PO **Add a part** share Scan's punctuation-blind part match. Dashes, spaces, and capitals in a part number do not matter. Two numbers that differ only by a hyphen both stay listed. The count tool is shelved and does not search. That match needs no SQL.
- The parts list paints as soon as the parts load. It does not wait for settings. Stock buttons stay dim until settings are ready.
- A second tap on **Commit change** does nothing until that one stock change finishes. The button is disabled while it runs. **Back** to Scan redraws the found card from the current parts list. If that part is gone, the card is cleared.
- If Edit changes the qty, Save reads the live row first. When the shelf moved it says `Stock changed since you opened this part. Reopen it.` and writes nothing. If that check fails it says `Couldn't check stock. Try again.` A successful Save replaces the Add step in Back's history with Inventory.
- Filter chips and the Scan add-part buttons pass a typed part number from the button's own data. They do not put it inside the click code.
- Source + Category filter chips
- **+ Add part** at the top
- Filter bar with Clear filter when a Home tile is on
- +/− qty logs adjustments on **new** stock only; Quote / Edit / Adjust (Scan, New vs Used). Delete part is at the bottom of Edit (not on the rows), same confirm. A part on an open quote (not void, no approved invoice; draft invoices count through their quote) can't be deleted: "Not deleted. This part is on open quote Q-…. Remove it from that quote first." Clear all is refused as a whole and lists every blocking quote (schema/b038_part_delete_guard.sql).
- On a phone (640px wide or less) each part is a card: name, part # and tags on top, then Qty / Value / Status, then the buttons on their own row (at least 44px tall, wrapping instead of scrolling sideways). The five buttons (Adjust + − Quote Edit) fit on one line on an iPhone. Computer layout unchanged.

### Plain errors
Known sale sentences stay exact, including `Q-… is cancelled…`, `I-L… is approved…` (or `I-S…`, or an older `INV-…`), `Not enough on hand…`, `Only N on hand…`, `Enter how many to remove — 1 or more.`, `Enter how many to add — 1 or more.`, `This invoice has no customer…`, `Quote changed since INV-… was printed. Save & print before Approve`, `Couldn't approve — try again`, `Not deleted. This part is on open quote Q-…. Remove it from that quote first.`, and the CO1 sentences (pick In-Mar Solutions or In-Mar Systems first, add at least one line, no longer on the shelf list, can't be deleted, keeps its number, company is locked, invoice numbers only at Approve, this invoice has no company, hard refresh). Raw `P0001`, function names, and other Postgres text are not shown. An unknown save says `Couldn't save — try again`. An unknown load says `Couldn't load — try again`. A known sentence is never replaced with those.

### Scan
- Lookup by **barcode or part number** (label ID not displayed)
- Found card: New vs Used, action, qty; **Quote**, **Edit part**, Commit / Save notes / Scan again
- Commit logs stock_in / stock_out / set_qty against the chosen condition
- Remove of more than is on hand is refused. The screen names the current count and points at Set. It does not floor at zero and it does not write a history row. Used stock uses the used count. Remove 0 and Add 0 are refused. Set 0 still sets the count. A blank, negative, or decimal quantity is refused before any write. Home − on a part already at 0 shows the same on-hand sentence once `schema/r1_round1_guards.sql` has been run.

### Add / Edit
- Same form; **barcode never shown** on the form (still generated on create for QR labels)
- While a saved part is open, **Find quotes with this part** and **Find invoices with this part** open that Find screen with the Part Number / SKU filled in and the search already run. Home Find Quotes and Find Invoices still open empty and do not search.
- Source, category, location: **dropdown + typeahead**. Matching existing values snap to the stored spelling; new values can still be kept
- Qty (new) and Qty (used) on the same SKU. Each must be a whole number, 0 or more. A blank box means 0. A negative or a decimal is refused and is not turned into 0.
- Sell price and buy price can't be negative. A blank price stays empty. A typed price is saved rounded to cents. The error sits above Save, in the card, and does not cover Part Name.
- A part number with spaces asks first. Cancel saves nothing. OK saves it with the spaces removed.
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
- Working **cart** stays in `localStorage` (`inv_quote`) until Save. The open quote id is `inv_quote_open`. The lines last opened or saved are `inv_quote_base`. A reload opens that same quote and keeps the same number. Unsaved line edits come back when nobody else saved it: `Reopened with your unsaved line changes. Save to update it.` If another phone saved it, those lines are kept: `This quote changed on another phone. Your unsaved line edits weren't kept.` A sold or cancelled quote does not restore the unsaved lines. If it cannot be opened, the builder is cleared and the toast is `Couldn't reopen the last quote. Open it again from Saved Quotes.` A slower reopen stops when a newer **Edit** or **New quote** has started, so the reload will not wipe that newer quote. The newest one stays on screen.
- **Saved Quotes** is live unsold only: Open (stored as draft), Sent, or Accepted, and no approved invoice. Cancelled, Expired, and any quote with an approved invoice are not in this list. The search box says `Search Q number or customer`. It filters that list by the Q number or the customer. A piece of either is enough. No match says `No quotes match.` It does not search parts. A failed list says `Couldn't load — try again` and shows **Retry**. Row actions: Edit, Print, Dup, **Cancel quote**. **Search all quotes** under the list opens Find quotes, fresh, and focuses the search. Cancel keeps the number. The stored status stays `void`. Lists say **Cancelled**. There is no Delete and no Archive chip.
- The builder has **Add a part**. Two characters of a part number or a name show up to eight matches, using the same punctuation-blind match as Scan. A tap adds the line. The box stays dim until settings are ready. The toast names the quote: `Added ZZ-TEST to Q-L00001`, or `Added ZZ-TEST to the new quote` when the number box is blank or still `New — number on first save`.
- A second tap on **Save quote** or **Save as new quote** while a save is running does nothing, so one save takes one number. Those buttons are disabled while the save runs.
- Saving an Accepted quote while the status box is still Accepted, when the lines differ from the saved lines (part, qty, or price), sets the status to `draft` and says `Lines changed, so Q-… is back to Open. Mark it Accepted again once the customer agrees.` A change that does not touch the lines leaves it Accepted. **Open** on a live unsold quote in Find loads that quote in the builder. **Back** returns to the Find document.
- Builder fields: number, status, date, **valid until (default +90 days)**, **Customer** and **Project** (separate), **RFQ #**, **Prepared By** (defaults to logged-in full name), FOB dropdown (Origin / Destination / type-and-save), payment terms dropdown (customer-specific when saved), lead time, notes
- Printed quote includes a **3.5% credit-card fee** notice
- **Save quote** / **Print quote** / **Invoice…** / Duplicate / **Cancel quote** do **not** change stock. The quote builder has no **Packing list** button. Cancel does not restock and does not clear `approved_at`, so a second invoice for that quote is still refused. The **Cancel quote** button sits outside the Invoice… buttons. The status dropdown says **Cancelled** and still saves `void`. Invoices keep the word Void. There is no draft-invoice void. There is no Delete on a saved quote.
- **Packing list** is on an approved invoice in Find Invoices, not on the quote builder. It opens the print dialog. It shows that invoice's I- number and `From quote`, the customer, and every saved invoice line as qty shipped. No prices, no totals, no payment terms. Packed-by / received-by lines stay. It takes no number and writes nothing. Old `PL-` numbers and the packing list tables stay as history. Its logo is the invoice's company. The packing list paper shows a plain Ship to block (with the I- number and From quote) in the top-right quarter, so it shows through the packing list pouch when the sheet is folded in thirds and then in half; it prints at 100% scale.
- Invoice (`INV-YYYY-###`): adds PO, ship-to, due date (it follows Valid Until until someone types a due date), optional 3.5% CC fee, shipping, duty, tariffs. Those three fees can't be negative. **Save & print** stores a **draft**, prints a DRAFT stamp, and does not change stock. **Approve** calls `shop_approve_invoice` and is the only sale. A blank or spaces-only customer on that invoice is refused. **Cash sale** fills the customer box with `Cash sale` and does not write `customers`. $0.00 lines and $0.00 invoices still save and approve. A giveaway is a $0 price plus a note. The invoice box shows the open draft's own PO, ship-to, due date, fees and card fee when a quote is opened, and empties on New quote, Clear cart, Duplicate, Void, and opening another quote. If the draft changed or didn't load, Save & print refuses with "This invoice changed or didn't load. Close and tap Invoice… again to reload it before saving." and writes nothing.
- **Invoice…** follows the quote on screen. It is available when no quote is open, and when the open quote has no approved invoice. **New**, **Duplicate**, **Clear cart**, and opening another quote unlock it immediately. Reopening a quote that already has an approved invoice leaves it grey. The lock is not remembered separately from that quote’s invoices.
- A quote line that wants more than the live new-shelf qty shows `wants N / shelf M` before Save & print. That is a warning only. Save & print and Approve stay available. Nothing is reserved.
- **Save & print** reuses the newest open draft invoice on this quote: it refreshes that header and its lines from the cart and reprints it. A new draft is inserted with no number. The screen and the print say `Draft — number at Approve`, and `From quote` plus the quote number sits under that. Approve gives the invoice its I-L or I-S number. An approved invoice still blocks another invoice.
- **Invoice…** on a cart that is not saved yet runs **Save quote** first. **Save & print** does the same if there is still no quote. If that save fails, the invoice box stays closed and no INV- is minted. Draft reuse still needs that quote id.
- **New quote** starts a blank header. It asks `Clear the working cart? (Saved quotes in the database are kept.)` only from that button, and only when the lines on screen are not the saved lines. The toast is `Builder ready — add lines then Save quote`. Approve and Cancel do not ask that question. A new quote shows In-Mar Solutions and In-Mar Systems, neither picked, and the number spot reads `New — number on first save`. The company can change until the first save, which calls `shop_save_new_quote` and toasts `Saved Q-L00001` (or Q-S). After that the company is text and the number cannot change. Duplicate copies the source company and stays changeable until its own first save. When Approve marks a quote Accepted that was not already Accepted, success toasts `Approved I-L00001. Parts left the shelf. Quote marked Accepted.` If the quote was already Accepted, the toast stays `Approved I-L00001. Parts left the shelf.` Either way it then starts that same blank quote. The sold quote leaves Saved quotes. Find can still open it. An already-approved tap does the same after its info toast. Approve failure leaves the quote open and leaves the cart, and a refused Approve uses no number. Save quote and Save & print do not clear the cart, except **Save** when the status just saved is Cancelled and that quote is open. **Cancel quote** on the quote that is open starts a blank quote, including Cancel from the list. Neither company is picked. The In-Mar Solutions and In-Mar Systems buttons both show, neither is highlighted, and the locked company name is hidden. The number reads `New — number on first save`. The toast is `Q-… cancelled. Stock unchanged.` Cancelling a different quote leaves the cart. **Clear cart** asks the same clear question when the cart has any lines. An empty cart does not ask. Either way it starts that same blank quote and says `Cart cleared`. Customer and the other header boxes are empty. Saved quotes stay in the database. Valid Until can't be before the quote Date. Save quote checks that before it saves, so a refused save does not use a number.
- If this quote has an approved invoice, it is not listed in Saved quotes. On the builder, **Cancel quote** is grey, and the note names that INV: `INV-… is approved. Cancelling this quote won't undo the sale.` Void and Expired cannot be chosen or saved. **Save quote** is grey too, and the note also says `INV-… is approved. This quote's lines can't change after the sale.` Save quote does not replace those lines. **Save as new quote** keeps the lines and the company already picked, writes those lines on the first save (Q-L or Q-S), and leaves customer, project, RFQ, FOB, terms, notes, and lead time blank. A quote with only a draft, or no invoice, can still be cancelled and still saves. Cancel does not restock and does not change the invoice.
- **Save & print** refuses when the open quote is Void. The note names that Q-: `Q-… is cancelled. This invoice can't be approved.` It does not create or refresh a draft. A draft invoice on a void quote stays a draft. The invoice list shows that same Q- note and **Approve** is grey. A tap still calls `shop_approve_invoice`, which refuses before any debit. Drafts are not auto-voided. There is no new invoice status.
- Once a quote is Cancelled, it stays Cancelled (stored status `void`). The status dropdown is locked, and **Save quote** and **Invoice…** are hidden. Save reads the stored status, so picking another status does not write. The refusal is `Q-… is cancelled. Start a new quote to bring this deal back.` Bring the deal back with **Save as new quote** or **Duplicate**. Save as new quote keeps the company already picked, writes the lines on screen on the first save, and leaves the customer and the other header fields blank. It does not copy Cancelled onto the new quote. Deleting one line is refused while that cancelled quote still exists. A saved quote cannot be deleted. Cancel keeps the number. After `schema/co1_company_numbering.sql` is run, the database refuses that delete too.
- **Approve** sells the draft invoice's lines, not the cart on screen. When the lines differ, or the Notes box differs from the notes stored on that draft at Save & print, the note says `Quote changed since INV-… was printed. Save & print before Approve` and **Approve** stays grey until **Save & print**. Nothing else in that hold changes.
- Once an invoice is approved, that invoice and its lines stay as sold. A later change raises `INV-… is approved. This invoice can't change.` Save & print still rewrites a draft. Run `schema/a2_6_freeze_approved_invoice.sql` once after this build is on live Pages and every phone has hard-refreshed. A grey button alone is not the lock.
- An Approve failure (short shelf, missing shelf id, quote already sold, or anything else) shows a red message fixed at the top of the screen and scrolls that banner into view. Approve stays tappable, including when a line is short. The shelf does not change and the draft stays a draft. The banner still clears after a few seconds.
- Customer type-ahead: pick from the list, or tap **+ Add “…” as a new customer**. App-added rows are tagged **New, not in QuickBooks yet**; any signed-in person can mark **In QuickBooks**. **Cash sale** still fills `Cash sale` and does not write `customers`. On a Solutions quote the New badge and Mark In QuickBooks use `qb_status`. On a Systems quote they use `qb_status_systems`. With no company picked, the quote shows no badge. Duplicate names are refused by the database itself (`schema/c1_customer_list.sql`).
- **Customers** (tab next to Quote, `src/customers.js`): type 2+ letters to search (`shop_customer_suggest`, closest 8). Tap a name to edit name, contact, phone, email, billing and ship-to address, payment terms, tax-exempt number, notes. Save writes only changed boxes; an emptied box saves as blank (null). The open customer shows **Solutions:** and **Systems:** QuickBooks lines. Mark on a line updates only that company. When either company is In QuickBooks and the name or payment terms changed, the green message adds `Update it in QuickBooks too.` A duplicate name says `Not saved. “…” is already on the customer list …`. If someone else saved that customer first, Save refuses and says to reopen it. Merged customers are hidden from search and open read-only. No Delete. Adding is still from the Quote screen. The Systems line appears after `schema/co1_company_numbering.sql` adds `qb_status_systems`.
- **CL2** freezes customer details on the quote when a listed customer is picked: contact, phone, email, billing address, ship-to, payment terms, tax-exempt number, and customer notes. A blank stays blank. Billing is never copied into ship-to. Cash sale and a name that is not a picked customer clear those fields. Saving the quote stores them on the quote. Opening that quote fills the boxes from the quote, and the customer row is read only for the QuickBooks tag. **Invoice…** copies that quote snapshot onto the invoice, including ship-to. Each field stays editable before Approve. Document notes stay in the Notes box. Customer notes stay in Customer notes. **Save as this customer's ship-to** is next to the invoice ship-to box, unchecked, and only visible when a listed customer is picked and ship-to has text. It is hidden for Cash sale, a blank customer, and a blank or whitespace-only ship-to. Clearing ship-to hides it and unchecks it. The checkbox is stored on the invoice (`save_ship_to`). Approve still calls `shop_approve_invoice`. After `schema/cl2_customer_carry.sql`, that function writes `customers.ship_to_address` from the invoice ship-to only when the box was checked, `customer_id` is set, and ship-to has text, and only on the first successful Approve. A failed Approve does not write the customer. A second Approve does not write again. Nothing else on the customer changes, including `qb_status` and `qb_status_systems`. If the write happened and the customer is In QuickBooks for the invoice's company, the success line adds `Ship-to updated. Update it in QuickBooks too.` A Systems invoice (`company = 'S'`) reads `qb_status_systems`. Any other company reads `qb_status`. Prints and reprints use the stored snapshot. An empty ship-to prints as —. It does not say "Same as bill to" and it does not repeat the billing address. Packing list still omits an empty ship-to. Quote, invoice, and PO part pickers are unchanged. Multiple ship-to addresses are later. Run `schema/cl2_customer_carry.sql` once after Pages is green and every phone has hard-refreshed. Safe to re-run. It does not add columns on `public.customers`. The merge does not run this SQL.
- Quote numbers (Q-L / Q-S) are taken on the first Save. Invoice numbers (I-L / I-S) are taken at Approve. A packing list takes no number. Old PL- rows stay in the packing list tables. After `schema/co1_company_numbering.sql` is run, that function refuses quote and invoice.
- Line snapshots: part_number, name, qty, unit_price (+ optional inventory_id)
- Tables optional: if missing, inventory still works; print still works; save of extra fields / packing / invoices prompts for Phase 2 SQL

### Labels (QR deep-links)
- QR codes (library: `qrcode` CDN), **not** Code 128
- QR payload = full app URL + `?p=` **stable label ID** (`inventory.barcode`, e.g. `IM…`) — **does not change** when name or part # is edited
- Fallback key is `part_number` only if barcode column/value missing
- `?part=` and `?pn=` are still accepted. `?p=` wins when more than one is present
- Phone **Camera** opens the URL → after sign-in the app opens Scan for that part (**Commit** still required)
- In-app scanner: if decoded text is a URL with `p`, `part`, or `pn`, extract the key; else treat as plain ID/part #
- Lookup matches `barcode` **or** `part_number` (case-insensitive)
- Layout DK-1201: horizontal — QR left (~0.85″), name small + **large part #** right
- Print via **popup** (Brother one-per-page; letter paper 8-up with larger QR)
- Deep link after sign-in: read `?p=`, then `?part=`, then `?pn=`. Open the Scan found card. `p`, `part`, and `pn` are removed and the address is cleaned to `?view=scan`

### Reports (inside More)
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
- Full setup SQL (inventory extras + Phase 1 + Phase 2 + Phase 3) + clear all inventory. Once schema/b038_part_delete_guard.sql has been run, Clear all is refused as a whole while any part is on an open quote.

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
- Sign in before import. The stamp is the signed-in person. There is no header name dropdown.
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
| App source, docs, SQL | GitHub `KG3924/parts-inventory` `main`. Actions publishes the Vite build. Count is shelved. |
| Live inventory, quotes, packing lists, invoices, settings, cost layers | **Supabase** (realtime). Phase 1–3 SQL has been run on production |
| Working quote **cart** (unsaved) | Browser `localStorage` key `inv_quote` — device/browser only until Save quote. The open quote id is `inv_quote_open`. A reload reopens that quote and keeps the same number |
| Sell factors / FX / costing method | `localStorage` + `app_settings` in Supabase |
| Physical count | Shelved. `count.html` only redirects to the shop home (`?view=dashboard`). It cannot read or write stock. There is no count draft |
| Original supplier sheets, 2026 catalogs, helper xlsx/json | **This Mac only** (not in git — see local file map). Do not rely on GitHub for those |

Default Wynn sell factor: **2.585**. FFS factor: enter when known.

---

## A1 stock and document numbers (live)

`schema/a1_stock_doc_referee.sql` is already applied. Commit and new Q- / INV- / PL- numbers go through `shop_commit_qty` and `shop_next_doc_number`. Round 1 replaces `shop_commit_qty`: a short remove is refused and points at Set. It does not floor at zero. Do not re-run A1 after `schema/r1_round1_guards.sql` unless you run that Round 1 file again right after.

## Approve invoice (run SQL only after this page is on the phones)

Stock leaves the shelf only when someone taps **Approve** on a draft invoice. The database function `shop_approve_invoice` debits every stock line or none, through the same referee as Commit. A second tap does not debit again. A short line fails the whole invoice and leaves the shelf as it was. Fee lines with no part number are not debited. A stock line missing a shelf id fails the whole Approve.

Run `schema/a2_approve_invoice.sql` **once**, and only after the Approve page is on the phones and every phone has hard-refreshed. Order: Approve build on Pages → hard-refresh → run that SQL → smoke on throwaway part numbers. This file does not record whether production already has that SQL — check Supabase before running it again. Running it before the phones show **Approve** does not fix the shelf.

## Void quote blocks Approve (run SQL only after the A2.4 page is on the phones)

`shop_approve_invoice` refuses when the invoice's quote is void, and when `quote_id` is set but the quote row is missing. The error names the quote: `Q-… is void. This invoice can't be approved.` The invoice stays a draft. The shelf does not change. Already-approved, one approved invoice per quote, and a short shelf stay as they are. The function does not void draft invoices.

Run `schema/a2_4_void_quote_approve_lock.sql` **once**, only after this build is on live Pages and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → run that SQL → smoke. Do not run this before the phones are on this build. A grey Approve button alone is not the lock. After Round 1, re-running this file or `schema/a2_approve_invoice.sql` puts the older Approve function back. Run `schema/r1_round1_guards.sql` again right after. The void refuse itself stays in that Round 1 function.

## Void is final (run SQL only after the A2.4b page is on the phones)

Once `quotes.status` is void, that row is locked. Any later update raises `Q-… is void. Start a new quote to bring this deal back.` A blank number uses `This quote`. Insert and update on `quote_lines` for that quote raise the same sentence. Delete of a line is refused while the void quote row is still there, so a line-edit Save cannot wipe the lines. Delete of the void quote is allowed, and its lines go with it. A line whose quote row is already gone can be deleted. The save that first sets Void still works: lines are written, then the status is sealed. This file does not void invoices and does not change `shop_approve_invoice`.

Run `schema/a2_4b_void_quote_final.sql` **once**, only after this build is on live Pages and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → run that SQL → smoke. Re-run the same file to pick up the line-delete rule. A grey Save button alone is not the lock. The pass is an update of that void quote, under a signed-in profile, raising that sentence. Optional prove: delete one line on that still-void quote and it raises the same sentence. Delete the void quote and its lines go with it.

## Approved invoice stays as sold (run SQL only after this page is on the phones)

Once an invoice is approved (`status` is approved, or `approved_at` is set), that row cannot change. Any later update raises `INV-… is approved. This invoice can't change.` A blank number uses `This invoice`. Insert, update, and delete of its `invoice_lines` raise the same sentence. The check uses the row that is already approved, so the update that first stamps a draft approved still works. A second Approve does not debit again. Save & print still rewrites a draft invoice and its lines. Deleting an approved invoice still raises `Approved invoices stay on the books`. This file does not change `shop_approve_invoice`, does not void drafts, does not restock, and does not touch the void-quote triggers.

Run `schema/a2_6_freeze_approved_invoice.sql` **once**, only after this build is on live Pages and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → run that SQL → smoke. A grey button alone is not the lock. The pass is an update of that approved invoice, under a signed-in profile, raising that sentence. The same sentence refuses a change to one of its lines.

## Quote lines lock (run SQL only after this page is on the phones)

Once any invoice for a quote has `status` approved, or `approved_at` set, that quote's lines stay as sold. Insert, update, and delete raise `Q-… has approved invoice I-…. Its lines can't change. Void the invoice first to change them.` A blank quote number says `This quote`. An update that moves a line onto or off that quote is refused the same way. Voiding the invoice clears the lock. A void quote still raises the void sentence. Approve does not write quote lines. The cutover reset is unchanged.

Run `schema/ql1_lock_quote_lines.sql` **once**, only after this build is on live Pages and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → run that SQL → smoke. Safe to re-run. The merge does not apply this SQL.

## Save quote in one step (run SQL only after this page is on the phones)

Save on an existing quote calls `shop_save_quote` once. The lines are written, then the header, in that one call. If anything refuses, the quote stays as it was. The first save still uses `shop_save_new_quote`. Until this SQL is applied, Save on an existing quote still replaces the lines and then writes the header as two calls.

Run `schema/sv1_save_quote.sql` **once**, only after this build is on live Pages and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → run that SQL → smoke. Safe to re-run. The merge does not apply this SQL.

## Round 1 guards (run SQL only after this page is on the phones)

Commit no longer floors a short remove at zero. Remove of more than is on hand raises `Only N on hand. If the shelf has more, use Set to correct the count first.` Used stock says `Only N used on hand…`. Add 0 raises `Enter how many to add — 1 or more.` Remove 0 raises `Enter how many to remove — 1 or more.` Set 0 still works. Approve still uses its own short-shelf sentence, because it sets `inmar.strict_remove`. Home − on a part at 0 shows the on-hand sentence after this SQL runs.

A quote line qty must be a whole number, 1 or more. A bad qty keeps the old qty. A negative price keeps the old price. Prices round to cents. Shipping, duty, and tariffs can't be negative. Valid Until can't be before the quote Date, and Save checks that before a new quote number is issued. $0.00 lines and $0.00 invoices still save and approve.

Approve on a Draft or Sent quote still sets it to Accepted. The toast adds `Quote marked Accepted.` when the quote was not already Accepted. Find says `Searching…` and `Opening…`, and a later search or Back wins. A blank customer on the invoice is refused before any debit: `This invoice has no customer. Add a customer or tap Cash sale, then Save & print before Approve.` **Cash sale** fills the box with exactly `Cash sale` and does not write `customers`. The mismatch hold also compares Notes. Nothing else in that hold changes.

`schema/r1_round1_guards.sql` replaces `shop_commit_qty` and `shop_approve_invoice` and adds `NOT VALID` checks. Run it once, only after GitHub Pages is serving this build and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → run that SQL → smoke. Safe to re-run. Never run `VALIDATE CONSTRAINT` on these checks. Re-running `schema/a1_stock_doc_referee.sql`, `schema/a2_approve_invoice.sql`, or `schema/a2_4_void_quote_approve_lock.sql` after this file puts the older functions back. Run `schema/r1_round1_guards.sql` again right after. A grey button alone is not the lock. The merge does not apply this SQL. Quote numbering is unchanged. RLS, the freeze, and the void locks are unchanged.

## Quote screen (no new SQL)

Invoice… follows the quote on screen and saves the cart first when that cart is not a saved quote yet. A short line warns `wants N / shelf M` and does not block Save & print or Approve. Save & print updates the newest open draft instead of minting another INV-. Approve failures stay on screen at the top and leave the shelf and the draft alone. The quote action is labeled **Cancel quote**. None of that changes `shop_approve_invoice` or `schema/a2_approve_invoice.sql`. Smoke after the page is on Pages and every phone has hard-refreshed. Do not run SQL for these screen fixes.

## Login and lock (live)

The login app is on `main`. `schema/auth_lock_after_merge.sql` is already applied. Do not leave or restore open policies. Smoke after any later merge: unlock → scan → new or used → Commit → printed label still scans.

## Archive (not linked from the app)

`archive.html` is not linked from the app. Release order: merge, wait until Pages is green, hard-refresh every phone, then Kyle runs `schema/archive_v1.sql` once in the Supabase SQL editor. Safe to re-run. The file creates empty tables and does not load records. The real load is a separate step outside the repo.

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
| `src/main.js` | Loads the quote and Customers screens |
| `src/quote.js` | Quote, packing list, invoice, and Find behavior |
| `src/po.js` | Purchase order. It prints and does not save |
| `src/quote-markup.js` | Quote screen HTML |
| `vite.config.js` | Build. Base path ./ (relative; works at inventory.inmarsystems.com and the old address). Output `dist/` |
| `package.json` | `npm run dev` / `npm run build` |
| `.github/workflows/pages.yml` | `npm ci`, build, secret scan, publish `dist/` |
| `scripts/refuse-shipped-secrets.sh` | Fails the Pages build if a real secret is in `dist/` |
| `src/customers.js` | Customers screen: search, edit, Mark In QuickBooks (CL1b) |
| `scripts/refuse-customer-data.sh` | Fails the Pages build if customer-looking data (spreadsheet files, unknown emails or phone numbers) is in `dist/`. Prints file names and counts only, never the values (the build log is public) |
| `scripts/refuse-shipped-count-seed.sh` | Fails the Pages build if `count-seed*` or part-catalog JSON is in `dist/` (BUG-041) |
| `public/public-config.js` | Public Supabase URL + anon key only (copied into the Pages build) |
| `public/shop-auth.js` | Sign-in wall for the app |
| `archive.html` | Old Logs archive. Not linked from the app. Same sign-in wall |
| `src/archive.js` | Archive search, record, hull, serial, customer, and lists |
| `schema/archive_v1.sql` | Empty archive tables and three read-only functions. Kyle runs it by hand after Pages is green and every phone has hard-refreshed |
| `schema/auth_lock_after_merge.sql` | Live lock (already applied). Do not re-open with allow-all policies |
| `public/inmar-logo.jpg` | Older shop logo. Quotes, packing lists, and invoices no longer use it |
| `public/In-Mar-Solutions-logo-v4.png` | Logo when the document company is L |
| `public/In-Mar-Systems-logo-v4.png` | Logo when the document company is S |
| `schema/co1_company_numbering.sql` | Two companies, four gap-free counters, number on first save, delete lock. Kyle runs it once by hand after Pages is live and every phone has hard-refreshed. Not wired into the build |
| `schema/co1_cutover_reset.sql` | Cutover-day tool only. Not part of the build. Run the file, then count only, then CLEAR PRACTICE DATA, after a backup |
| `README.md` | Setup docs |
| `CONTEXT.md` | This file — read first in a new session |
| `public/count.html` | Shelved. Redirects to the shop home (`?view=dashboard`). It cannot read or write stock |
| `public/manifest.webmanifest` | Home Screen manifest. Name is In-Mar Systems Parts. Short name is Parts |
| `public/icon-180.png` | Home Screen icon and the Apple touch icon |
| `public/icon-192.png` | Home Screen icon |
| `public/icon-512.png` | Home Screen icon |
| `COUNT.md` | Old count how-to, kept as history under a Shelved (Nov 2026) note |
| `schema/quotes_phase1.sql` | Additive quotes + customers |
| `schema/quotes_phase2.sql` | Quote extras, packing lists, invoices, settings |
| `schema/inventory_costing.sql` | Used qty, price history, cost layers |
| `schema/a1_stock_doc_referee.sql` | Live qty + document-number referee. Superseded in part by Round 1. Re-run Round 1 right after if this file is re-run |
| `schema/a2_approve_invoice.sql` | Older Approve function. Superseded in part by Round 1. Re-run Round 1 right after if this file is re-run |
| `schema/a2_4_void_quote_approve_lock.sql` | Older void-quote Approve lock. Superseded in part by Round 1. Re-run Round 1 right after if this file is re-run |
| `schema/r1_round1_guards.sql` | Round 1 guards. Run once after this build is on Pages and every phone has hard-refreshed. Do not VALIDATE the new checks. A grey button alone is not the lock |
| `schema/b038_part_delete_guard.sql` | A part on an open quote can't be deleted. Run once after this build is on Pages and every phone has hard-refreshed. Safe to re-run |
| `schema/c1_customer_list.sql` | customer list: unique name, type-ahead / Did you mean, New-not-in-QB tag, merge by pointer (run once after this build is on Pages and every phone has hard-refreshed; safe to re-run) |
| `schema/a2_4b_void_quote_final.sql` | Locks a void quote. Line edits are refused. Run once after A2.4b is on Pages and every phone has hard-refreshed. Re-run for the line-delete rule. Quote delete is closed by `schema/co1_company_numbering.sql` once that file has been run |
| `schema/a2_6_freeze_approved_invoice.sql` | Locks an approved invoice and its lines. Run once after this build is on Pages and every phone has hard-refreshed. A grey button alone is not the lock |
| `schema/vd1_void_invoice.sql` | Voids an approved invoice and puts its stock back once at the original cost. Kyle runs it once by hand after this build is on Pages and every phone has hard-refreshed |
| `schema/ql1_lock_quote_lines.sql` | Locks a quote's lines once an invoice for it is approved. Run once after this page is on Pages and every phone has hard-refreshed. Safe to re-run. The merge does not apply this SQL |
| `schema/sv1_save_quote.sql` | Saves an existing quote's lines and header in one call. Run once after this page is on Pages and every phone has hard-refreshed. Safe to re-run. The merge does not apply this SQL |

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

*Last updated: 2026-11-20 — #41–#46. Older notes are in git log.*
