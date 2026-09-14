# Moving off Opmetrix

One afternoon, three exports, one command. This is the whole job.

Perenso and Skynamo work the same way. Swap `opmetrix` for `perenso` or `csv` in the import command.

## 1. Get your data out

Opmetrix keeps its reporting in Opmetrix HQ, the browser side of the product. Every list view there
exports to CSV or Excel. If you are given XLSX, open it and save as CSV. You need three files.

**Customers.** The outlet list: every store your reps call on. Export it with as many columns as the
report will give you. The importer looks for these, and does not mind what order they are in or how
they are capitalised.

| What we need | Column names we accept |
|---|---|
| The code you match on | Customer Code, CustomerCode, Account Code, Code, Customer |
| Name | Customer Name, CustomerName, Trading Name, Name |
| Banner or chain | Group, Banner, Chain, Customer Group |
| Channel | Type, Customer Type, Channel, Category |
| Address | Address, Address1, Street, Delivery Address |
| Suburb, city, region | Suburb, Address2 / City, Town / Region, State, Area |
| The rep | Rep, Sales Rep, Representative, Owner |
| The territory | Territory, Area, Region |
| The call cycle | Call Frequency, Frequency, Cycle, Call Cycle |
| Active or not | Status, Active |

**Orders.** The order history report, one row per order line. Run it for as far back as you want to
keep. Three years is normal; the record keeping rules want seven.

| What we need | Column names we accept |
|---|---|
| Order number | Order Number, OrderNumber, Order No, Reference, Document |
| Customer code | Customer Code, CustomerCode, Account Code, Customer |
| Order date | Order Date, Date, Created |
| Delivery date | Delivery Date, Required Date, Deliver |
| Purchase order | PO Number, Purchase Order, PO |
| Product code | Product Code, ProductCode, SKU, Item Code, Item |
| Quantity | Quantity, Qty, Cases, Order Qty |
| Price | Unit Price, Price, Sell Price, Case Price |
| The rep | Rep, Sales Rep, Representative |

**Contacts.** Optional. Customer Code plus Contact Name, Role, Phone, Email.

## 2. Load your products first

Most field sales exports do not carry the product master, because the product master lives in your ERP,
not in Opmetrix. Load it here first so the order lines have something to attach to.

```bash
npm run field -- add product "Kaimai Water Crackers" --sku=KAI-CRK-150 --brand=Kaimai \
  --category=Crackers --size=150g --case=12 --price=2.89
```

For more than a handful, ask Claude Code: "here is our product list as a CSV, load it". It writes the
loop. Do the same for price lists if you run banner pricing:

```bash
npm run field -- price-list
```

## 3. Dry run

Always. It reads the files, counts what it would create, and writes nothing.

```bash
npm run field -- import opmetrix \
  --outlets=customers.csv \
  --orders=orders.csv \
  --contacts=contacts.csv \
  --dry-run
```

Read the counts. If outlets is lower than you expect, the code column is not one of the names above.
Tell Claude Code the header your file actually uses and it adds the alias.

## 4. Import

```bash
npm run field -- import opmetrix \
  --outlets=customers.csv \
  --orders=orders.csv \
  --contacts=contacts.csv
```

Then check three things:

```bash
npm run field -- outlets --all
npm run field -- orders --from=2020-01-01
npm run field -- call-cycle --all
```

Outlet count, order count and cycle count should match what Opmetrix HQ tells you. Anything that did
not match is listed in the import output with the reason. Nothing is guessed.

Running the import twice is safe. Outlets match on their code and update instead of duplicating.

## What maps

| Opmetrix | Here |
|---|---|
| Customer | `outlets` |
| Customer contact | `contacts` |
| Rep | `reps`, created from the name on the customer if it does not exist |
| Territory or area | `territories`, created from the name on the customer |
| Call frequency | `call_cycles.frequency_days`, and the journey plan is built from it |
| Order header and lines | `orders` and `order_lines`, matched on the customer code and the product code |
| PO number | `orders.po_number` |
| Active or inactive customer | `outlets.status`, active or closed |

## What does not carry over

Say this out loud before you start, because it is the honest part.

- **Photographs.** Opmetrix stores in-store photos against a call. The export gives you file names, not
  files. Get them out of Opmetrix HQ separately and keep them in a folder; `shelf_checks.note` and
  `promo_checks.photo_ref` hold the reference.
- **Historic visit records.** Most Opmetrix reporting exports call summaries, not the full visit with its
  survey answers. If you need them, export the call report and ask Claude Code to load it into `visits`.
  It is a twenty minute job, not a project.
- **Survey and questionnaire definitions.** The in-store forms your team built are Opmetrix objects. Here
  they are `visit_tasks` and `shelf_checks` columns. Rebuild the ones you still use with `/customise`.
  Most teams find half of them were never read.
- **Your saved reports.** They do not transfer, and they do not need to. You ask the question instead.
- **The mobile app.** There is no app. Read [why-no-front-end.md](why-no-front-end.md) for what a rep in
  an aisle actually gets today and what they do not.
- **Live stock levels.** Opmetrix pulls availability from your ERP on a sync. This repo holds no stock.
  If your reps need availability at the shelf, that is an ERP feed and it stays an ERP job.

## Run both for a cycle

Do not switch on a Monday. Import the history, then run one territory here alongside Opmetrix for one
full call cycle. Compare the two on three numbers: calls completed, orders written, and value. When they
match, move the rest of the team and stop paying for seats.

## After the switch

- Set `brand.json` to your business so the documents come out with your name on them.
- Fill in the "Who this is for" block in `CLAUDE.md`.
- Read `docs/compliance.md` and change the rules to match your category and your trading terms.
- Point `DATABASE_URL` at a Supabase project so the whole team shares one database.
- Ask for the three things you always wanted from the old system and never got. That is what
  `/customise` is for.
