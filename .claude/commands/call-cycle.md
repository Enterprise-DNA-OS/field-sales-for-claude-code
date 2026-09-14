---
description: The journey plan. Which outlets are due, which are late, and the order to drive them in. Takes a rep name or a territory.
---

The operator wants to know where to go. Arguments might be a rep ("Aroha"), a territory ("Waikato"), or nothing at all.

1. Run `npm run field -- call-cycle [rep] [--territory=] [--json]`. With no argument it covers everyone.
2. Lead with the number that matters: how many outlets are past their cycle, and the worst one in days.
3. Present the plan in two blocks. **Late now**, worst first, with the last call date and the ninety day value so the operator can see what is at risk. **Due this week**, in call cycle sequence, grouped by the preferred weekday, so it reads as a driving day.
4. For anything more than two cycles late, say so plainly and check `npm run field -- outlet <code>` for why. A store on credit hold or closed is a different problem from a store the rep keeps skipping.
5. Offer the next step: `visit plan <outlet> --on=YYYY-MM-DD` to book a call, or `/visit` to log one that has happened.

Never reorder the plan by your own idea of efficiency. The sequence column is the route the business drives.
