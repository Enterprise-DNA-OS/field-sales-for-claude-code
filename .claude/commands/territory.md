---
description: A territory in full: the reps, every outlet with its ninety day value and trend, and which lines are ranged where.
---

1. `npm run field -- territory` lists every territory with outlet count, late calls and ninety day value. `npm run field -- territory "<name>"` opens one.
2. In a single territory, read it in this order:
   - **Coverage.** How many outlets are past their call cycle, and how long the worst has been left.
   - **The outlets.** Sorted by ninety day value. Anything with a trend worse than minus fifteen percent gets named.
   - **Distribution.** How many outlets carry each line. A SKU in half the outlets is either a range problem or a sales problem, and the gap is the growth.
3. To find the gap, compare the distribution table to the outlet list: `npm run field -- products --json` and `npm run field -- outlets --territory="<name>" --json`, then name the outlets that do not order a line their neighbours do.
4. Rebalancing a territory: outlets move with `add outlet ... --territory=` or by editing the row. Say what would move and what it is worth before you change anything.
