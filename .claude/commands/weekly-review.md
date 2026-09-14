---
description: The Monday review, written from three commands. Coverage, the week numbers, what is wrong in store, and the five calls that matter most.
---

Run these three, in this order, and write the review from what they return. Do not write anything they do not support.

```
npm run field -- rep-week
npm run field -- attention
npm run field -- call-cycle --due
```

Then write it in this shape, no more than a page:

1. **The week in one line.** Calls completed, strike rate, value sold, and how the month is tracking against target.
2. **What went wrong in store.** Promotion breaches and empty shelves, named by outlet. This is the section a field manager reads first because it is the one that costs money quietly.
3. **What is stuck.** Credits waiting on authorisation, orders that never reached the ERP, and how many days each has been sitting.
4. **Coverage.** How many outlets are past their call cycle and who they belong to. Name the worst three.
5. **The five calls that matter this week.** Pick them yourself from the overdue list weighted by ninety day value, and say why each one made the list.
6. **One thing to decide.** The single item that needs a person, not a process.

Add `npm run view -- week` if the operator wants a page to send on. It renders the same numbers as HTML in their brand.

Numbers come from the commands. If a number is not in the output, do not put it in the review.
