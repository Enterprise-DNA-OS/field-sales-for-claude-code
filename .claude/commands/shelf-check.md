---
description: Record what the shelf looked like (facings, shelf price, empty, off planogram) or read the shelf history for an outlet or a product.
---

**Recording.** One command per line checked:

`npm run field -- shelf-check log <outlet> --sku=<SKU> --facings=<n> [--price=4.20] [--oos] [--off-planogram] [--note="..."]`

- `--facings` is the number of facings you counted. Zero and `--oos` together means the line was empty.
- `--price` is the price on the shelf ticket, in dollars. It is the evidence behind rule 1 in `docs/compliance.md`.
- `--off-planogram` means the product is not where the planogram says it should be.
- The check attaches to today's call at that outlet if one is logged.

**Reading.** `npm run field -- shelf-check [outlet] [--product=] [--oos] [--days=30]` gives the recent checks and a per product summary: how often it was checked, how often it was empty, how often it was off planogram, and the average facings and shelf price.

What to say back: the empties first, then the planogram failures, then anything where the shelf price is out of line with the rest of the estate. An average shelf price that moves by more than ten percent between stores is worth a sentence.

Never record a facing count the operator did not give you.
