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

PostgreSQL schema lives in `server/db/postgres-schema.sql`. Migration helper: `scripts/db.mjs`.

For SQLite import and rollback, follow `docs/runbooks/db-migration.md`. Do not switch production DB until backup and restore are tested.

## Runbooks

- `docs/runbooks/go-live.md`
- `docs/runbooks/db-migration.md`
- `docs/runbooks/incidents.md`

## CI/CD

GitHub Actions workflow is in `.github/workflows/ci.yml`: clean install, typecheck, lint, tests, build, security scan, dependency audit and Postgres migration dry-run with service containers.

## Current residual risks

- PostgreSQL adapter is prepared through schema/migration commands, but runtime DB access still uses current SQLite repository layer. Production config is intentionally blocked unless `DB_DRIVER=postgres`; full query adapter migration remains required before real production traffic.
- S3 adapter is implemented; bucket policy/encryption/versioning must be verified externally.
- Redis TTL store is implemented; production Redis TLS/connectivity must be verified externally.
- Playwright e2e is added, but browser binaries/service execution may need CI cache/install setup.
- Telegram Stars payment/refund cannot be evidenced without staging bot credentials.
