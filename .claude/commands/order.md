---
description: Write an order taken in store, list orders, or hand the submitted ones to the ERP as a CSV. Prices come from the price list the outlet is on.
---

**Writing an order.** The operator will say it the way a rep says it: "six crackers and two pods for Devonport".

1. Resolve every product to a SKU first with `npm run field -- products <word>`. Do not guess a SKU.
2. `npm run field -- order new <outlet> --line=<SKU>x<cases> [--line=...] [--po=] [--deliver=YYYY-MM-DD]`. Quantities are cases, not units. The case price comes from the price list the outlet is on, so do not pass `--price` unless the operator gave a special price.
3. If the outlet is on credit hold the command refuses. Say so and stop. Clearing a credit hold is a finance decision, not a rep one.
4. Read back the lines, the case count and the total, then say the order is `submitted` and nothing has been sent anywhere.

**Reading orders.** `npm run field -- orders [outlet] [--rep=] [--status=] [--from= --to=]`, or `order <number>` for one with its lines.

**Handing them to the ERP.** `npm run field -- order export [--ref=<reference>]` writes every submitted order to `exports/orders-<date>.csv` and marks them exported. That file is what you feed MYOB, Xero, NetSuite or whatever sits behind you. This repo never talks to the ERP itself, and it never emails anyone.
