# The rules a field sales team lives under

This file is the rule book `/compliance` checks the database against. Each rule has a name,
the source it comes from, what a breach looks like in the data, and the query that finds it.

Nothing here is legal advice. These are the rules the operator has told this system to enforce.
Read them, change them to match your own trading terms and your own category, and keep the
sources current. When a rule changes, change the rule and the check together.

The examples are New Zealand and Australian food and grocery. If you sell into another
category or another country, replace the sources with yours and keep the shape.

---

## 1. The price on the shelf is the price you promoted

**Source.** Fair Trading Act 1986, section 13(g): no false or misleading representation about
price. [legislation.govt.nz](https://www.legislation.govt.nz/act/public/1986/0121/latest/whole.html).
Commerce Commission guidance on pricing:
[comcom.govt.nz](https://www.comcom.govt.nz/consumers/dealing-with-typical-situations/buying-goods-and-services/pricing/).
In Australia the equivalent is the Australian Consumer Law, section 29(1)(i).

**What it means for a rep.** If your promotion says 2 for $5 and the shelf ticket says $5.78,
the store is making a misleading price representation and your brand is on the ticket. The rep
who walked past it is the last line of defence, and the record of what they saw is your evidence
that you found it and fixed it.

**Breach in the data.** A row in `promo_checks` inside a live promotion where `price_correct`
is false, or where `ticket_price_cents` does not equal the promotion's `promo_price_cents`.

```sql
select pr.code, o.code as outlet, pc.checked_on,
       pc.ticket_price_cents, pr.promo_price_cents
from promo_checks pc
join promotions pr on pr.id = pc.promotion_id
join outlets o on o.id = pc.outlet_id
where pc.checked_on between pr.starts_on and pr.ends_on
  and pr.ends_on >= current_date
  and (not pc.price_correct or pc.ticket_price_cents <> pr.promo_price_cents)
order by pc.checked_on desc;
```

**Command.** `npm run field -- promo-compliance` lists every breach with the outlet and the rep.

---

## 2. A "was" price has to be a price you actually charged

**Source.** Fair Trading Act 1986, sections 13(g) and 13(j) (misleading representations about
price and about the existence of a price advantage).
[legislation.govt.nz](https://www.legislation.govt.nz/act/public/1986/0121/latest/whole.html).
The Commerce Commission has taken action over strikethrough pricing and multi-buys that were
not cheaper than the single price.

**What it means for a rep.** A promotion that shows "was $5.78, now $5.00" has to be able to
show that $5.78 was the real selling price for a real period before the promotion started. Your
own shelf checks are that evidence.

**Breach in the data.** A promotion where `was_price_cents` is not above `promo_price_cents`,
or where no shelf check in the 60 days before the promotion started recorded a shelf price at
or above the claimed was price.

```sql
select p.code, p.name, p.was_price_cents, p.promo_price_cents,
       (select count(*) from shelf_checks sc
        join promotion_products pp on pp.product_id = sc.product_id and pp.promotion_id = p.id
        where sc.checked_on between p.starts_on - 60 and p.starts_on
          and sc.shelf_price_cents >= p.was_price_cents) as evidence_rows
from promotions p
where p.ends_on >= current_date
  and (p.was_price_cents is null or p.was_price_cents <= p.promo_price_cents);
```

**Command.** `npm run field -- promos` shows the promo price and the was price side by side.

---

## 3. Promotion funding is agreed in writing before anyone is charged for it

**Source.** Grocery Supply Code, made under the Grocery Industry Competition Act 2023.
[Commerce Commission](https://www.comcom.govt.nz/regulated-industries/grocery/grocery-supply-code/),
[the Act](https://www.legislation.govt.nz/act/public/2023/0031/latest/whole.html). Grocery supply
agreements must be in writing and retained for up to seven years after they expire, and a retailer
must not require a supplier to fund a promotion unless the Code's requirements are met.
In Australia the Food and Grocery Code of Conduct covers the same ground.

**What it means for a supplier.** Every co-funded promotion needs a reference to the written
agreement that set the split. A verbal yes from a category manager is not a record.

**Breach in the data.** A promotion with `funded_by` set and `funding_agreement_ref` empty.

```sql
select code, name, starts_on, ends_on, funded_by
from promotions
where ends_on >= current_date
  and funded_by is not null
  and coalesce(funding_agreement_ref, '') = '';
```

**Command.** `npm run field -- promos` prints `NONE` in the funding reference column.

---

## 4. Every batch tracked line carries its batch code

**Source.** Food Act 2014 (New Zealand),
[legislation.govt.nz](https://www.legislation.govt.nz/act/public/2014/0032/latest/whole.html), and
MPI's food recall requirements,
[mpi.govt.nz](https://www.mpi.govt.nz/food-business/running-a-food-business/food-act-2014/introduction-food-act-2014).
For Australia, Australia New Zealand Food Standards Code Standard 3.2.2, food recall,
[foodstandards.gov.au](https://www.foodstandards.gov.au/business/food-recalls).

**What it means for a supplier.** Traceability is one step back and one step forward: you must
be able to say which supplier lot went into a batch, and which customers received that batch.
A return of short dated or damaged stock is a traceability event. If the batch code is not
recorded when the stock leaves the store, the trail stops there. Records are kept for at least
four years, and seven for product under the Animal Products Act.

**Breach in the data.** A `return_lines` row for a product where `batch_tracked` is true and
`batch_code` is empty. A return with `reason = 'recall'` and any line without a batch code is
the serious version.

```sql
select r.return_no, r.reason, r.status, o.name as outlet, p.sku, rl.quantity
from return_lines rl
join returns r on r.id = rl.return_id
join products p on p.id = rl.product_id
join outlets o on o.id = r.outlet_id
where p.batch_tracked and coalesce(rl.batch_code, '') = ''
order by r.requested_on desc;
```

**Command.** `npm run field -- returns` shows a "No batch" count on every credit.
`npm run field -- return <number>` prints MISSING against the line.

---

## 5. A credit note only follows an authorised return

**Source.** Goods and Services Tax Act 1985, section 25 (credit and debit notes),
[legislation.govt.nz](https://www.legislation.govt.nz/act/public/1985/0141/latest/whole.html).
The customer's underlying right sits in the Consumer Guarantees Act 1993 and your own trading
terms, [legislation.govt.nz](https://www.legislation.govt.nz/act/public/1993/0091/latest/whole.html).

**What it means for a supplier.** Two rules, one check. A credit that was never authorised is a
control failure your auditor will find. A credit request that sits for weeks is a customer
relationship failure your rep will hear about.

**Breach in the data.** A return with `status = 'credited'` and no `authorised_by`, or a return
sitting at `requested` for more than five days.

```sql
select return_no, status, requested_on, authorised_by, credit_note_ref,
       (current_date - requested_on) as age_days
from returns
where (status = 'credited' and authorised_by is null)
   or (status = 'requested' and requested_on < current_date - 5)
order by requested_on;
```

**Command.** `npm run field -- attention` lists them under "Credit waiting on authorisation".
The CLI refuses `returns credit` on anything that is not authorised.

---

## 6. Keep the records for seven years

**Source.** Tax Administration Act 1994, section 22 (business records, seven years),
[legislation.govt.nz](https://www.legislation.govt.nz/act/public/1994/0166/latest/whole.html).
The Grocery Supply Code requires supply agreements to be retained for up to seven years after
they expire.

**What it means here.** Nothing in this repo deletes anything. Orders, credits, visits and
checks are kept. When you archive an outlet, set `status = 'closed'` instead of deleting the row,
so the history it carries stays with you. Back the database up somewhere you control.

```sql
select min(ordered_on) as oldest_order, max(ordered_on) as newest_order,
       count(*) as orders
from orders;
```

**Command.** `npm run field -- export` writes the whole database to a single JSON file.

---

## Adding your own rule

Copy the shape: a name in plain words, the source with a link, what the breach looks like in the
data, the SQL, and the command. Then tell Claude Code to add it to `/compliance`. If the rule
needs a column that does not exist yet, use `/customise` to add it first.
