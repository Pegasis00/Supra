// Reads one invoice sheet from the Supra Marketing Excel template and turns it into a bill the database accepts.
// Pure parsing: no network, no database. The numbers are recomputed with the SAME formulas the app uses
// (lib/money.ts), and any difference from what was printed in the sheet is recorded as a warning.
import ExcelJS from 'exceljs';
import { calcLine, r2 } from '../../lib/money';

export type ParsedItem = {
  position: number; description: string; hsn: string; gst: number; qty: number; rate: number;
  amount: number; cgst: number; sgst: number; total: number;
};
export type ParsedBill = {
  invoice_no: number; invoice_date: string; financial_year: number;
  challan_no: string | null; po_no: string | null;
  customer_name: string; customer_gstin: string | null; customer_address1: string | null; customer_address2: string | null;
  subtotal: number; cgst: number; sgst: number; round_off: number; total: number;
  status: 'final'; source_file: string; warnings: string[]; printed_total: number | null; items: ParsedItem[];
};
export type SheetResult =
  | { kind: 'bill'; bill: ParsedBill }
  | { kind: 'error'; sheet: string; error: string }
  | { kind: 'skipped'; sheet: string; reason: string };

type Cell = ExcelJS.Cell;

function raw(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return raw((o.result ?? null) as ExcelJS.CellValue);   // formula: use its cached value
    if ('richText' in o) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return o.text;                                           // hyperlink
    if ('error' in o) return null;
    return null;
  }
  return v;
}
const text = (c: Cell): string => { const v = raw(c.value); return v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim(); };
const numOf = (c: Cell): number | null => {
  const v = raw(c.value);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const x = Number(v.replace(/[,₹\s]/g, '')); return Number.isFinite(x) ? x : null; }
  return null;
};
// exceljs drops a formula's cached result when it is 0 (the file has <v>0</v>, the library returns no result).
// For the GST % column a formula with no readable result therefore means 0, which is also what every product has.
const gstOf = (c: Cell): number | null => {
  const v = c.value as unknown as Record<string, unknown> | null;
  if (v && typeof v === 'object' && !(v instanceof Date) && ('formula' in v || 'sharedFormula' in v) && !('result' in v)) return 0;
  return numOf(c);
};
const norm = (s: string) => s.toLowerCase().replace(/[\s:.]+/g, '');
const pad = (n: number) => String(n).padStart(2, '0');

function dateOf(c: Cell): string | null {
  const v = raw(c.value);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  if (typeof v === 'string') {
    const s = v.trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);      // day-first, as written in India
    if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  }
  return null;
}
const fyOf = (iso: string) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return m >= 4 ? y : y - 1; };
const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());

export function parseSheet(ws: ExcelJS.Worksheet, fileLabel: string): SheetResult {
  const sheet = ws.name;
  const maxRow = Math.min(ws.rowCount, 400);

  // Is this an invoice sheet at all?
  let isInvoice = false;
  for (let r = 1; r <= 8 && !isInvoice; r++) isInvoice = /tax\s*invoice/i.test(text(ws.getCell(r, 2)));
  if (!isInvoice) return { kind: 'skipped', sheet, reason: 'No "TAX INVOICE" heading in the first rows (not a bill sheet).' };

  // Header fields are found by their labels, so a row or two of drift does not break the parse.
  const labelValue = (label: string): Cell | null => {
    for (let r = 1; r <= 14; r++) if (norm(text(ws.getCell(r, 7))) === norm(label)) return ws.getCell(r, 9);
    return null;
  };
  const noCell = labelValue('Invoice No'), dateCell = labelValue('Date');
  if (!noCell || !dateCell) return { kind: 'error', sheet, error: 'Could not find the "Invoice No" / "Date" labels.' };

  const warnings: string[] = [];
  const noText = text(noCell);
  let invoiceNo = /^\d+$/.test(noText) ? Number(noText) : NaN;
  if (Number.isNaN(invoiceNo)) {
    const m = noText.match(/(\d+)\s*$/);
    if (m) { invoiceNo = Number(m[1]); warnings.push(`Invoice number "${noText}" was read as ${invoiceNo}.`); }
  }
  if (!Number.isInteger(invoiceNo) || invoiceNo <= 0) return { kind: 'error', sheet, error: `Invoice number "${noText}" is not a positive whole number.` };
  const invoiceDate = dateOf(dateCell);
  if (!invoiceDate) return { kind: 'error', sheet, error: `Invoice date "${text(dateCell)}" could not be read.` };

  const challanCell = labelValue('Challan No'), poCell = labelValue('P.O. No');

  // Buyer block: "Buyer (Bill To)" then name, two address lines, GSTIN formula.
  let buyerRow = 0;
  for (let r = 1; r <= 14; r++) if (/^buyer/i.test(text(ws.getCell(r, 2)))) { buyerRow = r; break; }
  if (!buyerRow) return { kind: 'error', sheet, error: 'Could not find the "Buyer (Bill To)" block.' };
  const customerName = text(ws.getCell(buyerRow + 1, 2));
  if (!customerName) return { kind: 'error', sheet, error: 'Customer name is blank.' };
  let gstin: string | null = blankToNull(text(ws.getCell(buyerRow + 4, 2)).replace(/^gstin\s*:?\s*/i, '')) ;
  if (gstin) { gstin = gstin.toUpperCase().replace(/\s+/g, ''); if (gstin.length !== 15) warnings.push(`GSTIN "${gstin}" is not 15 characters.`); }

  // Item table: header row has "Sr No" in column B; the "Total" label sits in column C below the items.
  let headerRow = 0, totalRow = 0;
  for (let r = 1; r <= 40; r++) if (norm(text(ws.getCell(r, 2))) === 'srno') { headerRow = r; break; }
  if (!headerRow) return { kind: 'error', sheet, error: 'Could not find the item table header ("Sr No").' };
  for (let r = headerRow + 1; r <= maxRow; r++) if (norm(text(ws.getCell(r, 3))) === 'total') { totalRow = r; break; }
  if (!totalRow) return { kind: 'error', sheet, error: 'Could not find the "Total" row under the items.' };

  const items: ParsedItem[] = [];
  for (let r = headerRow + 1; r < totalRow; r++) {
    const desc = text(ws.getCell(r, 3));
    const qty = numOf(ws.getCell(r, 6)), rate = numOf(ws.getCell(r, 7));
    if (!desc && qty == null && rate == null) continue;                       // empty template row
    if (!desc) return { kind: 'error', sheet, error: `Row ${r} has numbers but no description.` };
    if (qty == null || qty <= 0) return { kind: 'error', sheet, error: `Row ${r} ("${desc}") has no usable quantity.` };
    if (rate == null || rate < 0) return { kind: 'error', sheet, error: `Row ${r} ("${desc}") has no usable rate (formula without a saved value?).` };
    let gst = gstOf(ws.getCell(r, 5));
    if (gst == null) { gst = 0; warnings.push(`Row ${r}: GST % was empty, taken as 0.`); }
    if (gst < 0 || gst > 28) return { kind: 'error', sheet, error: `Row ${r} ("${desc}") has GST ${gst}%, outside 0 to 28.` };
    const hsn = text(ws.getCell(r, 4)) || '4820';
    const line = calcLine(qty, rate, gst);
    const printed = numOf(ws.getCell(r, 11));
    if (printed != null && Math.abs(printed - line.total) > 0.005) {
      warnings.push(`Row ${r} ("${desc}"): sheet line total ${printed} differs from recomputed ${line.total}.`);
    }
    items.push({ position: items.length + 1, description: desc, hsn, gst, qty, rate, ...line });
  }
  if (items.length === 0) return { kind: 'error', sheet, error: 'The bill has no item rows.' };

  const subtotal = r2(items.reduce((t, i) => t + i.amount, 0));
  const cgst = r2(items.reduce((t, i) => t + i.cgst, 0));
  const sgst = cgst;
  const exact = r2(subtotal + cgst + sgst);
  const total = Math.round(exact);
  const roundOff = r2(total - exact);

  const printedTotal = numOf(ws.getCell(totalRow + 2, 11));
  if (printedTotal != null && Math.abs(printedTotal - total) > 0.005) {
    warnings.push(`Printed grand total ${printedTotal} differs from recomputed ${total}; the recomputed figure was stored.`);
  }
  if (printedTotal == null) warnings.push('Grand total had no saved value in the sheet; the recomputed figure was stored.');

  return {
    kind: 'bill',
    bill: {
      invoice_no: invoiceNo, invoice_date: invoiceDate, financial_year: fyOf(invoiceDate),
      challan_no: challanCell ? blankToNull(text(challanCell)) : null,
      po_no: poCell ? blankToNull(text(poCell)) : null,
      customer_name: customerName, customer_gstin: gstin,
      customer_address1: blankToNull(text(ws.getCell(buyerRow + 2, 2))),
      customer_address2: blankToNull(text(ws.getCell(buyerRow + 3, 2))),
      subtotal, cgst, sgst, round_off: roundOff, total, status: 'final',
      source_file: `${fileLabel}#${sheet}`, warnings, printed_total: printedTotal, items,
    },
  };
}
