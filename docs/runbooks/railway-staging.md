# Railway staging setup

Status: Release Candidate pending external verification.

## 1. Services

Create a Railway project from GitHub repo `ignatvanuskin-sys/CLOUD-BOT`.

Add services:

- App service from this GitHub repo.
- Railway PostgreSQL service.
- Railway Redis service.
- Cloudflare R2 private bucket for `STORAGE_DRIVER=s3`.

Do not paste secrets into chat, README, issues, or logs. Store them only in Railway Variables / GitHub Secrets.

## 2. Railway app variables

Set these on the app service:

```env
NODE_ENV=production
PORT=${{PORT}}

BOT_TOKEN=<staging bot token from BotFather>
BOT_USERNAME=<staging bot username without @>
WEBAPP_URL=<Railway public HTTPS URL or custom staging domain>
CORS_ORIGIN=<same origin as WEBAPP_URL>
WEBHOOK_SECRET=<random 16-32+ chars>

DB_DRIVER=postgres
DATABASE_URL=${{Postgres.DATABASE_URL}}
DATABASE_SSL=true
DATABASE_POOL_MAX=10

REDIS_URL=${{Redis.REDIS_URL}}
REDIS_KEY_PREFIX=cloud-bot:staging:
REDIS_TLS=true

METRICS_TOKEN=<random metrics secret>
OTEL_EXPORTER_OTLP_ENDPOINT=<HTTPS OTLP collector endpoint>
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer-<secret-managed-value>
OTEL_SERVICE_NAME=cloud-bot-staging
OTEL_METRIC_EXPORT_INTERVAL_MS=30000

STORAGE_DRIVER=s3
S3_ENDPOINT=<Cloudflare R2 S3 API endpoint>
S3_REGION=auto
S3_BUCKET=<staging private bucket name>
S3_ACCESS_KEY_ID=<R2 access key id>
S3_SECRET_ACCESS_KEY=<R2 secret access key>
S3_FORCE_PATH_STYLE=true

SESSION_TTL_SECONDS=3600
ALLOW_DEV_LOGIN=false
DOWNLOAD_TTL_SECONDS=900
MAX_UPLOAD_BYTES=52428800
ADMIN_TELEGRAM_IDS=<your Telegram numeric id>
```

Important: current application production config requires `REDIS_TLS=true`. Railway Redis internal URL is often non-TLS. The code now explicitly allows Railway staging with `REDIS_TLS=false` when `REDIS_URL` starts with `redis://` and Railway environment variables are detected (`RAILWAY_ENVIRONMENT_NAME=production` or `RAILWAY_PROJECT_ID` set). This is an explicit exception for Railway internal networking, not a global bypass. For production outside Railway, `REDIS_TLS=true` remains enforced.

## 3. Deploy order

1. Push `main` to GitHub.
2. Connect Railway app service to repo.
3. Add Postgres and Redis variables.
4. Add R2 variables.
5. Deploy.
6. Run migrations against Railway Postgres:

```bash
npm run db:migrate
npm run db:status
```

For GitHub automation, set repository variable `RAILWAY_STAGING_ENABLED=true`, variables `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_SERVICE_ID`, `STAGING_BASE_URL`, and environment secrets `RAILWAY_TOKEN`, `STAGING_DATABASE_URL`, `STAGING_METRICS_TOKEN`. The guarded `.github/workflows/staging.yml` first runs `npm run staging:validate`, which checks presence of all required inputs and requires an HTTPS `STAGING_BASE_URL` without printing secret values. Only after this preflight does it install dependencies, build, deploy with the pinned Railway CLI, apply immutable migrations, check schema status, and run HTTPS health/metrics smoke tests. If credentials are absent, the workflow fails early with actionable variable names instead of reaching the Railway deploy step with an ambiguous authentication error.

7. Check:

```text
/health/live
/health/ready
/health/metrics (with x-metrics-token)
```

## 4. Telegram setup

After Railway gives a public HTTPS URL:

1. Set BotFather Mini App URL / Menu Button to `WEBAPP_URL`.
2. Set webhook:

```bash
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
  -d "url=$WEBAPP_URL/api/webhooks/telegram" \
  -d "secret_token=$WEBHOOK_SECRET"
```

Run this command locally with env variables set; do not paste token into shell history if possible.

## 5. Smoke checks

- Open Mini App from staging bot.
- Open product deep link.
- Create/upload/publish test asset through admin.
- Buy test item with Stars.
- Verify entitlement appears only after `successful_payment`.
- Verify duplicate update does not create duplicate entitlement.
- Download as owner works; чужой entitlement недоступен.
- Refund through owner admin endpoint.
- Verify entitlement revoked and audit log exists.

Evidence template:

```text
timestamp:
environment: railway-staging
bot username:
app url:
order id:
request id:
payment status:
refund status:
notes:
```

Never store tokens, raw initData, payment secrets, database URLs, Redis URLs, S3 secrets, or signed URLs as evidence.
