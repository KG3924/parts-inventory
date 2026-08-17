# Parts Inventory – Remote Web App (Supabase)

**Live app:** [https://kg3924.github.io/parts-inventory/](https://kg3924.github.io/parts-inventory/)

Phone-friendly inventory tracker for **In-Mar Systems** with live remote access, barcode scanning, labels, quotes, and basic reports.

**Labels use QR codes** that deep-link into the app (`?part=` + stable label ID). The printed part number is human-readable text; the QR stays valid when name/part # change.

---

## Features (live)

| Area | What it does |
|------|----------------|
| **Home** | Live list; search (name, part #, barcode, source, category); **source + category** filter chips; badges; clickable **Open Orders / Low / Needs Delivery Date** tiles; quick +/−; cost value; **Quote**, **Edit**, **Del** |
| **Scan** | Camera or type part # / barcode → review → **Commit** stock in/out/set; **notes** view/edit; **Quote** and **Edit part** on the result card |
| **Add / Edit** | Name, part #, qty, reorder, buy/sell, source, category, location, notes, open order (order date, est. delivery, qty ordered) |
| **Quote** | Cart + saved quotes: **customer vs project**, RFQ #, FOB, payment terms, lead time, 90-day validity, prepared-by = logged-in user; **Print quote**, **Packing list**, **Invoice**; free-text customer with optional save |
| **Reports** | Inventory valuation; **adjustment report** (who/when/action — needs adjustments table); items needing attention with filters (Out of Stock, Needs Delivery Date, Low, Open Orders) |
| **Labels** | **QR deep-link** labels (stable ID in URL) → phone Camera opens app to that part; Brother DK-1201 or letter paper (8/sheet) |
| **More** | Export/Import JSON; **global Wynn / FFS sell factors** (apply to all matching parts); connection + schema status; setup SQL; clear all inventory |
| **Physical count** | Separate phone tool: [`count.html`](count.html) — walk the room, export JSON, import here. See [`COUNT.md`](COUNT.md) |

**Users (required before changes):** Glynn Grantham, Kyle Grantham, Toby Whitfield, Grant Adams, Ricky Whitfield — select in the header each session (not remembered after close). Stamps `updated_by` on inventory changes and defaults **Prepared By** on quotes.

**Theme:** Light (white background)

---

## Required files on GitHub Pages

| File | Purpose |
|------|---------|
| `index.html` | The app (includes Supabase URL + anon key) |
| `inmar-logo.jpg` | Logo used on generated quotes |

---

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the setup SQL from the app (**More → Copy SQL**) or the files under `schema/` in the repo. That includes:
   - `inventory` extras (`category`, `barcode`)
   - `inventory_adjustments`
   - Phase 1 quotes: `customers`, `quotes`, `quote_lines`, `document_counters`
   - Phase 2: quote extras (project, RFQ, FOB, terms, lead time), `app_settings`, `app_lookups`, packing lists, invoices
3. **Project Settings → API** → copy Project URL and `anon` public key into `index.html` (do not overwrite existing production keys unless intentional).

Open RLS policies are used for trusted internal access (same model as the live app).

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

- Select your **user name** before importing (required).
- Existing part numbers are **skipped**.
- Optional `barcode`; if omitted and the column exists, the app generates one.
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
1. **Phone Camera app** → opens the web app → Scan screen with that part → choose action/qty → **Commit change**
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
6. Optional: check **Also save this customer (and payment terms)**.

Document numbers: `Q-2026-001`, `PL-2026-001`, `INV-2026-001`. The working cart is still in the browser until you save; **none of these documents change inventory qty**.

---

## 4b. Pricing (list → sell / buy)

- **Wynn** list is £ GBP. **FFS** list is € EUR. Everything else is $ USD.
- **Sell $** = list × sell factor, then **rounded up to the next $5** (130.01 → 135.00; 129.99 → 130.00).
- You can still change the factor on an individual item.
- **More → Global sell factors:** set Wynn and FFS, then **Apply to all Wynn / FFS parts** that have a list price.
- **Wynn buy $** auto-fills as converted list minus 30% (list × factor × 0.70). Buy stays optional on other sources.

---

## 5. Reports

- **Inventory at Cost** = Σ (Qty × Buy Price)
- **At Sell Price** / **Potential Margin**
- **Adjustment report:** Generate after the `inventory_adjustments` table exists (filters: user, dates, action)
- **Needs attention:** filter chips for out of stock, needs delivery date, low stock, open orders

---

## Tips

- Select a user every session before changing stock or saving quotes.
- Leave Est. Delivery blank when unknown — “Needs Delivery Date” flags it.
- Use source/category chips and Home tiles to narrow the list.
- Export JSON from More before large imports or clears.
- Hosted on GitHub Pages; data lives in your Supabase project (realtime across devices).

---

## Physical count (phone)

Use **`count.html`** in the parts room (iPhone / iPad). Draft stays on the device. **Export JSON** → this app **More → Import JSON**.

- Names: `Generic, specific…` (enforced). Part #s: no spaces, max 40.
- Catalog lookup: `count-seed.json` (Wynn 2026 prices + consolidated names). Old qtys are not imported.
- Existing part numbers in Supabase are **skipped** on import — use a clean DB or only new PNs.

Details: [`COUNT.md`](COUNT.md).

---

*Last updated: 2026-08-17 — global sell factors, Wynn buy auto-fill, $5 sell rounding, packing lists, invoices*
