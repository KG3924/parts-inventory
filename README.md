# Parts Inventory – Remote Web App (Supabase)

**Live app:** [https://kg3924.github.io/parts-inventory/](https://kg3924.github.io/parts-inventory/)

Phone-friendly inventory tracker for In-Mar Systems with live remote access, barcode scanning, open-order tracking, inventory valuation, batch label printing, and a branded quote builder.

**No new part numbers are created.**  
Your real alphanumeric part numbers are encoded directly as **Code 128** barcodes.

---

## Features

| Area | What it does |
|------|----------------|
| **Home** | Live list, search, **source + category filter chips**, badges, quick +/−, cost value, Open Order flags, **Delete**, **Add to Quote** |
| **Scan** | Phone camera or type part number → review → **Commit change** (stock in / out / set) |
| **Add** | Full form: Source, **Category**, Buy/Sell price, location, notes, Open Order |
| **Quote** | Build multi-line quotes, edit qty & unit price, generate branded printable quote with In-Mar logo |
| **Reports** | Inventory at Cost, At Sell Price, Potential Margin, items needing attention |
| **Labels** | Batch-select parts → print labels sized for **Brother DK-1201** (1.1″ × 3.5″) |
| **More** | Export / Import JSON, connection status |

**Users (required before changes):** Toby, Glynn, Ricky, Grant, Kyle — select in the header; stamps `updated_by` on saves, qty adjusts, scan commits, deletes, and imports.

**Theme:** Light (white background)

---

## Required files on GitHub Pages

| File | Purpose |
|------|---------|
| `index.html` | The app (must contain your real Supabase URL + anon key) |
| `inmar-logo.jpg` | Logo used on generated quotes |

Upload both to the root of this repo so Pages can serve them.

---

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor** run:

```sql
create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  part_number text unique not null,
  qty integer not null default 0,
  reorder_level integer default 5,
  buy_price numeric(12,2),
  sell_price numeric(12,2),
  source text,
  category text,
  location text,
  notes text,
  open_order boolean default false,
  date_ordered date,
  estimated_delivery date,
  ordered_qty integer,
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter publication supabase_realtime add table inventory;

-- Simple open policy for trusted internal use
create policy "Allow all for anon" on inventory
  for all using (true) with check (true);

-- If the table already exists without category:
alter table inventory add column if not exists category text;
create index if not exists inventory_category_idx on inventory (category);
create index if not exists inventory_source_idx on inventory (source);
```

3. **Project Settings → API** → copy Project URL and `anon` public key.
4. Paste them into `index.html` near the top of the `<script>` block:

```js
const SUPABASE_URL = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
```

---

## 2. Importing spreadsheet data

Use **More → Import JSON**.

JSON format (array of objects):

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
- Existing part numbers are **skipped** (safe to re-import).
- Use `PLACEHOLDER` in the name or part number for items that still need a real part # — search “placeholder” later to find them.
- No spaces in part numbers.
- To wipe the database and start fresh: **More → Clear all inventory…** (type `DELETE ALL`). Export a backup first.

---

## 3. Printing labels (Brother DK-1201)

Labels are sized for **Brother DK-1201** die-cut labels:

- **Size:** 1.1 in high × 3.5 in wide (29 mm × 90.3 mm)

1. Labels tab → select parts → **Generate Selected Labels** → **Print Now**
2. In the print dialog:
   - Printer = your Brother QL
   - Paper / media = **DK-1201** (or custom 3.5″ × 1.1″)
   - Scale = **100%** (do not fit to page)
   - Uncheck **Headers and footers**
3. Each label is its own page so the printer advances one label at a time until the batch is finished.

Each label shows: **Name** (truncated if long), **barcode (Code 128 of the real part number)**, **part number text**.

---

## 4. Quote builder

1. On Home, click the purple **Quote** button on any part (uses Sell Price as default unit price when available).
2. Open the **Quote** tab.
3. Adjust quantities and unit prices, fill customer / project / notes.
4. **Generate Quote** opens a print-ready window with the In-Mar logo and company details. Print or Save as PDF.

Quote cart is stored in the browser (survives refresh).

---

## Inventory valuation (Reports tab)

- **Inventory at Cost** = Σ (Qty × Buy Price) — balance-sheet style asset value
- **At Sell / Retail Value** = Σ (Qty × Sell Price)
- **Potential Gross Margin** = Sell Value − Cost Value

---

## Tips

- Leave Est. Delivery blank when unknown — the red “Needs Delivery Date” badge reminds everyone.
- Use source filter chips on Home to keep the list uncluttered.
- Delete obsolete parts with the red **Del** button (asks for confirmation).
- Export JSON from More as a backup before big imports.
- Hosted on GitHub Pages; all data lives in your Supabase project (real-time across devices).
