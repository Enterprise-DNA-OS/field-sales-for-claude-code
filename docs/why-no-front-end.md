# Why there is no front end

Opmetrix is a database with a subscription. The tables underneath it are ordinary: outlets, contacts, call cycles, visits, shelf checks, orders, promotions, returns. What you pay for is the layer on top that lets people who do not write SQL get at those tables. Screens, filters, dashboards, forms.

That layer used to be the whole product, because talking to a database was hard. It is not hard any more. Open this folder in Claude Code, describe what you want, and it writes the query, runs it, and explains the answer. Ask a question the dashboard never had a chart for and you still get an answer.

## What you gain

- **Better answers.** A dashboard shows what the vendor decided to chart. Here you ask your own question, in your own words, and get it answered against your own data. "Which outlets do not order a line their neighbours do, and what is that gap worth" is one sentence, not a support ticket.
- **No seats.** Everyone who needs to look can look. The bill does not grow with headcount, and a merchandiser who works two days a week does not cost what a national account manager costs.
- **Your data in your Postgres.** Plain tables. Back them up, query them from Power BI, leave any time. There is no export step because there is nothing to leave.
- **A process that matches you.** When your way of working changes, you add a command. You do not wait for a feature request to clear.
- **The rules checked, not just recorded.** `/compliance` reads your data against the rules in `docs/compliance.md` and tells you what is breached. Promotion pricing, funding agreements, batch codes on credits, the authorisation step. That is the part most field sales tools put behind the top tier, and mostly it is a report somebody has to remember to run.

## What you give up

Read this part twice. It is the honest one.

- **A phone app in the aisle.** This is the real trade. Opmetrix runs on a phone or a tablet, offline, in a chiller aisle with no signal. This does not. Today a rep works one of two ways: a laptop in the car between calls running Claude Code, which is how a lot of reps already write their day up; or the Claude app on a phone reading an export, which answers questions but does not write back. If your reps must key an order at the shelf with no signal, keep the app you have. If they write the day up between calls, this is faster than the app was.
- **Photos taken in store.** No camera, no upload. The shelf check holds a file reference, and the photos live wherever your team already puts them.
- **A visual board and a map.** The journey plan is a table you ask about, not pins you drag. Route optimisation on live traffic is a mapping product; this is a database.
- **A vendor help desk.** This is open source. Enterprise DNA supports the installed version for businesses that want someone to call.

## Who this fits

A supplier or distributor whose field team is under about twenty people, where the sales manager already lives in spreadsheets, and where the questions matter more than the screens. If the whole team needs an offline app in their hand all day, keep Opmetrix and use this for the reporting layer instead: import the history, ask the questions, pay for fewer seats.

Installed and run for you: https://enterprisedna.co/omni/instead-of/opmetrix
