---
description: One outlet, everything on it: contacts, call cycle, recent calls, orders, what sells there, the last shelf check, open credits and the notes.
---

1. `npm run field -- outlet <code|name>`. Codes are exact, names match loosely. If several outlets match, the command lists them; pick with the code.
2. Read the whole card before answering anything about that store. The notes at the bottom are what the last rep knew and nobody wrote in a system.
3. The three numbers that matter: days since the last call, days since the last order, and the ninety day trend. A store visited on time that has stopped ordering is a different problem from a store nobody has been to.
4. "What sells here" is the last 180 days by value. Compare it against `npm run field -- products` to find the lines this outlet does not carry that outlets like it do.
5. Adding to the record: `note <outlet> "<what happened>"` for anything that is not a call, an order or a check.
