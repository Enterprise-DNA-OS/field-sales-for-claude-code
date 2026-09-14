---
description: Did the promotion actually happen in store. Display up, ticket up, price correct, and which outlets nobody has checked at all.
---

1. `npm run field -- promo-compliance [<promo code>]`. With no argument it covers every live promotion.
2. Report three things in this order:
   - **Price breaches.** A shelf ticket that does not match the promoted price is a Fair Trading Act problem, not a merchandising one. Name the outlet, the rep, the ticket price and the price it should be. Cite rule 1 in `docs/compliance.md`.
   - **Missing displays.** A promotion the supplier funded and the store never built. Name the required display from the promotion record.
   - **Never checked.** Live promotions in outlets where no rep has recorded a check. These are the calls to add to next week.
3. Check the funding column. A live promotion with no `funding_agreement_ref` is rule 3 in `docs/compliance.md`. Say it once, plainly.
4. For each breach, offer the fix: a call to plan (`visit plan`), a note to the store (`/draft-visit-summary` writes a draft, it never sends), or a correction to the promotion record.

Recording a check from the road: `npm run field -- promo-check <outlet> --promo=<code> [--display] [--ticket] [--price=5.00] [--note=]`. Pass `--price` with what the ticket actually said and the command works out whether it is correct.
