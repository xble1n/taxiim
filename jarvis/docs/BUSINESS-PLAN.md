# Initial business strategy — pursuing €15,000 verified revenue / month

> Status: plan, not a forecast. The target is an objective; nothing here guarantees it. Figures marked **(A)** are assumptions to validate; **(E)** are externally sourced; **(O)** come from the owner's existing assets.

## Starting position

- **(O)** The owner already built and operates **TAXI IM** — a working dispatch desk + driver app (GPS, satellite maps, offers, reports) for a taxi company in Vushtrri/Mitrovica/Prishtina. A sellable product exists today; most competitors in this situation would have to build one first.
- **(O)** Full-stack capability (TypeScript/React/Postgres, Java/Spring) for custom builds.
- **(E)** International benchmark: TaxiCaller charges about **CAD 29 per vehicle per month** for dispatch, with no separate charge for dispatcher seats ([TaxiCaller](https://www.taxicaller.com/campaigns/en/quebec), [FAQ](https://taxicaller.com/en/faq)).
- **(E)** Prishtina already has app-based ordering for some fleets. Several branded apps (El Taxi, Urban Taxi, City Taxi, Taxi Dallas) appear to come from one white-label vendor, Net-Informatika, and have few ratings ([App Store example](https://apps.apple.com/us/app/id1502542494)). The market is contested but not saturated. Directory counts of Prishtina taxi companies are inconsistent: 7 to 13 on GobyTaxi ([source](https://www.gobytaxi.com/europe/kosovo/pristina/drivers)), so the true count must be established by field research.

## Revenue streams (prioritised by evidence and speed to cash)

| # | Offer | Price (A) | Delivery cost (A) | Why |
|---|---|---|---|---|
| 1 | **TAXI IM for fleets** — dispatch console, driver app, reports, branded passenger ordering | Setup €1,500 + €12/vehicle/month (min €199/mo) | ~€300 onboarding + hosting ~€15/fleet/mo | Product exists; recurring; local language and support beat foreign SaaS; undercuts TaxiCaller's ~€19/vehicle |
| 2 | **Custom business software & websites** (booking, inventory, CRM, internal tools) | €2,500–€8,000 per project | Owner time (≈40–80 h) | Fastest cash; uses existing skills; each build seeds reusable modules |
| 3 | **Care plans** (hosting, updates, small changes) | €150–€500/month | ~2–6 h/month | Turns every project into recurring revenue |
| 4 | Fleet tracking for non-taxi fleets (delivery, logistics, field services) | €8–€15/vehicle/month | Same codebase | Same product, wider market — after #1 is proven |

## Model to €15,000/month (illustrative mix, all (A))

| Line | Volume | Monthly |
|---|---|---|
| Dispatch subscriptions | 12 fleets × avg 25 vehicles × €12 | €3,600 |
| Dispatch setup fees | 2 new fleets × €1,500 | €3,000 |
| Custom projects | 1.5 projects × €4,000 | €6,000 |
| Care plans | 10 × €250 | €2,500 |
| **Total** | | **€15,100** |

Realistic ramp **(A)**: month 1 €2–4k (one project and one fleet), month 3 €6–9k, month 6 €12–15k. That ramp assumes roughly a 20% proposal-to-close rate and 10–15 qualified conversations per month. If month-3 verified revenue is under €5k, Performance Review Mode triggers a strategy revision (pricing, segment or channel), not more of the same.

## First 30 days — actionable

1. **Package TAXI IM** as a product (week 1): a one-page offer, a 10-minute demo script, and a pricing sheet. Take a reference statement from the current fleet, with their written consent.
2. **Build the lead list** (week 1–2): every licensed taxi operator in Prishtina, Mitrovica, Vushtrri, Peja, Prizren, Gjilan and Ferizaj, sourced from municipal registers, directories and visible fleet branding. Record each in the CRM with its `source`. Contact basis: `legitimate_interest_b2b` for a direct, personal business approach. No mass messaging.
3. **Outreach** (week 2–4): in-person visits and personal calls first, then personalised email drafted in JARVIS and released by the owner. Target 25 conversations, 8 demos, 3 proposals, 1–2 closes.
4. **Cash now** (parallel): offer custom builds to the existing network, aiming for 1 project in month 1.
5. **Measure**: every euro recorded and verified in the ledger; opportunities updated with real conversion data; weekly review of pipeline coverage.

## Key risks

Small local market and price sensitivity · incumbent white-label vendor · owner time is the delivery bottleneck (keep custom work productised) · payment collection (invoice with 50% upfront) · regulatory or tax requirements for invoicing in Kosovo (confirm with an accountant before scaling).

## What JARVIS does for this plan

- Holds the CRM, drafts, proposals and invoices. It drafts; the owner approves and sends.
- Researches each prospect and the competition, with sources (once `ANTHROPIC_API_KEY` is configured).
- Tracks verified cash, regenerates the monthly plan from live data, and triggers Performance Review when a month closes short.
