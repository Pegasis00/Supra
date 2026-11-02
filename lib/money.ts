// Same rounding as the database function (round half away from zero, 2 decimals).
export const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
export const n = (s: string | number | null | undefined) => Number(s) || 0;

export const inr = (x: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);

export function calcLine(qty: number, rate: number, gst: number) {
  const amount = r2(qty * rate);
  const half = r2((amount * gst) / 200);
  return { amount, cgst: half, sgst: half, total: r2(amount + 2 * half) };
}

export const dmy = (iso: string) => iso.split('-').reverse().join('-');
export const plain = (x: number) => String(Number(x));

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (x: number) => (x < 20 ? ONES[x] : TENS[Math.floor(x / 10)] + (x % 10 ? ' ' + ONES[x % 10] : ''));

// Indian system: Crore, Lakh, Thousand, Hundred.
export function words(total: number): string {
  const v = Math.round(total);
  if (v <= 0) return '';
  const parts: string[] = [];
  const crore = Math.floor(v / 1e7), lakh = Math.floor((v % 1e7) / 1e5), thou = Math.floor((v % 1e5) / 1e3);
  const hund = Math.floor((v % 1e3) / 100), rest = v % 100;
  if (crore) parts.push(two(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thou) parts.push(two(thou) + ' Thousand');
  if (hund) parts.push(ONES[hund] + ' Hundred');
  if (rest) parts.push(two(rest));
  return 'Rupees ' + parts.join(' ') + ' Only';
}
