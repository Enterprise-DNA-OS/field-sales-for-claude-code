#!/usr/bin/env node
// field-sales-for-claude-code: the one CLI. Claude Code slash commands call this; so can you.
//
//   node scripts/field.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick, yesNo } from './lib/csv.mjs';
import { table, money, price, isoDate, weekday, short, truncate, heading, bar } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set([
  'json', 'help', 'all', 'due', 'overdue', 'oos', 'off-planogram', 'display', 'ticket',
  'detail', 'open', 'breaches', 'dry-run', 'csv', 'no-display', 'no-ticket',
]);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  const repeated = { line: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      if (name === 'line') repeated.line.push(value);
      else flags[name] = value;
    } else {
      args.push(a);
    }
  }
  flags.lines = repeated.line;
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const pct = (v) => (v === null || v === undefined ? '' : `${Math.round(Number(v))}%`);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------------
// Dates

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return addDays(iso, -((d.getDay() + 6) % 7));
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // Field sales exports write DD/MM/YYYY in New Zealand and Australia.
  const slash = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = a > 12 ? [a, b] : [b, a];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

function parseMoney(v) {
  if (v === undefined || v === null || v === '' || v === true) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not an amount.`);
  return Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// Lookups: full id, first 4+ characters of an id, exact code or name, then contains.
// One hit wins. Several hits list the candidates and exit 1.

const RESOLVERS = {
  outlet: {
    from: 'outlets c left join territories t on t.id = c.territory_id left join reps r on r.id = c.rep_id',
    cols: 'c.*, t.name as territory_name, r.full_name as rep_name',
    exact: 'lower(c.code) = lower($1) or lower(c.name) = lower($1) or lower(c.external_ref) = lower($1)',
    fuzzy: 'c.name ilike $1 or c.code ilike $1 or c.suburb ilike $1',
    label: (r) => `${r.code}  ${r.name} (${r.city || ''}${r.status === 'active' ? '' : ', ' + r.status})`,
    order: 'c.code',
    listing: 'outlets --all',
  },
  rep: {
    from: 'reps c left join territories t on t.id = c.territory_id',
    cols: 'c.*, t.name as territory_name',
    exact: 'lower(c.full_name) = lower($1) or lower(c.code) = lower($1) or lower(c.email) = lower($1)',
    fuzzy: 'c.full_name ilike $1 or c.code ilike $1',
    label: (r) => `${r.full_name} (${r.role})`,
    order: 'c.full_name',
    listing: 'reps',
  },
  product: {
    from: 'products c',
    cols: 'c.*',
    exact: 'lower(c.sku) = lower($1) or lower(c.name) = lower($1)',
    fuzzy: 'c.sku ilike $1 or c.name ilike $1 or c.brand ilike $1',
    label: (r) => `${r.sku}  ${r.name} ${r.unit_size || ''}`,
    order: 'c.sku',
    listing: 'products',
  },
  promotion: {
    from: 'promotions c',
    cols: 'c.*',
    exact: 'lower(c.code) = lower($1) or lower(c.name) = lower($1)',
    fuzzy: 'c.code ilike $1 or c.name ilike $1',
    label: (r) => `${r.code}  ${r.name} (${r.status})`,
    order: 'c.starts_on desc',
    listing: 'promos --all',
  },
  territory: {
    from: 'territories c',
    cols: 'c.*',
    exact: 'lower(c.name) = lower($1) or lower(c.code) = lower($1)',
    fuzzy: 'c.name ilike $1 or c.code ilike $1 or c.region ilike $1',
    label: (r) => `${r.name}${r.code ? ` (${r.code})` : ''}`,
    order: 'c.name',
    listing: 'territories',
  },
  order: {
    from: 'orders c join outlets o on o.id = c.outlet_id',
    cols: 'c.*, o.name as outlet_name, o.code as outlet_code',
    exact: 'lower(c.order_no) = lower($1) or lower(c.po_number) = lower($1)',
    fuzzy: 'c.order_no ilike $1 or o.name ilike $1',
    label: (r) => `${r.order_no}  ${r.outlet_name} (${r.status})`,
    order: 'c.ordered_on desc',
    listing: 'orders',
  },
  return: {
    from: 'returns c join outlets o on o.id = c.outlet_id',
    cols: 'c.*, o.name as outlet_name, o.code as outlet_code',
    exact: 'lower(c.return_no) = lower($1)',
    fuzzy: 'c.return_no ilike $1 or o.name ilike $1',
    label: (r) => `${r.return_no}  ${r.outlet_name} (${r.status})`,
    order: 'c.requested_on desc',
    listing: 'returns --all',
  },
  visit: {
    from: 'visits c join outlets o on o.id = c.outlet_id left join reps r on r.id = c.rep_id',
    cols: 'c.*, o.name as outlet_name, o.code as outlet_code, r.full_name as rep_name',
    exact: 'lower(c.external_ref) = lower($1)',
    fuzzy: 'o.name ilike $1',
    label: (r) => `${short(r.id)}  ${r.outlet_name} ${isoDate(r.visited_on || r.planned_on)} (${r.status})`,
    order: 'coalesce(c.visited_on, c.planned_on) desc',
    listing: 'visits',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, code or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where c.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
  }
  if (!rows.length) rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query(`${select} where ${spec.fuzzy} order by ${spec.order}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (kind === 'outlet' && rows.length > 1) {
    const active = rows.filter((r) => r.status === 'active');
    if (active.length === 1) return active[0];
  }
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(
    `"${q}" matches ${rows.length} ${kind}s. Use a code, an id, or a longer name:\n` +
      rows.map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'),
  );
}

// The rep on the road: --rep, FIELD_REP, or the only active rep.
async function whoIs(db, flags, { optional = false } = {}) {
  const named = flags.rep || process.env.FIELD_REP;
  if (named && named !== true) return resolve(db, 'rep', named);
  const rows = await db.query('select * from reps where active order by full_name');
  if (rows.length === 1) return rows[0];
  if (optional) return null;
  if (!rows.length) throw new CliError('No reps on file. Add one: add rep "<name>" --territory="<territory>"');
  throw new CliError(
    'Several reps work here. Pass --rep= (or set FIELD_REP):\n' +
      rows.map((r) => `  ${r.code || short(r.id)}  ${r.full_name}`).join('\n'),
  );
}

// "KAI-CRK-150x6", "KAI-CRK-150:6", "6xKAI-CRK-150", "KAI-CRK-150 6"
function parseLineSpec(spec) {
  const s = String(spec).trim();
  let m = s.match(/^(.+?)\s*[x:*]\s*(\d+)$/i);
  if (m) return { sku: m[1].trim(), qty: Number(m[2]) };
  m = s.match(/^(\d+)\s*[x:*]\s*(.+)$/i);
  if (m) return { sku: m[2].trim(), qty: Number(m[1]) };
  m = s.match(/^(.+?)\s+(\d+)$/);
  if (m) return { sku: m[1].trim(), qty: Number(m[2]) };
  throw new CliError(`"${spec}" is not a line. Use --line=SKUx6 (product then cases).`);
}

// The price one outlet pays for one product: its price list, then the list price.
// Prices are held per unit; an order line is a case.
async function casePrice(db, outlet, product) {
  if (outlet.price_list_id) {
    const [row] = await db.query(
      'select price_cents from price_list_items where price_list_id = $1 and product_id = $2',
      [outlet.price_list_id, product.id],
    );
    if (row) return Number(row.price_cents) * Number(product.case_size || 1);
  }
  return Number(product.list_price_cents) * Number(product.case_size || 1);
}

// Returns run on a simple counter: RET-1041, RET-1042.
async function nextReturnNo(db) {
  const rows = await db.query(`select return_no from returns where return_no like 'RET-%'`);
  let last = 1000;
  for (const r of rows) {
    const n = Number(String(r.return_no).replace(/\D/g, ''));
    if (Number.isFinite(n) && n > last) last = n;
  }
  return `RET-${last + 1}`;
}

// Orders carry the date and the outlet, the way a rep reads them back: SO-260914-104.
async function nextOrderNo(db, outlet, on) {
  const base = `SO-${on.slice(2).replace(/-/g, '')}-${String(outlet.code).replace(/[^0-9A-Za-z]/g, '').slice(-3)}`;
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while ((await db.query('select 1 from orders where lower(order_no) = lower($1)', [candidate])).length) {
    candidate = `${base}-${++n}`;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Reads

async function cmdOutlets(db, args, flags) {
  const where = ['1=1'];
  const params = [];
  if (!flags.all) where.push(`h.status = 'active'`);
  if (args[0]) {
    params.push(`%${args[0]}%`);
    where.push(`(h.outlet ilike $${params.length} or h.outlet_code ilike $${params.length} or h.banner ilike $${params.length})`);
  }
  if (flags.territory && flags.territory !== true) {
    const t = await resolve(db, 'territory', flags.territory);
    params.push(t.name);
    where.push(`h.territory = $${params.length}`);
  }
  if (flags.rep && flags.rep !== true) {
    const r = await resolve(db, 'rep', flags.rep);
    params.push(r.full_name);
    where.push(`h.rep = $${params.length}`);
  }
  if (flags.channel && flags.channel !== true) {
    params.push(String(flags.channel).toLowerCase());
    where.push(`lower(h.channel) = $${params.length}`);
  }
  const rows = await db.query(
    `select * from v_outlet_health h where ${where.join(' and ')} order by h.value_90_cents desc, h.outlet`,
    params,
  );
  const text =
    heading(`Outlets (${rows.length})`) +
    '\n' +
    table(rows, [
      { key: 'outlet_code', label: 'Code' },
      { key: 'outlet', label: 'Outlet', width: 28 },
      { key: 'channel', label: 'Channel', width: 12 },
      { key: 'territory', label: 'Territory', width: 16 },
      { key: 'rep', label: 'Rep', width: 14 },
      { key: 'days_since_visit', label: 'Last call', align: 'right', format: (v) => (v === null ? 'never' : `${v}d`) },
      { key: 'orders_90', label: 'Ord 90d', align: 'right' },
      { key: 'value_90_cents', label: 'Value 90d', align: 'right', format: (v) => money(v) },
      { key: 'trend_pct', label: 'Trend', align: 'right', format: (v) => (v === null ? '' : `${v > 0 ? '+' : ''}${v}%`) },
    ]);
  return { text, json: rows };
}

async function cmdOutlet(db, args, flags) {
  const outlet = await resolve(db, 'outlet', args.join(' '));
  const [health] = await db.query('select * from v_outlet_health where outlet_id = $1', [outlet.id]);
  const [cycle] = await db.query(
    `select c.*, r.full_name as rep_name from call_cycles c left join reps r on r.id = c.rep_id where c.outlet_id = $1`,
    [outlet.id],
  );
  const contacts = await db.query('select * from contacts where outlet_id = $1 order by is_primary desc, full_name', [outlet.id]);
  const visits = await db.query(
    `select v.*, r.full_name as rep_name,
            (select count(*) from orders o where o.visit_id = v.id) as orders
     from visits v left join reps r on r.id = v.rep_id
     where v.outlet_id = $1 order by coalesce(v.visited_on, v.planned_on) desc limit 8`,
    [outlet.id],
  );
  const orders = await db.query(
    'select * from v_order_totals where outlet_id = $1 order by ordered_on desc limit 8',
    [outlet.id],
  );
  const shelf = await db.query(
    `select sc.*, p.sku, p.name as product from shelf_checks sc join products p on p.id = sc.product_id
     where sc.outlet_id = $1 and sc.checked_on = (select max(checked_on) from shelf_checks where outlet_id = $1)
     order by p.sku`,
    [outlet.id],
  );
  const rets = await db.query(
    `select r.*, coalesce((select sum(line_total_cents) from return_lines l where l.return_id = r.id), 0) as total_cents
     from returns r where r.outlet_id = $1 order by r.requested_on desc limit 5`,
    [outlet.id],
  );
  const notes = await db.query(
    `select n.*, r.full_name as rep_name from outlet_notes n left join reps r on r.id = n.rep_id
     where n.outlet_id = $1 order by n.created_at desc limit 5`,
    [outlet.id],
  );
  const top = await db.query(
    `select p.sku, p.name as product, sum(l.quantity)::integer as cases, sum(l.line_total_cents)::bigint as value_cents
     from order_lines l join orders o on o.id = l.order_id join products p on p.id = l.product_id
     where o.outlet_id = $1 and o.status <> 'cancelled' and o.ordered_on >= current_date - 180
     group by p.sku, p.name order by value_cents desc limit 6`,
    [outlet.id],
  );

  const lines = [];
  lines.push(heading(`${outlet.code}  ${outlet.name}`));
  lines.push(`  ${[outlet.banner, outlet.channel, [outlet.suburb, outlet.city].filter(Boolean).join(', ')].filter(Boolean).join('  |  ')}`);
  lines.push(`  Territory ${outlet.territory_name || 'unassigned'}  |  Rep ${outlet.rep_name || 'unassigned'}  |  Status ${outlet.status}${outlet.credit_hold ? '  |  ON CREDIT HOLD' : ''}`);
  if (cycle) {
    lines.push(
      `  Call cycle: every ${cycle.frequency_days} days${cycle.preferred_weekday === null ? '' : `, ${WEEKDAYS[cycle.preferred_weekday]}`}` +
        `  |  Last call ${health?.last_visit_on ? isoDate(health.last_visit_on) : 'never'}` +
        `  |  Last order ${health?.last_order_on ? isoDate(health.last_order_on) : 'never'}`,
    );
  }
  if (health) {
    lines.push(
      `  90 days: ${health.orders_90} orders, ${money(health.value_90_cents)}` +
        `${health.trend_pct === null ? '' : ` (${health.trend_pct > 0 ? '+' : ''}${health.trend_pct}% on the 90 before)`}` +
        `  |  Out of stock (30d) ${health.oos_30}  |  Off planogram (30d) ${health.planogram_fails_30}  |  Open credits ${health.open_returns}`,
    );
  }
  if (outlet.notes) lines.push(`  Note: ${outlet.notes}`);

  lines.push(heading('Contacts'));
  lines.push(table(contacts, [
    { key: 'full_name', label: 'Name', width: 22 },
    { key: 'role', label: 'Role', width: 18 },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email', width: 30 },
    { key: 'is_primary', label: 'Main', format: (v) => (v ? 'yes' : '') },
  ]));

  lines.push(heading('Recent calls'));
  lines.push(table(visits, [
    { key: 'id', label: 'Id', format: short },
    { key: 'visited_on', label: 'Date', format: (v, r) => isoDate(v || r.planned_on) },
    { key: 'status', label: 'Status', width: 10 },
    { key: 'rep_name', label: 'Rep', width: 14 },
    { key: 'duration_minutes', label: 'Mins', align: 'right' },
    { key: 'orders', label: 'Order', align: 'right', format: (v) => (num(v) ? 'yes' : 'no') },
    { key: 'notes', label: 'Notes', width: 34, format: (v, r) => truncate(v || r.no_order_reason || '', 34) },
  ]));

  lines.push(heading('Recent orders'));
  lines.push(table(orders, [
    { key: 'order_no', label: 'Order' },
    { key: 'ordered_on', label: 'Date', format: isoDate },
    { key: 'status', label: 'Status', width: 10 },
    { key: 'line_count', label: 'Lines', align: 'right' },
    { key: 'units', label: 'Cases', align: 'right' },
    { key: 'total_cents', label: 'Value', align: 'right', format: (v) => money(v) },
    { key: 'erp_ref', label: 'ERP ref', width: 18 },
  ]));

  lines.push(heading('What sells here (180 days)'));
  lines.push(table(top, [
    { key: 'sku', label: 'SKU' },
    { key: 'product', label: 'Product', width: 30 },
    { key: 'cases', label: 'Cases', align: 'right' },
    { key: 'value_cents', label: 'Value', align: 'right', format: (v) => money(v) },
  ]));

  lines.push(heading('Last shelf check'));
  lines.push(table(shelf, [
    { key: 'sku', label: 'SKU' },
    { key: 'product', label: 'Product', width: 28 },
    { key: 'facings', label: 'Facings', align: 'right' },
    { key: 'shelf_price_cents', label: 'Shelf price', align: 'right', format: (v) => price(v) },
    { key: 'out_of_stock', label: 'Empty', format: (v) => (v ? 'EMPTY' : '') },
    { key: 'planogram_ok', label: 'Planogram', format: (v) => (v ? 'ok' : 'OFF') },
  ]));

  lines.push(heading('Credits and returns'));
  lines.push(table(rets, [
    { key: 'return_no', label: 'Number' },
    { key: 'requested_on', label: 'Asked', format: isoDate },
    { key: 'reason', label: 'Reason', width: 14 },
    { key: 'status', label: 'Status', width: 12 },
    { key: 'total_cents', label: 'Value', align: 'right', format: (v) => money(v) },
  ]));

  if (notes.length) {
    lines.push(heading('Notes'));
    for (const n of notes) lines.push(`  ${isoDate(n.created_at)}  ${n.rep_name || ''}: ${n.body}`);
  }

  return {
    text: lines.join('\n'),
    json: { outlet, health, call_cycle: cycle, contacts, visits, orders, top_products: top, shelf_checks: shelf, returns: rets, notes },
  };
}

async function cmdCallCycle(db, args, flags) {
  const where = ['1=1'];
  const params = [];
  const repArg = flags.rep || args[0];
  if (repArg && repArg !== true) {
    const rep = await resolve(db, 'rep', repArg);
    params.push(rep.full_name);
    where.push(`d.rep = $${params.length}`);
  }
  if (flags.territory && flags.territory !== true) {
    const t = await resolve(db, 'territory', flags.territory);
    params.push(t.name);
    where.push(`d.territory = $${params.length}`);
  }
  if (flags.due || flags.overdue) where.push('d.days_overdue >= 0');
  const horizon = flags.days && flags.days !== true ? Number(flags.days) : 7;
  if (!flags.all && !flags.due && !flags.overdue) where.push(`d.days_overdue >= ${-Math.abs(horizon)}`);

  const rows = await db.query(
    `select * from v_call_cycle_due d where ${where.join(' and ')} order by d.days_overdue desc, d.sequence, d.outlet`,
    params,
  );
  const overdue = rows.filter((r) => num(r.days_overdue) > 0);
  const text =
    heading(`Call cycle (${rows.length} outlets, ${overdue.length} past due)`) +
    '\n' +
    table(rows, [
      { key: 'outlet_code', label: 'Code' },
      { key: 'outlet', label: 'Outlet', width: 28 },
      { key: 'rep', label: 'Rep', width: 14 },
      { key: 'frequency_days', label: 'Every', align: 'right', format: (v) => `${v}d` },
      { key: 'preferred_weekday', label: 'Day', format: (v) => (v === null ? '' : WEEKDAYS[v]) },
      { key: 'last_visit_on', label: 'Last call', format: (v) => (v ? isoDate(v) : 'never') },
      { key: 'due_on', label: 'Due', format: isoDate },
      { key: 'days_overdue', label: 'Late', align: 'right', format: (v) => (num(v) > 0 ? `${v}d` : num(v) === 0 ? 'today' : `in ${-v}d`) },
      { key: 'value_90_cents', label: 'Value 90d', align: 'right', format: (v) => money(v) },
    ]);
  return { text, json: rows };
}

async function cmdVisits(db, args, flags) {
  const where = ['1=1'];
  const params = [];
  if (flags.outlet && flags.outlet !== true) {
    const o = await resolve(db, 'outlet', flags.outlet);
    params.push(o.id);
    where.push(`v.outlet_id = $${params.length}`);
  }
  if (flags.rep && flags.rep !== true) {
    const r = await resolve(db, 'rep', flags.rep);
    params.push(r.id);
    where.push(`v.rep_id = $${params.length}`);
  }
  if (flags.status && flags.status !== true) {
    params.push(String(flags.status).toLowerCase());
    where.push(`v.status = $${params.length}`);
  }
  const from = parseDate(flags.from) || addDays(today(), -13);
  const to = parseDate(flags.to) || addDays(today(), 9);
  params.push(from, to);
  where.push(`coalesce(v.visited_on, v.planned_on) between $${params.length - 1} and $${params.length}`);

  const rows = await db.query(
    `select v.*, o.code as outlet_code, o.name as outlet, r.full_name as rep,
            coalesce(t.total_cents, 0) as order_cents, t.order_no
     from visits v
     join outlets o on o.id = v.outlet_id
     left join reps r on r.id = v.rep_id
     left join v_order_totals t on t.visit_id = v.id
     where ${where.join(' and ')}
     order by coalesce(v.visited_on, v.planned_on) desc, o.code`,
    params,
  );
  const text =
    heading(`Calls ${from} to ${to} (${rows.length})`) +
    '\n' +
    table(rows, [
      { key: 'id', label: 'Id', format: short },
      { key: 'visited_on', label: 'Date', format: (v, r) => isoDate(v || r.planned_on) },
      { key: 'visited_on', label: 'Day', format: (v, r) => weekday(v || r.planned_on) },
      { key: 'outlet', label: 'Outlet', width: 26 },
      { key: 'rep', label: 'Rep', width: 14 },
      { key: 'status', label: 'Status', width: 10 },
      { key: 'duration_minutes', label: 'Mins', align: 'right' },
      { key: 'order_no', label: 'Order', width: 14 },
      { key: 'order_cents', label: 'Value', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    ]);
  return { text, json: rows };
}

async function cmdVisitShow(db, visit) {
  const tasks = await db.query('select * from visit_tasks where visit_id = $1 order by created_at', [visit.id]);
  const shelf = await db.query(
    `select sc.*, p.sku, p.name as product from shelf_checks sc join products p on p.id = sc.product_id
     where sc.visit_id = $1 order by p.sku`,
    [visit.id],
  );
  const promo = await db.query(
    `select pc.*, pr.code, pr.name as promotion, pr.promo_price_cents from promo_checks pc
     join promotions pr on pr.id = pc.promotion_id where pc.visit_id = $1 order by pr.code`,
    [visit.id],
  );
  const [order] = await db.query('select * from v_order_totals where visit_id = $1', [visit.id]);
  const orderLines = order
    ? await db.query(
        `select l.*, p.sku, p.name as product from order_lines l join products p on p.id = l.product_id
         where l.order_id = $1 order by p.sku`,
        [order.order_id],
      )
    : [];

  const lines = [];
  lines.push(heading(`Call ${short(visit.id)}  ${visit.outlet_code} ${visit.outlet_name}`));
  lines.push(
    `  ${isoDate(visit.visited_on || visit.planned_on)} ${weekday(visit.visited_on || visit.planned_on)}` +
      `  |  ${visit.status}  |  ${visit.rep_name || 'unassigned'}  |  ${visit.duration_minutes} minutes in store`,
  );
  if (visit.purpose) lines.push(`  Purpose: ${visit.purpose}`);
  if (visit.notes) lines.push(`  Notes: ${visit.notes}`);
  if (visit.no_order_reason) lines.push(`  No order because: ${visit.no_order_reason}`);

  lines.push(heading('Tasks'));
  lines.push(table(tasks, [
    { key: 'kind', label: 'Kind', width: 14 },
    { key: 'title', label: 'Task', width: 44 },
    { key: 'status', label: 'Status', width: 10 },
    { key: 'result_note', label: 'Note', width: 34, format: (v) => truncate(v || '', 34) },
  ]));

  lines.push(heading('Shelf'));
  lines.push(table(shelf, [
    { key: 'sku', label: 'SKU' },
    { key: 'product', label: 'Product', width: 28 },
    { key: 'facings', label: 'Facings', align: 'right' },
    { key: 'shelf_price_cents', label: 'Shelf price', align: 'right', format: (v) => price(v) },
    { key: 'out_of_stock', label: 'Empty', format: (v) => (v ? 'EMPTY' : '') },
    { key: 'planogram_ok', label: 'Planogram', format: (v) => (v ? 'ok' : 'OFF') },
  ]));

  lines.push(heading('Promotions checked'));
  lines.push(table(promo, [
    { key: 'code', label: 'Code' },
    { key: 'promotion', label: 'Promotion', width: 28 },
    { key: 'display_present', label: 'Display', format: (v) => (v ? 'up' : 'MISSING') },
    { key: 'ticket_present', label: 'Ticket', format: (v) => (v ? 'up' : 'MISSING') },
    { key: 'ticket_price_cents', label: 'Ticket price', align: 'right', format: (v) => price(v) },
    { key: 'promo_price_cents', label: 'Should be', align: 'right', format: (v) => price(v) },
    { key: 'price_correct', label: 'Price', format: (v) => (v ? 'ok' : 'WRONG') },
  ]));

  lines.push(heading('Order'));
  if (!order) lines.push('  (none)');
  else {
    lines.push(`  ${order.order_no}  ${order.status}  ${order.units} cases  ${money(order.total_cents)}`);
    lines.push(table(orderLines, [
      { key: 'sku', label: 'SKU' },
      { key: 'product', label: 'Product', width: 30 },
      { key: 'quantity', label: 'Cases', align: 'right' },
      { key: 'unit_price_cents', label: 'Per case', align: 'right', format: (v) => price(v) },
      { key: 'line_total_cents', label: 'Line', align: 'right', format: (v) => price(v) },
    ]));
  }
  return { text: lines.join('\n'), json: { visit, tasks, shelf_checks: shelf, promo_checks: promo, order, order_lines: orderLines } };
}

async function cmdOrders(db, args, flags) {
  const where = ['1=1'];
  const params = [];
  if (args[0] || (flags.outlet && flags.outlet !== true)) {
    const o = await resolve(db, 'outlet', flags.outlet && flags.outlet !== true ? flags.outlet : args[0]);
    params.push(o.id);
    where.push(`t.outlet_id = $${params.length}`);
  }
  if (flags.rep && flags.rep !== true) {
    const r = await resolve(db, 'rep', flags.rep);
    params.push(r.id);
    where.push(`t.rep_id = $${params.length}`);
  }
  if (flags.status && flags.status !== true) {
    params.push(String(flags.status).toLowerCase());
    where.push(`t.status = $${params.length}`);
  }
  const from = parseDate(flags.from) || addDays(today(), -29);
  const to = parseDate(flags.to) || today();
  params.push(from, to);
  where.push(`t.ordered_on between $${params.length - 1} and $${params.length}`);

  const rows = await db.query(
    `select t.*, o.code as outlet_code, o.name as outlet, r.full_name as rep
     from v_order_totals t join outlets o on o.id = t.outlet_id left join reps r on r.id = t.rep_id
     where ${where.join(' and ')} order by t.ordered_on desc, o.code`,
    params,
  );
  const total = rows.reduce((s, r) => s + num(r.total_cents), 0);
  const text =
    heading(`Orders ${from} to ${to} (${rows.length}, ${money(total)})`) +
    '\n' +
    table(rows, [
      { key: 'order_no', label: 'Order' },
      { key: 'ordered_on', label: 'Date', format: isoDate },
      { key: 'outlet', label: 'Outlet', width: 26 },
      { key: 'rep', label: 'Rep', width: 14 },
      { key: 'status', label: 'Status', width: 10 },
      { key: 'line_count', label: 'Lines', align: 'right' },
      { key: 'units', label: 'Cases', align: 'right' },
      { key: 'total_cents', label: 'Value', align: 'right', format: (v) => money(v) },
      { key: 'po_number', label: 'PO', width: 12 },
    ]);
  return { text, json: rows };
}

async function cmdOrderShow(db, order) {
  const lines = await db.query(
    `select l.*, p.sku, p.name as product, p.case_size, pr.code as promo_code
     from order_lines l join products p on p.id = l.product_id
     left join promotions pr on pr.id = l.promotion_id
     where l.order_id = $1 order by p.sku`,
    [order.id],
  );
  const total = lines.reduce((s, l) => s + num(l.line_total_cents), 0);
  const out = [];
  out.push(heading(`${order.order_no}  ${order.outlet_code} ${order.outlet_name}`));
  out.push(
    `  Ordered ${isoDate(order.ordered_on)}  |  Deliver ${order.delivery_on ? isoDate(order.delivery_on) : 'not set'}` +
      `  |  ${order.status}${order.po_number ? `  |  PO ${order.po_number}` : ''}${order.erp_ref ? `  |  ERP ${order.erp_ref}` : ''}`,
  );
  if (order.notes) out.push(`  Notes: ${order.notes}`);
  out.push('');
  out.push(table(lines, [
    { key: 'sku', label: 'SKU' },
    { key: 'product', label: 'Product', width: 32 },
    { key: 'quantity', label: 'Cases', align: 'right' },
    { key: 'case_size', label: 'Per case', align: 'right' },
    { key: 'unit_price_cents', label: 'Case price', align: 'right', format: (v) => price(v) },
    { key: 'promo_code', label: 'Promo', width: 12 },
    { key: 'line_total_cents', label: 'Line', align: 'right', format: (v) => price(v) },
  ]));
  out.push(`\n  Total ${price(total)} ex GST`);
  return { text: out.join('\n'), json: { order, lines, total_cents: total } };
}

async function cmdShelfCheck(db, args, flags) {
  if (args[0] === 'log') return cmdShelfCheckLog(db, args.slice(1), flags);
  const where = ['1=1'];
  const params = [];
  const days = flags.days && flags.days !== true ? Number(flags.days) : 30;
  where.push(`sc.checked_on >= current_date - ${Math.abs(days)}`);
  if (args[0] || (flags.outlet && flags.outlet !== true)) {
    const o = await resolve(db, 'outlet', flags.outlet && flags.outlet !== true ? flags.outlet : args[0]);
    params.push(o.id);
    where.push(`sc.outlet_id = $${params.length}`);
  }
  if (flags.product && flags.product !== true) {
    const p = await resolve(db, 'product', flags.product);
    params.push(p.id);
    where.push(`sc.product_id = $${params.length}`);
  }
  if (flags.oos) where.push('sc.out_of_stock');

  const rows = await db.query(
    `select sc.*, o.code as outlet_code, o.name as outlet, p.sku, p.name as product, p.list_price_cents
     from shelf_checks sc join outlets o on o.id = sc.outlet_id join products p on p.id = sc.product_id
     where ${where.join(' and ')} order by sc.checked_on desc, o.code, p.sku limit 200`,
    params,
  );
  const bySku = await db.query(
    `select p.sku, p.name as product,
            count(*)::integer as checks,
            count(*) filter (where sc.out_of_stock)::integer as empty,
            count(*) filter (where not sc.planogram_ok)::integer as off_planogram,
            round(avg(sc.facings), 1) as avg_facings,
            round(avg(sc.shelf_price_cents)) as avg_shelf_price
     from shelf_checks sc join products p on p.id = sc.product_id
     where sc.checked_on >= current_date - ${Math.abs(days)}
     group by p.sku, p.name order by empty desc, p.sku`,
    [],
  );
  const text =
    heading(`Shelf checks, last ${days} days (${rows.length})`) +
    '\n' +
    table(rows.slice(0, 40), [
      { key: 'checked_on', label: 'Date', format: isoDate },
      { key: 'outlet', label: 'Outlet', width: 24 },
      { key: 'sku', label: 'SKU' },
      { key: 'product', label: 'Product', width: 26 },
      { key: 'facings', label: 'Facings', align: 'right' },
      { key: 'shelf_price_cents', label: 'Shelf price', align: 'right', format: (v) => price(v) },
      { key: 'out_of_stock', label: 'Empty', format: (v) => (v ? 'EMPTY' : '') },
      { key: 'planogram_ok', label: 'Planogram', format: (v) => (v ? 'ok' : 'OFF') },
    ]) +
    heading('By product') +
    '\n' +
    table(bySku, [
      { key: 'sku', label: 'SKU' },
      { key: 'product', label: 'Product', width: 30 },
      { key: 'checks', label: 'Checks', align: 'right' },
      { key: 'empty', label: 'Empty', align: 'right' },
      { key: 'off_planogram', label: 'Off plan', align: 'right' },
      { key: 'avg_facings', label: 'Avg facings', align: 'right' },
      { key: 'avg_shelf_price', label: 'Avg shelf', align: 'right', format: (v) => price(v) },
    ]);
  return { text, json: { checks: rows, by_product: bySku } };
}

async function cmdPromos(db, args, flags) {
  const rows = await db.query(
    `select * from v_promo_compliance
     ${flags.all ? '' : `where ends_on >= current_date - 7`}
     order by starts_on desc`,
  );
  const text =
    heading(`Promotions (${rows.length})`) +
    '\n' +
    table(rows, [
      { key: 'code', label: 'Code' },
      { key: 'promotion', label: 'Promotion', width: 30 },
      { key: 'mechanic', label: 'Mechanic', width: 10 },
      { key: 'starts_on', label: 'From', format: isoDate },
      { key: 'ends_on', label: 'To', format: isoDate },
      { key: 'promo_price_cents', label: 'Price', align: 'right', format: (v) => price(v) },
      { key: 'was_price_cents', label: 'Was', align: 'right', format: (v) => price(v) },
      { key: 'outlets_checked', label: 'Checked', align: 'right' },
      { key: 'compliance_pct', label: 'Price ok', align: 'right', format: pct },
      { key: 'funding_agreement_ref', label: 'Funding ref', width: 14, format: (v) => v || 'NONE' },
    ]);
  return { text, json: rows };
}

async function cmdPromoCompliance(db, args, flags) {
  const target = args[0] || (flags.promo && flags.promo !== true ? flags.promo : null);
  const promo = target ? await resolve(db, 'promotion', target) : null;
  const rows = await db.query(
    `select * from v_promo_compliance ${promo ? 'where promotion_id = $1' : 'where ends_on >= current_date'} order by starts_on desc`,
    promo ? [promo.id] : [],
  );
  const detail = await db.query(
    `select pc.*, pr.code, pr.name as promotion, pr.promo_price_cents, pr.required_display,
            o.code as outlet_code, o.name as outlet, r.full_name as rep
     from promo_checks pc
     join promotions pr on pr.id = pc.promotion_id
     join outlets o on o.id = pc.outlet_id
     left join reps r on r.id = o.rep_id
     where ${promo ? 'pc.promotion_id = $1' : 'pr.ends_on >= current_date'}
       and pc.checked_on >= current_date - 28
       ${flags.all ? '' : 'and (not pc.price_correct or not pc.display_present or not pc.ticket_present)'}
     order by pc.checked_on desc, o.code`,
    promo ? [promo.id] : [],
  );
  const notChecked = await db.query(
    `select pr.code, o.code as outlet_code, o.name as outlet, r.full_name as rep
     from promotions pr
     cross join outlets o
     left join reps r on r.id = o.rep_id
     where pr.ends_on >= current_date and pr.starts_on <= current_date and o.status = 'active'
       ${promo ? 'and pr.id = $1' : ''}
       and not exists (select 1 from promo_checks pc where pc.promotion_id = pr.id and pc.outlet_id = o.id
                        and pc.checked_on >= pr.starts_on)
     order by pr.code, o.code`,
    promo ? [promo.id] : [],
  );

  const lines = [];
  lines.push(heading(`Promotion compliance${promo ? `: ${promo.code}` : ''}`));
  lines.push(table(rows, [
    { key: 'code', label: 'Code' },
    { key: 'promotion', label: 'Promotion', width: 28 },
    { key: 'ends_on', label: 'Ends', format: isoDate },
    { key: 'checks', label: 'Checks', align: 'right' },
    { key: 'outlets_checked', label: 'Outlets', align: 'right' },
    { key: 'display_pct', label: 'Display up', align: 'right', format: pct },
    { key: 'compliance_pct', label: 'Price ok', align: 'right', format: pct },
    { key: 'price_breaches', label: 'Breaches', align: 'right' },
    { key: 'compliance_pct', label: '', format: (v) => (v === null ? '' : bar(v)) },
  ]));

  lines.push(heading(flags.all ? 'Every check, last 28 days' : 'What is wrong in store, last 28 days'));
  lines.push(table(detail, [
    { key: 'checked_on', label: 'Date', format: isoDate },
    { key: 'code', label: 'Promo' },
    { key: 'outlet', label: 'Outlet', width: 26 },
    { key: 'rep', label: 'Rep', width: 14 },
    { key: 'display_present', label: 'Display', format: (v) => (v ? 'up' : 'MISSING') },
    { key: 'ticket_present', label: 'Ticket', format: (v) => (v ? 'up' : 'MISSING') },
    { key: 'ticket_price_cents', label: 'Ticket', align: 'right', format: (v) => price(v) },
    { key: 'promo_price_cents', label: 'Should be', align: 'right', format: (v) => price(v) },
    { key: 'note', label: 'Note', width: 34, format: (v) => truncate(v || '', 34) },
  ]));

  lines.push(heading(`Live promotions never checked in these outlets (${notChecked.length})`));
  lines.push(table(notChecked.slice(0, 25), [
    { key: 'code', label: 'Promo' },
    { key: 'outlet_code', label: 'Code' },
    { key: 'outlet', label: 'Outlet', width: 30 },
    { key: 'rep', label: 'Rep', width: 16 },
  ]));

  return { text: lines.join('\n'), json: { summary: rows, breaches: detail, never_checked: notChecked } };
}

async function cmdRepWeek(db, args, flags) {
  const repArg = args[0] || (flags.rep && flags.rep !== true ? flags.rep : null);
  const rep = repArg ? await resolve(db, 'rep', repArg) : null;
  const rows = await db.query(
    `select * from v_rep_week ${rep ? 'where rep_id = $1' : ''} order by order_value_cents desc`,
    rep ? [rep.id] : [],
  );
  const targets = await db.query(
    `select t.*, r.full_name as rep from targets t left join reps r on r.id = t.rep_id
     where t.period_month = date_trunc('month', current_date)::date ${rep ? 'and t.rep_id = $1' : ''}`,
    rep ? [rep.id] : [],
  );
  const byRep = new Map();
  for (const t of targets) {
    if (!byRep.has(t.rep)) byRep.set(t.rep, {});
    byRep.get(t.rep)[t.metric] = Number(t.target_value);
  }
  const enriched = rows.map((r) => {
    const t = byRep.get(r.rep) || {};
    return {
      ...r,
      target_value_cents: t.sales_value ? Math.round(t.sales_value * 100) : null,
      month_pct: t.sales_value ? Math.round((num(r.month_value_cents) / (t.sales_value * 100)) * 100) : null,
      strike_target: t.strike_rate ?? null,
    };
  });

  const lines = [];
  lines.push(heading(`Rep week, ${addDays(today(), -6)} to ${today()}`));
  lines.push(table(enriched, [
    { key: 'rep', label: 'Rep', width: 16 },
    { key: 'territory', label: 'Territory', width: 20 },
    { key: 'calls_completed', label: 'Calls', align: 'right' },
    { key: 'calls_missed', label: 'Missed', align: 'right' },
    { key: 'calls_overdue', label: 'Overdue', align: 'right' },
    { key: 'orders_taken', label: 'Orders', align: 'right' },
    { key: 'strike_rate_pct', label: 'Strike', align: 'right', format: pct },
    { key: 'strike_target', label: 'Target', align: 'right', format: (v) => (v === null ? '' : pct(v)) },
    { key: 'avg_order_cents', label: 'Avg order', align: 'right', format: (v) => money(v) },
    { key: 'order_value_cents', label: 'Week', align: 'right', format: (v) => money(v) },
    { key: 'avg_minutes_in_store', label: 'Mins/call', align: 'right' },
  ]));

  lines.push(heading('Month to date against target'));
  lines.push(table(enriched, [
    { key: 'rep', label: 'Rep', width: 16 },
    { key: 'month_value_cents', label: 'Sold', align: 'right', format: (v) => money(v) },
    { key: 'target_value_cents', label: 'Target', align: 'right', format: (v) => (v === null ? 'none set' : money(v)) },
    { key: 'month_pct', label: 'At', align: 'right', format: (v) => (v === null ? '' : pct(v)) },
    { key: 'month_pct', label: '', format: (v) => (v === null ? '' : bar(v, 14)) },
  ]));

  if (rep) {
    const calls = await db.query(
      `select v.*, o.code as outlet_code, o.name as outlet, t.order_no, coalesce(t.total_cents, 0) as order_cents
       from visits v join outlets o on o.id = v.outlet_id
       left join v_order_totals t on t.visit_id = v.id
       where v.rep_id = $1 and coalesce(v.visited_on, v.planned_on) >= current_date - 6
       order by coalesce(v.visited_on, v.planned_on) desc`,
      [rep.id],
    );
    lines.push(heading(`${rep.full_name}: the week call by call`));
    lines.push(table(calls, [
      { key: 'visited_on', label: 'Date', format: (v, r) => isoDate(v || r.planned_on) },
      { key: 'visited_on', label: 'Day', format: (v, r) => weekday(v || r.planned_on) },
      { key: 'outlet', label: 'Outlet', width: 28 },
      { key: 'status', label: 'Status', width: 10 },
      { key: 'duration_minutes', label: 'Mins', align: 'right' },
      { key: 'order_no', label: 'Order', width: 14 },
      { key: 'order_cents', label: 'Value', align: 'right', format: (v) => (num(v) ? money(v) : '') },
      { key: 'no_order_reason', label: 'No order because', width: 30, format: (v) => truncate(v || '', 30) },
    ]));
  }
  return { text: lines.join('\n'), json: enriched };
}

async function cmdTerritory(db, args, flags) {
  const name = args.join(' ') || (flags.territory && flags.territory !== true ? flags.territory : null);
  if (!name) {
    const rows = await db.query(
      `select t.name as territory, t.code, t.region, t.manager,
              (select count(*) from outlets o where o.territory_id = t.id and o.status = 'active')::integer as outlets,
              (select count(*) from reps r where r.territory_id = t.id and r.active)::integer as reps,
              (select count(*) from v_call_cycle_due d where d.territory = t.name and d.days_overdue > 0)::integer as calls_overdue,
              (select coalesce(sum(vt.total_cents), 0) from v_order_totals vt
                join outlets o2 on o2.id = vt.outlet_id
                where o2.territory_id = t.id and vt.status <> 'cancelled'
                  and vt.ordered_on >= current_date - 90)::bigint as value_90_cents
       from territories t order by t.name`,
    );
    const text =
      heading(`Territories (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'territory', label: 'Territory', width: 22 },
        { key: 'code', label: 'Code' },
        { key: 'region', label: 'Region', width: 16 },
        { key: 'reps', label: 'Reps', align: 'right' },
        { key: 'outlets', label: 'Outlets', align: 'right' },
        { key: 'calls_overdue', label: 'Late calls', align: 'right' },
        { key: 'value_90_cents', label: 'Value 90d', align: 'right', format: (v) => money(v) },
      ]);
    return { text, json: rows };
  }

  const terr = await resolve(db, 'territory', name);
  const outlets = await db.query(
    `select h.*, d.days_overdue, d.frequency_days from v_outlet_health h
     left join v_call_cycle_due d on d.outlet_id = h.outlet_id
     where h.territory = $1 order by h.value_90_cents desc`,
    [terr.name],
  );
  const reps = await db.query('select * from v_rep_week where territory = $1', [terr.name]);
  const products = await db.query(
    `select p.sku, p.name as product, sum(l.quantity)::integer as cases, sum(l.line_total_cents)::bigint as value_cents,
            count(distinct o.outlet_id)::integer as outlets
     from order_lines l join orders o on o.id = l.order_id join outlets ou on ou.id = o.outlet_id
     join products p on p.id = l.product_id
     where ou.territory_id = $1 and o.status <> 'cancelled' and o.ordered_on >= current_date - 90
     group by p.sku, p.name order by value_cents desc`,
    [terr.id],
  );
  const activeOutlets = outlets.filter((o) => o.status === 'active').length;

  const lines = [];
  lines.push(heading(`${terr.name}${terr.code ? ` (${terr.code})` : ''}`));
  lines.push(`  ${terr.region || ''}${terr.manager ? `  |  Manager ${terr.manager}` : ''}  |  ${activeOutlets} active outlets  |  ${reps.length} rep${reps.length === 1 ? '' : 's'}`);
  lines.push(heading('Reps this week'));
  lines.push(table(reps, [
    { key: 'rep', label: 'Rep', width: 18 },
    { key: 'calls_completed', label: 'Calls', align: 'right' },
    { key: 'orders_taken', label: 'Orders', align: 'right' },
    { key: 'strike_rate_pct', label: 'Strike', align: 'right', format: pct },
    { key: 'order_value_cents', label: 'Week', align: 'right', format: (v) => money(v) },
    { key: 'calls_overdue', label: 'Late calls', align: 'right' },
  ]));
  lines.push(heading('Outlets'));
  lines.push(table(outlets, [
    { key: 'outlet_code', label: 'Code' },
    { key: 'outlet', label: 'Outlet', width: 28 },
    { key: 'channel', label: 'Channel', width: 12 },
    { key: 'rep', label: 'Rep', width: 14 },
    { key: 'days_since_visit', label: 'Last call', align: 'right', format: (v) => (v === null ? 'never' : `${v}d`) },
    { key: 'days_overdue', label: 'Late', align: 'right', format: (v) => (v === null ? '' : num(v) > 0 ? `${v}d` : '') },
    { key: 'value_90_cents', label: 'Value 90d', align: 'right', format: (v) => money(v) },
    { key: 'trend_pct', label: 'Trend', align: 'right', format: (v) => (v === null ? '' : `${v > 0 ? '+' : ''}${v}%`) },
  ]));
  lines.push(heading('Distribution: what sells here (90 days)'));
  lines.push(table(products, [
    { key: 'sku', label: 'SKU' },
    { key: 'product', label: 'Product', width: 32 },
    { key: 'outlets', label: 'Outlets', align: 'right' },
    { key: 'cases', label: 'Cases', align: 'right' },
    { key: 'value_cents', label: 'Value', align: 'right', format: (v) => money(v) },
  ]));
  return { text: lines.join('\n'), json: { territory: terr, reps, outlets, products } };
}

async function cmdReturns(db, args, flags) {
  const sub = args[0];
  if (sub === 'new') return cmdReturnNew(db, args.slice(1), flags);
  if (sub === 'authorise' || sub === 'authorize') return cmdReturnAuthorise(db, args.slice(1), flags);
  if (sub === 'decline') return cmdReturnDecline(db, args.slice(1), flags);
  if (sub === 'credit') return cmdReturnCredit(db, args.slice(1), flags);
  if (sub && sub !== 'list') {
    const ret = await resolve(db, 'return', args.join(' '));
    return cmdReturnShow(db, ret);
  }

  const where = ['1=1'];
  const params = [];
  if (!flags.all) where.push(`r.status in ('requested', 'authorised')`);
  if (flags.status && flags.status !== true) {
    params.push(String(flags.status).toLowerCase());
    where.push(`r.status = $${params.length}`);
  }
  if (flags.outlet && flags.outlet !== true) {
    const o = await resolve(db, 'outlet', flags.outlet);
    params.push(o.id);
    where.push(`r.outlet_id = $${params.length}`);
  }
  const rows = await db.query(
    `select r.*, o.code as outlet_code, o.name as outlet, rp.full_name as rep,
            coalesce(l.total_cents, 0) as total_cents, coalesce(l.line_count, 0) as line_count,
            coalesce(l.missing_batch, 0) as missing_batch,
            (current_date - r.requested_on)::integer as age_days
     from returns r
     join outlets o on o.id = r.outlet_id
     left join reps rp on rp.id = r.rep_id
     left join (
       select rl.return_id,
              sum(rl.line_total_cents) as total_cents,
              count(*) as line_count,
              count(*) filter (where p.batch_tracked and coalesce(rl.batch_code, '') = '') as missing_batch
       from return_lines rl join products p on p.id = rl.product_id group by rl.return_id
     ) l on l.return_id = r.id
     where ${where.join(' and ')} order by r.requested_on`,
    params,
  );
  const total = rows.reduce((s, r) => s + num(r.total_cents), 0);
  const text =
    heading(`Returns and credits (${rows.length}, ${money(total)})`) +
    '\n' +
    table(rows, [
      { key: 'return_no', label: 'Number' },
      { key: 'requested_on', label: 'Asked', format: isoDate },
      { key: 'age_days', label: 'Age', align: 'right', format: (v) => `${v}d` },
      { key: 'outlet', label: 'Outlet', width: 26 },
      { key: 'reason', label: 'Reason', width: 14 },
      { key: 'status', label: 'Status', width: 12 },
      { key: 'total_cents', label: 'Value', align: 'right', format: (v) => money(v) },
      { key: 'authorised_by', label: 'Authorised by', width: 16 },
      { key: 'missing_batch', label: 'No batch', align: 'right', format: (v) => (num(v) ? `${v} line${num(v) === 1 ? '' : 's'}` : '') },
    ]);
  return { text, json: rows };
}

async function cmdReturnShow(db, ret) {
  const lines = await db.query(
    `select l.*, p.sku, p.name as product, p.batch_tracked from return_lines l join products p on p.id = l.product_id
     where l.return_id = $1 order by p.sku`,
    [ret.id],
  );
  const total = lines.reduce((s, l) => s + num(l.line_total_cents), 0);
  const out = [];
  out.push(heading(`${ret.return_no}  ${ret.outlet_code} ${ret.outlet_name}`));
  out.push(
    `  Requested ${isoDate(ret.requested_on)}  |  ${ret.reason}  |  ${ret.status}` +
      `${ret.authorised_by ? `  |  Authorised by ${ret.authorised_by} on ${isoDate(ret.authorised_on)}` : ''}` +
      `${ret.credit_note_ref ? `  |  Credit note ${ret.credit_note_ref}` : ''}`,
  );
  if (ret.notes) out.push(`  Notes: ${ret.notes}`);
  out.push('');
  out.push(table(lines, [
    { key: 'sku', label: 'SKU' },
    { key: 'product', label: 'Product', width: 30 },
    { key: 'quantity', label: 'Cases', align: 'right' },
    { key: 'unit_price_cents', label: 'Case price', align: 'right', format: (v) => price(v) },
    { key: 'batch_code', label: 'Batch', format: (v, r) => v || (r.batch_tracked ? 'MISSING' : '') },
    { key: 'expiry_on', label: 'Expiry', format: (v) => (v ? isoDate(v) : '') },
    { key: 'line_total_cents', label: 'Line', align: 'right', format: (v) => price(v) },
  ]));
  out.push(`\n  Total ${price(total)} ex GST`);
  const missing = lines.filter((l) => l.batch_tracked && !l.batch_code);
  if (missing.length) {
    out.push(`\n  ${missing.length} batch tracked line(s) have no batch code. That breaks the recall trail. See docs/compliance.md.`);
  }
  return { text: out.join('\n'), json: { return: ret, lines, total_cents: total } };
}

async function cmdProducts(db, args, flags) {
  const params = [];
  let where = flags.all ? '1=1' : 'p.active';
  if (args[0]) {
    params.push(`%${args[0]}%`);
    where += ` and (p.sku ilike $1 or p.name ilike $1 or p.brand ilike $1 or p.category ilike $1)`;
  }
  const rows = await db.query(
    `select p.*,
            (select count(distinct o.outlet_id) from order_lines l join orders o on o.id = l.order_id
              where l.product_id = p.id and o.ordered_on >= current_date - 90 and o.status <> 'cancelled')::integer as outlets_90,
            (select coalesce(sum(l.quantity), 0) from order_lines l join orders o on o.id = l.order_id
              where l.product_id = p.id and o.ordered_on >= current_date - 90 and o.status <> 'cancelled')::integer as cases_90,
            (select coalesce(sum(l.line_total_cents), 0) from order_lines l join orders o on o.id = l.order_id
              where l.product_id = p.id and o.ordered_on >= current_date - 90 and o.status <> 'cancelled')::bigint as value_90_cents
     from products p where ${where} order by value_90_cents desc, p.sku`,
    params,
  );
  const activeOutlets = num((await db.query(`select count(*) as n from outlets where status = 'active'`))[0].n);
  const text =
    heading(`Products (${rows.length})`) +
    '\n' +
    table(rows, [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Product', width: 30 },
      { key: 'brand', label: 'Brand', width: 14 },
      { key: 'unit_size', label: 'Size' },
      { key: 'case_size', label: 'Case', align: 'right' },
      { key: 'list_price_cents', label: 'List (unit)', align: 'right', format: (v) => price(v) },
      { key: 'outlets_90', label: 'Outlets', align: 'right' },
      { key: 'outlets_90', label: 'Distribution', align: 'right', format: (v) => (activeOutlets ? `${Math.round((num(v) / activeOutlets) * 100)}%` : '') },
      { key: 'cases_90', label: 'Cases 90d', align: 'right' },
      { key: 'value_90_cents', label: 'Value 90d', align: 'right', format: (v) => money(v) },
    ]);
  return { text, json: rows };
}

async function cmdPriceList(db, args) {
  const q = args.join(' ');
  let list;
  if (q) {
    const outlet = await resolve(db, 'outlet', q, { optional: true });
    if (outlet && outlet.price_list_id) {
      [list] = await db.query('select * from price_lists where id = $1', [outlet.price_list_id]);
    } else {
      [list] = await db.query('select * from price_lists where lower(code) = lower($1) or lower(name) = lower($1)', [q]);
    }
    if (!list) throw new CliError(`No price list matches "${q}".`);
  }
  if (!list) {
    const rows = await db.query(
      `select pl.*, (select count(*) from price_list_items i where i.price_list_id = pl.id)::integer as items,
              (select count(*) from outlets o where o.price_list_id = pl.id)::integer as outlets
       from price_lists pl order by pl.code`,
    );
    return {
      text: heading(`Price lists (${rows.length})`) + '\n' + table(rows, [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name', width: 30 },
        { key: 'currency', label: 'Ccy' },
        { key: 'items', label: 'Items', align: 'right' },
        { key: 'outlets', label: 'Outlets', align: 'right' },
        { key: 'notes', label: 'Notes', width: 44, format: (v) => truncate(v || '', 44) },
      ]),
      json: rows,
    };
  }
  const items = await db.query(
    `select p.sku, p.name as product, p.case_size, p.list_price_cents, i.price_cents,
            (i.price_cents * p.case_size)::bigint as case_price_cents,
            round((1 - i.price_cents::numeric / nullif(p.list_price_cents, 0)) * 100)::integer as off_list_pct
     from price_list_items i join products p on p.id = i.product_id
     where i.price_list_id = $1 order by p.sku`,
    [list.id],
  );
  return {
    text:
      heading(`${list.code}  ${list.name} (${list.currency})`) +
      `\n  ${list.notes || ''}\n` +
      table(items, [
        { key: 'sku', label: 'SKU' },
        { key: 'product', label: 'Product', width: 32 },
        { key: 'case_size', label: 'Case', align: 'right' },
        { key: 'list_price_cents', label: 'List (unit)', align: 'right', format: (v) => price(v) },
        { key: 'price_cents', label: 'Yours (unit)', align: 'right', format: (v) => price(v) },
        { key: 'off_list_pct', label: 'Off list', align: 'right', format: (v) => `${v}%` },
        { key: 'case_price_cents', label: 'Per case', align: 'right', format: (v) => price(v) },
      ]),
    json: { price_list: list, items },
  };
}

async function cmdTargets(db, args, flags) {
  const month = parseDate(flags.month) || `${today().slice(0, 7)}-01`;
  const rows = await db.query(
    `select t.*, r.full_name as rep, te.name as territory,
            case t.metric
              when 'sales_value' then (select coalesce(sum(vt.total_cents), 0) / 100.0 from v_order_totals vt
                                        where vt.rep_id = t.rep_id and vt.status <> 'cancelled'
                                          and vt.ordered_on >= $1 and vt.ordered_on < ($1::date + interval '1 month'))
              when 'calls' then (select count(*) from visits v where v.rep_id = t.rep_id and v.status = 'completed'
                                  and v.visited_on >= $1 and v.visited_on < ($1::date + interval '1 month'))
              when 'strike_rate' then (select case when count(*) filter (where v.status = 'completed') = 0 then 0
                                          else round(count(distinct o.id) * 100.0 / count(*) filter (where v.status = 'completed')) end
                                        from visits v left join orders o on o.visit_id = v.id and o.status <> 'cancelled'
                                        where v.rep_id = t.rep_id and v.visited_on >= $1 and v.visited_on < ($1::date + interval '1 month'))
              else 0 end as actual
     from targets t left join reps r on r.id = t.rep_id left join territories te on te.id = t.territory_id
     where t.period_month = $1 order by r.full_name, t.metric`,
    [month],
  );
  const enriched = rows.map((r) => ({
    ...r,
    actual: Number(r.actual || 0),
    at_pct: Number(r.target_value) ? Math.round((Number(r.actual || 0) / Number(r.target_value)) * 100) : null,
  }));
  const text =
    heading(`Targets for ${month.slice(0, 7)}`) +
    '\n' +
    table(enriched, [
      { key: 'rep', label: 'Rep', width: 18 },
      { key: 'metric', label: 'Metric', width: 14 },
      { key: 'target_value', label: 'Target', align: 'right', format: (v, r) => (r.metric === 'sales_value' ? money(Number(v) * 100) : String(Math.round(Number(v)))) },
      { key: 'actual', label: 'Actual', align: 'right', format: (v, r) => (r.metric === 'sales_value' ? money(Number(v) * 100) : String(Math.round(Number(v)))) },
      { key: 'at_pct', label: 'At', align: 'right', format: (v) => (v === null ? '' : pct(v)) },
      { key: 'at_pct', label: '', format: (v) => (v === null ? '' : bar(v, 14)) },
      { key: 'notes', label: 'Notes', width: 30, format: (v) => truncate(v || '', 30) },
    ]);
  return { text, json: enriched };
}

async function cmdAttention(db, args, flags) {
  const params = [];
  let where = '1=1';
  if (flags.rep && flags.rep !== true) {
    const rep = await resolve(db, 'rep', flags.rep);
    params.push(rep.full_name);
    where = `a.rep = $${params.length}`;
  }
  const rows = await db.query(
    `select a.* from v_attention_due a where ${where} order by
       case a.reason
         when 'promo_breach' then 1 when 'return_unauthorised' then 2 when 'order_unsent' then 3
         when 'call_overdue' then 4 when 'outlet_quiet' then 5 else 6 end,
       a.days desc`,
    params,
  );
  const LABEL = {
    call_overdue: 'Call overdue',
    promo_breach: 'Promotion wrong in store',
    order_unsent: 'Order not in the ERP',
    return_unauthorised: 'Credit waiting on authorisation',
    outlet_quiet: 'Outlet has gone quiet',
    out_of_stock: 'Out of stock on shelf',
  };
  const counts = {};
  for (const r of rows) counts[r.reason] = (counts[r.reason] || 0) + 1;
  const summary = Object.entries(counts).map(([reason, n]) => `${LABEL[reason] || reason}: ${n}`).join('  |  ');
  const text =
    heading(`Needs attention (${rows.length})`) +
    `\n  ${summary || 'Nothing.'}\n\n` +
    table(rows, [
      { key: 'reason', label: 'What', width: 30, format: (v) => LABEL[v] || v },
      { key: 'label', label: 'Record', width: 26 },
      { key: 'outlet', label: 'Outlet', width: 26 },
      { key: 'rep', label: 'Rep', width: 14 },
      { key: 'days', label: 'Days', align: 'right' },
      { key: 'amount_cents', label: 'Value', align: 'right', format: (v) => (num(v) ? money(v) : '') },
      { key: 'detail', label: 'Detail', width: 40, format: (v) => truncate(v || '', 40) },
    ]);
  return { text, json: rows };
}

async function cmdStats(db) {
  const [row] = await db.query(`
    select
      (select count(*) from outlets where status = 'active')::integer                                as outlets_active,
      (select count(*) from reps where active)::integer                                              as reps_active,
      (select count(*) from call_cycles c join outlets o on o.id = c.outlet_id
        where c.active and o.status = 'active')::integer                                             as outlets_on_cycle,
      (select count(*) from v_call_cycle_due where days_overdue > 0)::integer                        as calls_overdue,
      (select count(*) from visits where status = 'completed' and visited_on >= current_date - 29)::integer as calls_30,
      (select count(*) from visits where status = 'missed' and planned_on >= current_date - 29)::integer    as missed_30,
      (select count(*) from v_order_totals where status <> 'cancelled' and ordered_on >= current_date - 29)::integer as orders_30,
      (select coalesce(sum(total_cents), 0) from v_order_totals
        where status <> 'cancelled' and ordered_on >= current_date - 29)::bigint                     as value_30_cents,
      (select coalesce(sum(total_cents), 0) from v_order_totals
        where status <> 'cancelled' and ordered_on >= date_trunc('month', current_date)::date)::bigint as value_mtd_cents,
      (select count(*) from v_order_totals where status = 'submitted')::integer                      as orders_unsent,
      (select count(*) from returns where status in ('requested', 'authorised'))::integer            as returns_open,
      (select count(*) from shelf_checks where out_of_stock and checked_on >= current_date - 29)::integer as oos_30,
      (select round(avg(compliance_pct)) from v_promo_compliance where ends_on >= current_date)      as promo_compliance_pct
  `);
  const strike = num(row.calls_30) ? Math.round((num(row.orders_30) / num(row.calls_30)) * 100) : 0;
  const coverage = num(row.outlets_on_cycle)
    ? Math.round(((num(row.outlets_on_cycle) - num(row.calls_overdue)) / num(row.outlets_on_cycle)) * 100)
    : 0;
  const stats = { ...row, strike_rate_pct: strike, coverage_pct: coverage };
  const text =
    heading('The round in numbers') +
    `
  Outlets active            ${row.outlets_active}   (${row.outlets_on_cycle} on a call cycle)
  Reps active               ${row.reps_active}
  Cycle coverage            ${coverage}%  ${bar(coverage, 20)}   ${row.calls_overdue} outlets past due
  Calls, last 30 days       ${row.calls_30} completed, ${row.missed_30} missed
  Orders, last 30 days      ${row.orders_30}
  Strike rate, 30 days      ${strike}%
  Sold, last 30 days        ${money(row.value_30_cents)}
  Sold, month to date       ${money(row.value_mtd_cents)}
  Orders not in the ERP     ${row.orders_unsent}
  Promotion price accuracy  ${row.promo_compliance_pct === null ? 'no live promotions' : `${row.promo_compliance_pct}%`}
  Out of stock, 30 days     ${row.oos_30} shelf checks found an empty facing
  Credits open              ${row.returns_open}`;
  return { text, json: stats };
}

// ---------------------------------------------------------------------------
// Writes

async function cmdVisit(db, args, flags) {
  const sub = args[0];
  if (sub === 'log') return cmdVisitLog(db, args.slice(1), flags);
  if (sub === 'plan') return cmdVisitPlan(db, args.slice(1), flags);
  if (sub === 'miss' || sub === 'missed') return cmdVisitMiss(db, args.slice(1), flags);
  if (sub === 'task') return cmdVisitTask(db, args.slice(1), flags);
  if (!sub || sub === 'list') return cmdVisits(db, args.slice(sub ? 1 : 0), flags);
  const visit = await resolve(db, 'visit', args.join(' '));
  return cmdVisitShow(db, visit);
}

const DEFAULT_TASKS = [
  ['shelf_check', 'Count facings and check the planogram'],
  ['promo_check', 'Check the promotion display and shelf ticket'],
  ['stocktake', 'Check the back stock and write the order'],
  ['photo', 'Photo of the bay before you leave'],
];

async function cmdVisitLog(db, args, flags) {
  const outlet = await resolve(db, 'outlet', args[0]);
  const rep = (flags.rep && flags.rep !== true) || !outlet.rep_id
    ? await whoIs(db, flags)
    : (await db.query('select * from reps where id = $1', [outlet.rep_id]))[0];
  const on = parseDate(flags.on) || today();
  const minutes = flags.minutes && flags.minutes !== true ? Number(flags.minutes) : 30;
  const notes = args.slice(1).join(' ') || (flags.notes && flags.notes !== true ? flags.notes : null);
  const [visit] = await db.query(
    `insert into visits (outlet_id, rep_id, planned_on, visited_on, duration_minutes, status, purpose, no_order_reason, notes)
     values ($1, $2, $3, $3, $4, 'completed', $5, $6, $7) returning *`,
    [
      outlet.id, rep?.id || null, on, minutes,
      flags.purpose && flags.purpose !== true ? flags.purpose : 'call cycle visit',
      flags['no-order-reason'] && flags['no-order-reason'] !== true ? flags['no-order-reason'] : null,
      notes,
    ],
  );
  // Close out the planned call for this outlet if there was one.
  await db.query(
    `update visits set status = 'completed', visited_on = $2 where outlet_id = $1 and status = 'planned' and planned_on <= $2 and id <> $3`,
    [outlet.id, on, visit.id],
  );
  if (!flags['no-tasks']) {
    for (const [kind, title] of DEFAULT_TASKS) {
      await db.query(
        `insert into visit_tasks (visit_id, kind, title, status, done_at) values ($1, $2, $3, 'done', now())`,
        [visit.id, kind, title],
      );
    }
  }
  if (notes) {
    await db.query('insert into outlet_notes (outlet_id, rep_id, visit_id, body) values ($1, $2, $3, $4)', [
      outlet.id, rep?.id || null, visit.id, notes,
    ]);
  }
  const text = `Logged ${minutes} minutes at ${outlet.code} ${outlet.name} on ${on} for ${rep?.full_name || 'nobody'}.\n  Call id ${short(visit.id)}. Next: \`order new ${outlet.code} --line=SKUx6\` or \`shelf-check log ${outlet.code} --sku=...\`.`;
  return { text, json: visit };
}

async function cmdVisitPlan(db, args, flags) {
  const outlet = await resolve(db, 'outlet', args[0]);
  const on = parseDate(flags.on || args[1]) || addDays(today(), 1);
  const rep = outlet.rep_id ? (await db.query('select * from reps where id = $1', [outlet.rep_id]))[0] : await whoIs(db, flags, { optional: true });
  const [visit] = await db.query(
    `insert into visits (outlet_id, rep_id, planned_on, status, purpose) values ($1, $2, $3, 'planned', $4) returning *`,
    [outlet.id, rep?.id || null, on, flags.purpose && flags.purpose !== true ? flags.purpose : 'call cycle visit'],
  );
  return { text: `Planned ${outlet.code} ${outlet.name} for ${on} (${weekday(on)}), ${rep?.full_name || 'unassigned'}.`, json: visit };
}

async function cmdVisitMiss(db, args, flags) {
  const outlet = await resolve(db, 'outlet', args[0]);
  const on = parseDate(flags.on) || today();
  const reason = args.slice(1).join(' ') || (flags.reason && flags.reason !== true ? flags.reason : 'not recorded');
  const [visit] = await db.query(
    `insert into visits (outlet_id, rep_id, planned_on, status, purpose, notes) values ($1, $2, $3, 'missed', 'call cycle visit', $4) returning *`,
    [outlet.id, outlet.rep_id, on, reason],
  );
  return { text: `Marked ${outlet.code} ${outlet.name} missed on ${on}: ${reason}`, json: visit };
}

async function cmdVisitTask(db, args, flags) {
  const visit = await resolve(db, 'visit', args[0]);
  const title = args.slice(1).join(' ');
  if (!title) throw new CliError('What is the task? visit task <visit-id> "<what to do>" [--kind=shelf_check]');
  const [row] = await db.query(
    `insert into visit_tasks (visit_id, kind, title, status) values ($1, $2, $3, $4) returning *`,
    [visit.id, flags.kind && flags.kind !== true ? flags.kind : 'other', title, flags.done ? 'done' : 'pending'],
  );
  return { text: `Task added to call ${short(visit.id)}: ${title}`, json: row };
}

async function cmdOrder(db, args, flags) {
  const sub = args[0];
  if (sub === 'new' || sub === 'add') return cmdOrderNew(db, args.slice(1), flags);
  if (sub === 'submit') return cmdOrderStatus(db, args.slice(1), flags, 'submitted');
  if (sub === 'cancel') return cmdOrderStatus(db, args.slice(1), flags, 'cancelled');
  if (sub === 'export') return cmdOrderExport(db, args.slice(1), flags);
  if (!sub || sub === 'list') return cmdOrders(db, args.slice(sub ? 1 : 0), flags);
  const order = await resolve(db, 'order', args.join(' '));
  return cmdOrderShow(db, order);
}

async function cmdOrderNew(db, args, flags) {
  const outlet = await resolve(db, 'outlet', args[0]);
  if (outlet.credit_hold && !flags.force) {
    throw new CliError(`${outlet.code} ${outlet.name} is on credit hold. Clear it with finance, or pass --force to write the order anyway.`);
  }
  const specs = flags.lines.length ? flags.lines : args.slice(1);
  if (!specs.length) throw new CliError('Give me at least one line: order new <outlet> --line=KAI-CRK-150x6');
  const rep = (flags.rep && flags.rep !== true) ? await resolve(db, 'rep', flags.rep)
    : outlet.rep_id ? (await db.query('select * from reps where id = $1', [outlet.rep_id]))[0]
    : await whoIs(db, flags, { optional: true });
  const on = parseDate(flags.on) || today();
  const orderNo = flags.number && flags.number !== true ? flags.number : await nextOrderNo(db, outlet, on);

  let visitId = null;
  if (flags.visit && flags.visit !== true) visitId = (await resolve(db, 'visit', flags.visit)).id;
  else {
    const [v] = await db.query(
      `select id from visits where outlet_id = $1 and status = 'completed' and visited_on = $2 order by created_at desc limit 1`,
      [outlet.id, on],
    );
    visitId = v?.id || null;
  }

  const [order] = await db.query(
    `insert into orders (order_no, outlet_id, rep_id, visit_id, price_list_id, ordered_on, delivery_on, status, po_number, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [
      orderNo, outlet.id, rep?.id || null, visitId, outlet.price_list_id, on,
      parseDate(flags.deliver) || addDays(on, 3),
      flags.status && flags.status !== true ? String(flags.status).toLowerCase() : 'submitted',
      flags.po && flags.po !== true ? flags.po : null,
      flags.notes && flags.notes !== true ? flags.notes : null,
    ],
  );

  const written = [];
  for (const spec of specs) {
    const { sku, qty } = parseLineSpec(spec);
    const product = await resolve(db, 'product', sku);
    const unit = flags.price && flags.price !== true ? parseMoney(flags.price) : await casePrice(db, outlet, product);
    const [promo] = await db.query(
      `select p.* from promotions p join promotion_products pp on pp.promotion_id = p.id
       where pp.product_id = $1 and $2 between p.starts_on and p.ends_on order by p.starts_on desc limit 1`,
      [product.id, on],
    );
    const [line] = await db.query(
      `insert into order_lines (order_id, product_id, quantity, unit_price_cents, discount_pct, promotion_id, line_total_cents)
       values ($1, $2, $3, $4, 0, $5, $6) returning *`,
      [order.id, product.id, qty, unit, promo?.id || null, qty * unit],
    );
    written.push({ ...line, sku: product.sku, product: product.name, promo_code: promo?.code || null });
  }
  const total = written.reduce((s, l) => s + num(l.line_total_cents), 0);
  const text =
    `${order.order_no} written for ${outlet.code} ${outlet.name}, ${written.length} line${written.length === 1 ? '' : 's'}, ${price(total)} ex GST, status ${order.status}.\n` +
    table(written, [
      { key: 'sku', label: 'SKU' },
      { key: 'product', label: 'Product', width: 30 },
      { key: 'quantity', label: 'Cases', align: 'right' },
      { key: 'unit_price_cents', label: 'Case price', align: 'right', format: (v) => price(v) },
      { key: 'promo_code', label: 'Promo', width: 12 },
      { key: 'line_total_cents', label: 'Line', align: 'right', format: (v) => price(v) },
    ]) +
    `\n\n  Send it on with \`order export ${order.order_no} --ref=<ERP reference>\`. Nothing leaves this database on its own.`;
  return { text, json: { order, lines: written, total_cents: total } };
}

async function cmdOrderStatus(db, args, flags, status) {
  const order = await resolve(db, 'order', args.join(' '));
  const [row] = await db.query('update orders set status = $2 where id = $1 returning *', [order.id, status]);
  return { text: `${order.order_no} is now ${status}.`, json: row };
}

async function cmdOrderExport(db, args, flags) {
  const orders = args.length
    ? [await resolve(db, 'order', args.join(' '))]
    : await db.query(`select o.*, ou.name as outlet_name, ou.code as outlet_code from orders o join outlets ou on ou.id = o.outlet_id where o.status = 'submitted' order by o.ordered_on`);
  if (!orders.length) return { text: 'No submitted orders waiting to go to the ERP.', json: [] };

  const rows = [];
  for (const o of orders) {
    const lines = await db.query(
      `select l.*, p.sku, p.name as product from order_lines l join products p on p.id = l.product_id where l.order_id = $1 order by p.sku`,
      [o.id],
    );
    for (const l of lines) {
      rows.push({
        order_no: o.order_no,
        outlet_code: o.outlet_code,
        ordered_on: isoDate(o.ordered_on),
        delivery_on: o.delivery_on ? isoDate(o.delivery_on) : '',
        po_number: o.po_number || '',
        sku: l.sku,
        quantity: l.quantity,
        unit_price: (num(l.unit_price_cents) / 100).toFixed(2),
        line_total: (num(l.line_total_cents) / 100).toFixed(2),
      });
    }
  }
  const dir = path.join(REPO_ROOT, 'exports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `orders-${today()}.csv`);
  const header = Object.keys(rows[0]).join(',');
  const body = rows.map((r) => Object.values(r).map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n');
  writeFileSync(file, `${header}\n${body}\n`);

  const ref = flags.ref && flags.ref !== true ? flags.ref : null;
  for (const o of orders) {
    await db.query(`update orders set status = 'exported', exported_at = now(), erp_ref = coalesce($2, erp_ref) where id = $1`, [
      o.id, ref ? `${ref}` : null,
    ]);
  }
  return {
    text: `${orders.length} order(s), ${rows.length} lines written to ${path.relative(REPO_ROOT, file)} and marked exported.\n  Hand that file to the ERP the way you do today. Nothing is sent from here.`,
    json: { file, orders: orders.map((o) => o.order_no), lines: rows.length },
  };
}

async function cmdShelfCheckLog(db, args, flags) {
  const outlet = await resolve(db, 'outlet', args[0]);
  const sku = flags.sku && flags.sku !== true ? flags.sku : args[1];
  if (!sku) throw new CliError('Which product? shelf-check log <outlet> --sku=KAI-CRK-150 --facings=3 --price=4.20 [--oos] [--off-planogram]');
  const product = await resolve(db, 'product', sku);
  const on = parseDate(flags.on) || today();
  const [visit] = await db.query(
    `select id from visits where outlet_id = $1 and status = 'completed' and visited_on = $2 order by created_at desc limit 1`,
    [outlet.id, on],
  );
  const [row] = await db.query(
    `insert into shelf_checks (visit_id, outlet_id, product_id, checked_on, facings, shelf_price_cents, on_shelf, out_of_stock, planogram_ok, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [
      visit?.id || null, outlet.id, product.id, on,
      flags.facings && flags.facings !== true ? Number(flags.facings) : 0,
      flags.price && flags.price !== true ? parseMoney(flags.price) : null,
      !flags.oos,
      Boolean(flags.oos),
      !flags['off-planogram'],
      flags.note && flags.note !== true ? flags.note : null,
    ],
  );
  return {
    text: `Shelf check at ${outlet.code}: ${product.sku} ${product.name}, ${row.facings} facings${flags.oos ? ', EMPTY' : ''}${flags['off-planogram'] ? ', off planogram' : ''}${row.shelf_price_cents ? `, shelf price ${price(row.shelf_price_cents)}` : ''}.`,
    json: row,
  };
}

async function cmdPromoCheck(db, args, flags) {
  const outlet = await resolve(db, 'outlet', args[0]);
  const promoArg = flags.promo && flags.promo !== true ? flags.promo : args[1];
  if (!promoArg) throw new CliError('Which promotion? promo-check <outlet> --promo=SPRING-CRK [--display] [--ticket] [--price=5.00]');
  const promo = await resolve(db, 'promotion', promoArg);
  const on = parseDate(flags.on) || today();
  const ticketPrice = flags.price && flags.price !== true ? parseMoney(flags.price) : null;
  const priceCorrect = ticketPrice !== null ? ticketPrice === Number(promo.promo_price_cents) : Boolean(flags.ticket);
  const [visit] = await db.query(
    `select id from visits where outlet_id = $1 and status = 'completed' and visited_on = $2 order by created_at desc limit 1`,
    [outlet.id, on],
  );
  const [row] = await db.query(
    `insert into promo_checks (visit_id, promotion_id, outlet_id, checked_on, display_present, ticket_present, ticket_price_cents, price_correct, photo_ref, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [
      visit?.id || null, promo.id, outlet.id, on,
      Boolean(flags.display) && !flags['no-display'],
      ticketPrice !== null ? true : Boolean(flags.ticket),
      ticketPrice,
      priceCorrect,
      flags.photo && flags.photo !== true ? flags.photo : null,
      flags.note && flags.note !== true ? flags.note : null,
    ],
  );
  const verdict = priceCorrect ? 'price is right' : `price is WRONG (ticket ${price(ticketPrice)}, should be ${price(promo.promo_price_cents)})`;
  return { text: `${promo.code} checked at ${outlet.code} ${outlet.name} on ${on}: ${row.display_present ? 'display up' : 'no display'}, ${verdict}.`, json: row };
}

async function cmdReturnNew(db, args, flags) {
  const outlet = await resolve(db, 'outlet', args[0]);
  const specs = flags.lines.length ? flags.lines : args.slice(1);
  if (!specs.length) throw new CliError('Give me at least one line: returns new <outlet> --reason=damaged --line=KAI-CRK-250x6@L2604A');
  const rep = outlet.rep_id ? (await db.query('select * from reps where id = $1', [outlet.rep_id]))[0] : await whoIs(db, flags, { optional: true });
  const returnNo = flags.number && flags.number !== true ? flags.number : await nextReturnNo(db);
  const [ret] = await db.query(
    `insert into returns (return_no, outlet_id, rep_id, requested_on, reason, status, notes) values ($1, $2, $3, $4, $5, 'requested', $6) returning *`,
    [
      returnNo, outlet.id, rep?.id || null, parseDate(flags.on) || today(),
      flags.reason && flags.reason !== true ? String(flags.reason).toLowerCase() : 'damaged',
      flags.notes && flags.notes !== true ? flags.notes : null,
    ],
  );
  const written = [];
  for (const spec of specs) {
    const [body, batch] = String(spec).split('@');
    const { sku, qty } = parseLineSpec(body);
    const product = await resolve(db, 'product', sku);
    const unit = await casePrice(db, outlet, product);
    const [line] = await db.query(
      `insert into return_lines (return_id, product_id, quantity, unit_price_cents, batch_code, expiry_on, line_total_cents)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [ret.id, product.id, qty, unit, batch || null, parseDate(flags.expiry), qty * unit],
    );
    written.push({ ...line, sku: product.sku, product: product.name, batch_tracked: product.batch_tracked });
  }
  const missing = written.filter((l) => l.batch_tracked && !l.batch_code);
  const total = written.reduce((s, l) => s + num(l.line_total_cents), 0);
  let text = `${ret.return_no} raised for ${outlet.code} ${outlet.name}: ${ret.reason}, ${written.length} line${written.length === 1 ? '' : 's'}, ${price(total)}. Status requested.`;
  if (missing.length) {
    text += `\n  ${missing.length} batch tracked line(s) have no batch code (${missing.map((l) => l.sku).join(', ')}). Add one with @BATCH on the line, or the recall trail is broken. See docs/compliance.md.`;
  }
  text += `\n  Nobody is credited until someone authorises it: \`returns authorise ${ret.return_no} --by="<name>"\`.`;
  return { text, json: { return: ret, lines: written, total_cents: total } };
}

async function cmdReturnAuthorise(db, args, flags) {
  const ret = await resolve(db, 'return', args[0]);
  const by = flags.by && flags.by !== true ? flags.by : args.slice(1).join(' ');
  if (!by) throw new CliError('Who authorised it? returns authorise <number> --by="Rachel Adams"');
  const [row] = await db.query(
    `update returns set status = 'authorised', authorised_by = $2, authorised_on = $3 where id = $1 returning *`,
    [ret.id, by, parseDate(flags.on) || today()],
  );
  return { text: `${ret.return_no} authorised by ${by} on ${isoDate(row.authorised_on)}. Raise the credit note next: \`returns credit ${ret.return_no} --note=CN-00123\`.`, json: row };
}

async function cmdReturnDecline(db, args, flags) {
  const ret = await resolve(db, 'return', args[0]);
  const why = flags.reason && flags.reason !== true ? flags.reason : args.slice(1).join(' ');
  const [row] = await db.query(
    `update returns set status = 'declined', authorised_by = $2, authorised_on = $3, notes = coalesce(notes || ' | ', '') || $4 where id = $1 returning *`,
    [ret.id, flags.by && flags.by !== true ? flags.by : null, today(), `Declined: ${why || 'no reason given'}`],
  );
  return { text: `${ret.return_no} declined.${why ? ` ${why}` : ''}`, json: row };
}

async function cmdReturnCredit(db, args, flags) {
  const ret = await resolve(db, 'return', args[0]);
  if (ret.status !== 'authorised') {
    throw new CliError(`${ret.return_no} is ${ret.status}. A credit note only follows an authorised return. Authorise it first.`);
  }
  const note = flags.note && flags.note !== true ? flags.note : args[1];
  if (!note) throw new CliError('What is the credit note reference? returns credit <number> --note=CN-00123');
  const [row] = await db.query(`update returns set status = 'credited', credit_note_ref = $2 where id = $1 returning *`, [ret.id, note]);
  return { text: `${ret.return_no} credited against ${note}.`, json: row };
}

async function cmdNote(db, args, flags) {
  const outlet = await resolve(db, 'outlet', args[0]);
  const body = args.slice(1).join(' ');
  if (!body) throw new CliError('What is the note? note <outlet> "<what happened>"');
  const rep = outlet.rep_id ? (await db.query('select * from reps where id = $1', [outlet.rep_id]))[0] : await whoIs(db, flags, { optional: true });
  const [row] = await db.query('insert into outlet_notes (outlet_id, rep_id, body) values ($1, $2, $3) returning *', [
    outlet.id, rep?.id || null, body,
  ]);
  return { text: `Noted against ${outlet.code} ${outlet.name}.`, json: row };
}

async function cmdAdd(db, args, flags) {
  const kind = String(args[0] || '').toLowerCase();
  const name = args.slice(1).join(' ');
  if (kind === 'territory') {
    const [row] = await db.query(
      'insert into territories (name, code, region, manager) values ($1, $2, $3, $4) returning *',
      [name, flags.code === true ? null : flags.code, flags.region === true ? null : flags.region, flags.manager === true ? null : flags.manager],
    );
    return { text: `Territory ${row.name} added.`, json: row };
  }
  if (kind === 'rep') {
    const terr = flags.territory && flags.territory !== true ? await resolve(db, 'territory', flags.territory) : null;
    const [row] = await db.query(
      'insert into reps (full_name, code, email, phone, role, territory_id) values ($1, $2, $3, $4, $5, $6) returning *',
      [
        name, flags.code === true ? null : flags.code, flags.email === true ? null : flags.email,
        flags.phone === true ? null : flags.phone,
        flags.role && flags.role !== true ? flags.role : 'sales rep', terr?.id || null,
      ],
    );
    return { text: `Rep ${row.full_name} added${terr ? ` to ${terr.name}` : ''}.`, json: row };
  }
  if (kind === 'product') {
    if (!flags.sku || flags.sku === true) throw new CliError('A product needs a SKU: add product "<name>" --sku=ABC-123 --case=12 --price=4.49');
    const [row] = await db.query(
      `insert into products (sku, name, brand, category, unit_size, case_size, list_price_cents, batch_tracked)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [
        flags.sku, name, flags.brand === true ? null : flags.brand, flags.category === true ? null : flags.category,
        flags.size === true ? null : flags.size,
        flags.case && flags.case !== true ? Number(flags.case) : 1,
        parseMoney(flags.price), Boolean(flags.batch),
      ],
    );
    return { text: `Product ${row.sku} ${row.name} added.`, json: row };
  }
  if (kind === 'outlet') {
    const terr = flags.territory && flags.territory !== true ? await resolve(db, 'territory', flags.territory) : null;
    const rep = flags.rep && flags.rep !== true ? await resolve(db, 'rep', flags.rep) : null;
    const [pl] = flags.pricelist && flags.pricelist !== true
      ? await db.query('select * from price_lists where lower(code) = lower($1)', [flags.pricelist])
      : [null];
    const code = flags.code && flags.code !== true ? flags.code : `OUT-${String(Date.now()).slice(-6)}`;
    const [row] = await db.query(
      `insert into outlets (code, name, banner, channel, address, suburb, city, region, territory_id, rep_id, price_list_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [
        code, name, flags.banner === true ? null : flags.banner,
        flags.channel && flags.channel !== true ? flags.channel : 'grocery',
        flags.address === true ? null : flags.address, flags.suburb === true ? null : flags.suburb,
        flags.city === true ? null : flags.city, flags.region === true ? null : flags.region,
        terr?.id || null, rep?.id || null, pl?.id || null,
      ],
    );
    if (flags.every && flags.every !== true) {
      await db.query('insert into call_cycles (outlet_id, rep_id, frequency_days) values ($1, $2, $3) on conflict do nothing', [
        row.id, rep?.id || null, Number(flags.every),
      ]);
    }
    return { text: `Outlet ${row.code} ${row.name} added${flags.every && flags.every !== true ? `, on a ${flags.every} day call cycle` : ''}.`, json: row };
  }
  if (kind === 'contact') {
    const outlet = await resolve(db, 'outlet', flags.outlet);
    const [row] = await db.query(
      'insert into contacts (outlet_id, full_name, role, phone, email, is_primary) values ($1, $2, $3, $4, $5, $6) returning *',
      [outlet.id, name, flags.role === true ? null : flags.role, flags.phone === true ? null : flags.phone, flags.email === true ? null : flags.email, Boolean(flags.primary)],
    );
    return { text: `Contact ${row.full_name} added to ${outlet.code} ${outlet.name}.`, json: row };
  }
  if (kind === 'promotion' || kind === 'promo') {
    if (!flags.code || flags.code === true) throw new CliError('A promotion needs a code: add promotion "<name>" --code=SPRING-CRK --from= --to= --price=5.00 --was=5.78');
    const [row] = await db.query(
      `insert into promotions (code, name, mechanic, starts_on, ends_on, promo_price_cents, was_price_cents, required_display, funded_by, funding_agreement_ref)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [
        flags.code, name, flags.mechanic && flags.mechanic !== true ? flags.mechanic : 'price_off',
        parseDate(flags.from) || today(), parseDate(flags.to) || addDays(today(), 28),
        parseMoney(flags.price), parseMoney(flags.was),
        flags.display === true ? null : flags.display, flags.funded === true ? null : flags.funded,
        flags['funding-ref'] === true ? null : flags['funding-ref'],
      ],
    );
    for (const sku of flags.lines.length ? flags.lines : (flags.sku && flags.sku !== true ? [flags.sku] : [])) {
      const p = await resolve(db, 'product', String(sku).split(/[x:*]/)[0]);
      await db.query('insert into promotion_products (promotion_id, product_id) values ($1, $2) on conflict do nothing', [row.id, p.id]);
    }
    let text = `Promotion ${row.code} ${row.name} added, ${isoDate(row.starts_on)} to ${isoDate(row.ends_on)}.`;
    if (!row.funding_agreement_ref) text += '\n  No funding agreement reference on file. See docs/compliance.md, rule 2.';
    return { text, json: row };
  }
  if (kind === 'cycle' || kind === 'call-cycle') {
    const outlet = await resolve(db, 'outlet', name || flags.outlet);
    const [row] = await db.query(
      `insert into call_cycles (outlet_id, rep_id, frequency_days, preferred_weekday, sequence)
       values ($1, $2, $3, $4, $5)
       on conflict (outlet_id) do update set frequency_days = excluded.frequency_days,
         preferred_weekday = excluded.preferred_weekday, rep_id = coalesce(excluded.rep_id, call_cycles.rep_id)
       returning *`,
      [
        outlet.id,
        flags.rep && flags.rep !== true ? (await resolve(db, 'rep', flags.rep)).id : outlet.rep_id,
        flags.every && flags.every !== true ? Number(flags.every) : 14,
        flags.day && flags.day !== true ? WEEKDAYS.findIndex((d) => d.toLowerCase() === String(flags.day).slice(0, 3).toLowerCase()) : null,
        flags.sequence && flags.sequence !== true ? Number(flags.sequence) : 0,
      ],
    );
    return { text: `${outlet.code} ${outlet.name} is now on a ${row.frequency_days} day call cycle.`, json: row };
  }
  throw new CliError('add what? territory, rep, product, outlet, contact, promotion, cycle.');
}

async function cmdReps(db, args, flags) {
  const rows = await db.query(
    `select r.*, t.name as territory,
            (select count(*) from outlets o where o.rep_id = r.id and o.status = 'active')::integer as outlets,
            (select count(*) from visits v where v.rep_id = r.id and v.status = 'completed' and v.visited_on >= current_date - 29)::integer as calls_30
     from reps r left join territories t on t.id = r.territory_id
     ${flags.all ? '' : 'where r.active'} order by r.full_name`,
  );
  return {
    text: heading(`Reps (${rows.length})`) + '\n' + table(rows, [
      { key: 'code', label: 'Code' },
      { key: 'full_name', label: 'Name', width: 20 },
      { key: 'role', label: 'Role', width: 14 },
      { key: 'territory', label: 'Territory', width: 20 },
      { key: 'outlets', label: 'Outlets', align: 'right' },
      { key: 'calls_30', label: 'Calls 30d', align: 'right' },
      { key: 'email', label: 'Email', width: 28 },
    ]),
    json: rows,
  };
}

// ---------------------------------------------------------------------------
// Import

const SOURCES = {
  opmetrix: {
    outlet: {
      code: ['Customer Code', 'CustomerCode', 'Account Code', 'Code', 'Customer'],
      name: ['Customer Name', 'CustomerName', 'Trading Name', 'Name'],
      banner: ['Group', 'Banner', 'Chain', 'Customer Group'],
      channel: ['Type', 'Customer Type', 'Channel', 'Category'],
      address: ['Address', 'Address1', 'Street', 'Delivery Address'],
      suburb: ['Suburb', 'Address2'],
      city: ['City', 'Town'],
      region: ['Region', 'State', 'Area'],
      rep: ['Rep', 'Sales Rep', 'Representative', 'Owner'],
      territory: ['Territory', 'Area', 'Region'],
      frequency: ['Call Frequency', 'Frequency', 'Cycle', 'Call Cycle'],
      status: ['Status', 'Active'],
    },
    order: {
      number: ['Order Number', 'OrderNumber', 'Order No', 'Reference', 'Document'],
      code: ['Customer Code', 'CustomerCode', 'Account Code', 'Customer'],
      date: ['Order Date', 'Date', 'Created'],
      delivery: ['Delivery Date', 'Required Date', 'Deliver'],
      po: ['PO Number', 'Purchase Order', 'PO'],
      sku: ['Product Code', 'ProductCode', 'SKU', 'Item Code', 'Item'],
      qty: ['Quantity', 'Qty', 'Cases', 'Order Qty'],
      price: ['Unit Price', 'Price', 'Sell Price', 'Case Price'],
      rep: ['Rep', 'Sales Rep', 'Representative'],
    },
  },
  perenso: {
    outlet: {
      code: ['Outlet Code', 'Store Code', 'Customer Code', 'Account', 'Code'],
      name: ['Outlet Name', 'Store Name', 'Customer Name', 'Name'],
      banner: ['Banner', 'Chain', 'Group'],
      channel: ['Channel', 'Outlet Type', 'Type'],
      address: ['Address', 'Address Line 1', 'Street'],
      suburb: ['Suburb', 'Address Line 2'],
      city: ['City', 'Town'],
      region: ['State', 'Region'],
      rep: ['Rep', 'Sales Rep', 'Assigned To'],
      territory: ['Territory', 'Region'],
      frequency: ['Call Frequency', 'Visit Frequency', 'Frequency'],
      status: ['Status', 'Active'],
    },
    order: {
      number: ['Order ID', 'Order Number', 'Order No', 'Reference'],
      code: ['Outlet Code', 'Store Code', 'Customer Code', 'Account'],
      date: ['Order Date', 'Date'],
      delivery: ['Delivery Date', 'Required Date'],
      po: ['PO', 'PO Number', 'Purchase Order'],
      sku: ['Product Code', 'SKU', 'Item Code', 'Barcode'],
      qty: ['Quantity', 'Qty', 'Units', 'Cases'],
      price: ['Price', 'Unit Price', 'Sell'],
      rep: ['Rep', 'Sales Rep'],
    },
  },
};
// The generic reader accepts anything either of the named ones accepts.
SOURCES.csv = {
  outlet: Object.fromEntries(
    Object.keys(SOURCES.opmetrix.outlet).map((k) => [k, [...new Set([...SOURCES.opmetrix.outlet[k], ...SOURCES.perenso.outlet[k]])]]),
  ),
  order: Object.fromEntries(
    Object.keys(SOURCES.opmetrix.order).map((k) => [k, [...new Set([...SOURCES.opmetrix.order[k], ...SOURCES.perenso.order[k]])]]),
  ),
};

function readCsvFile(file) {
  const full = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  return parseCsv(readFileSync(full, 'utf8'));
}

async function cmdImport(db, args, flags) {
  const source = String(args[0] || 'csv').toLowerCase();
  const map = SOURCES[source];
  if (!map) throw new CliError(`Unknown source "${source}". Use opmetrix, perenso or csv.`);
  if (!flags.outlets && !flags.orders && !flags.contacts) {
    throw new CliError(
      `Point me at the export files:\n  import ${source} --outlets=customers.csv [--orders=orders.csv] [--contacts=contacts.csv]\n` +
        'See docs/replace-opmetrix.md for how to get them out.',
    );
  }
  const dry = Boolean(flags['dry-run']);
  const created = { outlets: 0, outlets_updated: 0, contacts: 0, orders: 0, order_lines: 0, cycles: 0, skipped: [] };

  const territoryCache = new Map();
  const repCache = new Map();
  async function territoryFor(name) {
    if (!name) return null;
    const key = name.toLowerCase();
    if (territoryCache.has(key)) return territoryCache.get(key);
    let [row] = await db.query('select * from territories where lower(name) = lower($1)', [name]);
    if (!row && !dry) [row] = await db.query('insert into territories (name) values ($1) returning *', [name]);
    territoryCache.set(key, row || null);
    return row || null;
  }
  async function repFor(name) {
    if (!name) return null;
    const key = name.toLowerCase();
    if (repCache.has(key)) return repCache.get(key);
    let [row] = await db.query('select * from reps where lower(full_name) = lower($1) or lower(code) = lower($1)', [name]);
    if (!row && !dry) [row] = await db.query('insert into reps (full_name) values ($1) returning *', [name]);
    repCache.set(key, row || null);
    return row || null;
  }

  if (flags.outlets && flags.outlets !== true) {
    const rows = readCsvFile(flags.outlets);
    for (const r of rows) {
      const code = pick(r, ...map.outlet.code);
      const name = pick(r, ...map.outlet.name);
      if (!code && !name) continue;
      const territory = await territoryFor(pick(r, ...map.outlet.territory));
      const rep = await repFor(pick(r, ...map.outlet.rep));
      const statusRaw = pick(r, ...map.outlet.status).toLowerCase();
      const status = !statusRaw ? 'active' : ['inactive', 'closed', 'no', 'false', '0'].includes(statusRaw) ? 'closed' : 'active';
      const [existing] = await db.query('select * from outlets where lower(code) = lower($1) or lower(external_ref) = lower($1)', [code || name]);
      if (dry) {
        created[existing ? 'outlets_updated' : 'outlets']++;
        continue;
      }
      if (existing) {
        await db.query(
          `update outlets set name = coalesce(nullif($2, ''), name), banner = coalesce(nullif($3, ''), banner),
             territory_id = coalesce($4, territory_id), rep_id = coalesce($5, rep_id), status = $6 where id = $1`,
          [existing.id, name, pick(r, ...map.outlet.banner), territory?.id || null, rep?.id || null, status],
        );
        created.outlets_updated++;
        continue;
      }
      const [outlet] = await db.query(
        `insert into outlets (code, name, banner, channel, address, suburb, city, region, territory_id, rep_id, status, external_ref)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
        [
          code || name, name || code, pick(r, ...map.outlet.banner),
          (pick(r, ...map.outlet.channel) || 'grocery').toLowerCase(),
          pick(r, ...map.outlet.address), pick(r, ...map.outlet.suburb), pick(r, ...map.outlet.city),
          pick(r, ...map.outlet.region), territory?.id || null, rep?.id || null, status, code || null,
        ],
      );
      created.outlets++;
      const freq = Number(String(pick(r, ...map.outlet.frequency)).replace(/\D/g, ''));
      if (freq > 0 && status === 'active') {
        await db.query('insert into call_cycles (outlet_id, rep_id, frequency_days) values ($1, $2, $3) on conflict do nothing', [
          outlet.id, rep?.id || null, freq,
        ]);
        created.cycles++;
      }
    }
  }

  if (flags.contacts && flags.contacts !== true) {
    const rows = readCsvFile(flags.contacts);
    for (const r of rows) {
      const code = pick(r, ...map.outlet.code);
      const name = pick(r, 'Contact Name', 'Contact', 'Full Name', 'Name');
      if (!code || !name) continue;
      const [outlet] = await db.query('select * from outlets where lower(code) = lower($1) or lower(external_ref) = lower($1)', [code]);
      if (!outlet) {
        created.skipped.push(`contact ${name}: no outlet ${code}`);
        continue;
      }
      if (dry) {
        created.contacts++;
        continue;
      }
      await db.query('insert into contacts (outlet_id, full_name, role, phone, email) values ($1, $2, $3, $4, $5)', [
        outlet.id, name, pick(r, 'Role', 'Position', 'Job Title'), pick(r, 'Phone', 'Mobile', 'Telephone'), pick(r, 'Email', 'Email Address'),
      ]);
      created.contacts++;
    }
  }

  if (flags.orders && flags.orders !== true) {
    const rows = readCsvFile(flags.orders);
    const seen = new Map();
    for (const r of rows) {
      const orderNo = pick(r, ...map.order.number);
      const code = pick(r, ...map.order.code);
      const sku = pick(r, ...map.order.sku);
      if (!orderNo || !sku) continue;
      const [outlet] = await db.query('select * from outlets where lower(code) = lower($1) or lower(external_ref) = lower($1)', [code]);
      if (!outlet) {
        created.skipped.push(`order ${orderNo}: no outlet ${code}`);
        continue;
      }
      const [product] = await db.query('select * from products where lower(sku) = lower($1) or lower(external_ref) = lower($1)', [sku]);
      if (!product) {
        created.skipped.push(`order ${orderNo}: no product ${sku}`);
        continue;
      }
      if (dry) {
        created.order_lines++;
        if (!seen.has(orderNo)) {
          seen.set(orderNo, true);
          created.orders++;
        }
        continue;
      }
      let orderId = seen.get(orderNo);
      if (!orderId) {
        const [existing] = await db.query('select * from orders where lower(order_no) = lower($1) or lower(external_ref) = lower($1)', [orderNo]);
        if (existing) {
          orderId = existing.id;
        } else {
          const rep = await repFor(pick(r, ...map.order.rep));
          const [order] = await db.query(
            `insert into orders (order_no, outlet_id, rep_id, price_list_id, ordered_on, delivery_on, status, po_number, external_ref)
             values ($1, $2, $3, $4, $5, $6, 'invoiced', $7, $8) returning *`,
            [
              orderNo, outlet.id, rep?.id || outlet.rep_id, outlet.price_list_id,
              parseDate(pick(r, ...map.order.date)) || today(),
              parseDate(pick(r, ...map.order.delivery)),
              pick(r, ...map.order.po) || null, orderNo,
            ],
          );
          orderId = order.id;
          created.orders++;
        }
        seen.set(orderNo, orderId);
      }
      const qty = Number(String(pick(r, ...map.order.qty) || '1').replace(/[^0-9.-]/g, '')) || 1;
      const unit = parseMoney(pick(r, ...map.order.price)) || (await casePrice(db, outlet, product));
      await db.query(
        `insert into order_lines (order_id, product_id, quantity, unit_price_cents, line_total_cents) values ($1, $2, $3, $4, $5)`,
        [orderId, product.id, Math.round(qty), unit, Math.round(qty) * unit],
      );
      created.order_lines++;
    }
  }

  const text =
    `${dry ? 'Dry run. ' : ''}Imported from ${source}:\n` +
    `  outlets       ${created.outlets} new, ${created.outlets_updated} updated\n` +
    `  call cycles   ${created.cycles}\n` +
    `  contacts      ${created.contacts}\n` +
    `  orders        ${created.orders} (${created.order_lines} lines)\n` +
    (created.skipped.length
      ? `  skipped       ${created.skipped.length}\n${created.skipped.slice(0, 10).map((s) => `    ${s}`).join('\n')}\n`
      : '') +
    '\n  Check it with `outlets` and `orders --from=2020-01-01`. Products and price lists are not in most exports; add them with `add product`.';
  return { text, json: created };
}

async function cmdExport(db, args, flags) {
  const tables = [
    'territories', 'reps', 'products', 'price_lists', 'price_list_items', 'outlets', 'contacts',
    'call_cycles', 'visits', 'visit_tasks', 'shelf_checks', 'promotions', 'promotion_products',
    'promo_checks', 'orders', 'order_lines', 'returns', 'return_lines', 'targets', 'outlet_notes',
  ];
  const dump = {};
  for (const t of tables) dump[t] = await db.query(`select * from ${t}`);
  const dir = path.join(REPO_ROOT, 'exports');
  mkdirSync(dir, { recursive: true });
  const file = flags.out && flags.out !== true ? flags.out : path.join(dir, `field-sales-${today()}.json`);
  writeFileSync(file, JSON.stringify(dump, null, 2));
  const counts = tables.map((t) => `${t} ${dump[t].length}`).join(', ');
  return { text: `Wrote ${path.relative(REPO_ROOT, file)}\n  ${counts}`, json: { file, counts: Object.fromEntries(tables.map((t) => [t, dump[t].length])) } };
}

// ---------------------------------------------------------------------------

const HELP = `field-sales-for-claude-code

Reads
  call-cycle [rep] [--territory= --due --days=7 --all]  the journey plan: who is due, who is late
  outlets [q] [--territory= --rep= --channel= --all]    every outlet with 90 day value and trend
  outlet <code|name|id>                                 one outlet: contacts, calls, orders, shelf, credits
  visits [--rep= --outlet= --status= --from= --to=]     calls made and calls planned
  visit <id>                                            one call: tasks, shelf, promotions, the order
  orders [outlet] [--rep= --status= --from= --to=]      order list with cases and value
  order <number>                                        one order with its lines
  shelf-check [outlet] [--product= --oos --days=30]     facings, shelf prices, empty shelves, planogram
  promos [--all]                                        promotions with compliance at a glance
  promo-compliance [promo] [--all]                      what is wrong in store, and who has not checked
  rep-week [rep]                                        calls, strike rate, average order, month vs target
  territory [name]                                      territories, or one territory in full
  returns [--status= --outlet= --all]                   credit requests and where they are stuck
  return <number>                                       one credit with its lines and batch codes
  products [q] [--all]                                  distribution, cases and value by SKU
  price-list [code|outlet]                              the price lists and what each outlet pays
  reps [--all] | targets [--month=]                     the team, and the month against target
  attention [--rep=]                                    everything that wants a decision this week
  stats                                                 coverage, strike rate, sales, compliance

Writes
  visit log <outlet> ["notes"] [--on= --minutes=35 --rep= --purpose= --no-order-reason=]
  visit plan <outlet> [--on=YYYY-MM-DD]  |  visit miss <outlet> "why"  |  visit task <id> "what"
  order new <outlet> --line=SKUx6 [--line=...] [--po= --deliver= --on= --status=draft --force]
  order submit <number> | order cancel <number>
  order export [number] [--ref=ERP-123]                 writes exports/orders-<date>.csv, marks exported
  shelf-check log <outlet> --sku= [--facings=3 --price=4.20 --oos --off-planogram --note=]
  promo-check <outlet> --promo=CODE [--display --ticket --price=5.00 --note= --photo=]
  returns new <outlet> --reason=damaged --line=SKUx6@BATCH [--expiry=]
  returns authorise <number> --by="<name>" | returns decline <number> "why" | returns credit <number> --note=CN-1
  note <outlet> "<what happened>"
  add territory|rep|product|outlet|contact|promotion|cycle "<name>" [--flags]

Moving in and out
  import opmetrix|perenso|csv --outlets=<csv> [--orders=<csv>] [--contacts=<csv>] [--dry-run]
  export [--out=file.json]

Money in dollars: --price=4.20 means $4.20. Quantities are cases.
Any command takes --json. Ids shorten to their first 8 characters. Names match case-insensitively.
`;

const COMMANDS = {
  'call-cycle': cmdCallCycle,
  callcycle: cmdCallCycle,
  outlets: cmdOutlets,
  outlet: cmdOutlet,
  visits: cmdVisits,
  visit: cmdVisit,
  orders: cmdOrders,
  order: cmdOrder,
  'shelf-check': cmdShelfCheck,
  promos: cmdPromos,
  'promo-compliance': cmdPromoCompliance,
  'promo-check': cmdPromoCheck,
  'rep-week': cmdRepWeek,
  territory: cmdTerritory,
  territories: cmdTerritory,
  returns: cmdReturns,
  return: async (db, args) => cmdReturnShow(db, await resolve(db, 'return', args.join(' '))),
  products: cmdProducts,
  'price-list': cmdPriceList,
  reps: cmdReps,
  targets: cmdTargets,
  attention: cmdAttention,
  stats: cmdStats,
  note: cmdNote,
  add: cmdAdd,
  import: cmdImport,
  export: cmdExport,
};

async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  const [command, ...rest] = args;
  if (!command || command === 'help' || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const fn = COMMANDS[command];
  if (!fn) {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }
  const db = await getDb();
  try {
    const result = await fn(db, rest, flags);
    if (flags.json) process.stdout.write(JSON.stringify(result.json, null, 2) + '\n');
    else process.stdout.write(result.text.replace(/^\n/, '') + '\n');
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`${e.message}\n`);
      return e.code;
    }
    if (/relation .* does not exist/.test(e.message)) {
      process.stderr.write('The database has no tables yet. Run: npm run migrate\n');
      return 1;
    }
    throw e;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
