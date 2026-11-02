-- Seed data for Supra Billing. Safe to run more than once: every insert is "do nothing" on conflict.
-- Source: Supra_Marketing_Invoice.xlsx (Lists sheet: 53 customers, 38 products with default rates).
--
-- How to apply on the hosted project:  npx supabase db push --include-seed
-- (or paste this file into the Supabase SQL editor once, after the migrations have run)
--
-- Cleaning decisions made while loading (edit before the first push if you disagree):
--   * "K 'Sagar Book Centre(J)" and "K'Sagar Book Centre(J)"  -> one customer K'Sagar Book Centre(J)
--   * "K 'Sagar Book Centre(N)", "K'Sagar Book Centre(N)", "K'Sagar Biik Centre(N)" -> one customer K'Sagar Book Centre(N)
--   * "Pratik Stationary" and "Pratik Stationery" (same GSTIN) -> one customer Pratik Stationery
--   The old spellings are saved as aliases, so old bills that use them still link to the right customer.
--   * VENKATESHWARA and Venkateshwara Hatcheries share a GSTIN but are kept as two customers (unclear if same firm).
--   * Names are otherwise kept exactly as printed on bills. 49 customers, 38 products.
--   * No product is stock-tracked yet (track_stock = false). Turn it on per product in the Products screen.
--   * GST is 0% for every product, as in the Excel sheet. HSN 4820 everywhere.
--   * Bank details are NOT seeded: enter them in Settings so the account number stays out of git.

insert into public.business (id, name, address1, address2, phone, gstin, pan, declaration, next_invoice_no)
values (1, 'SUPRA MARKETING', '632, Budhwar Peth, Shan Brahma Complex', 'Appa Balwant Chowk, Pune 411002',
        '9422552850', '27NMHPS0701J1ZP', 'NMHPS0701J',
        'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
        5601)
on conflict (id) do nothing;

insert into public.parties (kind, name, gstin) values
  ('customer', 'ABC SQUARE', '27BKGP7852M1ZM'),
  ('customer', 'ABC Stationary', null),
  ('customer', 'Amar Book Centre', null),
  ('customer', 'Amar Book Depo', null),
  ('customer', 'Amol Book Centre', null),
  ('customer', 'Amol Book House', null),
  ('customer', 'Aryan Book Agency', null),
  ('customer', 'Baldota Stationery', '27ABGPB6235R1ZA'),
  ('customer', 'Bhagya Enterprises', '27DNPM0816M1ZR'),
  ('customer', 'Booktales', '27BPPPS8148J1Z1'),
  ('customer', 'Choice', '27ACYPK3323L1Z2'),
  ('customer', 'Choice Book Stall', '27CUXPB2852A1ZO'),
  ('customer', 'Dnyaneshwari Distributer', null),
  ('customer', 'Friends Book Centre', null),
  ('customer', 'Future Book Centre', null),
  ('customer', 'Girija enterprises', null),
  ('customer', 'K''Sagar Book Centre(J)', null),
  ('customer', 'K''Sagar Book Centre(N)', null),
  ('customer', 'Kapil Stores', null),
  ('customer', 'Krishna Book Centre', null),
  ('customer', 'Lucky Store', '27AFIPK0100L1ZR'),
  ('customer', 'Maharashtra Book Centre', null),
  ('customer', 'Manish Enterprises', null),
  ('customer', 'Maxa Enterprises', null),
  ('customer', 'Mayuresh Book Centre', null),
  ('customer', 'Mayuresh Book Depo', null),
  ('customer', 'N.A.Gandhi', '27AAAFN9941M1ZQ'),
  ('customer', 'Natraj variety', '27BDPD7071G1ZU'),
  ('customer', 'Om Book Stall', null),
  ('customer', 'Omkar Book Depo', null),
  ('customer', 'Omkar Book Stall', null),
  ('customer', 'Prabhat Book Stall', null),
  ('customer', 'Pragati Book Centre', '27AABFP5120B1ZV'),
  ('customer', 'Pratik Stationery', '27AAEPW0635M1ZB'),
  ('customer', 'Pravin Book Centre', null),
  ('customer', 'Rajesh Book Centre', null),
  ('customer', 'Rajesh Book Depo', null),
  ('customer', 'Rajyog Agency', '27AKSPS3567Q1ZV'),
  ('customer', 'Rohini Book Depot', '27BRHPS9441L1ZO'),
  ('customer', 'Scholar Books', null),
  ('customer', 'Sharda Vilas', null),
  ('customer', 'Shweta Enterprises', '27ALIPK5881G1ZR'),
  ('customer', 'Siddhi Book House', null),
  ('customer', 'Suyog Stationary', '27AGIPJ5029N1Z0'),
  ('customer', 'VENKATESHWARA', '27AAACV7247H1Z4'),
  ('customer', 'Venkateshwara Hatcheries', '27AAACV7247H1Z4'),
  ('customer', 'Vikas Book Centre', null),
  ('customer', 'Yash Books', null),
  ('customer', 'Yogiraj Pustakalay', null)
on conflict do nothing;

insert into public.party_aliases (party_id, alias)
select p.id, v.alias from (values
  ('K''Sagar Book Centre(J)', 'K ''Sagar Book Centre(J)'),
  ('K''Sagar Book Centre(N)', 'K ''Sagar Book Centre(N)'),
  ('K''Sagar Book Centre(N)', 'K''Sagar Biik Centre(N)'),
  ('Pratik Stationery', 'Pratik Stationary')
) as v(party_name, alias)
join public.parties p on lower(btrim(p.name)) = lower(v.party_name)
on conflict do nothing;

insert into public.products (name, hsn, rate, gst, track_stock, active) values
  ('A4 Spiral Book 196 Pgs Ruled', '4820', 53, 0, false, true),
  ('A4 Spiral Book 196 Pgs Unruled', '4820', 53, 0, false, true),
  ('A4 Spiral Book 300 Pgs Ruled', '4820', 81, 0, false, true),
  ('A4 Spiral Book 300 Pgs Unruled', '4820', 81, 0, false, true),
  ('A4 Spiral Book 348 Pgs Ruled', '4820', 91, 0, false, true),
  ('A4 Spiral Book 348 Pgs Unruled', '4820', 91, 0, false, true),
  ('A4 Spiral Book 384 Pgs Ruled', '4820', 101, 0, false, true),
  ('A4 Spiral Book 384 Pgs Unruled', '4820', 101, 0, false, true),
  ('A4 Spiral Book 500 Pgs Ruled', '4820', 131, 0, false, true),
  ('A4 Spiral Book 500 Pgs Unruled', '4820', 131, 0, false, true),
  ('A4 Notebook 172 Pgs', '4820', 37.5, 0, false, true),
  ('A4 Notebook 300 Pgs', '4820', 76, 0, false, true),
  ('A4 Notebook 400 Pgs', '4820', 91, 0, false, true),
  ('A5 Diary 192 Pgs', '4820', 89, 0, false, true),
  ('A5 Notebook Single Line 172 Pgs', '4820', 24, 0, false, true),
  ('A5 Notebook Double Line 172 Pgs', '4820', 24, 0, false, true),
  ('A5 Notebook Four Line 172 Pgs', '4820', 24, 0, false, true),
  ('A5 Notebook Medium Square 172 Pgs', '4820', 24, 0, false, true),
  ('A5 Notebook Small Square 172 Pgs', '4820', 24, 0, false, true),
  ('A5 Notebook Big Square 172 Pgs', '4820', 24, 0, false, true),
  ('A4 Wiro Book 200 Pgs Ruled', '4820', 70, 0, false, true),
  ('A4 Wiro Book 200 Pgs Unruled', '4820', 65, 0, false, true),
  ('A4 Wiro Book 300 Pgs Ruled', '4820', 95, 0, false, true),
  ('A4 Wiro Book 300 Pgs Unruled', '4820', 90, 0, false, true),
  ('A4 Wiro Book 380 Pgs Ruled', '4820', 130, 0, false, true),
  ('A4 Wiro Book 380 Pgs Unruled', '4820', 125, 0, false, true),
  ('UPSC Book 200 Pgs', '4820', 130, 0, false, true),
  ('A5 Wiro Book 160 Pgs Ruled', '4820', 35, 0, false, true),
  ('A5 Wiro Book 160 Pgs Unruled', '4820', 35, 0, false, true),
  ('A4 Graph Paper 50 Sheets', '4820', 39, 0, false, true),
  ('Journal Paper 50 Sheets', '4820', 35, 0, false, true),
  ('Journal Paper 100 Sheets', '4820', 50, 0, false, true),
  ('A4 Rough Book 140 Pgs', '4820', 19, 0, false, true),
  ('A4 Rough Book 220 Pgs', '4820', 26, 0, false, true),
  ('A4 Rough Book 380 Pgs', '4820', 45, 0, false, true),
  ('A4 Rough Book 340 Pgs', '4820', 36, 0, false, true),
  ('MPSC OMR 50 Sheets', '4820', 60, 0, false, true),
  ('NEET OMR 50 Sheets', '4820', 60, 0, false, true)
on conflict do nothing;
