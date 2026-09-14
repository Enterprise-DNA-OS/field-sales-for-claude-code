---
description: Log a call at an outlet, or read one back. Records minutes in store, notes, the in-store checklist, and links whatever order came out of it.
---

The operator will either describe a call that happened ("did Milford this morning, 40 minutes, Kelly wants the dips moved") or ask about one.

**Logging a call**

1. `npm run field -- visit log <outlet> "<notes>" --minutes=<n> [--on=YYYY-MM-DD] [--rep=] [--no-order-reason="<why>"]`. If the operator did not say how long, ask once. Minutes in store is the number every field manager reads.
2. If they took an order, run `/order` next and it attaches to this call automatically when the dates match.
3. If they did not take an order, record why with `--no-order-reason`. A blank strike is worth nothing. "Buyer was not in" and "range is under review" are different problems.
4. If they described a shelf or a promotion, log those too: `/shelf-check` and `promo-check <outlet> --promo=<code>`.
5. Read back one line: outlet, minutes, order or no order, and the call id.

**Reading a call**

`npm run field -- visit <id>` prints the call with its tasks, shelf checks, promotion checks and order. Use it before writing anything about that outlet.

Never invent minutes, facings or prices. If the operator did not say it, leave it out and say what is missing.
