---
description: Draft the summary of a call for the store or for the office, written from the record. Saved to drafts/. Never sends anything.
---

The operator will name an outlet or a call ("write up Takapuna from this morning").

1. Find the call: `npm run field -- visits --outlet=<outlet>` then `npm run field -- visit <id>`. Read the whole thing including the tasks that are still open.
2. Read the outlet card too: `npm run field -- outlet <outlet>`. The last three calls and the open credits belong in the summary if they are still open.
3. Write it to `drafts/visit-<outlet-code>-<date>.md` with these sections, and nothing that is not in the record:
   - **What we did.** Date, who, minutes in store.
   - **What we found.** Facings, shelf prices, empties, planogram. Numbers, not adjectives.
   - **Promotions.** Display, ticket, price, against what the promotion says it should be.
   - **The order.** Lines, cases, value, delivery date.
   - **Agreed actions.** Who is doing what by when. Only what was actually agreed.
   - **Still open.** Credits, out of stocks, anything the store owes us or we owe them.
4. Match the voice in the "Who this is for" block in `CLAUDE.md`. Short sentences. No adjectives about how the call went.
5. Print the path and the first few lines. Do not send it. A person sends it.

For a whole week for one rep, use `npm run docs -- rep-weekly-report` instead. It renders the same content as branded HTML from `brand.json`.
