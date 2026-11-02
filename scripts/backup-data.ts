// Exports every table to JSON so the data can never be lost with an account again.
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side secret) in .env.local.
//   npm run db:backup            -> private-data/backups/<date>/<table>.json
// private-data/ is git-ignored. Copy the folder to Google Drive / a pen drive after each run.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const TABLES = ['business', 'parties', 'party_aliases', 'products', 'product_aliases', 'import_batches', 'sales_invoices',
  'sales_invoice_lines', 'purchase_bills', 'purchase_bill_lines', 'stock_movements'];
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run via npm run db:backup).'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const dir = path.join('private-data', 'backups', new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  for (const table of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select('*').order('created_at', { ascending: true }).range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 1));
    console.log(`${table.padEnd(22)} ${rows.length} rows`);
  }
  console.log(`\nSaved to ${dir}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
