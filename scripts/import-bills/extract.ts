// Step 1 of the old-bill import. Reads every .xlsx/.xlsm under a folder (default: oldbills/) and writes
//   private-data/out/bills.json          bills ready for load.ts
//   private-data/out/import-report.csv   one row per sheet: OK / WARN / ERROR / SKIPPED / DUPLICATE
//   private-data/out/customers-found.csv every customer name seen, with bill counts (use it to spot typos)
// It never touches the database. Run:  npm run import:extract -- oldbills
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { parseSheet, type ParsedBill } from './parse';

const args = process.argv.slice(2);
const inputArg = args.find((a) => !a.startsWith('--')) ?? 'oldbills';
const outDir = (() => { const i = args.indexOf('--out'); return i >= 0 ? args[i + 1] : 'private-data/out'; })();

function listWorkbooks(p: string): string[] {
  if (!fs.existsSync(p)) { console.error(`Not found: ${p}`); process.exit(1); }
  if (fs.statSync(p).isFile()) return [p];
  const out: string[] = [];
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    if (e.isDirectory()) out.push(...listWorkbooks(full));
    else if (/\.(xlsx|xlsm)$/i.test(e.name) && !e.name.startsWith('~$')) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
const csv = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function main() {
  const files = listWorkbooks(inputArg);
  const bills: ParsedBill[] = [];
  const report: string[][] = [['file', 'sheet', 'invoice_no', 'date', 'customer', 'lines', 'total', 'status', 'notes']];
  const seen = new Map<string, string>();
  let sheets = 0, errors = 0, warned = 0, dupes = 0, skipped = 0;

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.readFile(file); }
    catch (e) { errors++; report.push([rel, '', '', '', '', '', '', 'ERROR', `Could not open workbook: ${(e as Error).message}`]); continue; }
    for (const ws of wb.worksheets) {
      sheets++;
      const res = parseSheet(ws, path.basename(file));
      if (res.kind === 'skipped') { skipped++; report.push([rel, ws.name, '', '', '', '', '', 'SKIPPED', res.reason]); continue; }
      if (res.kind === 'error') { errors++; report.push([rel, ws.name, '', '', '', '', '', 'ERROR', res.error]); continue; }
      const b = res.bill;
      const key = `${b.financial_year}-${b.invoice_no}`;
      if (seen.has(key)) {
        dupes++;
        report.push([rel, ws.name, String(b.invoice_no), b.invoice_date, b.customer_name, String(b.items.length), String(b.total), 'DUPLICATE', `Same invoice number and financial year as ${seen.get(key)}; this copy was left out.`]);
        continue;
      }
      seen.set(key, `${path.basename(file)}#${ws.name}`);
      bills.push(b);
      if (b.warnings.length) warned++;
      report.push([rel, ws.name, String(b.invoice_no), b.invoice_date, b.customer_name, String(b.items.length), String(b.total), b.warnings.length ? 'WARN' : 'OK', b.warnings.join(' | ')]);
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  bills.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.invoice_no - b.invoice_no);
  fs.writeFileSync(path.join(outDir, 'bills.json'), JSON.stringify({ generated_at: new Date().toISOString(), source: inputArg, bills }, null, 1));
  fs.writeFileSync(path.join(outDir, 'import-report.csv'), report.map((r) => r.map(csv).join(',')).join('\n') + '\n');
  const byName = new Map<string, { n: number; total: number }>();
  for (const b of bills) { const x = byName.get(b.customer_name) ?? { n: 0, total: 0 }; x.n++; x.total += b.total; byName.set(b.customer_name, x); }
  fs.writeFileSync(path.join(outDir, 'customers-found.csv'),
    'customer_name,bills,total\n' + [...byName].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${csv(k)},${v.n},${v.total}`).join('\n') + '\n');

  const dates = bills.map((b) => b.invoice_date).sort();
  console.log(`Files: ${files.length}   sheets: ${sheets}   bills ready: ${bills.length}   with warnings: ${warned}   errors: ${errors}   duplicates: ${dupes}   not bills: ${skipped}`);
  if (bills.length) {
    console.log(`Dates: ${dates[0]} to ${dates[dates.length - 1]}   grand total: ₹${bills.reduce((t, b) => t + b.total, 0).toLocaleString('en-IN')}   distinct customers: ${byName.size}`);
    const fys = [...new Set(bills.map((b) => b.financial_year))].sort();
    for (const fy of fys) {
      const list = bills.filter((b) => b.financial_year === fy), nos = list.map((b) => b.invoice_no);
      console.log(`  FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}: ${list.length} bills, numbers ${Math.min(...nos)} to ${Math.max(...nos)}`);
    }
  }
  console.log(`Wrote ${outDir}/bills.json, import-report.csv, customers-found.csv. Read the report before loading.`);
  if (errors) console.log('Bills with ERROR were NOT included. Fix those sheets (or send them to me) and run extract again.');
}
main().catch((e) => { console.error(e); process.exit(1); });
