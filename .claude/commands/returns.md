---
description: Credits and returns: raise one, see what is stuck, authorise it, and raise the credit note. Enforces batch codes and the authorisation step.
---

**Raising one.** `npm run field -- returns new <outlet> --reason=<damaged|expired|recall|wrong_product|overstock|quality> --line=<SKU>x<cases>[@BATCH] [--expiry=YYYY-MM-DD]`

- Batch tracked products need the batch code after an `@`. Without it the recall trail stops at the store. The command warns; do not ignore the warning. See rule 4 in `docs/compliance.md`.
- A `recall` return with no batch code is the serious version. Stop and get the code.

**Reading.** `npm run field -- returns [--all] [--status=] [--outlet=]` shows open credits with their age. `returns <number>` shows the lines and the batch codes.

**Moving one along.** Two steps, in this order, always:

1. `returns authorise <number> --by="<name>"`. Someone with authority puts their name on it.
2. `returns credit <number> --note=<credit note reference>`. The command refuses if the return was never authorised. That is rule 5 in `docs/compliance.md`, not a preference.

`returns decline <number> "<why>"` closes one off. Say why in the words the operator used.

Report the oldest open credit every time. A credit sitting for two weeks is a phone call the rep is about to get.
