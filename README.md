<h1 align="center">Field Sales for Claude Code</h1>

<p align="center">
  <strong>The open-source field sales and merchandising system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Or installed and run for you.
</p>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#ten-questions-opmetrix-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-opmetrix">Instead of Opmetrix</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Field Sales for Claude Code does the job you pay Opmetrix for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and ask for what you want in plain language. It runs the right query, and it can answer questions the Opmetrix dashboard cannot.

It is built for a supplier, distributor or wholesaler with reps on the road: territories, outlets, contacts, call cycles, visits, in-store shelf and planogram checks, promotion compliance, orders written in store, price lists, returns and credits, and monthly targets. The words are the words a field team already uses.

```
/call-cycle                       who is due, who is late, in the order you drive them
/visit KM-103 40 minutes          log the call, its notes and its checklist
/order KM-103 6 crackers 2 pods   write the order at the price list that outlet is on
/shelf-check                      facings, shelf prices, empties, off planogram
/promo-compliance                 is the display up and is the ticket price right
/returns                          credits waiting on somebody, with their batch codes
/rep-week                         calls, strike rate, average order, month against target
/attention                        everything that wants a decision this week
/weekly-review                    the Monday review, written from three commands
```

One call is one row. One order line is one row. The questions that decide whether a field team pays for itself are questions about those rows: which outlets have gone quiet, which promotions never went up, which lines are missing from stores that should carry them, what a call actually costs. You get better answers than the vendor dashboard, for no per-seat fee, with your data in your own Postgres.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too, including what a rep standing in an aisle does and does not get.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/field-sales-for-claude-code.git
cd field-sales-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database, loads Kaimai Foods (a demo New Zealand food and beverage supplier with three territories, four reps, twenty two outlets, twelve lines and six months of history), then prints the call cycle, the attention list and the rep week.

Then open the folder in Claude Code and type:

```
/call-cycle
```

Try `/attention`, `/outlet KM-103`, `/promo-compliance`, `/weekly-review`. When you are ready for real data, delete `.data/` and start with `/import`, or add outlets one at a time with `add outlet`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md) so drafts come out in your voice, and put your business name and colours in [brand.json](brand.json) so the documents and views come out with your name on them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. A team shares one database: each person clones the repo, points at the same `DATABASE_URL`, sets `FIELD_REP` to their own name, and works in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/call-cycle` | The journey plan. Who is due, who is late, in the sequence you drive. |
| `/outlet` | One outlet, everything on it: contacts, calls, orders, what sells there, credits, notes. |
| `/visit` | Log a call with its minutes, notes and checklist, or read one back. |
| `/order` | Write an order at the right price list, list orders, or hand them to the ERP as CSV. |
| `/shelf-check` | Facings, shelf prices, empty shelves, off planogram, per outlet and per line. |
| `/promo-compliance` | Display up, ticket up, price right, and which outlets nobody has checked. |
| `/returns` | Credits and returns, with batch codes and the authorisation step enforced. |
| `/rep-week` | Calls, strike rate, average order, minutes per call, month against target. |
| `/territory` | A territory in full: reps, outlets by value and trend, distribution by line. |
| `/attention` | Everything that wants a decision this week, worst first. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/draft-visit-summary` | A call written up for the store or the office, saved to `drafts/`. Never sends. |
| `/compliance` | Checks the records against the rules in [docs/compliance.md](docs/compliance.md), each with its source. |
| `/import` | Bring the history across from Opmetrix, Perenso or a plain CSV. |
| `/customise` | Add a field, rename a status, change a rule, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run field -- help`. Any command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # outlet visit summaries, rep weekly reports, order confirmations, as HTML
npm run view    # the week and the territories, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your business name, logo and colours are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser. `/new-view` adds a view, `documents.json` adds a document.

### Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached. Each rule cites its source:

1. The price on the shelf is the price you promoted (Fair Trading Act 1986, s 13(g)).
2. A "was" price has to be a price you actually charged (Fair Trading Act 1986, s 13(g) and (j)).
3. Promotion funding is agreed in writing (Grocery Supply Code, Grocery Industry Competition Act 2023).
4. Every batch tracked line carries its batch code (Food Act 2014; Food Standards Code 3.2.2 in Australia).
5. A credit note only follows an authorised return (GST Act 1985, s 25).
6. Keep the records for seven years (Tax Administration Act 1994, s 22).

Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your category and your trading terms.

## Ten questions Opmetrix cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. Which outlets do not order a line that outlets like them do, and what is that gap worth a year?
2. Which promotions lifted sales only in the stores that ticketed them correctly?
3. What does each outlet cost in minutes in store, against what it buys in ninety days?
4. Which blank calls share a reason, and is that a range problem or a pricing problem?
5. Which outlets are visited on time every cycle and are still shrinking?
6. If four outlets move from one rep to another, what happens to each call load and ninety day value?
7. Which lines are out of stock most often in the stores that sell them fastest?
8. What have the four weekly outlets bought in a year, and what would moving them to eight weekly cost?
9. Which shelf prices are more than fifteen percent out of line across the estate, and which stores are pricing us out?
10. Every batch of a product we have credited, with outlets and dates, the day the recall notice arrives.

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your business.

1. "Our call cycles are weekly, fortnightly and monthly. Give them names I can pick from instead of a number of days."
2. "Add a chiller temperature to every shelf check, and warn me when it is over 5 degrees."
3. "One of our banners needs a PO line number on every order line. Add it and put it on the order confirmation."
4. "Our reps are on 2 percent of invoiced value. Add commission to `/rep-week`."
5. "Add a competitor price to the shelf check, and show me where we are more than 10 percent above them."
6. "Put our logo and colours on the documents, and change the business name to ours."
7. "Build me a view for the Monday sales meeting: coverage, the week, and the five worst outlets."
8. "Add a rule to `/compliance`: no order over $5,000 without a purchase order number."
9. "Our territories run on postcodes, not names. Add postcodes to outlets and let me plan a day by postcode range."
10. "Write me a command that drafts the monthly report I send to the brand owner."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of Opmetrix

Export your customers and your order history, run one command, and the history comes with you. Step by step, with what maps and what does not: [docs/replace-opmetrix.md](docs/replace-opmetrix.md).

```bash
npm run field -- import opmetrix --outlets=customers.csv --orders=orders.csv --contacts=contacts.csv --dry-run
npm run field -- import opmetrix --outlets=customers.csv --orders=orders.csv --contacts=contacts.csv
```

Perenso and Skynamo exports go through the same command with `perenso` or `csv` in place of `opmetrix`.

## Architecture

```
field-sales-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  brand.json                your business name, logo and colours on every document and view
  views.json                the HTML dashboards npm run view renders
  documents.json            the paperwork npm run docs renders
  .claude/commands/         the slash commands
  scripts/field.mjs         the CLI the commands drive
  scripts/view.mjs          read-only HTML dashboards from the SQL views
  scripts/docs.mjs          the documents, one HTML file per record
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, tables and views
  supabase/seed.sql         demo data
  docs/compliance.md        the rules /compliance checks, each with its source
  docs/replace-opmetrix.md  moving off the incumbent
  exports/                  order CSVs for the ERP, and whole database dumps
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Field Sales for Claude Code for your business, migrates your Opmetrix data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call
- Read more: https://enterprisedna.co/omni/instead-of/opmetrix

## License

MIT. Copyright (c) 2026 Enterprise DNA.
