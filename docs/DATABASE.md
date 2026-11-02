# Database design

Source of truth: `supabase/migrations/`. This page explains the model and why it looks the way it does.

## Shape

```
business (1 row)                 parties ──< party_aliases
  next_invoice_no                  │  kind: customer | supplier | both
                                   │
        ┌──────────────────────────┴───────────────┐
        │ customer_id (set null)                   │ supplier_id (set null)
   sales_invoices ──< sales_invoice_lines     purchase_bills ──< purchase_bill_lines
        │ import_batch_id                           │               │
   import_batches                                   │               │ product_id (set null)
                                                    │               ▼
   products ──< product_aliases   ◄─────────────────┴──────── (lines point to products)
        ▲
        │ product_id (RESTRICT: history can't be orphaned)
   stock_movements   (append-only ledger, stock = SUM(qty_delta))

   9 read-only views (v_*) feed Ask Supra. Nothing else is readable by the chat role.
```

| Table | Holds | Key rules |
| --- | --- | --- |
| `business` | The seller on every invoice, invoice counter | Exactly one row (`id = 1`) |
| `parties` | Customers and suppliers | Name unique ignoring case and spaces |
| `party_aliases` | Other spellings of a party | Alias unique; used by lookups and the old-bill import |
| `products` | Catalog with default `rate` and `gst` | Name unique; no stock column |
| `product_aliases` | Other names of a product | Unique per product |
| `sales_invoices` | One row per bill | Number unique **per financial year**; `total = subtotal + cgst + sgst + round_off` |
| `sales_invoice_lines` | Items on a bill | `total = amount + cgst + sgst`; position unique per bill |
| `purchase_bills` / `_lines` | Supplier bills | Supplier + their bill number unique |
| `stock_movements` | Every stock change | Never updated or deleted; `qty_delta <> 0` |
| `import_batches` | One row per old-bill import run | Lets an import be audited |

## What every bill stores

| Group | Columns | Why |
| --- | --- | --- |
| Identity | `invoice_no`, `invoice_date`, `financial_year` (generated, April to March) | Numbers repeat across years, so uniqueness is `(financial_year, invoice_no)` |
| References | `challan_no`, `po_no` | Printed on the invoice |
| Customer snapshot | `customer_name`, `customer_gstin`, `customer_address1/2`, plus `customer_id` link | The snapshot is what was printed and never changes. The link only powers reports by customer |
| Money | `subtotal`, `cgst`, `sgst`, `round_off`, `total` | Stored, not recomputed, and the database checks they add up |
| Status | `status` final or cancelled | Cancelled bills stay visible and are excluded from totals |
| Provenance | `source` (`app` or `excel_import`), `source_file`, `import_warning`, `import_batch_id` | Tells old imported bills from app bills and flags anything to double-check |
| Lines | `description`, `hsn`, `gst`, `qty`, `rate`, `amount`, `cgst`, `sgst`, `total`, optional `product_id` | Each line keeps its own rate and GST; the catalog rate is only a default |

## Rules worth knowing

- **Writes go through functions.** `create_invoice`, `update_invoice`, `cancel_invoice`, `delete_invoice`, `confirm_purchase_bill`, `delete_purchase_bill`, `adjust_stock`, `clear_product_stock`, `remove_product`. The app has no direct write access to bills or stock.
- **Gap-free numbering.** `create_invoice` locks the business row, takes the next number and skips any number already used in that financial year.
- **Stock** only applies to products with `track_stock = true`. Selling more than is in stock is refused. Cancel/delete/edit write opposite ledger rows instead of changing history.
- **Old (imported) bills never touch stock**, including when edited, cancelled or deleted, because they were never part of the ledger.
- **Rounding** is identical in the app (`lib/money.ts`), the database functions and the import parser: amount = round(qty x rate, 2); CGST = SGST = round(amount x GST% / 200, 2); total rounded to a whole rupee, difference stored as `round_off`.
- **Ask Supra safety** has four layers: the TypeScript guard, text checks inside `chat_run_sql`, execution as the `chat_reader` role (views only, no tables), 3 s timeout and 200 rows.

## Old bills

```
oldbills/*.xlsx  ──npm run import:extract──►  private-data/out/bills.json + import-report.csv + customers-found.csv
                                                      │  (read the report; fix or drop bad sheets)
                                                      ▼
                          npm run import:load ──► import_sales_invoices()  (service role only)
```

What the parser reads from each invoice sheet (found by labels, not fixed cells): invoice number, date, challan, PO, buyer name, two address lines, GSTIN, and each item row (description, HSN, GST %, quantity, rate). It then **recomputes** every amount with the app's formulas and compares with what was printed; any difference becomes a warning on that bill (`import_warning`, shown as a "Check" badge) and the recomputed figure is stored so the database checks hold.

Behaviour you can rely on:

- Safe to re-run: bills already imported are skipped (`--replace` overwrites earlier *imported* bills only). A bill created in the app is never overwritten.
- A bill the database rejects fails alone; the rest still load, and the failures are listed.
- Customers are matched by exact name or alias (case-insensitive). Unmatched names are listed, the bill keeps the printed name and shows normally, and after you add the customer or an alias, `npm run import:load -- --relink` links them.
- Items not in the product list are kept as typed. Duplicate invoice numbers inside the files are reported and the later copy is left out.

In the app: **Bills** shows Year > Month folders, with counts and totals, a search box (customer, number or `2025-06`), and an "Imported" tag on old bills.

## What changed compared with the lost database

| Change | Reason |
| --- | --- |
| Invoice number unique per financial year, plus generated `financial_year` | A new April-March year can reuse numbers; also needed for 200 old bills |
| `party_aliases` table, `find_party` searches aliases | Old bills spell names differently (K'Sagar x5, Stationary/Stationery) |
| `import_batches`, `sales_invoices.import_batch_id` | Audit and undo for imports |
| `chat_reader` can read only the 9 views (no table policies) | The old setup also granted table access, which contradicted the documented design |
| Dropped legacy `parties.address` | Only `address1`/`address2` are used; the old bill page read a column that did not exist |
| Functions are locked to `authenticated` explicitly; anon has nothing | Supabase's default grants everything to anon |
| `import_sales_invoices` is service-role only | Bulk import must not be callable from the browser |

Not changed: the table and column names the app uses, all RPC names and arguments, the nine view names, every view column the app, the chat route and the chat test fixtures reference (checked by running all of them against the new database), and the bill/purchase/stock flows.
