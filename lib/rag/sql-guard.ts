const VIEWS = new Set(['v_sales_lines','v_purchase_lines','v_sales_bills','v_purchase_bills','v_party_summary','v_product_summary','v_stock','v_monthly_sales','v_monthly_purchases']);
const BASE_TABLES = new Set(['business','parties','products','product_aliases','party_aliases','import_batches','sales_invoices','sales_invoice_lines','purchase_bills','purchase_bill_lines','stock_movements']);

export function guardChatSql(input: string): string {
  if (!input || input.length > 12000 || /[^\x20-\x7e\n\r\t]/.test(input)) throw new Error('Query rejected by SQL safety guard.');
  if (/--|\/\*|\*\/|\$|\\|"/.test(input)) throw new Error('SQL comments, quoting tricks, and escapes are not allowed.');
  const sql = input.trim().replace(/;\s*$/, '');
  if (sql.includes(';')) throw new Error('Only one SQL statement is allowed.');
  const scrubbed = sql.replace(/'(?:[^']|'')*'/g, "'literal'");
  if (!/^\s*(select|with)\s/i.test(scrubbed)) throw new Error('Only SELECT or WITH queries are allowed.');
  if (/\b(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|prepare|deallocate|vacuum|analyze|refresh|comment|set|reset|pg_catalog|information_schema|pg_[a-z_]*|set_config|dblink|lo_import|lo_export)\b/i.test(scrubbed)) throw new Error('Query rejected by SQL safety guard.');
  const identifiers = [...scrubbed.matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)].map(match => match[1].toLowerCase());
  if (identifiers.some(identifier => BASE_TABLES.has(identifier))) throw new Error('Direct base-table access is not allowed.');
  const referenced = [...scrubbed.matchAll(/\b(v_[a-z_]+)\b/gi)].map(match => match[1].toLowerCase());
  if (!referenced.length || referenced.some(view => !VIEWS.has(view))) throw new Error('Query must read approved analytics views only.');
  return sql;
}
