# CLOUD-BOT — Release Candidate pending external verification

CLOUD-BOT подготовлен как Release Candidate для staging/pre-release. Он **не объявлен fully production ready**, пока не пройдены внешние Go-Live gates: реальные staging Telegram Stars payment/refund, проверка S3 bucket policy, Redis TLS, PostgreSQL backup/restore и deploy/rollback.

## Adapter contract

| Concern | Dev/Test | Production | Fallback policy |
|---|---|---|---|
| DB | SQLite | PostgreSQL | production старт блокируется, если `DB_DRIVER!=postgres` |
| Sessions / rate limit | memory TTL store | Redis-compatible TTL store | production требует `REDIS_URL` и `REDIS_TLS=true` |
| Storage | local private folder | S3-compatible private bucket | production требует `STORAGE_DRIVER=s3` и S3 env |
| Upload scan | local buffer + scanner | same scanner + S3 quarantine | rejected asset never becomes downloadable |

## New production env

```env
DB_DRIVER=postgres
DATABASE_URL=<postgres connection string from secret manager>
DATABASE_SSL=true
DATABASE_POOL_MAX=10
REDIS_URL=rediss://:password@redis.example.com:6380
REDIS_KEY_PREFIX=cloud-bot:production:
REDIS_TLS=true
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.example.com
S3_REGION=auto
S3_BUCKET=cloud-bot-production
S3_ACCESS_KEY_ID=change-me
S3_SECRET_ACCESS_KEY=change-me
S3_FORCE_PATH_STYLE=false
MAX_UPLOAD_BYTES=52428800
```

Нельзя коммитить реальные значения. Production также требует `BOT_TOKEN`, `BOT_USERNAME`, `WEBAPP_URL`, `CORS_ORIGIN`, `WEBHOOK_SECRET`.

## Commands

```bash
npm test
npm run test:integration
npm run test:e2e
npm run typecheck
npm run lint
npm run build
npm run db:status
npm run db:migrate
npm run security:scan
npm run deps:audit
npm run smoke:load
```

## Storage/upload/scan flow

`admin upload → memory upload limit → magic bytes / extension check → zip-slip / suspicious file / secret scan → S3/local quarantine or approved key → DB asset status → explicit publish → entitlement download`.

Asset statuses: `pending`, `scanning`, `approved`, `rejected`, `published`, `deleted`.

Download is issued only after entitlement check. Download tokens are stored as hashes. In production S3 signed URLs are generated server-side with short TTL and no credentials exposed to frontend.

## DB migration

PostgreSQL startup uses ordered immutable migrations in `server/db/postgres-migrations/`. The `schema_migrations` ledger stores a SHA-256 checksum; already-applied versions are skipped and changed migration content fails closed. `server/db/postgres-schema.sql` is reference-only and is never executed at runtime.

Migration `003_catalog_trigram_search` attempts to enable `pg_trgm` and creates the partial GIN index when available. If the database role lacks extension privilege, migration emits a notice and startup continues with the existing bounded `LIKE` query; search remains correct but may be slower until an administrator enables `pg_trgm` and creates the index.

For SQLite import and rollback, follow `docs/runbooks/db-migration.md`. Do not switch production DB until backup and restore are tested.

## Runbooks

- `docs/runbooks/go-live.md`
- `docs/runbooks/db-migration.md`
- `docs/runbooks/incidents.md`

## CI/CD

GitHub Actions workflow is in `.github/workflows/ci.yml`: clean install, typecheck, lint, tests, build, security scan, dependency audit and Postgres migration dry-run with service containers.

## Current residual risks

- PostgreSQL runtime adapter is implemented in `server/pg-db.ts`, but production traffic should be verified against real staging DB (backup/restore, connection pool limits, failover behavior).
- S3 adapter is implemented; bucket policy/encryption/versioning must be verified externally.
- Redis TTL store is implemented; production Redis TLS/connectivity must be verified externally.
- Playwright e2e is added, but browser binaries/service execution may need CI cache/install setup.
- Telegram Stars payment/refund cannot be evidenced without staging bot credentials.
- `server/pg-db.ts` uses manual SQL translation for `INSERT OR IGNORE`/`CURRENT_TIMESTAMP`; further hardening should move runtime paths to fully parameterized queries with explicit `ON CONFLICT` clauses.
