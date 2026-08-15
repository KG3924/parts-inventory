# Physical count tool (phone / iPad)

Fast shelf count for the parts room. It is **not** the live inventory app. When you finish, export JSON and import it in the web app.

| | |
|--|--|
| Tool | `count.html` — after a push: https://kg3924.github.io/parts-inventory/count.html |
| Catalog | `count-seed.json` — known part # / name / source / category / prices (lookup only) |
| Live app | https://kg3924.github.io/parts-inventory/ → **More → Import JSON** |

---

## Prepare the iPad (do this once, on Wi‑Fi)

**Best path:** put the tool on GitHub Pages, then open it in Safari. Opening a local HTML file from the Files app is clumsy on iPad.

### A. Get the files onto Pages (Mac)

In the project folder the two files are:

- `count.html`
- `count-seed.json`

They are **not live yet** until they are committed and pushed to `main`. After that push, on the iPad open:

`https://kg3924.github.io/parts-inventory/count.html`

(Pages can take 1–2 minutes to update. Hard-refresh if you still see the old site.)

### B. First launch on the iPad (Safari)

1. Open the URL above in **Safari** (not a Files preview).
2. Confirm search finds known parts (try `belt` or `1588`). If search is empty, tap **Load catalog file…** and choose `count-seed.json` (AirDrop or Files).
3. **Add to Home Screen:** Share → **Add to Home Screen** → name it `Parts count`. Use that icon in the warehouse so Safari does not lose the tab.
4. Leave the iPad on this same Safari profile. Drafts are saved **in this browser only**. Clearing Safari data or using Private mode will lose the count.

### C. Optional: same Wi‑Fi from your Mac (if not using Pages)

On the Mac, in the project folder:

```bash
cd "/Users/kylegrantham/Inmar Parts Inventory"
python3 -m http.server 8000
```

On the iPad, open `http://YOUR-MAC-LAN-IP:8000/count.html`. Fine for a test; Pages is better for a real walk-through.

---

## During the count

1. Tap **Rename** → e.g. `Parts room 2026-08-14`.
2. Search a name or part # → tap the match → enter **shelf qty** → **Save line**.  
   Catalog / live-app **name, notes, source, category, location, and prices** fill in so you can keep or edit them. Shelf **qty** is always what you type (old app qty is shown only as a reference).
3. **+ New part** for something not in the catalog (`Generic, specific…`, no spaces in the part #).
4. On any saved line, tap **Edit** to change name, qty, source, prices, or notes. Searching a part already in the count opens that line to edit.
4. Draft **auto-saves**. Tap **Save draft** if you want a confirmation toast.
5. You can lock the iPad or switch apps. Re-open the Home Screen icon and the draft should still be there.

Do **not** use Private Browsing. Do **not** clear Safari history/website data until you have exported.

---

## When you are finished

1. On the iPad, tap **Export JSON**. Safari saves a file like `Parts_room_2026-08-14.json` (Files → Downloads, or the share sheet).
2. Get that file to wherever you import from (AirDrop to Mac, iCloud Drive, email to yourself).
3. Open the **live inventory app**: https://kg3924.github.io/parts-inventory/
4. Select **your name** in the header (required).
5. **More → Import JSON** → pick the exported file.
6. Confirm the import. The app **creates new part numbers only**.

**Existing part numbers in Supabase are skipped.** Qty on those rows is **not** updated. Use this export to load a **clean** list (empty database, or only PNs that are not already in the app). If the 609 old rows are still live and you want this count to be the new truth, export a backup from **More** first, then **Clear all inventory…**, then import the count JSON.

7. Spot-check Home: names, sources, qtys. Then print labels from the **Labels** tab when you are ready.
8. Keep the exported JSON as the archive of that count. You can **Clear this count…** on the iPad after you know the import succeeded (two confirms). That only wipes the iPad draft.

---

## If something goes wrong

| Problem | What to do |
|---------|------------|
| Search finds nothing | Load `count-seed.json` via **Load catalog file…**, or confirm you opened the Pages URL not a Files preview |
| Draft disappeared | Wrong browser / Private mode / Safari data cleared. No server copy exists |
| Import added 0 / skipped all | Those part numbers already exist in the live app |
| Export button does nothing | Add at least one saved line; fix any red validation on the line first |

## Naming (enforced)

`Generic, specific, more specific…`

| Good | Bad |
|------|-----|
| `Blade, Artic 800mm` | `800mm Articulated Blade` |
| `Motor, Parv 65, 115VAC` | `Wynn Motor 65` |
| `Belt, Vee A52` | `A52 V-belt` |

Pick the **generic type** from the list (or add one on purpose). The tool blocks names that start with a brand (Wynn, FFS, Siemens, …).

Label tip: keep names ≤ **32** characters when you can. Longer names save but get clipped on DK-1201 labels.

## Part numbers (enforced)

- Required, unique in this count
- **No spaces** (stripped as you type)
- Max **40** characters (same as the web app form)
- Placeholders must include `PLACEHOLDER` if the real PN is unknown (web app convention)

## Export JSON (web app import)

Array of objects. Fields the live app already accepts:

```json
[
  {
    "part_number": "1279-553-800",
    "name": "Blade, Artic 800mm",
    "qty": 4,
    "reorder_level": 5,
    "source": "Wynn",
    "category": "Blade",
    "location": "Shelf A-3",
    "buy_price": null,
    "sell_price": 163.22,
    "notes": null,
    "exclude_from_valuation": false,
    "list_price": 63.14,
    "list_currency": "GBP"
  }
]
```

Optional extras the app ignores if columns are missing: `list_price`, `list_currency`, `exclude_from_valuation`.  
`barcode` is omitted — the web app generates a stable label ID on import.

`qty` is **what you counted**. Old spreadsheet quantities are never written into the export.

## Catalog vs your count

`count-seed.json` is built from:

- `Wynn Master Catalog 2026.xlsx` (2026 Hepworth prices when matched)
- `Consolidated Parts Inventory.xlsx` (names / sources / categories)

If the catalog name disagrees with an old sheet, the form shows a **note** and you choose. Nothing is overwritten silently.

Old sheet qty is **not** trusted. You always type the shelf count.

## Offline

After the catalog has loaded once (or you picked the seed file), search and draft work without a network. Export still just downloads a file.

## Clear

**Clear this count…** wipes the draft on this device only (two confirms). It does not touch Supabase or the live app.
