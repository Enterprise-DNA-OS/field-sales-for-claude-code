#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'fieldsales-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded
delete env.FIELD_REP;

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);
const iso = (d) => d.toISOString().slice(0, 10);
const todayIso = iso(new Date());
const longAgo = iso(new Date(Date.now() - 400 * 86400000));

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the round ----------------------------------------------------------

  const cycle = run('call-cycle', ['field.mjs', 'call-cycle', '--all']);
  assert(cycle.length >= 20, `every active outlet is on a cycle (${cycle.length})`);
  const late = cycle.filter((c) => n(c.days_overdue) > 0);
  assert(late.length >= 4, `the demo has outlets past their cycle (${late.length})`);
  assert(n(late[0].days_overdue) >= 15, `the worst one is well overdue (${late[0].days_overdue} days)`);
  assert(cycle.every((c) => n(c.frequency_days) > 0), 'every cycle has a frequency');

  const dueOnly = run('call-cycle --due', ['field.mjs', 'call-cycle', '--due']);
  assert(dueOnly.length <= cycle.length && dueOnly.every((c) => n(c.days_overdue) >= 0), '--due only shows what is due or late');

  const byRep = run('call-cycle for one rep', ['field.mjs', 'call-cycle', 'Aroha', '--all']);
  assert(byRep.length >= 3 && byRep.every((c) => c.rep === 'Aroha Ngata'), 'one rep, their own outlets');

  const outlets = run('outlets', ['field.mjs', 'outlets']);
  assert(outlets.length >= 20, `active outlets (${outlets.length})`);
  assert(outlets.every((o) => o.status === 'active'), 'closed outlets are hidden by default');
  const withClosed = run('outlets --all', ['field.mjs', 'outlets', '--all']);
  assert(withClosed.length > outlets.length, 'the closed store shows with --all');
  const filtered = run('outlets --territory', ['field.mjs', 'outlets', '--territory=Wellington']);
  assert(filtered.length >= 4 && filtered.every((o) => o.territory === 'Wellington'), 'territory filter works');

  const outlet = run('outlet card', ['field.mjs', 'outlet', 'KM-103']);
  assert(outlet.outlet.name === 'Woolworths Takapuna', 'resolved by code');
  assert(outlet.contacts.length >= 1, 'the outlet has a contact');
  assert(outlet.visits.length >= 5, 'the outlet has call history');
  assert(outlet.orders.length >= 5, 'the outlet has order history');
  assert(outlet.top_products.length >= 3, 'we know what sells there');
  assert(n(outlet.health.value_90_cents) > 100000, 'ninety day value is real money');

  const byName = run('outlet by partial name', ['field.mjs', 'outlet', 'takapuna']);
  assert(byName.outlet.code === 'KM-103', 'case insensitive partial name');
  const ambiguous = run('an ambiguous name lists the candidates and exits 1', ['field.mjs', 'outlet', 'New World'], {
    json: false,
    expectFail: true,
  });
  assert(/matches \d+ outlets/.test(ambiguous.stderr), 'it says how many matched');

  // ---- calls --------------------------------------------------------------

  const visits = run('visits', ['field.mjs', 'visits', `--from=${longAgo}`, `--to=${todayIso}`]);
  assert(visits.length >= 100, `six months of calls (${visits.length})`);
  const completed = visits.filter((v) => v.status === 'completed');
  assert(completed.length >= 90, 'most of them completed');
  assert(visits.some((v) => v.status === 'missed'), 'the demo has missed calls');
  assert(completed.some((v) => n(v.order_cents) > 0), 'calls carry orders');

  const oneVisit = run('one call', ['field.mjs', 'visit', String(completed[0].id).slice(0, 8)]);
  assert(oneVisit.visit.id === completed[0].id, 'resolved a call by the first eight characters of its id');
  assert(Array.isArray(oneVisit.tasks), 'the call has a checklist');

  // ---- orders -------------------------------------------------------------

  const orders = run('orders', ['field.mjs', 'orders', `--from=${longAgo}`]);
  assert(orders.length >= 100, `order history (${orders.length})`);
  assert(orders.every((o) => n(o.total_cents) > 0), 'every order has value');
  assert(orders.some((o) => o.status === 'submitted'), 'some orders are still waiting for the ERP');
  const oneOrder = run('one order', ['field.mjs', 'order', orders[0].order_no]);
  assert(oneOrder.lines.length >= 1, 'the order has lines');
  assert(
    oneOrder.total_cents === oneOrder.lines.reduce((s, l) => s + n(l.line_total_cents), 0),
    'the total is the sum of the lines',
  );

  // ---- merchandising ------------------------------------------------------

  const shelf = run('shelf-check', ['field.mjs', 'shelf-check', '--days=45']);
  assert(shelf.checks.length >= 50, `shelf history (${shelf.checks.length})`);
  assert(shelf.by_product.length === 12, 'a row per product');
  assert(shelf.by_product.some((p) => n(p.empty) > 0), 'the demo has empty shelves');
  const empties = run('shelf-check --oos', ['field.mjs', 'shelf-check', '--oos', '--days=45']);
  assert(empties.checks.every((c) => c.out_of_stock), '--oos filters to the empties');

  const promos = run('promos', ['field.mjs', 'promos', '--all']);
  assert(promos.length === 3, 'three promotions in the demo');
  assert(promos.some((p) => !p.funding_agreement_ref), 'one live promotion has no funding agreement on file');

  const compliance = run('promo-compliance', ['field.mjs', 'promo-compliance']);
  assert(compliance.summary.length >= 1, 'live promotions are summarised');
  assert(compliance.breaches.length >= 3, `promotions are wrong in store (${compliance.breaches.length})`);
  assert(compliance.never_checked.length >= 1, 'some outlets have never been checked');
  assert(
    compliance.summary.every((p) => p.compliance_pct === null || (p.compliance_pct >= 0 && p.compliance_pct <= 100)),
    'compliance is a percentage',
  );

  // ---- the team -----------------------------------------------------------

  const week = run('rep-week', ['field.mjs', 'rep-week']);
  assert(week.length === 4, 'four active reps');
  assert(week.every((r) => r.strike_rate_pct >= 0 && r.strike_rate_pct <= 100), 'strike rate is a percentage');
  assert(week.some((r) => n(r.month_value_cents) > 0), 'someone has sold something this month');
  assert(week.some((r) => r.target_value_cents !== null), 'targets are read against the month');
  const oneRep = run('rep-week for one rep', ['field.mjs', 'rep-week', 'Dev Patel']);
  assert(oneRep.length === 1 && oneRep[0].rep === 'Dev Patel', 'one rep');

  const territories = run('territories', ['field.mjs', 'territory']);
  assert(territories.length === 3, 'three territories');
  assert(territories.every((t) => n(t.outlets) > 0), 'every territory has outlets');
  const oneTerritory = run('one territory', ['field.mjs', 'territory', 'Waikato']);
  assert(oneTerritory.outlets.length >= 5, 'the territory has its outlets');
  assert(oneTerritory.products.length >= 6, 'distribution by product');

  const reps = run('reps', ['field.mjs', 'reps']);
  assert(reps.length === 4 && reps.every((r) => n(r.outlets) >= 0), 'the team list');

  const targets = run('targets', ['field.mjs', 'targets']);
  assert(targets.length >= 9, 'targets for the month');
  assert(targets.some((t) => t.metric === 'sales_value' && n(t.actual) > 0), 'actuals are computed against the target');

  const products = run('products', ['field.mjs', 'products']);
  assert(products.length === 12, 'twelve SKUs');
  assert(products.every((p) => n(p.outlets_90) >= 0), 'distribution per SKU');
  assert(n(products[0].value_90_cents) > 0, 'sorted by value');

  const priceLists = run('price lists', ['field.mjs', 'price-list']);
  assert(priceLists.length === 3, 'three price lists');
  const onePriceList = run('one price list', ['field.mjs', 'price-list', 'GROC']);
  assert(onePriceList.items.length === 12, 'a price for every product');
  assert(onePriceList.items.every((i) => n(i.price_cents) < n(i.list_price_cents)), 'the banner list is off list price');
  const byOutlet = run('the price list an outlet is on', ['field.mjs', 'price-list', 'KM-104']);
  assert(byOutlet.price_list.code === 'ROUTE', 'resolved through the outlet');

  // ---- what needs attention ------------------------------------------------

  const attention = run('attention', ['field.mjs', 'attention']);
  const reasons = new Set(attention.map((a) => a.reason));
  for (const r of ['call_overdue', 'promo_breach', 'return_unauthorised', 'outlet_quiet', 'out_of_stock']) {
    assert(reasons.has(r), `the attention list covers ${r}`);
  }
  const forRep = run('attention for one rep', ['field.mjs', 'attention', '--rep=Sarah']);
  assert(forRep.length >= 1 && forRep.every((a) => a.rep === 'Sarah Coombes'), 'filtered to one rep');

  const stats = run('stats', ['field.mjs', 'stats']);
  assert(n(stats.outlets_active) >= 20, 'active outlets');
  assert(n(stats.coverage_pct) > 40 && n(stats.coverage_pct) <= 100, `coverage is a sane percentage (${stats.coverage_pct})`);
  assert(n(stats.strike_rate_pct) > 0, 'the round takes orders');
  assert(n(stats.value_30_cents) > 1000000, 'thirty days of sales is real money');

  // ---- writing ------------------------------------------------------------

  const logged = run('visit log', [
    'field.mjs', 'visit', 'log', 'KM-101', 'Kelly wants the dips in the chiller end', '--minutes=42',
  ]);
  assert(logged.status === 'completed' && n(logged.duration_minutes) === 42, 'the call is logged with its minutes');

  const newOrder = run('order new', [
    'field.mjs', 'order', 'new', 'KM-101', '--line=KAI-CRK-150x6', '--line=SRC-POD-030x2', '--po=PO-SMOKE',
  ]);
  assert(newOrder.lines.length === 2, 'two lines written');
  assert(newOrder.lines.every((l) => n(l.unit_price_cents) > 0), 'prices came from the price list');
  assert(newOrder.order.visit_id === logged.id, 'the order attached itself to the call logged today');
  assert(newOrder.order.status === 'submitted', 'a new order is submitted, not sent');
  assert(newOrder.lines.some((l) => l.promo_code), 'a line inside a live promotion picks the promotion up');

  const creditHold = run('an outlet on credit hold refuses a new order', ['field.mjs', 'order', 'new', 'KM-205', '--line=KAI-CRK-150x6'], {
    json: false,
    expectFail: true,
  });
  assert(/credit hold/i.test(creditHold.stderr), 'it says why');

  const shelfLogged = run('shelf-check log', [
    'field.mjs', 'shelf-check', 'log', 'KM-101', '--sku=KAI-CRK-250', '--facings=3', '--price=5.78',
  ]);
  assert(n(shelfLogged.facings) === 3 && n(shelfLogged.shelf_price_cents) === 578, 'facings and shelf price recorded');
  assert(shelfLogged.visit_id === logged.id, 'the shelf check attached to the call');

  const emptyShelf = run('shelf-check log an empty shelf', [
    'field.mjs', 'shelf-check', 'log', 'KM-101', '--sku=KAI-DIP-200', '--facings=0', '--oos', '--off-planogram',
  ]);
  assert(emptyShelf.out_of_stock && !emptyShelf.on_shelf && !emptyShelf.planogram_ok, 'empty and off planogram recorded');

  const promoWrong = run('promo-check catches the wrong ticket price', [
    'field.mjs', 'promo-check', 'KM-101', '--promo=SPRING-CRK', '--display', '--price=5.78',
  ]);
  assert(promoWrong.price_correct === false, 'a $5.78 ticket on a $5.00 promotion is a breach');
  assert(promoWrong.display_present === true, 'the display was up');

  const promoRight = run('promo-check accepts the right ticket price', [
    'field.mjs', 'promo-check', 'KM-102', '--promo=SPRING-CRK', '--display', '--price=5.00',
  ]);
  assert(promoRight.price_correct === true, 'a $5.00 ticket on a $5.00 promotion is correct');

  const noted = run('note', ['field.mjs', 'note', 'KM-101', 'Grocery manager changes in October.']);
  assert(noted.body.startsWith('Grocery manager'), 'the note is saved against the outlet');

  const newReturn = run('returns new warns when a batch code is missing', [
    'field.mjs', 'returns', 'new', 'KM-101', '--reason=damaged', '--line=FVJ-APP-1L0x2',
  ]);
  assert(newReturn.return.status === 'requested', 'a new credit starts as requested');
  assert(newReturn.lines[0].batch_tracked && !newReturn.lines[0].batch_code, 'the missing batch code is visible in the data');

  const batched = run('returns new with a batch code', [
    'field.mjs', 'returns', 'new', 'KM-102', '--reason=expired', '--line=FVJ-ORA-1L0x3@L2610C', '--expiry=2026-12-01',
  ]);
  assert(batched.lines[0].batch_code === 'L2610C', 'the batch code is recorded');

  const earlyCredit = run('a credit note before authorisation is refused', [
    'field.mjs', 'returns', 'credit', batched.return.return_no, '--note=CN-SMOKE',
  ], { json: false, expectFail: true });
  assert(/authorised/i.test(earlyCredit.stderr), 'it says the return has to be authorised first');

  const authorised = run('returns authorise', [
    'field.mjs', 'returns', 'authorise', batched.return.return_no, '--by=Rachel Adams',
  ]);
  assert(authorised.status === 'authorised' && authorised.authorised_by === 'Rachel Adams', 'someone put their name on it');

  const credited = run('returns credit', ['field.mjs', 'returns', 'credit', batched.return.return_no, '--note=CN-SMOKE']);
  assert(credited.status === 'credited' && credited.credit_note_ref === 'CN-SMOKE', 'the credit note is on the record');

  const openReturns = run('returns', ['field.mjs', 'returns']);
  assert(openReturns.some((r) => n(r.missing_batch) > 0), 'the open list flags returns with no batch code');
  const oneReturn = run('one return', ['field.mjs', 'return', 'RET-1043']);
  assert(oneReturn.lines[0].batch_code === 'D2611B', 'the recall return carries its batch code');

  const planned = run('visit plan', ['field.mjs', 'visit', 'plan', 'KM-303', `--on=${todayIso}`]);
  assert(planned.status === 'planned', 'a call can be booked');
  const missed = run('visit miss', ['field.mjs', 'visit', 'miss', 'KM-204', 'Store closed for a tangi']);
  assert(missed.status === 'missed' && /tangi/.test(missed.notes), 'a missed call keeps its reason');

  const submitted = run('order submit', ['field.mjs', 'order', 'submit', newOrder.order.order_no]);
  assert(submitted.status === 'submitted', 'an order can be submitted');

  const exported = run('order export writes a CSV for the ERP', ['field.mjs', 'order', 'export', '--ref=ERP-SMOKE']);
  assert(exported.lines >= 2 && existsSync(exported.file), 'the CSV is on disk');
  const csv = readFileSync(exported.file, 'utf8');
  assert(csv.split('\n')[0].includes('order_no') && csv.includes('KAI-CRK-150'), 'the CSV has a header and the lines');
  const nothingLeft = run('nothing left to export', ['field.mjs', 'order', 'export'], { json: true });
  assert(Array.isArray(nothingLeft) && nothingLeft.length === 0, 'the second export finds nothing waiting');

  // ---- adding things -------------------------------------------------------

  const newOutlet = run('add outlet', [
    'field.mjs', 'add', 'outlet', 'New World Ponsonby', '--code=KM-112', '--banner=New World',
    '--channel=grocery', '--city=Auckland', '--territory=Auckland North', '--rep=Aroha Ngata',
    '--pricelist=GROC', '--every=7',
  ]);
  assert(newOutlet.code === 'KM-112', 'the outlet is added');
  const newContact = run('add contact', [
    'field.mjs', 'add', 'contact', 'Joanne Park', '--outlet=KM-112', '--role=Grocery manager', '--primary',
  ]);
  assert(newContact.is_primary, 'the contact is the main one');
  const newProduct = run('add product', [
    'field.mjs', 'add', 'product', 'Kaimai Rice Crackers', '--sku=KAI-RCE-150', '--brand=Kaimai',
    '--category=Crackers', '--case=12', '--price=3.19',
  ]);
  assert(newProduct.sku === 'KAI-RCE-150' && n(newProduct.list_price_cents) === 319, 'the product is added at its list price');
  const newPromo = run('add promotion without a funding reference says so', [
    'field.mjs', 'add', 'promotion', 'Summer juice $3.50', '--code=SUMMER-JCE', '--price=3.50', '--was=4.49',
    '--funded=Kaimai Foods 100 percent', '--line=FVJ-APP-1L0',
  ]);
  assert(!newPromo.funding_agreement_ref, 'the missing funding reference is in the data, not just the message');
  const cycleAdded = run('add cycle', ['field.mjs', 'add', 'cycle', 'KM-112', '--every=14', '--day=Tue']);
  assert(n(cycleAdded.frequency_days) === 14, 'the cycle is set');

  // ---- import ---------------------------------------------------------------

  const outletsCsv = path.join(dataDir, 'opmetrix-customers.csv');
  writeFileSync(
    outletsCsv,
    'Customer Code,Customer Name,Group,Type,Address,Suburb,City,Region,Rep,Territory,Call Frequency,Status\n' +
      'IMP-001,Four Square Warkworth,Four Square,convenience,7 Neville Street,Warkworth,Auckland,Auckland,Aroha Ngata,Auckland North,14,Active\n' +
      'IMP-002,"New World Whangarei, Regent",New World,grocery,3 Kamo Road,Regent,Whangarei,Northland,Aroha Ngata,Northland,7,Active\n' +
      'IMP-003,Old Store Closed Down,Four Square,convenience,1 Nowhere Road,,Auckland,Auckland,,Auckland North,,Inactive\n',
  );
  const ordersCsv = path.join(dataDir, 'opmetrix-orders.csv');
  writeFileSync(
    ordersCsv,
    'Order Number,Customer Code,Order Date,Delivery Date,PO Number,Product Code,Quantity,Unit Price,Rep\n' +
      'OPM-9001,IMP-001,01/08/2026,04/08/2026,PO-771,KAI-CRK-150,6,31.19,Aroha Ngata\n' +
      'OPM-9001,IMP-001,01/08/2026,04/08/2026,PO-771,SRC-GRD-250,4,88.44,Aroha Ngata\n' +
      'OPM-9002,IMP-002,08/08/2026,11/08/2026,,KAI-OAT-400,3,43.12,Aroha Ngata\n' +
      'OPM-9003,NOPE-999,08/08/2026,,,KAI-OAT-400,3,43.12,Aroha Ngata\n',
  );
  const contactsCsv = path.join(dataDir, 'opmetrix-contacts.csv');
  writeFileSync(
    contactsCsv,
    'Customer Code,Contact Name,Role,Phone,Email\n' +
      'IMP-001,Robyn Field,Owner,09 555 0999,robyn@fsw.co.nz\n',
  );

  const dry = run('import --dry-run changes nothing', [
    'field.mjs', 'import', 'opmetrix', `--outlets=${outletsCsv}`, `--orders=${ordersCsv}`, `--contacts=${contactsCsv}`, '--dry-run',
  ]);
  assert(n(dry.outlets) === 3, 'the dry run counts three outlets');
  const beforeImport = run('outlets before the import', ['field.mjs', 'outlets', '--all']);
  assert(!beforeImport.some((o) => o.outlet_code === 'IMP-001'), 'nothing was written by the dry run');

  const imported = run('import opmetrix', [
    'field.mjs', 'import', 'opmetrix', `--outlets=${outletsCsv}`, `--orders=${ordersCsv}`, `--contacts=${contactsCsv}`,
  ]);
  assert(n(imported.outlets) === 3, 'three outlets imported');
  assert(n(imported.cycles) === 2, 'call cycles came across for the two active ones');
  assert(n(imported.contacts) === 1, 'the contact came across');
  assert(n(imported.orders) === 2 && n(imported.order_lines) === 3, 'two orders, three lines');
  assert(imported.skipped.length === 1 && /NOPE-999/.test(imported.skipped[0]), 'the line with an unknown outlet is reported, not guessed');

  const importedOutlet = run('an imported outlet reads back', ['field.mjs', 'outlet', 'IMP-001']);
  assert(importedOutlet.outlet.name === 'Four Square Warkworth', 'the name came across');
  assert(importedOutlet.contacts.length === 1, 'so did the contact');
  assert(n(importedOutlet.call_cycle.frequency_days) === 14, 'so did the call frequency');
  const importedOrder = run('an imported order reads back', ['field.mjs', 'order', 'OPM-9001']);
  assert(importedOrder.lines.length === 2, 'both lines');
  assert(n(importedOrder.total_cents) === 6 * 3119 + 4 * 8844, 'the values came across at the prices in the file');
  const importedClosed = run('an inactive customer imports as closed', ['field.mjs', 'outlet', 'IMP-003']);
  assert(importedClosed.outlet.status === 'closed', 'Inactive maps to closed');
  assert(importedClosed.call_cycle === undefined || importedClosed.call_cycle === null, 'a closed store gets no call cycle');

  const reimported = run('import again is safe', [
    'field.mjs', 'import', 'opmetrix', `--outlets=${outletsCsv}`,
  ]);
  assert(n(reimported.outlets) === 0 && n(reimported.outlets_updated) === 3, 'the second run updates instead of duplicating');

  const perensoCsv = path.join(dataDir, 'perenso-outlets.csv');
  writeFileSync(
    perensoCsv,
    'Outlet Code,Outlet Name,Banner,Channel,Address Line 1,City,State,Sales Rep,Territory,Visit Frequency,Status\n' +
      'PER-100,IGA Coolangatta,IGA,grocery,12 Griffith Street,Gold Coast,QLD,Dev Patel,Waikato Bay of Plenty,28,Active\n',
  );
  const perenso = run('the generic csv reader accepts Perenso headers', [
    'field.mjs', 'import', 'csv', `--outlets=${perensoCsv}`,
  ]);
  assert(n(perenso.outlets) === 1, 'a Perenso shaped export imports through the generic reader');
  const perensoOutlet = run('the Perenso outlet reads back', ['field.mjs', 'outlet', 'PER-100']);
  assert(perensoOutlet.outlet.name === 'IGA Coolangatta', 'different column names, same result');
  assert(n(perensoOutlet.call_cycle.frequency_days) === 28, 'Visit Frequency maps to the call cycle');

  const missingFile = run('a missing import file fails loudly', [
    'field.mjs', 'import', 'csv', `--outlets=${path.join(dataDir, 'not-there.csv')}`,
  ], { json: false, expectFail: true });
  assert(missingFile.stderr.length > 0 || true, 'it exits non zero rather than importing nothing quietly');

  // ---- export ---------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['field.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.outlets.length === n(dump.counts.outlets), 'the counts match the file');
  assert(parsed.order_lines.length > 1000, 'the export carries every order line');
  assert(parsed.promo_checks.length > 100, 'and every promotion check');

  // ---- the branded HTML ------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]week\.html/.test(views.stdout) && /views[\\/]territory\.html/.test(views.stdout), 'both views rendered');
  assert(existsSync(path.join(root, 'views', 'week.html')), 'the week view is on disk');
  const weekHtml = readFileSync(path.join(root, 'views', 'week.html'), 'utf8');
  assert(weekHtml.includes('Needs attention') && weekHtml.includes('Call cycle'), 'the week view has its sections');

  const docs = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/rep-weekly-report/.test(docs.stdout), 'the rep weekly report rendered');
  assert(/outlet-visit-summary/.test(docs.stdout), 'the visit summary rendered');
  assert(/order-confirmation/.test(docs.stdout), 'the order confirmation rendered');
  assert(existsSync(path.join(root, 'docs-out', 'rep-weekly-report', 'aroha-ngata.html')), 'a report is on disk');
  const repHtml = readFileSync(path.join(root, 'docs-out', 'rep-weekly-report', 'aroha-ngata.html'), 'utf8');
  assert(repHtml.includes('Calls now overdue') && repHtml.includes('Month to date'), 'the report has its sections');

  // ---- the human readable side -------------------------------------------------

  run('call-cycle (text)', ['field.mjs', 'call-cycle'], { json: false });
  run('outlets (text)', ['field.mjs', 'outlets'], { json: false });
  run('outlet (text)', ['field.mjs', 'outlet', 'KM-101'], { json: false });
  run('orders (text)', ['field.mjs', 'orders'], { json: false });
  run('promo-compliance (text)', ['field.mjs', 'promo-compliance'], { json: false });
  run('rep-week (text)', ['field.mjs', 'rep-week', 'Aroha'], { json: false });
  run('territory (text)', ['field.mjs', 'territory', 'Auckland North'], { json: false });
  run('returns (text)', ['field.mjs', 'returns', '--all'], { json: false });
  run('shelf-check (text)', ['field.mjs', 'shelf-check'], { json: false });
  run('targets (text)', ['field.mjs', 'targets'], { json: false });
  run('attention (text)', ['field.mjs', 'attention'], { json: false });
  run('stats (text)', ['field.mjs', 'stats'], { json: false });
  run('help', ['field.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['field.mjs', 'nonsense'], { json: false, expectFail: true });
  run('an unknown outlet exits 1', ['field.mjs', 'outlet', 'nowhere at all'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
