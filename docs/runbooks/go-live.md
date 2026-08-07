# Go-Live runbook

Status gate: Release Candidate pending external verification until staging Telegram Stars payment/refund, S3 bucket policy, Redis TLS, Postgres backup/restore and deploy rollback are evidenced.

## Staging verification
1. Use separate staging bot, `WEBAPP_URL`, `CORS_ORIGIN`, `WEBHOOK_SECRET`, Postgres DB, Redis namespace and S3 bucket.
2. Run `npm run db:migrate` against staging DB.
3. Deploy app with `NODE_ENV=production`, `DB_DRIVER=postgres`, `STORAGE_DRIVER=s3`, `REDIS_TLS=true`.
4. Check `/health/live` and `/health/ready`.
5. Create minimal product and approved asset.
6. Execute Stars flow: create order → invoice → pre-checkout → successful payment → entitlement → download.
7. Replay same update and confirm one entitlement.
8. Run admin refund and repeat refund; confirm entitlement revoked.
9. Record date, staging bot username, redacted order id and request id.

## Rollback
Rollback to previous image/build. Do not rollback DB destructively. If schema rollback is required, restore from verified backup.
