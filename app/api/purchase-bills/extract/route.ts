import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import * as CanvasModule from '@napi-rs/canvas';
import { convert as pdfToImages } from 'pdf-img-convert';

export const runtime = 'nodejs';
const extractionModel = process.env.OPENROUTER_EXTRACTION_MODEL ?? 'nvidia/nemotron-3.5-super-vl';
const maxBytes = 10 * 1024 * 1024;
const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

export async function GET() {
  return NextResponse.json({
    nvidia: { configured: Boolean(process.env.OPENROUTER_API_KEY), model: extractionModel },
  });
}

const nullableString = (value: unknown) => value === null || typeof value === 'string';
const nullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[₹$,\s]/g, '').replace(/,/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (source[key] !== undefined) return source[key];
  return null;
}

function normalizeDate(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

function normalizeExtraction(value: unknown): unknown {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawItems = pick(source, 'items', 'line_items', 'lines', 'products');
  const items = (Array.isArray(rawItems) ? rawItems : rawItems && typeof rawItems === 'object' ? [rawItems] : []).slice(0, 500);
  const result: Record<string, unknown> = {
    supplier_name: asString(pick(source, 'supplier_name', 'supplier', 'vendor_name', 'vendor')),
    supplier_mobile: asString(pick(source, 'supplier_mobile', 'supplier_phone', 'phone', 'mobile', 'vendor_phone')),
    supplier_gstin: asString(pick(source, 'supplier_gstin', 'gstin', 'vendor_gstin')),
    supplier_address: asString(pick(source, 'supplier_address', 'address', 'vendor_address')),
    supplier_invoice_number: asString(pick(source, 'supplier_invoice_number', 'invoice_number', 'bill_number', 'bill_no', 'invoice_no')),
    purchase_date: normalizeDate(pick(source, 'purchase_date', 'bill_date', 'invoice_date', 'date')),
    purchase_order_number: asString(pick(source, 'purchase_order_number', 'po_number', 'po_no')),
    challan_number: asString(pick(source, 'challan_number', 'challan_no')),
    subtotal: asNumber(pick(source, 'subtotal', 'sub_total', 'taxable_total')),
    tax_total: asNumber(pick(source, 'tax_total', 'tax', 'total_tax', 'gst_total')),
    round_off: asNumber(pick(source, 'round_off', 'rounding')),
    grand_total: asNumber(pick(source, 'grand_total', 'total', 'invoice_total', 'bill_total')),
    items: items.map(item => {
      const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return {
        description: asString(pick(row, 'description', 'product_name', 'item_name', 'name')),
        hsn: asString(pick(row, 'hsn', 'hsn_code')),
        quantity: asNumber(pick(row, 'quantity', 'qty')),
        unit: asString(pick(row, 'unit', 'uom')),
        unit_rate: asNumber(pick(row, 'unit_rate', 'rate', 'price')),
        discount: asNumber(pick(row, 'discount', 'discount_amount', 'disc')) ?? 0,
        line_total: asNumber(pick(row, 'line_total', 'amount', 'total', 'taxable_amount')),
        gst_rate: asNumber(pick(row, 'gst_rate', 'gst', 'tax_rate')),
        cgst: asNumber(pick(row, 'cgst')),
        sgst: asNumber(pick(row, 'sgst')),
        igst: asNumber(pick(row, 'igst')),
      };
    }),
  };
  return result;
}

function validExtraction(value: unknown): value is Record<string, unknown> & { items: unknown[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const bill = value as Record<string, unknown>;
  if (!nullableString(bill.supplier_name) || !nullableString(bill.supplier_invoice_number) || !nullableString(bill.purchase_date) || !Array.isArray(bill.items) || bill.items.length > 500) return false;
  if (bill.purchase_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(bill.purchase_date as string)) return false;
  if (!['subtotal','tax_total','round_off','grand_total'].every(key => nullableNumber(bill[key]))) return false;
  return bill.items.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const line = item as Record<string, unknown>;
    return nullableString(line.description) && nullableString(line.hsn) && nullableString(line.unit) &&
      ['quantity','unit_rate','discount','line_total','gst_rate','cgst','sgst','igst'].every(key => nullableNumber(line[key]));
  });
}

const extractionPrompt = 'Read this supplier bill and return ONLY compact valid JSON. Copy only visible facts; never guess; use null when absent. Date: YYYY-MM-DD. Preserve printed taxes. Fields: supplier_name, supplier_mobile, supplier_gstin, supplier_address, supplier_invoice_number, purchase_date, purchase_order_number, challan_number, items[{description,hsn,quantity,unit,unit_rate,discount,line_total,gst_rate,cgst,sgst,igst}], subtotal, tax_total, round_off, grand_total. Use numbers for numeric fields. No markdown, explanation, or extra keys.';

const extractionResponseFormat = { type: 'json_object' as const };

function parseModelJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { /* Some vision models wrap JSON in a sentence or code fence. */ }
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error(`Model returned no JSON object. Response: ${cleaned.slice(0, 220)}`);
  let depth = 0; let inString = false; let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(cleaned.slice(start, i + 1)); }
      catch { throw new Error(`Model returned malformed JSON. Response: ${cleaned.slice(start, Math.min(i + 1, start + 220))}`); }
    }
  }
  throw new Error(`Model returned incomplete JSON. Response: ${cleaned.slice(start, start + 220)}`);
}

async function renderFirstPdfPageAsJpeg(bytes: Buffer): Promise<Buffer> {
  const CanvasElement = (CanvasModule as unknown as { CanvasElement: { prototype: { toBuffer: (...args: any[]) => Buffer; __supraDefaultPng?: boolean } } }).CanvasElement;
  const canvasPrototype = CanvasElement.prototype as unknown as { toBuffer: (...args: any[]) => Buffer; __supraDefaultPng?: boolean };
  if (!canvasPrototype.__supraDefaultPng) {
    const originalToBuffer = canvasPrototype.toBuffer;
    canvasPrototype.toBuffer = function (type: string = 'image/png', ...args: any[]) { return originalToBuffer.call(this, type, ...args); };
    canvasPrototype.__supraDefaultPng = true;
  }
  const pages = await pdfToImages(bytes, { page_numbers: [1], scale: 2 });
  if (!pages[0]) throw new Error('This PDF has no readable first page.');
  const { loadImage, createCanvas } = CanvasModule as typeof import('@napi-rs/canvas');
  const image = await loadImage(Buffer.from(pages[0]));
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toBuffer('image/jpeg', 0.92);
}

export async function POST(req: NextRequest) {
  const authorization = req.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !allowed.has(file.type) || file.size < 1 || file.size > maxBytes)
    return NextResponse.json({ error: 'Choose a PDF, JPEG, PNG, or WebP file up to 10 MB.' }, { status: 400 });

  const key = process.env.OPENROUTER_API_KEY ?? '';
  const model = extractionModel;
  if (!key) return NextResponse.json({ error: 'NVIDIA extraction through OpenRouter is not configured. Add OPENROUTER_API_KEY on the server.' }, { status: 503 });

  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const image = file.type === 'application/pdf' ? await renderFirstPdfPageAsJpeg(bytes) : bytes;
    const mimeType = file.type === 'application/pdf' ? 'image/jpeg' : file.type;
    const openrouter = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: key, timeout: 60_000, maxRetries: 0 });
    const completionRequest = {
      model, temperature: 0.1, max_tokens: 4096,
      response_format: extractionResponseFormat,
      reasoning: { enabled: false },
      messages: [{ role: 'user', content: [
        { type: 'text', text: extractionPrompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image.toString('base64')}` } },
      ] }],
    } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
    const completion = await openrouter.chat.completions.create(completionRequest, { signal: controller.signal });
    const message = completion.choices[0]?.message;
    const content: unknown = message?.content;
    const raw = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: unknown) => part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : '').join('\n') : '';
    if (!raw) throw new Error(`Model returned no structured content${completion.choices[0]?.finish_reason ? ` (finish reason: ${completion.choices[0].finish_reason})` : ''}.`);
    const parsed = normalizeExtraction(parseModelJson(raw));
    if (!validExtraction(parsed)) throw new Error('Model returned an unexpected bill structure.');
    return NextResponse.json({ ...parsed, source_filename: file.name, extraction: { method: 'nvidia_vision', model, extracted_at: new Date().toISOString(), review_status: 'pending', schema_version: '1.0' } });
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : undefined;
    const providerDetail = error instanceof Error
      ? error.message.replaceAll(key, '[redacted]').replace(/sk-or-v1-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 320)
      : '';
    const message = error instanceof Error && error.name === 'AbortError' ? 'NVIDIA request timed out.'
      : status === 429 ? 'NVIDIA rate limit reached. Try again shortly.'
        : status ? `NVIDIA request failed (${status}). ${providerDetail}`
          : error instanceof Error && (error.message.includes('PDF has no readable') || error.message.includes('JSON') || error.message.includes('unexpected bill structure')) ? `NVIDIA extraction failed: ${error.message}`
            : `Could not extract the bill with NVIDIA: ${providerDetail || 'the provider returned an unsupported response.'}`;
    return NextResponse.json({ error: message }, { status: 502 });
  } finally { clearTimeout(timer); }
}
