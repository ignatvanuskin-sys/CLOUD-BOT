# SQLite to PostgreSQL migration

1. Stop writes or put app in maintenance.
2. Backup SQLite: copy `DATABASE_PATH` and WAL/SHM files.
3. Dry-run export counts for users/products/license_plans/orders/entitlements/product_assets/audit_log/webhook_updates.
4. Run Postgres migration: `DATABASE_URL=... npm run db:migrate`.
5. Import with stable ids inside one transaction. Do not import dev sessions or local secrets.
6. Verify counts, unique payment charge ids, order totals, entitlement ownership.
7. Switch staging first. Production switch only after backup restore test.
8. Rollback: point app back to previous DB snapshot before accepting new writes, or restore Postgres backup.
