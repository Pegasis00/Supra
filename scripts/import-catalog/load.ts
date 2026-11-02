// Applies the catalog normalization JSON to Supabase.
// Dry run first:
//   npm run import:catalog -- --dry-run
// Then apply:
//   npm run import:catalog

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

type CustomerInput = { canonical_name: string; gstin?: string | null; address1?: string | null; address2?: string | null; aliases?: string[] };
type ProductInput = { canonical_name: string; hsn?: string | null; rate?: number; gst?: number; track_stock?: boolean; aliases?: string[] };
type Party = { id: string; name: string; kind: string; gstin: string | null; address1: string | null; address2: string | null };
type Product = { id: string; name: string; hsn: string; rate: number; gst: number; track_stock: boolean; active: boolean };

const explicitFile = process.argv.find((arg) => arg.endsWith('.json'));
const defaultCatalogDir = 'private-data/import/catalog';
const defaultFile = `${defaultCatalogDir}/name-normalization-2026-27.json`;
const file = explicitFile ?? (fs.existsSync(defaultFile)
  ? defaultFile
  : fs.readdirSync(defaultCatalogDir).find((name) => name.endsWith('.json'))
    ? `${defaultCatalogDir}/${fs.readdirSync(defaultCatalogDir).find((name) => name.endsWith('.json'))}`
    : defaultFile);
const dryRun = process.argv.includes('--dry-run');
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const keyOf = (value: unknown) => String(value ?? '').trim().toLowerCase();
// Used only to match existing catalog rows to the supplied normalization file.
// It deliberately handles the known historical spelling/punctuation noise,
// while the stored/displayed name remains exactly the JSON canonical name.
const partyIdentityKey = (value: unknown) => keyOf(value)
  .replace(/mayureshwar/g, 'mayuresh')
  .replace(/depo\b/g, 'depot')
  .replace(/stationers\b/g, 'stationery')
  .replace(/[^a-z0-9]/g, '');
const text = (value: unknown) => { const v = String(value ?? '').trim(); return v || null; };
const unique = (values: string[]) => [...new Map(values.filter((v) => v.trim()).map((v) => [keyOf(v), v.trim()])).values()];

function validate(input: { customers?: CustomerInput[]; products?: ProductInput[] }) {
  if (!Array.isArray(input.customers) || !Array.isArray(input.products)) throw new Error('JSON must contain customers and products arrays.');
  const errors: string[] = [];
  for (const group of [['customer', input.customers], ['product', input.products] ] as const) {
    const seen = new Set<string>();
    for (const row of group[1]) {
      if (!row.canonical_name?.trim()) errors.push(`${group[0]} has an empty canonical_name.`);
      const canonical = keyOf(row.canonical_name);
      if (seen.has(canonical)) errors.push(`Duplicate ${group[0]} canonical name: ${row.canonical_name}`);
      seen.add(canonical);
    }
  }
  const productOwners = new Map<string, string>();
  for (const row of input.products) for (const alias of unique(row.aliases ?? [])) {
    const previous = productOwners.get(keyOf(alias));
    // Ambiguous old spellings are reported and skipped during import.
    productOwners.set(keyOf(alias), row.canonical_name);
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

async function main() {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const input = JSON.parse(fs.readFileSync(file, 'utf8')) as { schema_version?: string; customers?: CustomerInput[]; products?: ProductInput[] };
  if (input.schema_version !== 'catalog-normalization-v1') throw new Error('Expected schema_version catalog-normalization-v1.');
  validate(input);
  const customers = input.customers!; const products = input.products!;
  const ambiguousProductAliases = new Set<string>();
  const productAliasOwners = new Map<string, string>();
  for (const row of products) for (const alias of unique(row.aliases ?? [])) {
    const aliasKey = keyOf(alias); const previous = productAliasOwners.get(aliasKey);
    if (previous && previous !== row.canonical_name) ambiguousProductAliases.add(aliasKey);
    else productAliasOwners.set(aliasKey, row.canonical_name);
  }
  console.log(`Validated ${customers.length} customers and ${products.length} products from ${file}.`);
  if (dryRun) { console.log('Dry run: nothing was sent to Supabase.'); return; }
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [partyRows, partyAliasRows, productRows, productAliasRows] = await Promise.all([
    db.from('parties').select('id,name,kind,gstin,address1,address2'),
    db.from('party_aliases').select('id,party_id,alias'),
    db.from('products').select('id,name,hsn,rate,gst,track_stock,active'),
    db.from('product_aliases').select('id,product_id,alias'),
  ]);
  for (const result of [partyRows, partyAliasRows, productRows, productAliasRows]) if (result.error) throw new Error(result.error.message);
  const parties = (partyRows.data ?? []) as Party[]; const partyAliases = (partyAliasRows.data ?? []) as { id: string; party_id: string; alias: string }[];
  const catalogProducts = (productRows.data ?? []) as Product[]; const productAliases = (productAliasRows.data ?? []) as { id: string; product_id: string; alias: string }[];
  const partyByName = new Map(parties.map((row) => [keyOf(row.name), row]));
  const productByName = new Map(catalogProducts.map((row) => [keyOf(row.name), row]));
  const partyAliasByName = new Map(partyAliases.map((row) => [keyOf(row.alias), row]));
  const productAliasByName = new Map(productAliases.map((row) => [keyOf(row.alias), row]));
  const customerIds = new Map<string, string>(); const productIds = new Map<string, string>();
  const conflicts: string[] = [];

  for (const row of customers) {
    const aliases = unique(row.aliases ?? []);
    const aliasMatch = aliases.map((alias) => partyAliasByName.get(keyOf(alias))).find(Boolean);
    const namedAliasMatch = aliases.map((alias) => partyByName.get(keyOf(alias))).find(Boolean);
    const identityCandidates = parties.filter((party) => partyIdentityKey(party.name) === partyIdentityKey(row.canonical_name));
    const gstCandidates = row.gstin ? parties.filter((party) => keyOf(party.gstin) === keyOf(row.gstin)) : [];
    const identityMatch = identityCandidates.length === 1 ? identityCandidates[0] : undefined;
    const gstMatch = gstCandidates.length === 1 ? gstCandidates[0] : undefined;
    const existing = partyByName.get(keyOf(row.canonical_name)) ?? namedAliasMatch ?? (aliasMatch ? partyByName.get(aliasMatch.party_id) : undefined) ?? identityMatch ?? gstMatch;
    const values = { name: row.canonical_name.trim(), kind: existing?.kind === 'supplier' ? 'both' : (existing?.kind ?? 'customer'), gstin: text(row.gstin)?.toUpperCase() ?? null, address1: text(row.address1), address2: text(row.address2) };
    if (!existing) {
      const created = await db.from('parties').insert(values).select('id').single();
      if (created.error) throw new Error(`Customer ${row.canonical_name}: ${created.error.message}`);
      customerIds.set(keyOf(row.canonical_name), created.data.id);
    } else {
      const updated = await db.from('parties').update(values).eq('id', existing.id);
      if (updated.error) throw new Error(`Customer ${row.canonical_name}: ${updated.error.message}`);
      customerIds.set(keyOf(row.canonical_name), existing.id);
    }
    const partyId = customerIds.get(keyOf(row.canonical_name))!;
    partyByName.set(keyOf(row.canonical_name), { ...existing, id: partyId, ...values } as Party);
    for (const alias of aliases) {
      const old = partyAliasByName.get(keyOf(alias));
      if (old && old.party_id !== partyId) { conflicts.push(`Customer alias "${alias}" already belongs to another customer.`); continue; }
      if (!old && keyOf(alias) !== keyOf(row.canonical_name)) {
        const inserted = await db.from('party_aliases').insert({ party_id: partyId, alias });
        if (inserted.error && inserted.error.code !== '23505') throw new Error(`Customer alias ${alias}: ${inserted.error.message}`);
        partyAliasByName.set(keyOf(alias), { id: inserted.data?.[0]?.id ?? '', party_id: partyId, alias });
      }
    }
  }

  for (const row of products) {
    const aliases = unique(row.aliases ?? []);
    const aliasMatch = aliases.map((alias) => productAliasByName.get(keyOf(alias))).find(Boolean);
    const namedAliasMatch = aliases.map((alias) => productByName.get(keyOf(alias))).find(Boolean);
    const existing = productByName.get(keyOf(row.canonical_name)) ?? namedAliasMatch ?? (aliasMatch ? catalogProducts.find((item) => item.id === aliasMatch.product_id) : undefined);
    const values = { name: row.canonical_name.trim(), hsn: text(row.hsn) ?? '4820', rate: Number(row.rate ?? 0), gst: Number(row.gst ?? 0), track_stock: Boolean(row.track_stock), active: true };
    if (!existing) {
      const created = await db.from('products').insert(values).select('id').single();
      if (created.error) throw new Error(`Product ${row.canonical_name}: ${created.error.message}`);
      productIds.set(keyOf(row.canonical_name), created.data.id);
    } else {
      const updated = await db.from('products').update(values).eq('id', existing.id);
      if (updated.error) throw new Error(`Product ${row.canonical_name}: ${updated.error.message}`);
      productIds.set(keyOf(row.canonical_name), existing.id);
    }
    const productId = productIds.get(keyOf(row.canonical_name))!;
    productByName.set(keyOf(row.canonical_name), { ...existing, id: productId, ...values } as Product);
    for (const alias of aliases) {
      if (ambiguousProductAliases.has(keyOf(alias))) { conflicts.push(`Product alias "${alias}" is assigned to multiple products and was skipped.`); continue; }
      const old = productAliasByName.get(keyOf(alias));
      if (old && old.product_id !== productId) { conflicts.push(`Product alias "${alias}" already belongs to another product.`); continue; }
      if (!old && keyOf(alias) !== keyOf(row.canonical_name)) {
        const inserted = await db.from('product_aliases').insert({ product_id: productId, alias });
        if (inserted.error && inserted.error.code !== '23505') throw new Error(`Product alias ${alias}: ${inserted.error.message}`);
        productAliasByName.set(keyOf(alias), { id: inserted.data?.[0]?.id ?? '', product_id: productId, alias });
      }
    }
  }

  // A duplicate can itself be named like an alias (for example the old
  // K'Sagar rows). In that case the canonical row must absorb its references
  // before the stale-row cleanup below evaluates it.
  for (const row of customers) {
    const targetId = customerIds.get(keyOf(row.canonical_name));
    if (!targetId) continue;
    const namesToConsolidate = unique([...(row.aliases ?? []), row.canonical_name]);
    const aliasKeys = new Set(namesToConsolidate.map(keyOf));
    for (const alias of namesToConsolidate) {
      const duplicate = parties.find((party) => party.id !== targetId && (keyOf(party.name) === keyOf(alias) || (partyIdentityKey(party.name) === partyIdentityKey(row.canonical_name) && !aliasKeys.has(keyOf(party.name)))));
      if (!duplicate) continue;
      const sales = await db.from('sales_invoices').update({ customer_id: targetId }).eq('customer_id', duplicate.id);
      if (sales.error) throw new Error(`Could not consolidate customer ${duplicate.name}: ${sales.error.message}`);
      const purchases = await db.from('purchase_bills').update({ supplier_id: targetId }).eq('supplier_id', duplicate.id);
      if (purchases.error) throw new Error(`Could not consolidate supplier ${duplicate.name}: ${purchases.error.message}`);
      const removed = await db.from('parties').delete().eq('id', duplicate.id);
      if (removed.error) throw new Error(`Could not remove duplicate customer ${duplicate.name}: ${removed.error.message}`);
      console.log(`Consolidated duplicate customer row: ${duplicate.name} -> ${row.canonical_name}`);
    }
  }

  const relink = await db.rpc('relink_imported_bills');
  if (relink.error) throw new Error(`Catalog saved, but bill relinking failed: ${relink.error.message}`);
  console.log('Bill links refreshed:', relink.data);
  const warnings = await db.rpc('clear_resolved_import_warnings');
  if (warnings.error) throw new Error(`Catalog saved, but resolved warnings could not be cleared: ${warnings.error.message}`);
  console.log('Resolved import warnings cleared:', warnings.data);

  // Relinking sets foreign keys. These updates also make the visible bill
  // snapshots and bill_json use the canonical catalog names.
  for (const row of customers) {
    const partyId = customerIds.get(keyOf(row.canonical_name));
    if (!partyId) continue;
    const values = { customer_name: row.canonical_name.trim(), customer_gstin: text(row.gstin)?.toUpperCase() ?? null, customer_address1: text(row.address1), customer_address2: text(row.address2) };
    const sales = await db.from('sales_invoices').update(values).eq('customer_id', partyId);
    if (sales.error) throw new Error(`Could not update bills for ${row.canonical_name}: ${sales.error.message}`);
    const purchases = await db.from('purchase_bills').update({ supplier_name: row.canonical_name.trim(), supplier_gstin: text(row.gstin)?.toUpperCase() ?? null, supplier_address: [text(row.address1), text(row.address2)].filter(Boolean).join(' ') || null }).eq('supplier_id', partyId);
    if (purchases.error) throw new Error(`Could not update purchase bills for ${row.canonical_name}: ${purchases.error.message}`);
  }
  for (const row of products) {
    const productId = productIds.get(keyOf(row.canonical_name));
    if (!productId) continue;
    const sales = await db.from('sales_invoice_lines').update({ description: row.canonical_name.trim(), hsn: text(row.hsn) ?? '4820' }).eq('product_id', productId);
    if (sales.error) throw new Error(`Could not update sales lines for ${row.canonical_name}: ${sales.error.message}`);
    const purchases = await db.from('purchase_bill_lines').update({ description: row.canonical_name.trim(), hsn: text(row.hsn) ?? '4820' }).eq('product_id', productId);
    if (purchases.error) throw new Error(`Could not update purchase lines for ${row.canonical_name}: ${purchases.error.message}`);
  }
  const [salesBills, purchaseBills] = await Promise.all([
    db.from('sales_invoices').select('id').eq('source', 'excel_import'),
    db.from('purchase_bills').select('id'),
  ]);
  if (salesBills.error || purchaseBills.error) throw new Error(salesBills.error?.message ?? purchaseBills.error?.message);
  const stamp = new Date().toISOString();
  if (salesBills.data?.length) {
    const refreshed = await db.from('sales_invoice_lines').update({ updated_at: stamp }).in('invoice_id', salesBills.data.map((row) => row.id));
    if (refreshed.error) throw new Error(`Could not refresh sales JSON snapshots: ${refreshed.error.message}`);
  }
  if (purchaseBills.data?.length) {
    const refreshed = await db.from('purchase_bill_lines').update({ updated_at: stamp }).in('purchase_bill_id', purchaseBills.data.map((row) => row.id));
    if (refreshed.error) throw new Error(`Could not refresh purchase JSON snapshots: ${refreshed.error.message}`);
  }

  // Remove stale catalog rows only when the normalization file does not
  // represent them and no bill/stock row references them. Referenced rows are
  // preserved so historical data can never be orphaned by a cleanup import.
  const representedPartyNames = new Set(customers.flatMap((row) => [row.canonical_name, ...(row.aliases ?? [])].map(keyOf)));
  const representedProductNames = new Set(products.flatMap((row) => [row.canonical_name, ...(row.aliases ?? [])].map(keyOf)));
  const [salesCustomers, purchaseSuppliers, salesProducts, purchaseProducts, stockProducts] = await Promise.all([
    db.from('sales_invoices').select('customer_id'),
    db.from('purchase_bills').select('supplier_id'),
    db.from('sales_invoice_lines').select('product_id'),
    db.from('purchase_bill_lines').select('product_id'),
    db.from('stock_movements').select('product_id'),
  ]);
  for (const result of [salesCustomers, purchaseSuppliers, salesProducts, purchaseProducts, stockProducts]) if (result.error) throw new Error(`Could not inspect catalog references: ${result.error.message}`);
  const referencedPartyIds = new Set([...salesCustomers.data ?? [], ...purchaseSuppliers.data ?? []].map((row: any) => row.customer_id ?? row.supplier_id).filter(Boolean));
  const referencedProductIds = new Set([...salesProducts.data ?? [], ...purchaseProducts.data ?? [], ...stockProducts.data ?? []].map((row: any) => row.product_id).filter(Boolean));
  for (const party of parties) {
    if (!representedPartyNames.has(keyOf(party.name)) && !referencedPartyIds.has(party.id)) {
      const removed = await db.from('parties').delete().eq('id', party.id);
      if (removed.error) throw new Error(`Could not remove stale customer ${party.name}: ${removed.error.message}`);
      console.log(`Removed unused customer row: ${party.name}`);
    }
  }
  for (const product of catalogProducts) {
    if (!representedProductNames.has(keyOf(product.name)) && !referencedProductIds.has(product.id)) {
      const removed = await db.from('products').delete().eq('id', product.id);
      if (removed.error) throw new Error(`Could not remove stale product ${product.name}: ${removed.error.message}`);
      console.log(`Removed unused product row: ${product.name}`);
    }
  }
  if (conflicts.length) { console.log('\nSkipped alias conflicts (these need manual merge/decision):'); console.log(conflicts.join('\n')); }
  console.log('Catalog normalization complete. Existing bill rows and JSON snapshots now use canonical names.');
}

main().catch((error) => { console.error(`\n${error instanceof Error ? error.message : error}`); process.exit(1); });
