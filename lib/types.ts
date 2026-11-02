export type Business = {
  id: number; name: string; address1: string | null; address2: string | null; phone: string | null;
  gstin: string | null; pan: string | null; bank_name: string | null; bank_account: string | null;
  bank_ifsc: string | null; declaration: string | null; next_invoice_no: number;
};
export type Customer = { id: string; name: string; kind?: 'customer' | 'supplier' | 'both'; gstin: string | null; address1: string | null; address2: string | null };
export type Product = { id: string; name: string; hsn: string; rate: number; gst: number; track_stock: boolean; stock_qty?: number; active: boolean };
export type Invoice = {
  id: string; invoice_no: number; invoice_date: string; challan_no: string | null; po_no: string | null;
  customer_id?: string | null;
  customer_name: string; customer_gstin: string | null; customer_address1: string | null; customer_address2: string | null;
  subtotal: number; cgst: number; sgst: number; round_off: number; total: number; status: 'final' | 'cancelled';
  source?: 'app' | 'excel_import'; source_file?: string | null; import_warning?: string | null;
  bill_json?: Record<string, unknown>;
};
export type InvoiceItem = {
  id?: string; invoice_id?: string; product_id?: string | null; position: number; description: string; hsn: string | null; gst: number; qty: number; rate: number;
  amount: number; cgst: number; sgst: number; total: number;
};
