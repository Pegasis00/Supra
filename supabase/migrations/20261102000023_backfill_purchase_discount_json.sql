-- Include the new per-line discount in JSON snapshots for existing purchases.
update public.purchase_bills b
set bill_json = jsonb_build_object(
  'id', b.id, 'supplier_id', b.supplier_id, 'supplier_name', b.supplier_name, 'supplier_gstin', b.supplier_gstin,
  'supplier_address', b.supplier_address, 'supplier_invoice_number', b.supplier_invoice_number, 'purchase_date', b.purchase_date,
  'purchase_order_number', b.purchase_order_number, 'challan_number', b.challan_number, 'subtotal', b.subtotal,
  'tax_total', b.tax_total, 'round_off', b.round_off, 'grand_total', b.grand_total, 'status', b.status,
  'source_file_path', b.source_file_path, 'extraction_metadata', b.extraction_metadata,
  'items', coalesce((select jsonb_agg(jsonb_build_object('position', l.position, 'product_id', l.product_id, 'description', l.description,
    'hsn', l.hsn, 'quantity', l.quantity, 'unit', l.unit, 'unit_rate', l.unit_rate, 'discount', l.discount, 'line_total', l.line_total,
    'gst_rate', l.gst_rate, 'cgst', l.cgst, 'sgst', l.sgst, 'igst', l.igst) order by l.position)
    from public.purchase_bill_lines l where l.purchase_bill_id = b.id), '[]'::jsonb)
);
