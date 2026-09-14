-- field-sales-for-claude-code: core schema.
-- A field sales and merchandising round: territories, outlets, call cycles, visits,
-- in-store checks, orders, promotions, returns and targets.
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
-- Money is stored in cents. A route is an ordered list, not a map.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Territories ---------------------------------------------------------------

create table if not exists territories (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  code         text,
  region       text,
  manager      text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists territories_name_lower_idx on territories (lower(name));

-- Reps ----------------------------------------------------------------------

create table if not exists reps (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  code          text,
  email         text,
  phone         text,
  role          text not null default 'sales rep',
  territory_id  uuid references territories(id) on delete set null,
  active        boolean not null default true,
  started_on    date,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists reps_name_lower_idx on reps (lower(full_name));

-- Products ------------------------------------------------------------------

create table if not exists products (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null,
  name              text not null,
  brand             text,
  category          text,
  unit_size         text,
  case_size         integer not null default 1,
  list_price_cents  bigint not null default 0,
  batch_tracked     boolean not null default false,
  active            boolean not null default true,
  external_ref      text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists products_sku_lower_idx on products (lower(sku));

-- Price lists ---------------------------------------------------------------

create table if not exists price_lists (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  currency    text not null default 'NZD',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists price_lists_code_lower_idx on price_lists (lower(code));

create table if not exists price_list_items (
  id             uuid primary key default gen_random_uuid(),
  price_list_id  uuid not null references price_lists(id) on delete cascade,
  product_id     uuid not null references products(id) on delete cascade,
  price_cents    bigint not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists price_list_items_uniq on price_list_items (price_list_id, product_id);

-- Outlets (the stores a rep calls on) ---------------------------------------

create table if not exists outlets (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  name               text not null,
  banner             text,
  channel            text not null default 'grocery',
  address            text,
  suburb             text,
  city               text,
  region             text,
  territory_id       uuid references territories(id) on delete set null,
  rep_id             uuid references reps(id) on delete set null,
  price_list_id      uuid references price_lists(id) on delete set null,
  status             text not null default 'active',
  credit_hold        boolean not null default false,
  payment_terms_days integer not null default 20,
  opened_on          date,
  notes              text,
  external_ref       text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists outlets_code_lower_idx on outlets (lower(code));
create index if not exists outlets_name_lower_idx on outlets (lower(name));

create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references outlets(id) on delete cascade,
  full_name   text not null,
  role        text,
  phone       text,
  email       text,
  is_primary  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists contacts_outlet_idx on contacts (outlet_id);

-- Call cycles (the journey plan) --------------------------------------------
-- One row per outlet: who calls on it, how often, and which day suits.
-- preferred_weekday follows Postgres dow: 0 Sunday, 1 Monday ... 6 Saturday.

create table if not exists call_cycles (
  id                uuid primary key default gen_random_uuid(),
  outlet_id         uuid not null references outlets(id) on delete cascade,
  rep_id            uuid references reps(id) on delete set null,
  frequency_days    integer not null default 14,
  preferred_weekday integer,
  sequence          integer not null default 0,
  starts_on         date not null default current_date,
  active            boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists call_cycles_outlet_uniq on call_cycles (outlet_id);

-- Visits --------------------------------------------------------------------

create table if not exists visits (
  id               uuid primary key default gen_random_uuid(),
  outlet_id        uuid not null references outlets(id) on delete cascade,
  rep_id           uuid references reps(id) on delete set null,
  planned_on       date,
  visited_on       date,
  duration_minutes integer not null default 0,
  status           text not null default 'planned',
  purpose          text,
  no_order_reason  text,
  notes            text,
  external_ref     text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists visits_outlet_idx on visits (outlet_id);
create index if not exists visits_rep_idx on visits (rep_id);
create index if not exists visits_visited_idx on visits (visited_on);

-- The in-store checklist for a visit.
create table if not exists visit_tasks (
  id           uuid primary key default gen_random_uuid(),
  visit_id     uuid not null references visits(id) on delete cascade,
  kind         text not null,
  title        text not null,
  status       text not null default 'pending',
  result_note  text,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists visit_tasks_visit_idx on visit_tasks (visit_id);

-- Shelf and planogram checks ------------------------------------------------

create table if not exists shelf_checks (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid references visits(id) on delete cascade,
  outlet_id         uuid not null references outlets(id) on delete cascade,
  product_id        uuid not null references products(id) on delete cascade,
  checked_on        date not null default current_date,
  facings           integer not null default 0,
  shelf_price_cents bigint,
  on_shelf          boolean not null default true,
  out_of_stock      boolean not null default false,
  planogram_ok      boolean not null default true,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists shelf_checks_outlet_idx on shelf_checks (outlet_id, checked_on);
create index if not exists shelf_checks_product_idx on shelf_checks (product_id);

-- Promotions ----------------------------------------------------------------

create table if not exists promotions (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null,
  name                   text not null,
  mechanic               text not null default 'price_off',
  starts_on              date not null,
  ends_on                date not null,
  promo_price_cents      bigint,
  was_price_cents        bigint,
  required_display       text,
  funded_by              text,
  funding_agreement_ref  text,
  status                 text not null default 'active',
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists promotions_code_lower_idx on promotions (lower(code));

create table if not exists promotion_products (
  id            uuid primary key default gen_random_uuid(),
  promotion_id  uuid not null references promotions(id) on delete cascade,
  product_id    uuid not null references products(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create unique index if not exists promotion_products_uniq on promotion_products (promotion_id, product_id);

create table if not exists promo_checks (
  id                 uuid primary key default gen_random_uuid(),
  visit_id           uuid references visits(id) on delete cascade,
  promotion_id       uuid not null references promotions(id) on delete cascade,
  outlet_id          uuid not null references outlets(id) on delete cascade,
  checked_on         date not null default current_date,
  display_present    boolean not null default false,
  ticket_present     boolean not null default false,
  ticket_price_cents bigint,
  price_correct      boolean not null default false,
  photo_ref          text,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists promo_checks_promo_idx on promo_checks (promotion_id, checked_on);
create index if not exists promo_checks_outlet_idx on promo_checks (outlet_id);

-- Orders --------------------------------------------------------------------

create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  order_no       text not null,
  outlet_id      uuid not null references outlets(id) on delete cascade,
  rep_id         uuid references reps(id) on delete set null,
  visit_id       uuid references visits(id) on delete set null,
  price_list_id  uuid references price_lists(id) on delete set null,
  ordered_on     date not null default current_date,
  delivery_on    date,
  status         text not null default 'draft',
  po_number      text,
  notes          text,
  exported_at    timestamptz,
  erp_ref        text,
  external_ref   text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists orders_no_lower_idx on orders (lower(order_no));
create index if not exists orders_outlet_idx on orders (outlet_id, ordered_on);
create index if not exists orders_rep_idx on orders (rep_id, ordered_on);

-- quantity is cases. unit_price_cents is the price of one case, which is how a
-- rep writes an order and how the ERP expects to receive it.
create table if not exists order_lines (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  product_id        uuid not null references products(id) on delete restrict,
  quantity          integer not null default 1,
  unit_price_cents  bigint not null default 0,
  discount_pct      numeric(5,2) not null default 0,
  promotion_id      uuid references promotions(id) on delete set null,
  line_total_cents  bigint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists order_lines_order_idx on order_lines (order_id);
create index if not exists order_lines_product_idx on order_lines (product_id);

-- Returns and credits -------------------------------------------------------

create table if not exists returns (
  id               uuid primary key default gen_random_uuid(),
  return_no        text not null,
  outlet_id        uuid not null references outlets(id) on delete cascade,
  rep_id           uuid references reps(id) on delete set null,
  visit_id         uuid references visits(id) on delete set null,
  requested_on     date not null default current_date,
  reason           text not null default 'damaged',
  status           text not null default 'requested',
  authorised_by    text,
  authorised_on    date,
  credit_note_ref  text,
  notes            text,
  external_ref     text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists returns_no_lower_idx on returns (lower(return_no));
create index if not exists returns_outlet_idx on returns (outlet_id, requested_on);

create table if not exists return_lines (
  id                uuid primary key default gen_random_uuid(),
  return_id         uuid not null references returns(id) on delete cascade,
  product_id        uuid not null references products(id) on delete restrict,
  quantity          integer not null default 1,
  unit_price_cents  bigint not null default 0,
  batch_code        text,
  expiry_on         date,
  line_total_cents  bigint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists return_lines_return_idx on return_lines (return_id);

-- Targets -------------------------------------------------------------------

create table if not exists targets (
  id            uuid primary key default gen_random_uuid(),
  period_month  date not null,
  rep_id        uuid references reps(id) on delete cascade,
  territory_id  uuid references territories(id) on delete cascade,
  metric        text not null,
  target_value  numeric(14,2) not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists targets_period_idx on targets (period_month, metric);

-- Notes against an outlet that outlive any one visit ------------------------

create table if not exists outlet_notes (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references outlets(id) on delete cascade,
  rep_id      uuid references reps(id) on delete set null,
  visit_id    uuid references visits(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists outlet_notes_outlet_idx on outlet_notes (outlet_id, created_at);

-- updated_at triggers -------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'territories','reps','products','price_lists','price_list_items','outlets','contacts',
    'call_cycles','visits','visit_tasks','shelf_checks','promotions','promo_checks',
    'orders','order_lines','returns','return_lines','targets','outlet_notes'
  ] loop
    execute format('drop trigger if exists set_updated_at_%1$s on %1$s', t);
    execute format('create trigger set_updated_at_%1$s before update on %1$s for each row execute function set_updated_at()', t);
  end loop;
end
$$;

-- Views ---------------------------------------------------------------------

-- One row per order with its line total. Everything money reads through here.
create or replace view v_order_totals as
select
  o.id                                  as order_id,
  o.order_no,
  o.outlet_id,
  o.rep_id,
  o.visit_id,
  o.ordered_on,
  o.delivery_on,
  o.status,
  o.po_number,
  o.erp_ref,
  o.exported_at,
  coalesce(l.line_count, 0)::integer    as line_count,
  coalesce(l.units, 0)::integer         as units,
  coalesce(l.total_cents, 0)::bigint    as total_cents
from orders o
left join (
  select order_id,
         count(*)::integer          as line_count,
         sum(quantity)::integer     as units,
         sum(line_total_cents)::bigint as total_cents
  from order_lines group by order_id
) l on l.order_id = o.id;

-- The journey plan, with what is due and what is late.
create or replace view v_call_cycle_due as
select
  c.id                                       as call_cycle_id,
  o.id                                       as outlet_id,
  o.code                                     as outlet_code,
  o.name                                     as outlet,
  o.banner,
  o.channel,
  o.city,
  t.name                                     as territory,
  r.id                                       as rep_id,
  r.full_name                                as rep,
  c.frequency_days,
  c.preferred_weekday,
  c.sequence,
  lv.last_visit_on,
  case when lv.last_visit_on is null then null
       else (current_date - lv.last_visit_on)::integer end          as days_since_visit,
  coalesce(lv.last_visit_on + c.frequency_days, c.starts_on)        as due_on,
  (current_date - coalesce(lv.last_visit_on + c.frequency_days, c.starts_on))::integer as days_overdue,
  lo.last_order_on,
  coalesce(lo.value_90_cents, 0)::bigint     as value_90_cents
from call_cycles c
join outlets o on o.id = c.outlet_id
left join reps r on r.id = c.rep_id
left join territories t on t.id = o.territory_id
left join (
  select outlet_id, max(visited_on) as last_visit_on
  from visits where status = 'completed' group by outlet_id
) lv on lv.outlet_id = c.outlet_id
left join (
  select outlet_id,
         max(ordered_on) as last_order_on,
         sum(case when ordered_on >= current_date - 90 then total_cents else 0 end) as value_90_cents
  from v_order_totals where status <> 'cancelled' group by outlet_id
) lo on lo.outlet_id = c.outlet_id
where c.active and o.status = 'active';

-- A rep week: the seven days behind, the numbers a manager asks for.
create or replace view v_rep_week as
select
  w.*,
  case when w.calls_completed = 0 then 0
       else round(w.orders_taken * 100.0 / w.calls_completed)::integer end as strike_rate_pct,
  case when w.orders_taken = 0 then 0
       else (w.order_value_cents / w.orders_taken)::bigint end             as avg_order_cents,
  case when w.calls_completed = 0 then 0
       else round(w.minutes_in_store::numeric / w.calls_completed)::integer end as avg_minutes_in_store
from (
  select
    r.id                as rep_id,
    r.full_name         as rep,
    r.code              as rep_code,
    t.name              as territory,
    (select count(*) from visits v
      where v.rep_id = r.id and v.status = 'completed'
        and v.visited_on >= current_date - 6)::integer                        as calls_completed,
    (select count(*) from visits v
      where v.rep_id = r.id and v.status = 'missed'
        and v.planned_on >= current_date - 6)::integer                        as calls_missed,
    (select count(*) from visits v
      where v.rep_id = r.id and v.status = 'planned'
        and v.planned_on between current_date - 6 and current_date + 6)::integer as calls_planned,
    (select coalesce(sum(v.duration_minutes), 0) from visits v
      where v.rep_id = r.id and v.status = 'completed'
        and v.visited_on >= current_date - 6)::integer                        as minutes_in_store,
    (select count(*) from v_order_totals o
      where o.rep_id = r.id and o.status <> 'cancelled'
        and o.ordered_on >= current_date - 6)::integer                        as orders_taken,
    (select coalesce(sum(o.total_cents), 0) from v_order_totals o
      where o.rep_id = r.id and o.status <> 'cancelled'
        and o.ordered_on >= current_date - 6)::bigint                         as order_value_cents,
    (select coalesce(sum(o.total_cents), 0) from v_order_totals o
      where o.rep_id = r.id and o.status <> 'cancelled'
        and o.ordered_on >= date_trunc('month', current_date)::date)::bigint  as month_value_cents,
    (select count(*) from v_call_cycle_due d
      where d.rep_id = r.id and d.days_overdue > 0)::integer                  as calls_overdue,
    (select count(*) from promo_checks pc
      where pc.checked_on >= current_date - 6
        and pc.outlet_id in (select id from outlets where rep_id = r.id))::integer as promo_checks_done
  from reps r
  left join territories t on t.id = r.territory_id
  where r.active
) w;

-- Every outlet, how it is travelling, and whether it has gone quiet.
create or replace view v_outlet_health as
select
  o.id                                        as outlet_id,
  o.code                                      as outlet_code,
  o.name                                      as outlet,
  o.banner,
  o.channel,
  o.city,
  o.status,
  o.credit_hold,
  t.name                                      as territory,
  r.full_name                                 as rep,
  lv.last_visit_on,
  case when lv.last_visit_on is null then null
       else (current_date - lv.last_visit_on)::integer end   as days_since_visit,
  lo.last_order_on,
  case when lo.last_order_on is null then null
       else (current_date - lo.last_order_on)::integer end   as days_since_order,
  coalesce(lo.orders_90, 0)::integer          as orders_90,
  coalesce(lo.value_90_cents, 0)::bigint      as value_90_cents,
  coalesce(lo.value_prior_90_cents, 0)::bigint as value_prior_90_cents,
  case when coalesce(lo.value_prior_90_cents, 0) = 0 then null
       else round((coalesce(lo.value_90_cents, 0) - lo.value_prior_90_cents) * 100.0
                  / lo.value_prior_90_cents)::integer end    as trend_pct,
  coalesce(sc.oos_30, 0)::integer             as oos_30,
  coalesce(sc.planogram_fails_30, 0)::integer as planogram_fails_30,
  coalesce(rt.open_returns, 0)::integer       as open_returns
from outlets o
left join territories t on t.id = o.territory_id
left join reps r on r.id = o.rep_id
left join (
  select outlet_id, max(visited_on) as last_visit_on
  from visits where status = 'completed' group by outlet_id
) lv on lv.outlet_id = o.id
left join (
  select outlet_id,
         max(ordered_on) as last_order_on,
         count(*) filter (where ordered_on >= current_date - 90)                as orders_90,
         sum(case when ordered_on >= current_date - 90 then total_cents else 0 end) as value_90_cents,
         sum(case when ordered_on >= current_date - 180 and ordered_on < current_date - 90
                  then total_cents else 0 end)                                  as value_prior_90_cents
  from v_order_totals where status <> 'cancelled' group by outlet_id
) lo on lo.outlet_id = o.id
left join (
  select outlet_id,
         count(*) filter (where out_of_stock and checked_on >= current_date - 30)      as oos_30,
         count(*) filter (where not planogram_ok and checked_on >= current_date - 30)  as planogram_fails_30
  from shelf_checks group by outlet_id
) sc on sc.outlet_id = o.id
left join (
  select outlet_id, count(*) as open_returns
  from returns where status in ('requested', 'authorised') group by outlet_id
) rt on rt.outlet_id = o.id;

-- Promotion compliance: did the display go up, is the ticket right, is the price right.
create or replace view v_promo_compliance as
select
  p.id                                    as promotion_id,
  p.code,
  p.name                                  as promotion,
  p.mechanic,
  p.starts_on,
  p.ends_on,
  p.promo_price_cents,
  p.was_price_cents,
  p.required_display,
  p.funded_by,
  p.funding_agreement_ref,
  p.status,
  coalesce(c.checks, 0)::integer          as checks,
  coalesce(c.outlets_checked, 0)::integer as outlets_checked,
  coalesce(c.display_present, 0)::integer as display_present,
  coalesce(c.ticket_present, 0)::integer  as ticket_present,
  coalesce(c.price_correct, 0)::integer   as price_correct,
  (coalesce(c.checks, 0) - coalesce(c.price_correct, 0))::integer as price_breaches,
  case when coalesce(c.checks, 0) = 0 then null
       else round(c.price_correct * 100.0 / c.checks)::integer end as compliance_pct,
  case when coalesce(c.checks, 0) = 0 then null
       else round(c.display_present * 100.0 / c.checks)::integer end as display_pct,
  (select count(*) from outlets o where o.status = 'active')::integer as outlets_active
from promotions p
left join (
  select promotion_id,
         count(*)                                  as checks,
         count(distinct outlet_id)                 as outlets_checked,
         count(*) filter (where display_present)   as display_present,
         count(*) filter (where ticket_present)    as ticket_present,
         count(*) filter (where price_correct)     as price_correct
  from promo_checks group by promotion_id
) c on c.promotion_id = p.id;

-- Everything that wants a decision this week, in one list.
--   call_overdue        an outlet past its call cycle
--   promo_breach        a promotion checked in store with the wrong price or no display
--   order_unsent        a submitted order that has not gone to the ERP
--   return_unauthorised a credit request sitting with nobody
--   outlet_quiet        an active outlet with no order for 90 days
--   out_of_stock        a line found empty on the shelf and not seen since
create or replace view v_attention_due as
select
  'call_overdue'::text                 as reason,
  'outlet'::text                       as ref_type,
  d.outlet_id                          as ref_id,
  d.outlet_code                        as label,
  d.outlet                             as outlet,
  d.rep,
  d.days_overdue                       as days,
  0::bigint                            as amount_cents,
  ('every ' || d.frequency_days || ' days, due ' || d.due_on::text)::text as detail
from v_call_cycle_due d
where d.days_overdue > 0

union all

select
  'promo_breach',
  'promotion',
  pc.promotion_id,
  p.name,
  o.name,
  r.full_name,
  (current_date - pc.checked_on)::integer,
  0::bigint,
  (case when not pc.display_present then 'no display' else 'display up' end
    || ', ticket ' || (case when pc.ticket_present then 'up' else 'missing' end)
    || ', price ' || (case when pc.price_correct then 'right' else 'wrong' end))::text
from promo_checks pc
join promotions p on p.id = pc.promotion_id
join outlets o on o.id = pc.outlet_id
left join reps r on r.id = o.rep_id
where (not pc.price_correct or not pc.display_present)
  and pc.checked_on >= current_date - 28
  and p.ends_on >= current_date

union all

select
  'order_unsent',
  'order',
  t.order_id,
  t.order_no,
  o.name,
  r.full_name,
  (current_date - t.ordered_on)::integer,
  t.total_cents,
  (t.units::text || ' cases, submitted ' || t.ordered_on::text)::text
from v_order_totals t
join outlets o on o.id = t.outlet_id
left join reps r on r.id = t.rep_id
where t.status = 'submitted' and t.ordered_on <= current_date - 1

union all

select
  'return_unauthorised',
  'return',
  rt.id,
  rt.return_no,
  o.name,
  r.full_name,
  (current_date - rt.requested_on)::integer,
  coalesce(rl.total_cents, 0)::bigint,
  (rt.reason || ', requested ' || rt.requested_on::text)::text
from returns rt
join outlets o on o.id = rt.outlet_id
left join reps r on r.id = rt.rep_id
left join (
  select return_id, sum(line_total_cents) as total_cents from return_lines group by return_id
) rl on rl.return_id = rt.id
where rt.status = 'requested' and rt.requested_on <= current_date - 3

union all

select
  'outlet_quiet',
  'outlet',
  h.outlet_id,
  h.outlet_code,
  h.outlet,
  h.rep,
  coalesce(h.days_since_order, 999),
  0::bigint,
  (case when h.last_order_on is null then 'no order on record'
        else 'last order ' || h.last_order_on::text end)::text
from v_outlet_health h
where h.status = 'active'
  and (h.last_order_on is null or h.last_order_on < current_date - 90)

union all

select
  'out_of_stock',
  'product',
  sc.product_id,
  pr.name,
  o.name,
  r.full_name,
  (current_date - sc.checked_on)::integer,
  0::bigint,
  ('empty shelf, checked ' || sc.checked_on::text)::text
from shelf_checks sc
join products pr on pr.id = sc.product_id
join outlets o on o.id = sc.outlet_id
left join reps r on r.id = o.rep_id
where sc.out_of_stock and sc.checked_on >= current_date - 21;
