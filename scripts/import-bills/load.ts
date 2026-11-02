// Step 2 of the old-bill import: sends bills.json to the database through the import_sales_invoices function.
// Needs two environment variables (put them in .env.local, never commit them):
//   NEXT_PUBLIC_SUPABASE_URL   (already there)
//   SUPABASE_SERVICE_ROLE_KEY  (Supabase > Project settings > API > service_role. Server-side secret!)
//
//   npm run import:load                       load private-data/out/bills.json (skips bills already imported)
//   npm run import:load -- --dry-run          show what would be sent, change nothing
//   npm run import:load -- --replace          re-import: overwrite earlier IMPORTED bills (never app bills)
//   npm run import:load -- --relink           only re-link imported bills to customers/products added since
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const file = args.find((a) => !a.startsWith('--') && a.endsWith('.json')) ?? 'private-data/out/bills.json';
const label = (() => { const i = args.indexOf('--label'); return i >= 0 ? args[i + 1] : `Old bills import ${new Date().toISOString().slice(0, 10)}`; })();

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const dry = flag('--dry-run');
  if (!dry && (!url || !key)) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them to .env.local and run through npm run import:load.');
    process.exit(1);
  }
  const db = dry ? null : createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });

  if (flag('--relink')) {
    const { data, error } = await db!.rpc('relink_imported_bills');
    if (error) throw new Error(error.message);
    console.log('Relinked:', data);
    return;
  }

  if (!fs.existsSync(file)) { console.error(`Not found: ${file}. Run npm run import:extract first.`); process.exit(1); }
  const { bills } = JSON.parse(fs.readFileSync(file, 'utf8')) as { bills: Record<string, unknown>[] };
  console.log(`${bills.length} bills in ${file}${dry ? ' (dry run, nothing is sent)' : ''}`);
  if (dry || bills.length === 0) return;

  const batch = await db!.from('import_batches').insert({ label }).select('id').single();
  if (batch.error) throw new Error(`Could not start the import batch: ${batch.error.message}`);
  const batchId = batch.data.id as string;

  const total = { inserted: 0, replaced: 0, skipped_existing: 0, skipped_app_bills: 0 };
  const errors: unknown[] = [], conflicts: unknown[] = [];
  const unmatchedC = new Set<string>(), unmatchedP = new Set<string>();
  const SIZE = 25;
  for (let i = 0; i < bills.length; i += SIZE) {
    const chunk = bills.slice(i, i + SIZE).map(({ financial_year: _fy, printed_total: _pt, ...b }) => b);
    const { data, error } = await db!.rpc('import_sales_invoices', { p: chunk, p_batch_id: batchId, p_replace: flag('--replace') });
    if (error) throw new Error(`Chunk starting at bill ${i + 1} failed: ${error.message}`);
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += Number(data[k] ?? 0);
    errors.push(...(data.errors ?? [])); conflicts.push(...(data.conflicts ?? []));
    (data.unmatched_customers ?? []).forEach((x: string) => unmatchedC.add(x));
    (data.unmatched_products ?? []).forEach((x: string) => unmatchedP.add(x));
    process.stdout.write(`\r${Math.min(i + SIZE, bills.length)}/${bills.length}`);
  }
  console.log('\n', total);
  const summary = { ...total, errors: errors.length, conflicts: conflicts.length, unmatched_customers: [...unmatchedC], unmatched_products: [...unmatchedP] };
  await db!.from('import_batches').update({ summary }).eq('id', batchId);
  if (errors.length) { console.log('\nBills the database rejected (nothing else was affected):'); console.table(errors); }
  if (conflicts.length) { console.log('\nSkipped because an app-created bill already uses that number:'); console.table(conflicts); }
  if (unmatchedC.size) console.log(`\nCustomers not linked to a saved party (${unmatchedC.size}). Add them in the app, or add an alias for a different spelling, then run: npm run import:load -- --relink\n  ${[...unmatchedC].sort().join('\n  ')}`);
  if (unmatchedP.size) console.log(`\nItems not in the product list (${unmatchedP.size}), kept as typed on the bill:\n  ${[...unmatchedP].sort().join('\n  ')}`);
  console.log(`\nBatch ${batchId} recorded. Next number for new bills is set in Settings: make sure it is above your latest bill number of the current financial year.`);
}
main().catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}`); process.exit(1); });
