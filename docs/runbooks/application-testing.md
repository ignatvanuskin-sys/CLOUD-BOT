# Application testing runbook

## Scope

Application tests cover the user-visible marketplace and commerce lifecycle without inserting fake catalog content into production. The development seed contains only non-template fixtures: ready bots and modules. Legacy `template` rows remain compatible with the database schema but are excluded from public catalog and product detail APIs, and the admin product endpoint rejects new template products.

## Local test data

The development seed is disabled when `NODE_ENV=production`. Playwright uses an isolated SQLite database at `./data/e2e.sqlite` and isolated local storage at `./storage/e2e`; it runs the development seed before starting the backend. These fixtures are never intended for Railway production.

The current development fixtures are:

| Fixture | Type | Purpose |
|---|---|---|
| `booking-bot-pro` | `ready_bot` | Catalog, product detail and checkout CTA |
| `lead-crm-router` | `module` | Catalog filtering and product-card rendering |
| `faq-support-ai` | `ready_bot` | Search/category rendering and empty-state coverage |

## Test layers

The backend integration tests create disposable products, plans, users, orders and assets directly in the test SQLite database. They verify idempotent order creation, successful Telegram Stars payment, duplicate update protection, payer/amount/currency validation, entitlement creation, protected downloads and refund/reconciliation states.

The frontend E2E suite runs against the isolated development database. It verifies responsive layout, primary and secondary routes, absence of the template filter, rendering of a non-template test product and the checkout CTA before an external Telegram invoice is opened.

Run the main checks with:

```bash
npm test
npm run test:integration
npm run test:production-fixes
npm run test:e2e
npm run build
npm run security:scan
```

## Production rule

Do not run `npm run seed` against production. Do not use test bot tokens, test products, test payment updates, local storage or development login in production. Real staging verification must use a separate Telegram bot, database, Redis namespace, private object-storage bucket and real HTTPS origin.
