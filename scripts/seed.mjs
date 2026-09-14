#!/usr/bin/env node
// Loads supabase/seed.sql: Kaimai Foods, a demo food and beverage supplier with
// three territories, four reps, fifteen outlets and six months of field history.
// Every row has a stable id and inserts with ON CONFLICT DO NOTHING, so re-running is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from outlets)      as outlets,
           (select count(*) from reps)         as reps,
           (select count(*) from products)     as products,
           (select count(*) from visits)       as visits,
           (select count(*) from orders)       as orders,
           (select count(*) from order_lines)  as order_lines,
           (select count(*) from shelf_checks) as shelf_checks,
           (select count(*) from promo_checks) as promo_checks,
           (select count(*) from returns)      as returns
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    const counts = await seed(db);
    console.log(
      `seed: ${counts.outlets} outlets, ${counts.reps} reps, ${counts.products} products, ` +
        `${counts.visits} visits, ${counts.orders} orders (${counts.order_lines} lines), ` +
        `${counts.shelf_checks} shelf checks, ${counts.promo_checks} promotion checks, ${counts.returns} returns`,
    );
  } finally {
    await db.close();
  }
}
