# CLOUD-BOT — инфраструктурные улучшения

**Дата:** 16 августа 2026 года
**Статус:** инфраструктурные изменения внесены в рабочую копию; commit и push не выполнялись.

## OpenTelemetry

Добавлен `server/telemetry.ts` и preload `server/telemetry-bootstrap.ts`. При наличии `OTEL_EXPORTER_OTLP_ENDPOINT` приложение запускает NodeSDK до загрузки HTTP/Express/Redis/PostgreSQL модулей, включает Node auto-instrumentation, экспортирует OTLP traces и metrics, задаёт service identity и корректно flush-ит telemetry при graceful shutdown.

Экспорт отключён при отсутствии OTLP endpoint, поэтому локальный запуск не требует collector. Production/staging должны задавать `OTEL_EXPORTER_OTLP_ENDPOINT`, секретные `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` и, при необходимости, `OTEL_METRIC_EXPORT_INTERVAL_MS`. В текущем окружении startup с telemetry preload успешно поднял сервер, а `/health/live` и `/health/metrics` ответили 200.

## Durable background queue

Добавлен `server/queue.ts` с Redis-backed очередью. Реализованы ready list, processing list, visibility-timeout recovery, exponential retry/backoff, dead-letter list и безопасное redaction ошибок. Для `NODE_ENV=test` и локального запуска без Redis используется in-memory fallback.

Asset upload теперь сохраняется в quarantine, получает статус `scanning` и job `asset_scan`; worker читает quarantine object, запускает scanner и только после успешной проверки переносит asset в approved key. Отклонённые файлы остаются недоступными для скачивания. Worker lifecycle связан с app shutdown.

Добавлен `tests/queue.test.ts`, который проверяет retry после transient failure. В production queue использует существующий Redis instance и namespace `REDIS_KEY_PREFIX`; dead-letter jobs должны мониториться операционно.

## Staging deployment gate

Добавлен `.github/workflows/staging.yml`, запускаемый вручную либо автоматически после push в `main`, если repository variable `RAILWAY_STAGING_ENABLED=true`. Workflow:

1. выполняет clean install, typecheck, build и bundle budget;
2. деплоит Railway service через pinned `@railway/cli@5.41.2`;
3. запускает `npm run db:migrate` против staging PostgreSQL;
4. проверяет `npm run db:status`;
5. выполняет `scripts/staging-smoke.mjs` против HTTPS staging URL и проверяет `/health/live`, `/health/ready` и защищённый `/health/metrics`.

Гейт намеренно не активируется, пока не задана явная переменная `RAILWAY_STAGING_ENABLED=true`, чтобы push в GitHub не вызвал неожиданный внешний deploy.

## Required GitHub/Railway configuration

| Тип | Имя | Назначение |
|---|---|---|
| Repository variable | `RAILWAY_STAGING_ENABLED` | Явное включение staging deploy gate |
| Repository variable | `RAILWAY_PROJECT_ID` | Railway project |
| Environment variable | `RAILWAY_ENVIRONMENT_ID` | Railway staging environment |
| Environment variable | `RAILWAY_SERVICE_ID` | Railway app service |
| Environment variable | `STAGING_BASE_URL` | Публичный HTTPS URL staging app |
| Environment secret | `RAILWAY_TOKEN` | Railway CLI authentication |
| Environment secret | `STAGING_DATABASE_URL` | Staging PostgreSQL connection string |
| Environment secret | `STAGING_METRICS_TOKEN` | Access to `/health/metrics` |
| Railway variable | `OTEL_EXPORTER_OTLP_ENDPOINT` | HTTPS OTLP collector endpoint |
| Railway secret | `OTEL_EXPORTER_OTLP_HEADERS` | Collector authentication headers |
| Railway variable | `OTEL_SERVICE_NAME` | Service identity, e.g. `cloud-bot-staging` |

Secrets should be stored only in Railway Variables / GitHub Secrets and never committed or printed into evidence.

## Validation

| Проверка | Результат |
|---|---|
| Typecheck | PASS |
| ESLint | PASS; только прежние warnings в readiness tests |
| Core/integration tests | PASS |
| Queue contract test | PASS; retry recovery verified |
| PostgreSQL migration tests | PASS |
| Build | PASS |
| Security scan | PASS |
| Dependency audit | PASS, 0 high vulnerabilities |
| E2E | PASS, 3/3 |
| Local server with telemetry preload | PASS; liveness and metrics endpoints returned 200 |
| `git diff --check` | PASS |

## External prerequisites

Реальный Railway deploy, staging PostgreSQL migration, Redis durability test, OTLP collector receipt verification и Telegram/S3 payment smoke нельзя доказать локально без подключённых staging credentials и deployment target. После заполнения перечисленных variables/secrets workflow станет внешним release gate; до этого он существует как guarded, неактивный workflow.
