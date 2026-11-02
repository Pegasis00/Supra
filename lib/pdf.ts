import type { Business, Invoice, InvoiceItem } from './types';
import { dmy, inr, plain, r2, words } from './money';

const L = 10, R = 200, W = 190, MID = 105;
const COLS = [12, 48, 14, 12, 12, 18, 22, 16, 16, 20]; // widths in mm, total 190
const ROW = 6.7;

// Builds the A4 invoice (same layout as the Excel version). Runs in the browser.
export async function buildInvoiceDoc(inv: Invoice, items: InvoiceItem[], biz: Business) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setLineWidth(0.2);
  doc.setDrawColor(0);

  const text = (s: string, x: number, y: number, o: { b?: boolean; size?: number; align?: 'left' | 'center' | 'right' } = {}) => {
    doc.setFont('helvetica', o.b ? 'bold' : 'normal');
    doc.setFontSize(o.size ?? 9);
    doc.text(s, x, y, { align: o.align ?? 'left' });
  };

  // Title
  text('TAX INVOICE', MID, 15.5, { b: true, size: 13, align: 'center' });
  doc.line(L, 18, R, 18);

  // Seller (left) and invoice details (right)
  text(biz.name, L + 2, 26, { b: true, size: 16 });
  text(biz.address1 ?? '', L + 2, 32);
  text(biz.address2 ?? '', L + 2, 36.5);
  text(`Mob: ${biz.phone ?? ''}`, L + 2, 41);
  text(`GSTIN: ${biz.gstin ?? ''}`, L + 2, 46, { b: true });
  text(`PAN: ${biz.pan ?? ''}`, L + 2, 50.5, { b: true });
  const meta: [string, string][] = [
    ['Invoice No :', String(inv.invoice_no)], ['Date :', dmy(inv.invoice_date)],
    ['Challan No :', inv.challan_no ?? ''], ['P.O. No. :', inv.po_no ?? ''],
  ];
  meta.forEach(([a, b], i) => { text(a, MID + 3, 26 + i * 6, { b: true }); text(b, MID + 33, 26 + i * 6); });
  doc.line(L, 53, R, 53);

  // Buyer (left) and bank (right)
  text('Buyer (Bill To)', L + 2, 58, { b: true });
  text(inv.customer_name, L + 2, 65, { b: true, size: 12 });
  text(inv.customer_address1 ?? '', L + 2, 71);
  text(inv.customer_address2 ?? '', L + 2, 75.5);
  if (inv.customer_gstin) text(`GSTIN: ${inv.customer_gstin}`, L + 2, 80, { b: true });
  text('Company Bank Details', MID + 3, 58, { b: true });
  const bank: [string, string][] = [
    ['Bank Name :', biz.bank_name ?? ''], ['A/C No. :', biz.bank_account ?? ''], ['IFSC :', biz.bank_ifsc ?? ''],
  ];
  bank.forEach(([a, b], i) => { text(a, MID + 3, 65 + i * 6, { b: true }); text(b, MID + 33, 65 + i * 6); });
  doc.line(MID, 18, MID, 83);
  doc.line(L, 83, R, 83);

  // Items: vertical lines only, padded to 20 rows like the Excel sheet
  const body: string[][] = items.map((it, i) => [
    String(i + 1), it.description, it.hsn ?? '', plain(it.gst), plain(it.qty),
    inr(it.rate), inr(it.amount), inr(it.cgst), inr(it.sgst), inr(it.total),
  ]);
  while (body.length < 20) body.push(['', '', '', '', '', '', '', '', '', '']);
  const colStyles: Record<number, object> = {};
  COLS.forEach((w, i) => { colStyles[i] = { cellWidth: w, halign: i === 1 ? 'left' : i < 5 ? 'center' : 'right' }; });
  const common = {
    margin: { left: L, right: 210 - R }, tableWidth: W, columnStyles: colStyles, theme: 'plain' as const,
    styles: { font: 'helvetica', fontSize: 8.5, textColor: 0, cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 }, minCellHeight: ROW, lineColor: 0 },
  };
  autoTable(doc, {
    ...common, startY: 83,
    head: [['Sr No', 'Description', 'HSN', 'GST %', 'Qty', 'Rate', 'Amount', 'CGST', 'SGST', 'Total Amount']],
    headStyles: { fontStyle: 'bold', halign: 'center', fillColor: [255, 255, 255], textColor: 0, lineWidth: 0.2, lineColor: 0, fontSize: 8, minCellHeight: 8 },
    body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawCell: (d: any) => {
      if (d.section !== 'body') return;
      doc.setLineWidth(0.2);
      doc.line(d.cell.x, d.cell.y, d.cell.x, d.cell.y + d.cell.height);
      if (d.column.index === COLS.length - 1) doc.line(d.cell.x + d.cell.width, d.cell.y, d.cell.x + d.cell.width, d.cell.y + d.cell.height);
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y: number = (doc as any).lastAutoTable.finalY;

  // Totals
  const qtySum = items.reduce((s, i) => s + Number(i.qty), 0);
  const b = (c: string, h: 'left' | 'right' | 'center' = 'right', size = 8.5) => ({ content: c, styles: { fontStyle: 'bold' as const, halign: h, fontSize: size } });
  const ro = Number(inv.round_off);
  autoTable(doc, {
    ...common, startY: y, theme: 'grid',
    styles: { ...common.styles, lineWidth: 0.2 },
    body: [
      ['', b('Total'), '', '', b(plain(r2(qtySum)), 'center'), '', b(inr(inv.subtotal)), b(inr(inv.cgst)), b(inr(inv.sgst)), b(inr(inv.subtotal + inv.cgst + inv.sgst))],
      ['', { content: 'Round off', styles: { halign: 'right' } }, '', '', '', '', '', '', '', { content: (ro > 0 ? '+' : '') + ro.toFixed(2), styles: { halign: 'right' } }],
      ['', b('Grand Total', 'right', 10), '', '', '', '', '', '', '', b(inr(inv.total), 'right', 10)],
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY;

  // Amount in words, declaration, signature
  text('Amount in words:', L + 2, y + 5, { b: true });
  text(words(inv.total), L + 2, y + 10.5, { b: true });
  y += 13;
  doc.line(L, y, R, y);
  text('Declaration', L + 2, y + 5, { b: true });
  text('We declare that this invoice shows the actual price of the goods', L + 2, y + 10);
  text('described and that all particulars are true and correct.', L + 2, y + 14.5);
  text(`For ${biz.name}`, 155, y + 5, { b: true, align: 'center' });
  text('Proprietor', 155, y + 26, { b: true, align: 'center' });
  y += 28;

  doc.setLineWidth(0.6);
  doc.rect(L, 10, W, y - 10);

  if (inv.status === 'cancelled') {
    doc.setTextColor(190);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(64);
    doc.text('CANCELLED', MID, 160, { align: 'center', angle: 35 });
    doc.setTextColor(0);
  }
  return doc;
}

export async function buildInvoicePdf(inv: Invoice, items: InvoiceItem[], biz: Business): Promise<Blob> {
  return (await buildInvoiceDoc(inv, items, biz)).output('blob');
}
