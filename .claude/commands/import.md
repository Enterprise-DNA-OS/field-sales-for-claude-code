---
description: Bring the history across from Opmetrix, Perenso, or a plain outlets and orders CSV. One command, matched on customer code.
---

1. Read `docs/replace-opmetrix.md` first. It says exactly which export to run in the incumbent and which columns matter.
2. Always dry run before you write: add `--dry-run` and report the counts.

```
npm run field -- import opmetrix --outlets=customers.csv --orders=orders.csv --contacts=contacts.csv --dry-run
npm run field -- import opmetrix --outlets=customers.csv --orders=orders.csv --contacts=contacts.csv
```

`perenso` and `csv` are the other two sources. `csv` accepts any header either of the named ones accepts, which covers most exports from Skynamo, RepZio and a printed report saved as CSV.

3. Column names are matched case insensitively against a list of aliases per field. If a column is skipped, tell the operator the header it saw and add the alias to `SOURCES` in `scripts/field.mjs` rather than editing their file.
4. Territories and reps named in the outlet file are created if they do not exist. Call cycles are created from the frequency column.
5. What does not come across: products and price lists (most exports do not carry them), photographs, and the report definitions the incumbent built. Say that out loud. Add products with `add product` or a second CSV.
6. After the import, check three things and report them: `outlets`, `orders --from=2020-01-01`, and `call-cycle --all`. Numbers that do not match the incumbent are the first thing to chase.
