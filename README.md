# Parts Inventory – Remote Web App (Supabase)

**Live app:** [https://inventory.inmarsystems.com/](https://inventory.inmarsystems.com/)

### Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173/ (the dev server uses the same relative `./` base as the live site). `npm run build` writes `dist/`. GitHub Pages deploys that build, not the raw repo. After this is on `main`, the repo setting **Settings → Pages → Source** must be **GitHub Actions**, not “Deploy from a branch.” Count is shelved. http://localhost:5173/count.html only redirects to the shop home (`?view=dashboard`). It cannot read or write stock.

Phone-friendly inventory tracker for **In-Mar Systems** with live remote access, barcode scanning, labels, quotes, and basic reports.

**Labels use QR codes** that deep-link into the app (`?p=` + the stable label ID). The printed part number is human-readable text; the QR stays valid when the name or part # changes. `?part=` and `?pn=` are still accepted. The key is read after sign-in. Then `p`, `part`, and `pn` are removed and the address is cleaned to `?view=scan`.

---

## Features (live)

| Area | What it does |
|------|----------------|
| **Front row** | **Home · Scan · Inventory · Labels**. The second row is **Quote · Customers · PO**. Tabs, Quote, Scan start, Commit, Save, and Approve are large thumb targets. The header **‹ Back** is hidden on the first screen. After that it steps back through the screens you opened. |
| **Home** | Stats row: Parts, Units, Low, Open Orders. Until the parts list loads, these tiles and the value cards (cost, sell, margin, Needs Delivery Date) show —. They then fill from that list and do not wait for settings. A parts tile opens that list on Inventory. Units is a count only. **Find Quotes** and **Find Invoices** are two tiles side by side under that row and above the value cards. Each opens its own area, fresh every time. Find is not a tab and not under More. **More** is a link here, not a front-row tab. Add to Home Screen uses the manifest named In-Mar Systems Parts (short name Parts) and the Systems icons. |
| **Inventory** | Parts list, search, source + category chips, **+/−** on new qty, **Adjust**, Quote / Edit. Delete part is at the bottom of Edit. **+ Add part** is at the top. On a phone each part is a card with the buttons on their own row. No sideways scrolling. |
| **Scan** | Camera or type part # → review → pick **New or Used** → **Commit** stock in/out/set; **Quote** and **Edit part**. A second tap on **Commit change** does nothing until that one stock change finishes. **Back** to Scan redraws the found card from the current parts list. Remove of more than is on hand is refused and points at Set. Add 0 and Remove 0 are refused. Set 0 still works. |
| **Add / Edit** | Opened from Inventory. Delete part is at the bottom, only while editing an existing part, and it asks before deleting. Name, part #, qty new + used (whole numbers, 0 or more), reorder (default 0), buy/sell (not negative, rounded to cents), source/category/location dropdowns, notes, open order. A part # with spaces asks before it is saved without spaces. If the qty changed, Save reads the live row first and refuses when the shelf moved: `Stock changed since you opened this part. Reopen it.` A successful Save replaces the Add step in Back's history with Inventory. |
| **Quote** | On the second row, with Customers and PO. Cart + saved quotes in `src/quote.js`: | customer vs project, **Cash sale**, RFQ, FOB, terms, lead time, 90-day validity, prepared-by = signed-in person. Valid Until can't be before Date. Save, print, packing list, and draft invoice do not change stock. **Invoice…** saves the cart first if it is not a saved quote yet. **Approve** on a draft invoice is the sale and needs a customer on that invoice. A short line shows `wants N / shelf M` and does not block. **Save & print** reuses the newest open draft. A draft print shows DRAFT. Approve failures stay at the top of the screen. **Cancel quote** does not restock and keeps the number. A new quote picks In-Mar Solutions or In-Mar Systems; the number is given on the first save. |
| **Reports** | Inside **More**: valuation (new qty only); adjustment log; **price history**; **LIFO/FIFO ending inventory**; needs-attention |
| **Labels** | **QR deep-link** labels (stable ID in URL) → phone Camera opens app to that part; Brother DK-1201 or letter paper (8/sheet) |
| **More** | Link on Home. Export/Import JSON; sell factors; **GBP/EUR/NOK exchange rates** (fetch or type); FIFO/LIFO; setup SQL; Passwords; Reports; clear all |
| **Physical count** | Shelved. [`count.html`](count.html) only redirects to the shop home (`?view=dashboard`). It cannot read or write stock. [`COUNT.md`](COUNT.md) keeps the old how-to as history. |

Inventory, Labels, Price history, Scan, the quote builder's **Add a part**, and the PO **Add a part** share the punctuation-blind part match, so dashes, spaces, and capitals in a part number do not matter. The count tool is shelved and does not search. On Edit, **Find quotes with this part** and **Find invoices with this part** open that Find screen with the part number filled in and the search already run. That match needs no SQL.

A second tap on **Save quote** or **Save as new quote** while a save is running does nothing, so one save takes one number. Buttons pass a typed part number from the button's own data. They do not put it inside the click code. A failed parts list says `Couldn't load — try again.` The connection line says `Couldn't load — try again`. The list does not stay on `Loading…`. Saved Quotes says `Couldn't load — try again` and shows **Retry**.

**Sign-in:** Glynn Grantham, Kyle Grantham, Toby Whitfield, Grant Adams, and Ricky Whitfield each have their own login. Unlock once on that phone for a 12-hour shift. The phone’s saved password (Face ID, Touch ID, or fingerprint) fills the next unlock. The unlock screen asks you to select your name. There is no header name dropdown. Prepared By and the adjustment log use only the signed-in person. **Sign out** is in the header. **More → Passwords** sets a new password for any of the five. They save it again on their phone.

The public anon key is in `public-config.js`. Never commit a service-role key.

### Database lock

`schema/auth_lock_after_merge.sql` is **already applied** on the live database. Unsigned requests cannot read or change stock. Do not recreate open “anyone can edit” policies. More → Copy SQL only adds columns and tables, and grants them to signed-in users.

**Theme:** Light (white background)

---

## Required files on GitHub Pages

| File | Purpose |
|------|---------|
| `index.html` | The app (Vite entry; built into `dist/`) |
| `public/public-config.js` | Public Supabase URL + anon key (copied into `dist/`) |
| `public/shop-auth.js` | Sign-in wall (copied into `dist/`) |
| `public/inmar-logo.jpg` | Older shop logo. Document prints no longer use it |
| `public/In-Mar-Solutions-logo-v4.png` | In-Mar Solutions logo (company L) |
| `public/In-Mar-Systems-logo-v4.png` | In-Mar Systems logo (company S) |
| `public/count.html` | Shelved. Redirects to the shop home (`?view=dashboard`). It cannot read or write stock |
| `public/manifest.webmanifest` | Home Screen manifest. Name is In-Mar Systems Parts. Short name is Parts |
| `public/icon-180.png`, `public/icon-192.png`, `public/icon-512.png` | Home Screen icons (the Systems mark). `icon-180.png` is also the Apple touch icon |

**Archive** (`archive.html`) is not linked from the app. It is a read-only search of the old Logs site's quotes and invoices. After Pages is green and every phone has hard-refreshed, run `schema/archive_v1.sql` once in the Supabase SQL editor. The repo has no archive records.

---

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the setup SQL from the app (**More → Copy SQL**) or the files under `schema/` in the repo. That includes:
   - `inventory` extras (`category`, `barcode`)
   - `inventory_adjustments`
   - Phase 1 quotes: `customers`, `quotes`, `quote_lines`, `document_counters`
   - Phase 2: quote extras (project, RFQ, FOB, terms, lead time), `app_settings`, `app_lookups`, packing lists, invoices
   - Phase 3: `qty_used`, `inventory_price_history`, `inventory_cost_layers`
3. **Project Settings → API** → the public anon key belongs in `public-config.js` only. Never commit a service-role key.

Shop tables are signed-in only. The live database lock is already applied (`schema/auth_lock_after_merge.sql`). Do not paste old “allow all” policies back in.

Stock changes and document numbers already go through `schema/a1_stock_doc_referee.sql`. **Approve invoice** SQL started as `schema/a2_approve_invoice.sql`. Round 1 replaces both functions. See `schema/r1_round1_guards.sql` below. Check Supabase before running an older file again. The quote-screen work after Approve (Invoice… lock, short warning, draft reuse, Void quote, save-before-invoice, fail banner, empty cart) added no SQL.

**A2.4** is `schema/a2_4_void_quote_approve_lock.sql`. Run it once, only after this build is on live Pages and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → SQL → smoke. It makes Approve refuse a void quote, and a missing quote row, before any debit. The draft stays a draft. Do not run it before the phones show this build. After Round 1, re-running this file or `schema/a2_approve_invoice.sql` puts the older Approve function back. Run `schema/r1_round1_guards.sql` again right after.

**A2.4b** is `schema/a2_4b_void_quote_final.sql`. Run it once, only after this build is on live Pages and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → SQL → smoke. Re-run that same file to pick up the line-delete rule. A void quote stays void. Changing that row, or inserting or updating its lines, raises `Q-… is void. Start a new quote to bring this deal back.` Deleting a line is refused while the void quote is still there. Deleting the void quote removes its lines with it. It does not void invoices and does not change Approve. A grey Save button alone is not the lock.

**A2.6** is `schema/a2_6_freeze_approved_invoice.sql`. Run it once, only after this build is on live Pages and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → SQL → smoke. Once an invoice is approved, any later update of that row, and any insert, update, or delete of its lines, raises `INV-… is approved. This invoice can't change.` The first Approve still stamps a draft. A second Approve does not debit again. Save & print still rewrites a draft. Deleting an approved invoice still says `Approved invoices stay on the books`. It does not change `shop_approve_invoice`, does not void drafts, and does not restock. A grey button alone is not the lock.

**Round 1** is `schema/r1_round1_guards.sql`. Run it once, only after GitHub Pages is serving this build and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → SQL → smoke. Safe to re-run. Do not run `VALIDATE CONSTRAINT` on the new checks. Commit no longer floors a short remove at zero. It refuses that remove and points at Set. Add 0 and Remove 0 are refused. Set 0 still works. Approve still uses its own short-shelf sentence. A blank customer on the invoice is refused before any debit. Approve still marks a Draft or Sent quote Accepted, and the screen says so when it was not already Accepted. $0.00 lines and $0.00 invoices still save and approve. Quote numbers are issued the same way as before. RLS, the freeze, and the void locks are unchanged. Re-running `schema/a1_stock_doc_referee.sql`, `schema/a2_approve_invoice.sql`, or `schema/a2_4_void_quote_approve_lock.sql` after this file puts the older functions back. Run `schema/r1_round1_guards.sql` again right after. A grey button alone is not the lock. The merge does not run this SQL.

**BUG-038** is schema/b038_part_delete_guard.sql. Run it once, only after GitHub Pages is serving this build and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → SQL → smoke. Safe to re-run. A part on an open quote (not void, no approved invoice; a draft invoice counts through its quote) can't be deleted: "Not deleted. This part is on open quote Q-…. Remove it from that quote first." Clear all inventory is refused as a whole while any part is on an open quote, nothing is deleted, and the message lists every blocking quote ("Not deleted. N parts are on open quotes …"). It changes no rows and does not touch Approve, RLS, the freeze, or the void locks. The merge does not run this SQL.

**Customer list** is schema/c1_customer_list.sql. Run it once, only after GitHub Pages is serving this build and every phone has hard-refreshed. Order: merge → Pages → hard-refresh → SQL → smoke. Safe to re-run. The database itself refuses duplicate names (lower, trim, collapse spaces). Type-ahead and Did you mean are shop_customer_suggest. Adding from the quote is shop_add_customer and tags the row New, not in QuickBooks yet. Merge is SQL-editor only (shop_merge_customers). The file also adds optional billing_address, contact_name, ship_to_address and tax_exempt_number columns (blank until filled in). **Customers** (next to Quote) searches the list and edits those fields; it added no SQL (CL1b). No real customer data in the repo. The merge does not run this SQL.

**CL2** copies a picked customer's contact, phone, email, billing address, ship-to, payment terms, tax-exempt number, and customer notes onto the quote. A blank field stays blank. Billing is never copied into ship-to. The invoice is filled from that quote snapshot, and each field stays editable before Approve. Opening or reprinting a quote or invoice does not read those fields back from the customer. **Save as this customer's ship-to** sits by the invoice ship-to box. It shows only when a listed customer is picked and ship-to has text, and it is unchecked until someone checks it. Cash sale, a blank customer, and a blank ship-to hide it. The box is saved on the invoice. Approve writes that ship-to over the customer's one saved ship-to only when the box was checked, the customer is a listed customer, and ship-to has text. A failed Approve does not write it. A second Approve does not write it again. When that write happens and the customer is In QuickBooks for the invoice's company, the Approve message adds `Ship-to updated. Update it in QuickBooks too.` A Systems invoice reads `qb_status_systems`. Any other company reads `qb_status`. Multiple ship-to addresses are later. `schema/cl2_customer_carry.sql` adds the snapshot columns and `invoices.save_ship_to`. It does not add columns on `customers`. Run it once after this build is on live Pages and every phone has hard-refreshed. Safe to re-run. The merge does not run this SQL.

---

## 2. Importing spreadsheet data

Use **More → Import JSON**.

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

- Sign in first. Import stamps the signed-in person.
- Existing part numbers are **skipped**.
- Optional `barcode`; if omitted and the column exists, the app generates one.
- Optional `qty_used` (used/salvage on the same part #). Reorder defaults to **0** if omitted.
- No spaces in part numbers.
- Placeholders: include `PLACEHOLDER` in the part number (e.g. `WYNN-PLACEHOLDER-001`).
- Wipe and restart: **More → Clear all inventory…** (type `DELETE ALL`). Export a backup first. Once schema/b038_part_delete_guard.sql has been run, Clear all is refused as a whole while any part is on an open quote, nothing is deleted, and the message lists every blocking quote.

---

## 3. Labels (QR deep-links)

Labels use a **QR code** that opens the live app with a query parameter, e.g.  
`https://inventory.inmarsystems.com/?p=IMXXXXXXXX`

Labels printed before Nov 2026 encode https://kg3924.github.io/parts-inventory/?p=…; GitHub redirects those to the new address with the ?p= kept. Never rename, transfer, or turn off Pages on this repo, and never add a custom domain to the kg3924.github.io repo, or those labels break.

The value is the part’s **stable label ID** (`barcode` in Supabase), not the human part number — so renaming a part does **not** require reprinting. Name and part # still print as text next to the QR.

### Brother QL-710W + DK-1201
- Size: **1.1″ high × 3.5″ wide**
- Labels → select → **Generate preview** → **Print on Brother QL (DK-1201)**
- Print: media **DK-1201**, scale **100%**, no fit-to-page
- One die-cut per page (popup print window)

### Letter paper (shelves / laminate)
- **Print on letter paper (8 / sheet)** — 2×4 grid, larger QR

### Scanning
1. **Phone Camera app** → opens the web app → Scan screen with that part → pick **New or Used**, action, qty → **Commit change**
2. **In-app scanner** → reads the same QR (or a plain part number) → same Commit flow

---


## 4. Quotes, packing lists, and invoices

These are three related documents that share the same cart and look similar, but they are not the same thing:

| Document | Job | Shows money? |
|----------|-----|----------------|
| **Quote** | Offer to sell. Valid 90 days. | Yes — unit prices and quoted total. Notes 3.5% CC fee if a card is used later. |
| **Packing list** | What was physically shipped (warehouse / receiver). | **No.** No prices, payment terms, lead time, or CC note. |
| **Invoice** | Request for payment after the sale. | Yes — merchandise, shipping, duty, tariffs, optional 3.5% CC fee, amount due. |

1. Add lines from Inventory or Scan with **Quote**.
2. On the **Quote** row fill: **Customer** (separate from **Project**), or tap **Cash sale**, RFQ #, dates (valid until defaults to **+90 days**, and it can't be before Date), FOB (Origin / Destination / type-and-save), payment terms (can be stored on the customer), lead time, prepared by (defaults to whoever is logged in). **Cash sale** writes the words `Cash sale` in the customer box. It does not add a customer row.
3. **Save quote** stores it in Supabase (after Phase 1 SQL). New header fields need **Phase 2 SQL**.
4. **Print quote** — branded offer. On a quote that was never saved, it says `Save the quote first.` and opens no window. The quote builder has no **Packing list** button. **Invoice…** — adds PO, ship-to, due date (it starts as the quote's Valid Until, and stays there until someone types a due date), shipping/duty/tariffs (not negative), optional CC fee. A new draft has no number until Approve. If the cart is not a saved quote yet, Invoice… saves it first. **Save & print invoice** stores a draft on that quote, prints a DRAFT stamp, and does not change stock. If this quote already has an open draft, Save & print updates that draft and reprints it. A draft with no number prints `Draft — number at Approve`, with `From quote` and the quote number under it. If the open quote is Cancelled, Save & print refuses, names that Q-, and does not create or refresh a draft. A quote line qty must be a whole number, 1 or more. A negative price is refused and the old price stays. $0.00 is allowed. Prices round to cents. The invoice box shows the open draft's own PO, ship-to, due date, fees and card fee when a quote is opened, and empties on New quote, Clear cart, Duplicate, Cancel, and opening another quote. If the draft changed or didn't load, Save & print refuses with "This invoice changed or didn't load. Close and tap Invoice… again to reload it before saving." and writes nothing.
5. A line that wants more than the shelf shows `wants N / shelf M` on the quote before Save & print. Save & print and Approve are still allowed.
6. **Approve** on that draft takes every stock line off the shelf, or none of them. A second Approve does nothing to the shelf. When the quote was not already Accepted, success toasts `Approved I-L00001. Parts left the shelf. Quote marked Accepted.` Otherwise it toasts `Approved I-L00001. Parts left the shelf.` A refused Approve uses no number. Either way it opens a new blank quote. The sold quote leaves Saved quotes. Find can still open it. A blank or spaces-only customer on the saved invoice is refused: `This invoice has no customer. Add a customer or tap Cash sale, then Save & print before Approve.` The name that counts is the one on the invoice at Save & print. If Approve fails (short shelf, missing shelf id, quote already sold, a cancelled quote, no customer, or anything else) a red message stays at the top of the screen, the shelf stays as it was, the draft stays a draft, and the quote stays open. Approve is not greyed when a line is short. It is grey when that draft's quote is Cancelled, and the row names the Q-. A tap still asks the database, which refuses. If the lines or the Notes on screen differ from the draft, Approve stays grey until **Save & print**, and the note names that INV. **Invoice…** is grey only while the quote on screen already has an approved invoice. New, Duplicate, Clear cart, or opening another quote unlocks it. After Approve, that invoice and its lines stay as sold. A later change is refused with `INV-… is approved. This invoice can't change.` $0.00 lines and $0.00 invoices still approve.
7. **New quote** starts a blank quote. It asks `Clear the working cart? (Saved quotes in the database are kept.)` only from that button, and only when the lines on screen are not the saved lines. The toast is `Builder ready — add lines then Save quote`. Approve and Cancel do not ask that question. A failed Approve leaves the lines. Save quote and Save & print leave them, except Save when the status just saved is Cancelled and that quote is open. **Cancel quote** on the quote that is open starts a blank quote, including Cancel on that row in the list. The toast is `Q-… cancelled. Stock unchanged.` Cancelling a different quote leaves the lines. **Clear cart** asks that same question when the cart has any lines. An empty cart does not ask. Either way it starts a blank quote and says `Cart cleared`. Neither company is picked. The In-Mar Solutions and In-Mar Systems buttons both show, neither is highlighted, and the locked company name is hidden. The number reads `New — number on first save`. Customer and the other header boxes are empty. Saved quotes stay in the database.
8. The saved list is live unsold only: Open (stored as draft), Sent, or Accepted, and no approved invoice. Cancelled, Expired, and any quote that already has an approved invoice are left off this list. **Search all quotes** under the list opens Find quotes, fresh. **Edit**, **Print**, **Dup**, **Cancel quote**. Cancel keeps the number and does not put stock back. Lists say Cancelled. The stored status stays void. If the quote open in the builder already has an approved invoice, Cancel quote and Save quote are grey, the note names that INV, Cancelled or Expired cannot be saved, and Save quote does not replace the sold lines. **Save as new quote** keeps the company already picked and writes the lines on screen on the first save, with a blank customer and the other header fields blank. A draft-only quote can still be cancelled and still saves. There is no Delete and no draft-invoice void. A draft invoice on a cancelled quote is not voided for you. Once a quote is Cancelled, it stays Cancelled: the status dropdown is locked, Save quote and Invoice… are hidden, and Save refuses with `Q-… is cancelled. Start a new quote to bring this deal back.` Bring the deal back with **Save as new quote** or **Duplicate**. Do not flip the status.
9. Type at least two letters and pick a customer, or tap **+ Add “…” as a new customer**. App-added rows are tagged **New, not in QuickBooks yet**. An unknown name still saves on the quote without a list row.
10. **Saved Quotes** has a search box (`Search Q number or customer`). It filters the live unsold list by the Q number or the customer. A piece of either is enough. No match says `No quotes match.` It does not search parts. **Search all quotes** still opens Find. The builder has **Add a part**. Two characters of a part number or a name show up to eight matches. A tap adds the line. The toast names the quote: `Added ZZ-TEST to Q-L00001`, or `Added ZZ-TEST to the new quote` when there is no number yet. The box stays dim until settings are ready. Opening a quote counts. A slower open stops when a newer **Edit** or **New quote** has started. The reload that reopens the last quote does the same, so it will not wipe that newer quote. The newest one stays on screen. Saving an Accepted quote while the status box is still Accepted, when the lines differ from the saved lines (part, qty, or price), sets it back to Open and says `Lines changed, so Q-… is back to Open. Mark it Accepted again once the customer agrees.` A change that does not touch the lines leaves it Accepted. The open quote's id stays on the phone. A reload opens that same quote and keeps the same number. Unsaved line edits come back when nobody else saved it: `Reopened with your unsaved line changes. Save to update it.` If another phone saved it, those lines are kept: `This quote changed on another phone. Your unsaved line edits weren't kept.` A sold or cancelled quote does not restore the unsaved lines. If it cannot be opened, the builder is cleared and the toast is `Couldn't reopen the last quote. Open it again from Saved Quotes.`

New quote numbers look like `Q-L00001` or `Q-S00001` and are taken on the first Save. New invoice numbers look like `I-L00001` or `I-S00001` and are taken at Approve. A packing list takes no number. Old `PL-2026-001` rows stay in the packing list tables. The working cart stays in the browser until **Save quote** or **Invoice…** (Invoice… saves the quote first). **New quote** and a successful **Approve** empty that cart. Quote, packing list, and draft invoice do not change inventory qty. **Approve** does. If that save fails, no number is used.

A database error keeps a known sale sentence exactly (`Q-… is cancelled…`, `I-L… is approved…` (or `I-S…`, or an older `INV-…`), a short shelf, `Only N on hand…`, `Enter how many to remove — 1 or more.`, `Enter how many to add — 1 or more.`, `This invoice has no customer…`, `Quote changed since INV-… was printed. Save & print before Approve`, `Couldn't approve — try again`, `Not deleted. This part is on open quote Q-…. Remove it from that quote first.`, pick a company first, no longer on the shelf list, can't be deleted, keeps its number, the company is locked, invoice numbers only at Approve). Other database text is not shown. An unknown save says `Couldn't save — try again`. An unknown load says `Couldn't load — try again`.

**Find Quotes** and **Find Invoices** are two Home tiles side by side under the stats row. Each area starts fresh on every entry: empty search, no dates, no list, no open document. **Back** returns one screen. On an open document it returns one document at a time (a quote's invoice, then that quote, then the list), then to the screen Find was opened from. Search text, dates, a list, or an open document in one area does not show in the other. Find quotes searches a Q- number, a customer, or a part on the lines. Find invoices searches an invoice number, a customer, or a part on the lines. A part match uses the part number or the name. Dashes, spaces and capitals don't matter. Find Invoices includes drafts, including a draft with no number yet. Cancelled quotes are included. A piece of the number, name, or part is enough. `schema/bl3a_find_by_part.sql` is run once in the Supabase SQL editor after this build is on Pages and every phone has hard-refreshed. It is safe to re-run. It reads only. The merge does not run it. Until that SQL has run, Find adds `Search needs an update. Only numbers and customers were searched.` and still searches numbers and customers. The list says `Searching…` as soon as Find is tapped, and a slow older search does not replace a newer one. Opening a row says `Opening…` right away. An empty search with no dates lists nothing. Empty results say `No quotes match.` or `No invoices match.` **Last 7 days** and **From–To** use America/Chicago. Last 7 is Chicago today and the six days before it. A quote is dated by `created_at`, then `quote_date`, then `updated_at`. An invoice is dated by `invoice_date`, or by `approved_at` when that stamp is the sale day. Typed search and date browse show about 50 newest. More than that says `Narrow the dates.` A typed search with no dates says `Narrow the search.` Opening a match stays on Find until **Open**. **Open** is on a live unsold quote (Open, Sent, or Accepted, and no approved invoice). It loads that quote in the builder, and **Back** returns to the Find document. A quote lists each of its invoices as a button (the number, or —, plus the status). An invoice's quote number is a button back to that quote. **Reprint** and **Dup** stay on a quote. An approved invoice in Find Invoices also has **Packing list** next to Reprint. The quote builder has no Packing list button. A quote, a draft invoice, and an invoice with no I- number do not show it. There is no Approve on Find. A quote there has no Void button. An approved invoice whose number starts with I- can be voided. **Reprint** opens the document to look at and does not open the print dialog. **Packing list** opens the print dialog with that invoice's I- number and `From quote`. It takes no number and writes nothing. The packing list paper shows a plain Ship to block (with the I- number and From quote) in the top-right quarter, so it shows through the packing list pouch when the sheet is folded in thirds and then in half; it prints at 100% scale. **Print quote** and **Save & print invoice** still open the print dialog. **Reprint** of a quote shows that saved quote (QUOTE, Quote #, Quote date, Valid Until, Quoted total, no Status line) and does not change the open quote form. It has no Invoice #, no Amount due, and no DRAFT stamp. **Reprint** of an invoice uses the same invoice as **Save & print** and does not write a row. An approved invoice reprint shows the stored header and lines, with no DRAFT stamp. A draft invoice reprint shows the DRAFT stamp and `Draft — number at Approve`, and does not say `Draft — current rows`. A quote that already sold reprints the quote. Open the invoice in Find Invoices for the sold paper. A cancelled quote hides Reprint and shows `Q-… is cancelled. Start a new quote to bring this deal back.` A draft invoice on that cancelled quote hides Reprint and shows `Q-… is cancelled. This invoice can't be approved.` An approved invoice can still be reprinted after its quote is cancelled. **Dup** makes a new draft from the quote, or from the invoice's parent quote. Nothing here stores a PDF.

---

## 4b. Pricing (list → sell / buy)

- **Wynn** list is £ GBP. **FFS** list is € EUR. **Alu Design** list is kr NOK. Everything else is $ USD.
- **Sell $** = list × sell factor, then **rounded up to the next $5**.
- **Buy $** = list × **exchange rate** × 0.70 (minus 30%). Not the sell factor.
- **More → Global sell factors** apply sell $. **Exchange rates** (GBP / EUR / NOK) apply buy $. Fetch uses `api.frankfurter.dev` (the old `.app` URL 301s without CORS). You can still type rates.
- Same part # can have **new** qty (valued) and **used/salvage** qty (not valued). Scan asks which one to issue. Home **+/−** changes new qty only.

---

## 5. Reports

- **Inventory at Cost** = Σ (new qty × buy). Used/salvage is excluded.
- **At Sell Price** / **Potential Margin** (new qty)
- **Adjustment report**
- **Price history** and **Ending inventory (FIFO or LIFO)** — needs Phase 3 SQL
- **Needs attention:** Low only if reorder level is set above 0

---

## Tips

- Unlock on that phone before changing stock or saving quotes. Stamps use the signed-in person.
- Leave Est. Delivery blank when unknown — “Needs Delivery Date” flags it.
- Use source/category chips and Home tiles to narrow the list.
- Export JSON from More before large imports or clears.
- Hosted on GitHub Pages; **inventory and saved quotes live in Supabase** (realtime). Closing a chat session does not delete them. An unsaved quote cart stays in that browser until Save. The open quote is remembered on that phone and reopens with the same number. Count is shelved, so there is no count draft.

---

## Physical count (phone)

Count is shelved. **`count.html`** only redirects to the shop home (`?view=dashboard`). It cannot read or write stock. [`COUNT.md`](COUNT.md) keeps the old walk-through as history.

---

*Last updated: 2026-11-20 — #41–#46. Older notes are in git log.*
*2026-11-25 — Packing list pouch shows a bold PACKING LIST line above Ship to (ship-to height budget 144px). Edit Part hides Clear; Add Part still shows it. Valid Until shows the whole-day count from the quote Date, and Save quote, Save as new quote, and Save & print invoice ask before any number or row write when Valid Until is more than 180 days after that date.*
