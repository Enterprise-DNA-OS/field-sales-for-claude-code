# Field Sales for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS], a [supplier / distributor / wholesaler] selling into [grocery, pharmacy, route trade, foodservice]
- **Operator:** [YOUR NAME], [national sales manager / owner / field manager]
- **The team:** [how many reps, how many merchandisers, how many territories]
- **What matters most:** [for example: cycle coverage, strike rate, distribution on the top ten lines, promotion compliance]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about an outlet, run `outlet <code>` and read its history first, including the notes.
3. **Plain language.** Short sentences. No filler. Numbers in tables. The industry words, not software words: a call, an outlet, a cycle, a facing, a strike rate.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.
6. **Never invent a number.** Facings, minutes, shelf prices and quantities come from the operator or from the database. If one is missing, say which one.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| Where do I go, who is due, who is late | `/call-cycle` |
| Everything about one store | `/outlet` |
| I did a call, write it up | `/visit` |
| They gave me an order | `/order` |
| What the shelf looked like, facings, empties, planogram | `/shelf-check` |
| Did the promotion actually go up, is the ticket right | `/promo-compliance` |
| A credit, a return, a damaged pallet, a recall | `/returns` |
| How is a rep going, how is the team going | `/rep-week` |
| A whole territory, distribution, rebalancing | `/territory` |
| What needs a decision this week | `/attention` |
| The Monday review | `/weekly-review` |
| Write up a call for the store or the office | `/draft-visit-summary` |
| Are we breaking any of the rules we run under | `/compliance` |
| Bring the history over from the old system | `/import` |
| Change how this system works | `/customise` |
| A new page to look at | `/new-view` |
| The paperwork, in our brand | `npm run docs` |

If an ask fits nothing here, run the CLI directly (`npm run field -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Close an outlet with `status = 'closed'`, do not delete it. The history it carries is a seven year record.
- Never invent a record. If a name is ambiguous, list the candidates and ask. The CLI already does this; do not talk it out of it.
- Never write an order for an outlet on credit hold. The command refuses and that refusal stands until finance clears it.
- A credit note only follows an authorised return. Do not work around the check.
- Batch tracked lines on a return need their batch code. Chase it rather than leaving it empty.
- The database is the source of truth. If the answer is not in it, say so.

## Words this business uses

- **Outlet**, not customer or account. **Call** or **visit**, not activity. **Call cycle** or **journey plan**, not schedule.
- **Strike rate** is the share of completed calls that took an order. **Coverage** is the share of outlets that are not past their cycle.
- **Facings** is how many units of a line face the shopper. **Off planogram** means it is not where the plan says.
- **Distribution** is how many outlets carry a line. **Range** is what an outlet has agreed to carry.
- Order quantities are **cases**. Prices on an order line are **per case**. Shelf prices are per unit.

## Where things live

- `scripts/field.mjs` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it. Never edit an applied migration; add the next one.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `brand.json`, `views.json`, `documents.json` the HTML output: whose name is on it, what pages, what paperwork.
- `docs/compliance.md` the rules `/compliance` checks, each with its source. `docs/replace-opmetrix.md` moving off the incumbent.
- `exports/` order CSVs for the ERP and whole database dumps. `drafts/` anything written for a person to send.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/opmetrix
