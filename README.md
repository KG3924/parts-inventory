# Parts Inventory – Remote Web App (Supabase)

**Live app:** [https://kg3924.github.io/parts-inventory/](https://kg3924.github.io/parts-inventory/)

Phone-friendly inventory tracker for **In-Mar Systems** with live remote access, barcode scanning, labels, quotes, and basic reports.

**Labels encode a stable barcode** (short Code 128 value stored on each part). The human-readable **part number** is shown on the label but is not what the barcode encodes (unless the barcode column is missing).

---

## Features (live)

| Area | What it does |
|------|----------------|
| **Home** | Live list; search (name, part #, barcode, source, category); **source + category** filter chips; badges; clickable **Open Orders / Low / Needs Delivery Date** tiles; quick +/−; cost value; **Quote**, **Edit**, **Del** |
| **Scan** | Camera or type part # / barcode → review → **Commit** stock in/out/set; **notes** view/edit; **Quote** and **Edit part** on the result card |
| **Add / Edit** | Name, part #, qty, reorder, buy/sell, source, category, location, notes, open order (order date, est. delivery, qty ordered) |
| **Quote** | Cart (browser) + **saved quotes in Supabase** (when tables are installed): list by status, open/edit, save, duplicate, void, print branded PDF; free-text customer with optional save to **Customers** |
| **Reports** | Inventory valuation; **adjustment report** (who/when/action — needs adjustments table); items needing attention with filters (Out of Stock, Needs Delivery Date, Low, Open Orders) |
| **Labels** | Select parts → preview → **Print on Brother QL (DK-1201)** or **Print on letter paper (8 per sheet)** for shelves/laminate |
| **More** | Export/Import JSON; connection + schema status; setup SQL; clear all inventory |

**Users (required before changes):** Toby, Glynn, Ricky, Grant, Kyle — select in the header each session (not remembered after close). Stamps `updated_by` on inventory changes.

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

## 3. Labels

### Brother QL-710W + DK-1201
- Size: **1.1″ high × 3.5″ wide**
- Labels tab → select parts → **Generate preview** → **Print on Brother QL (DK-1201)**
- Print dialog: media **DK-1201**, scale **100%**, no fit-to-page, no headers/footers
- Each die-cut is its own page (print opens a clean popup so extra blank labels are not fed)

Each label shows: **name**, **Code 128 of the stable barcode**, **part number text**.

### Letter paper (shelves / laminate)
- Same preview → **Print on letter paper (8 / sheet)**
- **2×4 grid** on US Letter (~3.5″ × 2.4″ each), larger barcode for readability

---

## 4. Quotes

1. Add lines from Home or Scan with **Quote**.
2. On the **Quote** tab: fill header (customer/project, dates, prepared by, status).
3. **Save quote** stores it in Supabase (after Phase 1 SQL is run).
4. Open from the saved list to edit; **Print / PDF** for the branded layout; **Void** instead of delete.
5. Optional: check **Also save this name to Customers**.

Document numbers look like `Q-2026-001`. The working cart is still in the browser until you save; **quotes never change inventory qty**.

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

*Last updated: 2026-08-09*
