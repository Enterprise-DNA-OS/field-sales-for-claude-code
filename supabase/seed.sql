-- Demo data for field-sales-for-claude-code.
-- Kaimai Foods, a New Zealand food and beverage supplier: 3 territories, 4 reps,
-- 12 SKUs, 15 outlets, a call cycle per outlet, six months of visits, orders,
-- shelf checks, promotion checks and returns.
--
-- Deliberately messy, so the attention list has something to say:
--   five outlets past their call cycle, one of them by nearly three weeks
--   a coffee promotion running with no funding agreement on file
--   promotion checks with the wrong shelf ticket price
--   submitted orders that never reached the ERP
--   a credit request nobody has authorised for nine days
--   a return of a batch tracked juice with no batch code recorded
--   two outlets that have not ordered in over three months
--
-- Dates are relative to current_date. Ids are fixed or derived, and every insert
-- is ON CONFLICT DO NOTHING, so running it twice changes nothing.

-- A stable uuid from any text, so the generated rows are the same every run.
create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Territories ---------------------------------------------------------------

insert into territories (id, name, code, region, manager, notes) values
  ('10000001-0000-4000-8000-000000000001', 'Auckland North', 'AKL-N', 'Auckland', 'Rachel Adams', 'North Shore and Hibiscus Coast. Six grocery, one pharmacy.'),
  ('10000002-0000-4000-8000-000000000002', 'Waikato Bay of Plenty', 'WBP', 'Waikato', 'Rachel Adams', 'Hamilton, Cambridge, Rotorua, Tauranga. Long drives, fortnightly calls.'),
  ('10000003-0000-4000-8000-000000000003', 'Wellington', 'WLG', 'Wellington', 'Rachel Adams', 'City and Hutt. Foodservice is the growth here.')
on conflict do nothing;

-- Reps ----------------------------------------------------------------------

insert into reps (id, full_name, code, email, phone, role, territory_id, active, started_on) values
  ('20000001-0000-4000-8000-000000000001', 'Aroha Ngata', 'ANG', 'aroha@kaimaifoods.co.nz', '021 555 0181', 'sales rep', '10000001-0000-4000-8000-000000000001', true, current_date - 900),
  ('20000002-0000-4000-8000-000000000002', 'Dev Patel', 'DPA', 'dev@kaimaifoods.co.nz', '021 555 0182', 'sales rep', '10000002-0000-4000-8000-000000000002', true, current_date - 430),
  ('20000003-0000-4000-8000-000000000003', 'Sarah Coombes', 'SCO', 'sarah@kaimaifoods.co.nz', '021 555 0183', 'sales rep', '10000003-0000-4000-8000-000000000003', true, current_date - 1600),
  ('20000004-0000-4000-8000-000000000004', 'Mike Ellis', 'MEL', 'mike@kaimaifoods.co.nz', '021 555 0184', 'merchandiser', '10000001-0000-4000-8000-000000000001', true, current_date - 200)
on conflict do nothing;

-- Products ------------------------------------------------------------------

insert into products (id, sku, name, brand, category, unit_size, case_size, list_price_cents, batch_tracked) values
  ('30000001-0000-4000-8000-000000000001', 'KAI-CRK-150', 'Kaimai Water Crackers', 'Kaimai', 'Crackers', '150g', 12, 289, false),
  ('30000002-0000-4000-8000-000000000002', 'KAI-CRK-250', 'Kaimai Seeded Crackers', 'Kaimai', 'Crackers', '250g', 12, 449, false),
  ('30000003-0000-4000-8000-000000000003', 'KAI-OAT-400', 'Kaimai Oat Biscuits', 'Kaimai', 'Biscuits', '400g', 8, 599, false),
  ('30000004-0000-4000-8000-000000000004', 'KAI-DIP-200', 'Kaimai Hummus Dip', 'Kaimai', 'Chilled dips', '200g', 12, 549, true),
  ('30000005-0000-4000-8000-000000000005', 'KAI-DIP-CAR', 'Kaimai Caramelised Onion Dip', 'Kaimai', 'Chilled dips', '200g', 12, 549, true),
  ('30000006-0000-4000-8000-000000000006', 'SRC-BEA-1KG', 'Southern Roast Beans', 'Southern Roast', 'Coffee', '1kg', 6, 2450, false),
  ('30000007-0000-4000-8000-000000000007', 'SRC-GRD-250', 'Southern Roast Ground', 'Southern Roast', 'Coffee', '250g', 12, 899, false),
  ('30000008-0000-4000-8000-000000000008', 'SRC-POD-030', 'Southern Roast Pods', 'Southern Roast', 'Coffee', '30 pack', 8, 1699, false),
  ('30000009-0000-4000-8000-000000000009', 'SRC-CHO-180', 'Southern Roast Chocolate Beans', 'Southern Roast', 'Confectionery', '180g', 12, 749, false),
  ('30000010-0000-4000-8000-000000000010', 'FVJ-APP-1L0', 'Fern Valley Apple Juice', 'Fern Valley', 'Juice', '1L', 12, 449, true),
  ('30000011-0000-4000-8000-000000000011', 'FVJ-ORA-1L0', 'Fern Valley Orange Juice', 'Fern Valley', 'Juice', '1L', 12, 469, true),
  ('30000012-0000-4000-8000-000000000012', 'FVJ-BER-300', 'Fern Valley Berry Smoothie', 'Fern Valley', 'Juice', '300ml', 24, 399, true)
on conflict do nothing;

-- Price lists ---------------------------------------------------------------

insert into price_lists (id, code, name, currency, notes) values
  ('40000001-0000-4000-8000-000000000001', 'GROC', 'Grocery banner list', 'NZD', 'The two supermarket groups. List less 18 percent.'),
  ('40000002-0000-4000-8000-000000000002', 'WHSL', 'Wholesale and foodservice', 'NZD', 'Distributors and foodservice. List less 26 percent.'),
  ('40000003-0000-4000-8000-000000000003', 'ROUTE', 'Route trade and convenience', 'NZD', 'Single store accounts. List less 10 percent.')
on conflict do nothing;

insert into price_list_items (id, price_list_id, product_id, price_cents)
select seed_uuid('pli:' || pl.code || ':' || p.sku), pl.id, p.id,
       round(p.list_price_cents * case pl.code when 'GROC' then 0.82 when 'WHSL' then 0.74 else 0.90 end)::bigint
from price_lists pl cross join products p
on conflict do nothing;

-- Outlets -------------------------------------------------------------------

insert into outlets (id, code, name, banner, channel, address, suburb, city, region, territory_id, rep_id, price_list_id, status, credit_hold, payment_terms_days, opened_on, notes) values
  ('50000001-0000-4000-8000-000000000001', 'KM-101', 'New World Milford', 'New World', 'grocery', '24 Milford Road', 'Milford', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000001-0000-4000-8000-000000000001', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 1500, 'Grocery manager wants the dips in the chiller end, not the deli.'),
  ('50000002-0000-4000-8000-000000000002', 'KM-102', 'Pak n Save Albany', 'Pak n Save', 'grocery', '150 Don McKinnon Drive', 'Albany', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000001-0000-4000-8000-000000000001', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 1800, 'Biggest volume in the territory. Orders Tuesday, delivers Thursday.'),
  ('50000003-0000-4000-8000-000000000003', 'KM-103', 'Woolworths Takapuna', 'Woolworths', 'grocery', '38 Anzac Street', 'Takapuna', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000001-0000-4000-8000-000000000001', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 1200, 'Planogram reset in the cracker bay every quarter. Check facings.'),
  ('50000004-0000-4000-8000-000000000004', 'KM-104', 'Four Square Devonport', 'Four Square', 'convenience', '9 Victoria Road', 'Devonport', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000004-0000-4000-8000-000000000004', '40000003-0000-4000-8000-000000000003', 'active', false, 14, current_date - 700, 'Owner operator. Small orders, pays on the day.'),
  ('50000005-0000-4000-8000-000000000005', 'KM-105', 'Unichem Browns Bay', 'Unichem', 'pharmacy', '62 Clyde Road', 'Browns Bay', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000004-0000-4000-8000-000000000004', '40000003-0000-4000-8000-000000000003', 'active', false, 20, current_date - 400, 'Only takes the oat biscuits and the pods. Four weekly call.'),
  ('50000006-0000-4000-8000-000000000006', 'KM-106', 'Farro Fresh Orewa', 'Farro', 'grocery', '10 Florence Avenue', 'Orewa', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000001-0000-4000-8000-000000000001', '40000003-0000-4000-8000-000000000003', 'active', false, 20, current_date - 300, 'Premium range only. Good for the 1kg beans.'),
  ('50000007-0000-4000-8000-000000000007', 'KM-107', 'Fresh Choice Birkenhead', 'Fresh Choice', 'grocery', '2 Rawene Road', 'Birkenhead', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000001-0000-4000-8000-000000000001', '40000001-0000-4000-8000-000000000001', 'closed', false, 20, current_date - 2000, 'Store closed for a rebuild. No calls until it reopens.'),
  ('50000008-0000-4000-8000-000000000008', 'KM-201', 'New World Hamilton East', 'New World', 'grocery', '4 Clyde Street', 'Hamilton East', 'Hamilton', 'Waikato', '10000002-0000-4000-8000-000000000002', '20000002-0000-4000-8000-000000000002', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 1100, 'Strong on the juice. Wants a second facing for the smoothie.'),
  ('50000009-0000-4000-8000-000000000009', 'KM-202', 'Pak n Save Rotorua', 'Pak n Save', 'grocery', '1 Amohau Street', 'Rotorua', 'Rotorua', 'Bay of Plenty', '10000002-0000-4000-8000-000000000002', '20000002-0000-4000-8000-000000000002', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 1300, 'Two hours from Hamilton. Worth a full morning when Dev goes.'),
  ('50000010-0000-4000-8000-000000000010', 'KM-203', 'Night n Day Tauranga', 'Night n Day', 'convenience', '88 Devonport Road', 'Tauranga', 'Tauranga', 'Bay of Plenty', '10000002-0000-4000-8000-000000000002', '20000002-0000-4000-8000-000000000002', '40000003-0000-4000-8000-000000000003', 'active', false, 14, current_date - 500, 'Single serve only. Smoothie and chocolate beans.'),
  ('50000011-0000-4000-8000-000000000011', 'KM-204', 'Gull Cambridge', 'Gull', 'forecourt', '55 Victoria Street', 'Cambridge', 'Cambridge', 'Waikato', '10000002-0000-4000-8000-000000000002', '20000002-0000-4000-8000-000000000002', '40000003-0000-4000-8000-000000000003', 'active', false, 14, current_date - 250, 'Forecourt. Coffee pods move, nothing else does.'),
  ('50000012-0000-4000-8000-000000000012', 'KM-205', 'Bay Cafe Supply Co', 'Independent', 'foodservice', '17 Newton Street', 'Mount Maunganui', 'Tauranga', 'Bay of Plenty', '10000002-0000-4000-8000-000000000002', '20000002-0000-4000-8000-000000000002', '40000002-0000-4000-8000-000000000002', 'active', true, 30, current_date - 600, 'On credit hold since the March invoices. No new orders until finance clears it.'),
  ('50000013-0000-4000-8000-000000000013', 'KM-301', 'New World Thorndon', 'New World', 'grocery', '279 Tinakori Road', 'Thorndon', 'Wellington', 'Wellington', '10000003-0000-4000-8000-000000000003', '20000003-0000-4000-8000-000000000003', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 1700, 'Best cracker store in the country. Do not lose the end cap.'),
  ('50000014-0000-4000-8000-000000000014', 'KM-302', 'Moore Wilsons Wellington', 'Moore Wilsons', 'foodservice', '36 College Street', 'Te Aro', 'Wellington', 'Wellington', '10000003-0000-4000-8000-000000000003', '20000003-0000-4000-8000-000000000003', '40000002-0000-4000-8000-000000000002', 'active', false, 30, current_date - 1400, 'Buys by the pallet. Talks to the buyer, not the floor.'),
  ('50000015-0000-4000-8000-000000000015', 'KM-303', 'Woolworths Johnsonville', 'Woolworths', 'grocery', '30 Broderick Road', 'Johnsonville', 'Wellington', 'Wellington', '10000003-0000-4000-8000-000000000003', '20000003-0000-4000-8000-000000000003', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 900, 'Nobody has been in for weeks. Range check overdue.'),
  ('50000016-0000-4000-8000-000000000016', 'KM-108', 'New World Long Bay', 'New World', 'grocery', '5 Glenvar Ridge Road', 'Long Bay', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000001-0000-4000-8000-000000000001', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 320, 'Newest store on the Shore. Range is still being built.'),
  ('50000017-0000-4000-8000-000000000017', 'KM-109', 'Woolworths Glenfield', 'Woolworths', 'grocery', '12 Bentley Avenue', 'Glenfield', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000001-0000-4000-8000-000000000001', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 1600, 'Steady. Never asks for anything, never complains.'),
  ('50000018-0000-4000-8000-000000000018', 'KM-110', 'Woolworths Silverdale', 'Woolworths', 'grocery', '7 Hibiscus Coast Highway', 'Silverdale', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000004-0000-4000-8000-000000000004', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 800, 'Merchandising call. Mike resets the bay, Aroha takes the order.'),
  ('50000019-0000-4000-8000-000000000019', 'KM-111', 'Fresh Choice Mairangi Bay', 'Fresh Choice', 'grocery', '380 Beach Road', 'Mairangi Bay', 'Auckland', 'Auckland', '10000001-0000-4000-8000-000000000001', '20000004-0000-4000-8000-000000000004', '40000003-0000-4000-8000-000000000003', 'active', false, 20, current_date - 950, 'Small footprint. One facing per line and they defend it.'),
  ('50000020-0000-4000-8000-000000000020', 'KM-206', 'New World Te Awamutu', 'New World', 'grocery', '180 Alexandra Street', 'Te Awamutu', 'Te Awamutu', 'Waikato', '10000002-0000-4000-8000-000000000002', '20000002-0000-4000-8000-000000000002', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 1050, 'Rural catchment. Bulk sizes outsell singles here.'),
  ('50000021-0000-4000-8000-000000000021', 'KM-207', 'Woolworths Greerton', 'Woolworths', 'grocery', '1247 Cameron Road', 'Greerton', 'Tauranga', 'Bay of Plenty', '10000002-0000-4000-8000-000000000002', '20000002-0000-4000-8000-000000000002', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 640, 'Best juice store in the Bay. Protect the chiller space.'),
  ('50000022-0000-4000-8000-000000000022', 'KM-304', 'New World Karori', 'New World', 'grocery', '250 Karori Road', 'Karori', 'Wellington', 'Wellington', '10000003-0000-4000-8000-000000000003', '20000003-0000-4000-8000-000000000003', '40000001-0000-4000-8000-000000000001', 'active', false, 20, current_date - 1250, 'Older shoppers, premium basket. Oat biscuits do well.'),
  ('50000023-0000-4000-8000-000000000023', 'KM-305', 'Commonsense Wellington', 'Commonsense', 'grocery', '260 Wakefield Street', 'Te Aro', 'Wellington', 'Wellington', '10000003-0000-4000-8000-000000000003', '20000003-0000-4000-8000-000000000003', '40000003-0000-4000-8000-000000000003', 'active', false, 20, current_date - 480, 'Organic only. They will not take the confectionery line.')
on conflict do nothing;

-- Contacts ------------------------------------------------------------------

insert into contacts (id, outlet_id, full_name, role, phone, email, is_primary, notes) values
  ('51000001-0000-4000-8000-000000000001', '50000001-0000-4000-8000-000000000001', 'Kelly Brown', 'Grocery manager', '09 555 0101', 'kelly@nwmilford.co.nz', true, 'In store Tuesday to Saturday. Not before 9am.'),
  ('51000002-0000-4000-8000-000000000002', '50000002-0000-4000-8000-000000000002', 'Sione Tuilagi', 'Grocery manager', '09 555 0102', 'sione@pnsalbany.co.nz', true, 'Signs off on all end caps.'),
  ('51000003-0000-4000-8000-000000000003', '50000002-0000-4000-8000-000000000002', 'Amy Wu', 'Chilled buyer', '09 555 0112', 'amy@pnsalbany.co.nz', false, 'Handles the dips only.'),
  ('51000004-0000-4000-8000-000000000004', '50000003-0000-4000-8000-000000000003', 'Grant Fisher', 'Store manager', '09 555 0103', 'grant@ww-takapuna.co.nz', true, 'Planogram resets come from head office. Grant just executes.'),
  ('51000005-0000-4000-8000-000000000005', '50000004-0000-4000-8000-000000000004', 'Nadia Rahman', 'Owner', '09 555 0104', 'nadia@fsdevonport.co.nz', true, 'Pays on the day, always asks about new lines.'),
  ('51000006-0000-4000-8000-000000000006', '50000005-0000-4000-8000-000000000005', 'Peter Yee', 'Pharmacy owner', '09 555 0105', 'peter@unichembb.co.nz', true, 'Four weekly is plenty. Do not over call.'),
  ('51000007-0000-4000-8000-000000000007', '50000008-0000-4000-8000-000000000008', 'Hine Walker', 'Grocery manager', '07 555 0201', 'hine@nwhamiltoneast.co.nz', true, 'Asked for a second smoothie facing three visits running.'),
  ('51000008-0000-4000-8000-000000000008', '50000009-0000-4000-8000-000000000009', 'Craig Ellery', 'Grocery manager', '07 555 0202', 'craig@pnsrotorua.co.nz', true, 'Only available before 11am.'),
  ('51000009-0000-4000-8000-000000000009', '50000012-0000-4000-8000-000000000012', 'Tui Ranginui', 'Owner', '07 555 0205', 'tui@baycafesupply.co.nz', true, 'Credit hold is a finance conversation, not a rep one.'),
  ('51000010-0000-4000-8000-000000000010', '50000013-0000-4000-8000-000000000013', 'Marcus Reid', 'Grocery manager', '04 555 0301', 'marcus@nwthorndon.co.nz', true, 'Protects the cracker end cap. Keep him happy.'),
  ('51000011-0000-4000-8000-000000000011', '50000014-0000-4000-8000-000000000014', 'Fiona Clark', 'Buyer', '04 555 0302', 'fiona@moorewilsons.co.nz', true, 'Buys quarterly by the pallet. Book a meeting, do not drop in.'),
  ('51000012-0000-4000-8000-000000000012', '50000015-0000-4000-8000-000000000015', 'Dan Whitcombe', 'Store manager', '04 555 0303', 'dan@ww-johnsonville.co.nz', true, 'New manager since June. Never been introduced.')
on conflict do nothing;

-- The journey plan ----------------------------------------------------------
-- gap_days is how long ago the last completed visit was, which is how the
-- overdue rows in the demo get there.

drop table if exists seed_plan;
create table seed_plan (
  code       text primary key,
  frequency  integer not null,
  weekday    integer not null,
  seq        integer not null,
  gap_days   integer not null,
  strike_mod integer not null
);
insert into seed_plan (code, frequency, weekday, seq, gap_days, strike_mod) values
  ('KM-101', 7, 2, 10, 3, 4),
  ('KM-102', 7, 2, 20, 12, 5),
  ('KM-103', 7, 3, 30, 5, 4),
  ('KM-104', 14, 4, 40, 9, 3),
  ('KM-105', 28, 4, 50, 41, 3),
  ('KM-106', 14, 5, 60, 6, 4),
  ('KM-201', 7, 1, 10, 4, 5),
  ('KM-202', 7, 2, 20, 16, 4),
  ('KM-203', 14, 3, 30, 11, 3),
  ('KM-204', 28, 3, 40, 20, 2),
  ('KM-205', 14, 4, 50, 33, 3),
  ('KM-301', 7, 1, 10, 2, 5),
  ('KM-302', 14, 2, 20, 8, 4),
  ('KM-303', 7, 3, 30, 25, 4),
  ('KM-108', 7, 1, 70, 1, 3),
  ('KM-109', 7, 3, 80, 6, 4),
  ('KM-110', 14, 5, 90, 4, 4),
  ('KM-111', 14, 5, 100, 12, 3),
  ('KM-206', 14, 1, 60, 5, 4),
  ('KM-207', 7, 4, 70, 7, 5),
  ('KM-304', 7, 4, 40, 5, 4),
  ('KM-305', 14, 5, 50, 10, 3);

insert into call_cycles (id, outlet_id, rep_id, frequency_days, preferred_weekday, sequence, starts_on, active, notes)
select seed_uuid('cc:' || o.code), o.id, o.rep_id, sp.frequency, sp.weekday, sp.seq,
       current_date - 365, true, null
from outlets o join seed_plan sp on sp.code = o.code
on conflict do nothing;

-- Visits --------------------------------------------------------------------
-- Six months of completed calls, walked backwards from the last one at the
-- cycle frequency.

insert into visits (id, outlet_id, rep_id, planned_on, visited_on, duration_minutes, status, purpose, notes)
select
  seed_uuid('visit:' || o.code || ':' || g.n),
  o.id,
  o.rep_id,
  (current_date - sp.gap_days - (g.n * sp.frequency))::date,
  (current_date - sp.gap_days - (g.n * sp.frequency))::date,
  22 + ((extract(day from (current_date - sp.gap_days - (g.n * sp.frequency))::date)::integer * 7 + sp.seq) % 45),
  'completed',
  'call cycle visit',
  null
from outlets o
join seed_plan sp on sp.code = o.code
cross join generate_series(0, 28) as g(n)
where (current_date - sp.gap_days - (g.n * sp.frequency)) >= current_date - 200
on conflict do nothing;

-- Three calls the rep did not make.
insert into visits (id, outlet_id, rep_id, planned_on, visited_on, duration_minutes, status, purpose, notes) values
  (seed_uuid('miss:KM-104'), '50000004-0000-4000-8000-000000000004', '20000004-0000-4000-8000-000000000004', current_date - 5, null, 0, 'missed', 'call cycle visit', 'Store shut for a power cut.'),
  (seed_uuid('miss:KM-203'), '50000010-0000-4000-8000-000000000010', '20000002-0000-4000-8000-000000000002', current_date - 4, null, 0, 'missed', 'call cycle visit', 'Ran out of day in Tauranga.'),
  (seed_uuid('miss:KM-303'), '50000015-0000-4000-8000-000000000015', '20000003-0000-4000-8000-000000000003', current_date - 2, null, 0, 'missed', 'range check', 'New manager was not in.')
on conflict do nothing;

-- The plan for the next few days.
insert into visits (id, outlet_id, rep_id, planned_on, visited_on, duration_minutes, status, purpose, notes)
select
  seed_uuid('plan:' || o.code),
  o.id,
  o.rep_id,
  greatest(current_date, (current_date - sp.gap_days + sp.frequency)::date),
  null,
  0,
  'planned',
  'call cycle visit',
  null
from outlets o
join seed_plan sp on sp.code = o.code
where greatest(current_date, (current_date - sp.gap_days + sp.frequency)::date) <= current_date + 9
on conflict do nothing;

-- Visit tasks ---------------------------------------------------------------

insert into visit_tasks (id, visit_id, kind, title, status, result_note, done_at)
select seed_uuid('task:shelf:' || v.id::text), v.id, 'shelf_check', 'Count facings and check the planogram', 'done', null, v.visited_on + time '10:30'
from visits v where v.status = 'completed' and v.visited_on >= current_date - 60
on conflict do nothing;

insert into visit_tasks (id, visit_id, kind, title, status, result_note, done_at)
select seed_uuid('task:promo:' || v.id::text), v.id, 'promo_check', 'Check the promotion display and shelf ticket', 'done', null, v.visited_on + time '10:45'
from visits v where v.status = 'completed' and v.visited_on >= current_date - 30
on conflict do nothing;

insert into visit_tasks (id, visit_id, kind, title, status, result_note, done_at)
select seed_uuid('task:photo:' || v.id::text), v.id, 'photo', 'Photo of the bay before you leave', 'pending', 'Rep left without the photo.', null
from visits v
join outlets o on o.id = v.outlet_id
where v.status = 'completed' and v.visited_on >= current_date - 21
  and (extract(day from v.visited_on)::integer % 3) = 0
on conflict do nothing;

-- Orders --------------------------------------------------------------------
-- An order comes out of most calls, not all of them. strike_mod sets the rate
-- per outlet, which is what makes one rep look better than another.

insert into orders (id, order_no, outlet_id, rep_id, visit_id, price_list_id, ordered_on, delivery_on, status, po_number, notes, exported_at, erp_ref)
select
  seed_uuid('order:' || v.id::text),
  'SO-' || to_char(v.visited_on, 'YYMMDD') || '-' || right(o.code, 3),
  o.id,
  v.rep_id,
  v.id,
  o.price_list_id,
  v.visited_on,
  v.visited_on + 3,
  case
    when v.visited_on <= current_date - 21 then 'invoiced'
    when v.visited_on <= current_date - 4  then 'exported'
    when v.visited_on <= current_date - 1  then 'submitted'
    else 'draft'
  end,
  case when o.channel = 'grocery' then 'PO' || to_char(v.visited_on, 'MMDD') || right(o.code, 3) else null end,
  null,
  case when v.visited_on <= current_date - 4 then (v.visited_on + 1)::timestamptz else null end,
  case when v.visited_on <= current_date - 4 then 'ERP-' || to_char(v.visited_on, 'YYMMDD') || right(o.code, 3) else null end
from visits v
join outlets o on o.id = v.outlet_id
join seed_plan sp on sp.code = o.code
where v.status = 'completed'
  and ((extract(doy from v.visited_on)::integer + sp.seq) % sp.strike_mod) <> 0
  and not (o.code = 'KM-205' and v.visited_on > current_date - 100)
on conflict do nothing;

insert into order_lines (id, order_id, product_id, quantity, unit_price_cents, discount_pct, promotion_id, line_total_cents)
select
  seed_uuid('line:' || ord.id::text || ':' || p.sku),
  ord.id,
  p.id,
  qty.q,
  price.unit,
  0,
  null,
  qty.q * price.unit
from orders ord
join outlets o on o.id = ord.outlet_id
join products p on true
cross join lateral (
  select (2 + ((extract(doy from ord.ordered_on)::integer + length(p.sku) + p.case_size) % 9))::integer as q
) qty
cross join lateral (
  select (coalesce(
    (select pli.price_cents from price_list_items pli
      where pli.price_list_id = o.price_list_id and pli.product_id = p.id),
    p.list_price_cents
  ) * p.case_size)::bigint as unit
) price
where p.active
  and ((extract(doy from ord.ordered_on)::integer + p.case_size + length(p.name)) % 3) = 0
  and not (o.channel in ('convenience', 'forecourt') and p.category in ('Chilled dips', 'Coffee') and p.case_size < 8)
on conflict do nothing;

-- Every order needs at least one line. Anything the rule above skipped gets the
-- core cracker line, which is what a rep would have written anyway.
insert into order_lines (id, order_id, product_id, quantity, unit_price_cents, discount_pct, promotion_id, line_total_cents)
select
  seed_uuid('line:core:' || ord.id::text),
  ord.id,
  '30000001-0000-4000-8000-000000000001',
  6,
  12 * coalesce((select pli.price_cents from price_list_items pli
                  where pli.price_list_id = o.price_list_id
                    and pli.product_id = '30000001-0000-4000-8000-000000000001'), 289),
  0,
  null,
  6 * 12 * coalesce((select pli.price_cents from price_list_items pli
                      where pli.price_list_id = o.price_list_id
                        and pli.product_id = '30000001-0000-4000-8000-000000000001'), 289)
from orders ord
join outlets o on o.id = ord.outlet_id
where not exists (select 1 from order_lines l where l.order_id = ord.id)
on conflict do nothing;

-- Promotions ----------------------------------------------------------------

insert into promotions (id, code, name, mechanic, starts_on, ends_on, promo_price_cents, was_price_cents, required_display, funded_by, funding_agreement_ref, status, notes) values
  ('60000001-0000-4000-8000-000000000001', 'SPRING-CRK', 'Spring crackers 2 for $5', 'multibuy', current_date - 14, current_date + 14, 500, 578, 'End cap, cracker aisle, 2 shelves', 'Kaimai Foods 60 percent, retailer 40 percent', 'GSA-2026-014', 'active', 'Was price is two singles at the everyday shelf price. Ticket must say so.'),
  ('60000002-0000-4000-8000-000000000002', 'ROAST-1KG', 'Southern Roast 1kg at $19.99', 'price_off', current_date - 7, current_date + 21, 1999, 2450, 'Gondola end, coffee aisle', 'Kaimai Foods 100 percent', null, 'active', 'Signed off verbally by the category manager. Nothing in writing yet.'),
  ('60000003-0000-4000-8000-000000000003', 'JUICE-350', 'Fern Valley juice $3.50', 'price_off', current_date - 70, current_date - 25, 350, 449, 'In aisle shelf strip', 'Kaimai Foods 50 percent, retailer 50 percent', 'GSA-2026-009', 'ended', 'Ran through winter. Sales lifted 31 percent in the stores that ticketed it.')
on conflict do nothing;

insert into promotion_products (id, promotion_id, product_id) values
  (seed_uuid('pp:SPRING-CRK:1'), '60000001-0000-4000-8000-000000000001', '30000001-0000-4000-8000-000000000001'),
  (seed_uuid('pp:SPRING-CRK:2'), '60000001-0000-4000-8000-000000000001', '30000002-0000-4000-8000-000000000002'),
  (seed_uuid('pp:ROAST-1KG:1'), '60000002-0000-4000-8000-000000000002', '30000006-0000-4000-8000-000000000006'),
  (seed_uuid('pp:JUICE-350:1'), '60000003-0000-4000-8000-000000000003', '30000010-0000-4000-8000-000000000010'),
  (seed_uuid('pp:JUICE-350:2'), '60000003-0000-4000-8000-000000000003', '30000011-0000-4000-8000-000000000011')
on conflict do nothing;

-- Promotion checks: what the rep found in store.
insert into promo_checks (id, visit_id, promotion_id, outlet_id, checked_on, display_present, ticket_present, ticket_price_cents, price_correct, photo_ref, note)
select
  seed_uuid('pc:' || pr.code || ':' || v.id::text),
  v.id,
  pr.id,
  v.outlet_id,
  v.visited_on,
  ((extract(doy from v.visited_on)::integer + length(o.code)) % 5) <> 0,
  ((extract(doy from v.visited_on)::integer + length(o.name)) % 6) <> 0,
  case when ((extract(doy from v.visited_on)::integer + length(o.name)) % 6) = 0 then null
       when ((extract(doy from v.visited_on)::integer + length(o.name)) % 4) = 0 then pr.was_price_cents
       else pr.promo_price_cents end,
  ((extract(doy from v.visited_on)::integer + length(o.name)) % 6) <> 0
    and ((extract(doy from v.visited_on)::integer + length(o.name)) % 4) <> 0,
  'photos/' || pr.code || '-' || o.code || '-' || to_char(v.visited_on, 'YYMMDD') || '.jpg',
  case when ((extract(doy from v.visited_on)::integer + length(o.name)) % 6) = 0
         then 'No promotion ticket on the shelf at all.'
       when ((extract(doy from v.visited_on)::integer + length(o.name)) % 4) = 0
         then 'Shelf ticket still shows the everyday price.'
       else null end
from visits v
join outlets o on o.id = v.outlet_id
join promotions pr on v.visited_on between pr.starts_on and pr.ends_on
where v.status = 'completed'
  and o.channel in ('grocery', 'convenience')
on conflict do nothing;

-- Shelf checks --------------------------------------------------------------

insert into shelf_checks (id, visit_id, outlet_id, product_id, checked_on, facings, shelf_price_cents, on_shelf, out_of_stock, planogram_ok, note)
select
  seed_uuid('sc:' || v.id::text || ':' || p.sku),
  v.id,
  v.outlet_id,
  p.id,
  v.visited_on,
  case when ((extract(doy from v.visited_on)::integer + p.case_size) % 7) = 0 then 0 else 1 + ((p.case_size + length(p.sku)) % 3) end,
  round(p.list_price_cents * 1.45)::bigint,
  ((extract(doy from v.visited_on)::integer + p.case_size) % 7) <> 0,
  ((extract(doy from v.visited_on)::integer + p.case_size) % 7) = 0,
  ((extract(doy from v.visited_on)::integer + length(p.name)) % 9) <> 0,
  case when ((extract(doy from v.visited_on)::integer + length(p.name)) % 9) = 0
       then 'Off planogram. Sitting a shelf below where it should be.' else null end
from visits v
join outlets o on o.id = v.outlet_id
join products p on p.active
where v.status = 'completed'
  and v.visited_on >= current_date - 45
  and o.channel in ('grocery', 'convenience', 'pharmacy')
  and ((extract(doy from v.visited_on)::integer + length(p.sku) + length(o.code)) % 3) = 0
on conflict do nothing;

-- Returns and credits -------------------------------------------------------

insert into returns (id, return_no, outlet_id, rep_id, visit_id, requested_on, reason, status, authorised_by, authorised_on, credit_note_ref, notes) values
  ('70000001-0000-4000-8000-000000000001', 'RET-1041', '50000003-0000-4000-8000-000000000003', '20000001-0000-4000-8000-000000000001', null, current_date - 9, 'damaged', 'requested', null, null, null, 'Pallet dropped in the back dock. Nine days with nobody looking at it.'),
  ('70000002-0000-4000-8000-000000000002', 'RET-1042', '50000009-0000-4000-8000-000000000009', '20000002-0000-4000-8000-000000000002', null, current_date - 15, 'expired', 'authorised', 'Rachel Adams', current_date - 12, null, 'Short dated juice pulled from the shelf. Credit note not raised yet.'),
  ('70000003-0000-4000-8000-000000000003', 'RET-1043', '50000013-0000-4000-8000-000000000013', '20000003-0000-4000-8000-000000000003', null, current_date - 30, 'recall', 'credited', 'Rachel Adams', current_date - 29, 'CN-88214', 'Hummus batch D2611B withdrawn after a supplier notice. Full traceability recorded.'),
  ('70000004-0000-4000-8000-000000000004', 'RET-1044', '50000012-0000-4000-8000-000000000012', '20000002-0000-4000-8000-000000000002', null, current_date - 4, 'overstock', 'requested', null, null, null, 'Cafe over ordered before the credit hold went on.')
on conflict do nothing;

insert into return_lines (id, return_id, product_id, quantity, unit_price_cents, batch_code, expiry_on, line_total_cents) values
  (seed_uuid('rl:1041:1'), '70000001-0000-4000-8000-000000000001', '30000002-0000-4000-8000-000000000002', 6, 4416, null, null, 26496),
  (seed_uuid('rl:1041:2'), '70000001-0000-4000-8000-000000000001', '30000012-0000-4000-8000-000000000012', 3, 7848, null, null, 23544),
  (seed_uuid('rl:1042:1'), '70000002-0000-4000-8000-000000000002', '30000010-0000-4000-8000-000000000010', 4, 4416, 'L2604A', current_date - 5, 17664),
  (seed_uuid('rl:1042:2'), '70000002-0000-4000-8000-000000000002', '30000011-0000-4000-8000-000000000011', 2, 4620, 'L2604B', current_date - 2, 9240),
  (seed_uuid('rl:1043:1'), '70000003-0000-4000-8000-000000000003', '30000004-0000-4000-8000-000000000004', 8, 5400, 'D2611B', current_date + 40, 43200),
  (seed_uuid('rl:1044:1'), '70000004-0000-4000-8000-000000000004', '30000006-0000-4000-8000-000000000006', 2, 10878, null, null, 21756)
on conflict do nothing;

-- Targets -------------------------------------------------------------------

insert into targets (id, period_month, rep_id, territory_id, metric, target_value, notes) values
  (seed_uuid('tgt:ANG:value'), date_trunc('month', current_date)::date, '20000001-0000-4000-8000-000000000001', '10000001-0000-4000-8000-000000000001', 'sales_value', 42000, 'Dollars ex GST for the month.'),
  (seed_uuid('tgt:ANG:calls'), date_trunc('month', current_date)::date, '20000001-0000-4000-8000-000000000001', '10000001-0000-4000-8000-000000000001', 'calls', 60, 'Completed calls.'),
  (seed_uuid('tgt:ANG:strike'), date_trunc('month', current_date)::date, '20000001-0000-4000-8000-000000000001', '10000001-0000-4000-8000-000000000001', 'strike_rate', 70, 'Percent of calls that take an order.'),
  (seed_uuid('tgt:DPA:value'), date_trunc('month', current_date)::date, '20000002-0000-4000-8000-000000000002', '10000002-0000-4000-8000-000000000002', 'sales_value', 33000, 'Dollars ex GST for the month.'),
  (seed_uuid('tgt:DPA:calls'), date_trunc('month', current_date)::date, '20000002-0000-4000-8000-000000000002', '10000002-0000-4000-8000-000000000002', 'calls', 44, 'Completed calls.'),
  (seed_uuid('tgt:DPA:strike'), date_trunc('month', current_date)::date, '20000002-0000-4000-8000-000000000002', '10000002-0000-4000-8000-000000000002', 'strike_rate', 65, 'Percent of calls that take an order.'),
  (seed_uuid('tgt:SCO:value'), date_trunc('month', current_date)::date, '20000003-0000-4000-8000-000000000003', '10000003-0000-4000-8000-000000000003', 'sales_value', 38000, 'Dollars ex GST for the month.'),
  (seed_uuid('tgt:SCO:calls'), date_trunc('month', current_date)::date, '20000003-0000-4000-8000-000000000003', '10000003-0000-4000-8000-000000000003', 'calls', 40, 'Completed calls.'),
  (seed_uuid('tgt:SCO:strike'), date_trunc('month', current_date)::date, '20000003-0000-4000-8000-000000000003', '10000003-0000-4000-8000-000000000003', 'strike_rate', 72, 'Percent of calls that take an order.'),
  (seed_uuid('tgt:MEL:calls'), date_trunc('month', current_date)::date, '20000004-0000-4000-8000-000000000004', '10000001-0000-4000-8000-000000000001', 'calls', 36, 'Merchandising calls, no order target.')
on conflict do nothing;

-- Outlet notes --------------------------------------------------------------

insert into outlet_notes (id, outlet_id, rep_id, visit_id, body, created_at) values
  (seed_uuid('note:1'), '50000008-0000-4000-8000-000000000008', '20000002-0000-4000-8000-000000000002', null, 'Hine has asked for a second smoothie facing three visits running. Needs a category argument, not another ask.', now() - interval '11 days'),
  (seed_uuid('note:2'), '50000013-0000-4000-8000-000000000013', '20000003-0000-4000-8000-000000000003', null, 'Marcus will keep the cracker end cap through summer if we cover the ticketing. Confirm in writing before the next cycle.', now() - interval '6 days'),
  (seed_uuid('note:3'), '50000015-0000-4000-8000-000000000015', '20000003-0000-4000-8000-000000000003', null, 'New store manager since June. Nobody from us has introduced themselves. Range has quietly shrunk to two SKUs.', now() - interval '3 days'),
  (seed_uuid('note:4'), '50000012-0000-4000-8000-000000000012', '20000002-0000-4000-8000-000000000002', null, 'Credit hold since March. Tui is good for it but finance wants the old invoices cleared first.', now() - interval '20 days'),
  (seed_uuid('note:5'), '50000003-0000-4000-8000-000000000003', '20000001-0000-4000-8000-000000000001', null, 'Planogram reset due at the end of the month. Get the cracker facings agreed before head office sets it.', now() - interval '5 days')
on conflict do nothing;

drop table if exists seed_plan;
drop function if exists seed_uuid(text);
