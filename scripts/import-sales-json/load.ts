// Imports Claude-produced sales JSON into the existing sales import RPC.
// Run with the service-role key only from the terminal:
//   npm run import:sales-json -- --dry-run
//   npm run import:sales-json
//   npm run import:sales-json -- --replace

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

type JsonItem = {
  description?: unknown;
  hsn?: unknown;
  gst_rate?: unknown;
  quantity?: unknown;
  rate?: unknown;
};

type JsonBill = {
  invoice_no?: unknown;
  invoice_date?: unknown;
  challan_no?: unknown;
  po_no?: unknown;
  customer?: { name?: unknown; gstin?: unknown; address1?: unknown; address2?: unknown };
  items?: JsonItem[];
  totals?: { subtotal?: unknown; cgst?: unknown; sgst?: unknown; round_off?: unknown; total?: unknown };
  warnings?: unknown;
  source_reference?: unknown;
};

const input = process.argv.find((a) => a.endsWith('.json')) ?? 'private-data/import/sales/sales-bills-2026-27.json';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const replace = args.includes('--replace');
const MIN_NEW_NUMBER = 5605;
const chunkSize = 25;

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function numberValue(value: unknown, field: string, billNo: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`Bill ${billNo}: ${field} must be a number.`);
  return n;
}

function textValue(value: unknown): string | null {
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

function dateValue(value: unknown, billNo: number): string {
  const date = textValue(value);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`Bill ${billNo}: invoice_date must be YYYY-MM-DD.`);
  }
  return date;
}

function normalizeBill(source: JsonBill) {
  const invoiceNo = numberValue(source.invoice_no, 'invoice_no', 0);
  if (!Number.isInteger(invoiceNo) || invoiceNo <= 0) throw new Error('Every invoice_no must be a positive integer.');
  const date = dateValue(source.invoice_date, invoiceNo);
  if (!Array.isArray(source.items) || source.items.length === 0) throw new Error(`Bill ${invoiceNo}: items must not be empty.`);

  const customerName = textValue(source.customer?.name);
  if (!customerName) throw new Error(`Bill ${invoiceNo}: customer.name is required.`);
  const totals = source.totals ?? {};
  const warnings = Array.isArray(source.warnings) ? source.warnings.map(String) : [];

  const items = source.items.map((item, index) => {
    const description = textValue(item.description);
    if (!description) throw new Error(`Bill ${invoiceNo}, item ${index + 1}: description is required.`);
    const gst = numberValue(item.gst_rate ?? 0, 'items.gst_rate', invoiceNo);
    const qty = numberValue(item.quantity, 'items.quantity', invoiceNo);
    const rate = numberValue(item.rate, 'items.rate', invoiceNo);
    const amount = Math.round(qty * rate * 100) / 100;
    const tax = Math.round(amount * gst / 100 * 100) / 100;
    const cgst = Math.round(tax / 2 * 100) / 100;
    const sgst = Math.round((tax - cgst) * 100) / 100;
    return {
      position: index + 1,
      description,
      hsn: textValue(item.hsn),
      gst,
      qty,
      rate,
      amount,
      cgst,
      sgst,
      total: Math.round((amount + cgst + sgst) * 100) / 100,
    };
  });

  return {
    invoice_no: invoiceNo,
    invoice_date: date,
    challan_no: textValue(source.challan_no),
    po_no: textValue(source.po_no),
    customer_name: customerName,
    customer_gstin: textValue(source.customer?.gstin),
    customer_address1: textValue(source.customer?.address1),
    customer_address2: textValue(source.customer?.address2),
    subtotal: numberValue(totals.subtotal, 'totals.subtotal', invoiceNo),
    cgst: numberValue(totals.cgst ?? 0, 'totals.cgst', invoiceNo),
    sgst: numberValue(totals.sgst ?? 0, 'totals.sgst', invoiceNo),
    round_off: numberValue(totals.round_off ?? 0, 'totals.round_off', invoiceNo),
    total: numberValue(totals.total, 'totals.total', invoiceNo),
    status: 'final',
    source_file: textValue(source.source_reference) ?? `claude-sales-${invoiceNo}`,
    warnings,
    items,
  };
}

async function main() {
  if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);
  const parsed = JSON.parse(fs.readFileSync(input, 'utf8')) as { schema_version?: string; bills?: JsonBill[] };
  if (parsed.schema_version !== 'sales-bills-v1') throw new Error('Expected schema_version sales-bills-v1.');
  if (!Array.isArray(parsed.bills)) throw new Error('Expected a bills array.');

  const bills = parsed.bills.map(normalizeBill).sort((a, b) => a.invoice_no - b.invoice_no);
  const numbers = new Set<number>();
  for (const bill of bills) {
    if (numbers.has(bill.invoice_no)) throw new Error(`Duplicate invoice number in JSON: ${bill.invoice_no}.`);
    numbers.add(bill.invoice_no);
    if (bill.invoice_no >= MIN_NEW_NUMBER) throw new Error(`Invoice #${bill.invoice_no} is reserved for new app bills; historical JSON must end before ${MIN_NEW_NUMBER}.`);
  }
  const max = bills.at(-1)?.invoice_no ?? 0;
  console.log(`${bills.length} sales bills validated; range #${bills[0]?.invoice_no ?? '-'}–#${max}.`);
  if (dryRun) { console.log('Dry run: nothing was sent to Supabase.'); return; }
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const batch = await db.from('import_batches').insert({ label: 'Claude sales JSON import 2026-27' }).select('id').single();
  if (batch.error) throw new Error(`Could not start import batch: ${batch.error.message}`);
  const batchId = batch.data.id as string;
  const total = { inserted: 0, replaced: 0, skipped_existing: 0, skipped_app_bills: 0 };
  const errors: unknown[] = [], conflicts: unknown[] = [];
  const unmatchedCustomers = new Set<string>(), unmatchedProducts = new Set<string>();

  for (let i = 0; i < bills.length; i += chunkSize) {
    const chunk = bills.slice(i, i + chunkSize);
    const result = await db.rpc('import_sales_invoices', { p: chunk, p_batch_id: batchId, p_replace: replace });
    if (result.error) throw new Error(`Import failed near bill ${chunk[0].invoice_no}: ${result.error.message}`);
    for (const field of Object.keys(total) as (keyof typeof total)[]) total[field] += Number(result.data?.[field] ?? 0);
    errors.push(...(result.data?.errors ?? []));
    conflicts.push(...(result.data?.conflicts ?? []));
    for (const name of result.data?.unmatched_customers ?? []) unmatchedCustomers.add(name);
    for (const name of result.data?.unmatched_products ?? []) unmatchedProducts.add(name);
    process.stdout.write(`\rImported ${Math.min(i + chunkSize, bills.length)}/${bills.length}`);
  }

  const nextNo = Math.max(MIN_NEW_NUMBER, max + 1);
  const setting = await db.from('business').update({ next_invoice_no: nextNo }).eq('id', 1);
  if (setting.error) throw new Error(`Bills imported, but next invoice number was not updated: ${setting.error.message}`);
  const summary = { ...total, errors: errors.length, conflicts: conflicts.length, unmatched_customers: [...unmatchedCustomers], unmatched_products: [...unmatchedProducts], next_invoice_no: nextNo };
  await db.from('import_batches').update({ summary }).eq('id', batchId);
  console.log(`\nImport complete:`, total);
  console.log(`Next new invoice number: ${nextNo}`);
  if (errors.length) console.table(errors);
  if (conflicts.length) console.table(conflicts);
  if (unmatchedCustomers.size) console.log(`Unlinked customers: ${[...unmatchedCustomers].join(', ')}`);
  if (unmatchedProducts.size) console.log(`Unlinked products: ${[...unmatchedProducts].join(', ')}`);
  console.log(`Batch: ${batchId}`);
}

main().catch((error) => { console.error(`\n${error instanceof Error ? error.message : error}`); process.exit(1); });
