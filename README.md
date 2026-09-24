# Parts Inventory – Remote Web App (Supabase)

**Live app:** [https://kg3924.github.io/parts-inventory/](https://kg3924.github.io/parts-inventory/)

Phone-friendly inventory tracker for **In-Mar Systems** with live remote access, barcode scanning, labels, quotes, and basic reports.

**Labels use QR codes** that deep-link into the app (`?part=` + stable label ID). The printed part number is human-readable text; the QR stays valid when name/part # change.

---

## Features (live)

| Area | What it does |
|------|----------------|
| **Home** | Live list; search; source + category chips; tiles; **+/−** on new qty; **Adjust** (Scan, New vs Used); Quote / Edit / Del |
| **Scan** | Camera or type part # → review → pick **New or Used** → **Commit** stock in/out/set; **Quote** and **Edit part** |
| **Add / Edit** | Name, part #, qty new + used, reorder (default 0), buy/sell, source/category/location dropdowns, notes, open order |
| **Quote** | Cart + saved quotes: **customer vs project**, RFQ #, FOB, payment terms, lead time, 90-day validity, prepared-by = logged-in user; **Print quote**, **Packing list**, **Invoice**; free-text customer with optional save |
| **Reports** | Valuation (new qty only); adjustment log; **price history**; **LIFO/FIFO ending inventory**; needs-attention |
| **Labels** | **QR deep-link** labels (stable ID in URL) → phone Camera opens app to that part; Brother DK-1201 or letter paper (8/sheet) |
| **More** | Export/Import JSON; sell factors; **GBP/EUR/NOK exchange rates** (fetch or type); FIFO/LIFO; setup SQL; clear all |
| **Physical count** | Separate phone tool: [`count.html`](count.html) — walk the room, export JSON, import here. See [`COUNT.md`](COUNT.md) |

**Sign-in:** Glynn Grantham, Kyle Grantham, Toby Whitfield, Grant Adams, and Ricky Whitfield each have their own login. Unlock once on that phone for a 12-hour shift. The phone’s saved password (Face ID, Touch ID, or fingerprint) fills the next unlock. There is no name dropdown. Prepared By and the adjustment log use only the signed-in person. **Sign out** is in the header. **More → Passwords** sets a new password for any of the five. They save it again on their phone.

The public anon key is in `public-config.js`. Never commit a service-role key.

### Database lock

`schema/auth_lock_after_merge.sql` is **already applied** on the live database. Unsigned requests cannot read or change stock. Do not recreate open “anyone can edit” policies. More → Copy SQL only adds columns and tables, and grants them to signed-in users.

**Theme:** Light (white background)

---

## Required files on GitHub Pages

| File | Purpose |
|------|---------|
| `index.html` | The app (includes Supabase URL + anon key) |
| `inmar-logo.jpg` | Logo used on quotes / packing lists / invoices |
| `count.html` | Physical count tool |
| `count-seed.json` | Catalog lookup for the count tool |

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
- Wipe and restart: **More → Clear all inventory…** (type `DELETE ALL`). Export a backup first.

---

## 3. Labels (QR deep-links)

Labels use a **QR code** that opens the live app with a query parameter, e.g.  
`https://kg3924.github.io/parts-inventory/?part=IMXXXXXXXX`

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

1. Add lines from Home or Scan with **Quote**.
2. On the **Quote** tab fill: **Customer** (separate from **Project**), RFQ #, dates (valid until defaults to **+90 days**), FOB (Origin / Destination / type-and-save), payment terms (can be stored on the customer), lead time, prepared by (defaults to whoever is logged in).
3. **Save quote** stores it in Supabase (after Phase 1 SQL). New header fields need **Phase 2 SQL**.
4. **Print quote** — branded offer. **Packing list** — items + qty only (`PL-YYYY-###`). **Invoice…** — adds PO, ship-to, due date (from quote valid-until), shipping/duty/tariffs, optional CC fee (`INV-YYYY-###`).
5. Open from the saved list to edit; **Void** instead of delete.
6. Optional: check **Also save this customer**.

Document numbers: `Q-2026-001`, `PL-2026-001`, `INV-2026-001`. The working cart is still in the browser until you save; **none of these documents change inventory qty**.

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
- Hosted on GitHub Pages; **inventory and saved quotes live in Supabase** (realtime). Closing a chat session does not delete them. Unsaved quote carts and count drafts stay in that browser until you save/export.

---

## Physical count (phone)

Use **`count.html`** in the parts room (iPhone / iPad). It asks for the same sign-in and still does not write stock. Draft stays on the device. **Export JSON** → this app **More → Import JSON**.

- Names: `Generic, specific…` (enforced). Part #s: no spaces, max 40.
- Catalog lookup: `count-seed.json` (Wynn 2026 prices + consolidated names). Old qtys are not imported.
- Existing part numbers in Supabase are **skipped** on import — use a clean DB or only new PNs.

Details: [`COUNT.md`](COUNT.md).

---

*Last updated: 2026-09-24 — live lock is applied. More → Copy SQL does not recreate open policies.*
