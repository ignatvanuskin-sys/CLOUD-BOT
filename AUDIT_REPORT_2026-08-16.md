# CLOUD-BOT — глубокий аудит проекта

**Дата:** 16 августа 2026 года  
**Режим:** verification-only; исходный код проекта не изменялся.  
**Ревизия:** `0759e25` (`main`, совпадает с `origin/main`).  
**Автор:** Manus AI.

## 1. Итоговый вердикт

Проект имеет хорошо структурированный Release Candidate с понятным разделением адаптеров SQLite/PostgreSQL, Redis и local/S3 storage, проверкой Telegram Mini App init data, webhook secret, ownership и admin roles. В коде присутствуют транзакционные сценарии оплаты и возвратов, идемпотентность заказов, ограничение загрузок, ZIP-slip/zip-bomb проверки, request IDs и fail-closed production configuration.

Однако на текущем состоянии проекта **нельзя считать release pipeline зелёным**. Главный практический блокер обнаружен при запуске самого SQLite runtime: процесс завершается с `exit 139` (segmentation fault). Из-за этого не стартует серверный процесс и не запускается Playwright E2E-сценарий; несколько SQLite-зависимых тестовых файлов также падают до выполнения тестов. Причина, вероятнее всего, находится в нативном модуле `better-sqlite3` либо в его совместимости с используемым Node ABI, но до устранения и проверки в чистом CI/Docker это нельзя списывать только на окружение.

Дополнительно `npm audit --audit-level=high` обнаружил одну **high severity** у транзитивного `nanoid@3.3.17`, подтянутого через `postcss` внутри Vite. Уязвимость относится к build/development цепочке, а не доказанному production HTTP-пути, но текущая команда `deps:audit` всё равно будет красной. В проекте также слишком много зависимостей с диапазонами `latest` и `^`, что ухудшает воспроизводимость и расширяет supply-chain риск.

> **Рекомендация по статусу:** до исправления native crash, зелёного E2E и закрытия dependency audit проект следует маркировать как **Release Candidate / Not production-ready**. После этого остаются обязательные внешние проверки: реальные Telegram Stars payment/refund, PostgreSQL backup/restore/failover, Redis TLS/failover и S3 policy/encryption/versioning.

## 2. Проверенная область и методика

Аудит выполнен по клонированной ревизии GitHub-репозитория `ignatvanuskin-sys/CLOUD-BOT`. Проверены README и предыдущий audit report, package manifest и lockfile, серверные маршруты, конфигурация, DB adapters и migrations, storage, scanner, Telegram handlers, frontend API client, Dockerfile, CI workflow, тестовые сценарии и deployment metadata. Запущены typecheck, lint, build, secret scan, npm audit, отдельные test files, общий test command, server startup и E2E webServer startup.

| Область | Результат текущего аудита |
|---|---|
| TypeScript typecheck | **PASS** |
| ESLint | **PASS с 5 warnings**, ошибок нет |
| Production build | **PASS** |
| Secret scan | **PASS**, `secret scan ok` |
| npm audit | **FAIL**: 1 high severity в транзитивном `nanoid` |
| Основной test command | **FAIL**: 4 unhandled worker errors; причина ниже уточнена как native segfault |
| SQLite-dependent test files | **FAIL**: `exit 139`, segmentation fault |
| Telegram-only test | **PASS**, 12/12 |
| Storage test | **PASS**, 3/3 |
| Logging test | **PASS**, 2/2 |
| E2E | **FAIL**: server from `webServer` exits with code 139 |
| Production adapter contracts | **Не подтверждены в этом запуске**: без `RUN_PRODUCTION_ADAPTER_CONTRACTS=true` suite skip-ит тесты |
| Git working tree | Чистый; изменения от аудита не внесены |

Typecheck и build прошли успешно. Lint содержит пять предупреждений о неиспользуемой переменной `db` в `tests/readiness.test.ts`, то есть качество статической проверки приемлемое, но warnings не следует оставлять без объяснения в release pipeline.

## 3. Приоритизированные findings

### BLOCKER-01 — нативный SQLite crash блокирует server startup и E2E

**Severity:** Blocker до подтверждения причины; минимум High для release gate.  
**Доказательства:** `server/sqlite-db.ts:1` импортирует `better-sqlite3`; `npm run server` в development SQLite режиме завершился с `SERVER_EXIT=139`; независимые `tests/core.test.ts`, `tests/sqlite-migration.test.ts`, `tests/stars-payment.test.ts`, `tests/readiness.test.ts`, `tests/integration.test.ts` и `tests/postgres-migration.test.ts` завершились с `Segmentation fault`; `npm run test:e2e` сообщил `Process from config.webServer was not able to start. Exit code: 139`.

Проблема воспроизводится вне общего Vitest worker pool и сохраняется после `npm rebuild better-sqlite3`, поэтому это не обычный flaky test и не только параллелизм. В Dockerfile production image также присутствует нативная зависимость, а SQLite adapter статически импортируется через `server/db.ts`, даже когда выбран `DB_DRIVER=postgres`. Это увеличивает площадь отказа и означает, что native dependency должна быть проверена в том же Node 22/Docker образе, который используется на deploy.

**Риск:** сервер может не стартовать в окружениях, где запускается SQLite dev/test path; CI не сможет доказать E2E и значительную часть бизнес-логики. Если проблема проявится в production image на этапе module loading, production process также не поднимется.

**Необходимое исправление:** зафиксировать совместимую версию `better-sqlite3` и Node ABI, проверить `npm ci` и `npm rebuild` в чистом `node:22-slim` image, добавить минимальный smoke test `node -e` для native module. Дополнительно желательно сделать SQLite adapter lazy-loaded только при `DB_DRIVER=sqlite`, чтобы PostgreSQL production path не зависел от загрузки native SQLite module. Если SQLite не требуется в production image, его следует вынести из production dependencies либо построить отдельный test image.

### HIGH-01 — dependency audit красный из-за транзитивного `nanoid`

**Severity:** High по policy проекта; фактическая runtime-экспозиция пока не доказана.  
**Доказательства:** `npm audit --audit-level=high` сообщает `nanoid <3.3.18`, high severity, через `node_modules/postcss/node_modules/nanoid`; `npm ls` показывает путь `vite -> postcss@8.5.26 -> nanoid@3.3.17`. Аудит ссылается на advisory [1].

Уязвимый пакет находится во вложенной build-зависимости PostCSS/Vite, а runtime-приложение использует прямой `nanoid@6.0.1`. Поэтому это не доказательство exploitable уязвимости в API или Telegram payment path. Тем не менее команда `npm run deps:audit` специально настроена на high и будет завершаться ошибкой, а оставление известной high vulnerability в supply chain неприемлемо.

**Необходимое исправление:** обновить Vite/PostCSS до версии, подтягивающей исправленный `nanoid`, либо добавить временный проверенный `overrides` в `package.json`; после этого пересобрать lockfile и подтвердить `npm audit`, build и E2E. Нельзя ограничиваться подавлением advisory без документирования, почему build-only exposure принята.

### HIGH-02 — package manifest недостаточно воспроизводим для production

**Severity:** High для supply-chain/release reproducibility; Medium для непосредственно работающего runtime.  
**Доказательства:** в `package.json` несколько прямых зависимостей указаны как `latest`, включая `express`, `react`, `react-dom`, `vite`, `typescript`, `grammy`, `zod`, `better-sqlite3`, `nanoid` и другие. Остальные зависимости используют широкие диапазоны `^`. Lockfile фиксирует текущий install, но любой будущий `npm install` или сознательное обновление lockfile может привести к крупному набору изменений без policy по версиям.

Для проекта с платежами, Telegram webhook, storage и миграциями это создаёт непредсказуемые изменения API и native ABI. Уже обнаруженный `better-sqlite3` crash усиливает этот риск.

**Необходимое исправление:** отказаться от `latest` в application manifest, зафиксировать критичные runtime/build/native пакеты exact versions или контролируемыми диапазонами, включить Dependabot/Renovate с отдельными PR, добавить lockfile diff review и периодическую проверку лицензий и CVE. Обновления Node, Vite, TypeScript и native packages должны проходить отдельный compatibility smoke test.

### MEDIUM-01 — production adapter contracts не являются частью обычного локального доказательства

**Severity:** Medium.  
**Доказательства:** `tests/production-adapters.test.ts` пропускает тесты без `RUN_PRODUCTION_ADAPTER_CONTRACTS=true`; текущий запуск получил `3 tests | 3 skipped`. CI workflow действительно включает PostgreSQL, Redis и MinIO services и запускает этот suite с переменной окружения, однако в данном аудите реальный внешний adapter contract не был подтверждён.

Это означает, что локальный зелёный status основных тестов не доказывает работу PostgreSQL transaction path, Redis TTL/rate-limit semantics и S3 put/head/get. Предыдущий `AUDIT_REPORT.md` содержит более старый baseline, где эти contracts были заявлены как PASS; его нельзя автоматически считать доказательством для текущего запуска.

**Необходимое исправление:** добавить отдельный `npm run verify:production-adapters`, который явно поднимает disposable services или завершается ошибкой, а не silently skip. В CI следует публиковать результат с количеством skipped tests и блокировать merge, если production contract suite не выполнился.

### MEDIUM-02 — ручной SQL translation остаётся техническим риском PostgreSQL

**Severity:** Medium.  
**Доказательства:** `server/pg-db.ts:19-43` преобразует SQLite-style `?` placeholders в `$n`, но не является полноценным SQL dialect adapter. В `server/db.ts` и `server/app.ts` runtime SQL поддерживает одновременно SQLite и PostgreSQL, включая `on conflict`, `returning`, `CURRENT_TIMESTAMP` и параметризацию. Такой подход работает до тех пор, пока каждая новая query вручную совместима с обеими СУБД.

Риск не равен подтверждённой SQL injection: запросы параметризованы, а текущий typecheck проходит. Риск состоит в том, что новая SQLite-specific конструкция может пройти локальные тесты и сломать production PostgreSQL, либо различия в типах/`rowCount`/timestamps проявятся только под нагрузкой.

**Необходимое исправление:** перейти к явно разделённым SQL paths для существенно различающихся запросов или использовать единый проверенный query layer; добавить полный PostgreSQL integration suite для auth, order idempotency, payment fulfilment, refund, download claim/release и migrations. Для каждой миграции нужен повторный запуск и проверка checksum/rollback/backup restore.

### MEDIUM-03 — hardcoded `trust proxy` может нарушить IP rate limiting

**Severity:** Medium, зависит от topology.  
**Доказательства:** `server/app.ts:63` устанавливает `app.set('trust proxy', 1)`, а rate limiter строит ключ на `req.ip` (`server/app.ts:87-95`). Если между клиентом и приложением находится не ровно один доверенный proxy, Express может неверно определить адрес клиента: при другой цепочке возможны обход лимита, объединение разных клиентов в один bucket или доверие к подделанному forwarded header.

**Необходимое исправление:** задавать trusted proxy через deployment-specific configuration, либо ограничить доверенные CIDR/known proxy count; документировать Railway/load-balancer topology и добавить integration test с `X-Forwarded-For`.

### LOW-01 — CI не запускает часть специализированных тестов

**Severity:** Low/Medium.  
**Доказательства:** `package.json` содержит `test:production-fixes` для `postgres-migration.test.ts` и `logging.test.ts`, но `.github/workflows/ci.yml` отдельно запускает только `npm test`, `test:integration`, E2E и `test:adapters`. Поэтому специализированные migration/logging tests не гарантированно выполняются в обычном CI пути.

**Необходимое исправление:** включить `npm run test:production-fixes` в CI либо объединить все обязательные suites в один явно именованный `test:ci` script. CI должен падать при unexpected skips.

### LOW-02 — secret scan имеет намеренно ограниченный scope

**Severity:** Low как дополнительный контроль, High только если его ошибочно считать полной защитой.  
**Доказательства:** `scripts/security-scan.mjs` исключает `.env.example`, `prompt.md`, `security-scan.mjs` и `scanner.ts`, а также `node_modules`, `dist`, `data`, `storage` и `.git`. Текущий scan завершился успешно, но это означает только отсутствие совпадений в разрешённом scope.

**Необходимое исправление:** добавить отдельное сканирование Git history и всех tracked files с redaction-safe output, подключить provider secret scanning и secret manager policy. Исключения должны быть минимальными и объяснёнными, а не скрывать потенциальные secret-like fixtures.

## 4. Что сделано хорошо

Конфигурация production в `server/config.ts` требует PostgreSQL, S3, Redis и HTTPS-origin; development login запрещается в production. Telegram init data проверяется через HMAC и ограничения `auth_date`, webhook проверяет `x-telegram-bot-api-secret-token`, а pre-checkout и successful payment сверяют payer, currency, amount и payload. Session token хранится в TTL-store по SHA-256 hash, а endpoint ownership checks привязаны к текущему пользователю.

Платёжная модель имеет scoped idempotency key на пользователя. Fulfilment и entitlement creation выполняются в транзакции, duplicate webhook updates учитываются через `webhook_updates`, возвраты имеют manual-review/reconciliation path. Download token одноразовый и хранится как hash; поток `issued → streaming → used` пытается вернуть token в issued при storage/stream/client abort.

Upload path имеет лимит Multer, magic-byte/extension checks, ZIP limits, zip-slip/symlink/encrypted-entry checks, secret-pattern scan и компенсационное удаление storage object при ошибке записи DB. В HTTP path присутствуют Helmet, request ID, bounded pagination, rate limit headers и production-safe error metadata. Build проходит, а в протестированных Telegram-only, storage и logging suites assertions зелёные.

## 5. Рекомендованный план исправлений

| Приоритет | Действие | Критерий готовности |
|---|---|---|
| P0 | Разобрать `better-sqlite3` segfault и разделить/lazy-load SQLite dependency | `npm run server`, SQLite tests и E2E проходят в чистом Node 22/Docker окружении |
| P0 | Исправить транзитивный `nanoid` advisory | `npm audit --audit-level=high` возвращает exit 0 |
| P1 | Убрать `latest`, зафиксировать native/runtime toolchain и ввести controlled updates | Повторный `npm ci` даёт тот же dependency graph; обновления идут отдельными PR |
| P1 | Сделать adapter contracts обязательными и непроходимыми при skip | PostgreSQL/Redis/MinIO suite выполняется в CI, skipped count = 0 |
| P1 | Добавить полноценные PostgreSQL payment/refund/download/migration tests | Ключевые state transitions подтверждены на PostgreSQL, а не только SQLite |
| P1 | Исправить `trust proxy` policy | Topology задокументирована; forwarded-header tests не позволяют обходить limiter |
| P2 | Включить specialized production-fixes tests в CI | `test:production-fixes` выполняется на каждом PR |
| P2 | Усилить secret scanning и logging/operations controls | History/provider scan, metrics, alerts и SLO/runbooks подтверждены |

## 6. Release gates перед production

Кодовый release не следует объявлять готовым, пока не будут подтверждены в staging реальные Telegram Stars `pre_checkout`, successful payment, duplicate/replay, wrong payer/amount, refund, refund failure и reconciliation сценарии. Нужны также PostgreSQL backup/restore и failover, Redis TLS/connectivity/failover, S3 private bucket policy, encryption, versioning, lifecycle/quarantine behavior и проверка observability.

Отдельно следует собрать production image из текущего commit и выполнить в нём migrations, `/health/live`, `/health/ready`, graceful SIGTERM, native module smoke и rollback/restore drill. В отчёты необходимо сохранять exit codes и количество skipped tests; `UNVERIFIED` не должен преобразовываться в `PASS`.

## References

[1]: https://github.com/advisories/GHSA-2v37-7h3g-55p8 "GitHub Advisory: nanoid custom generators can loop indefinitely when size is zero"

## Evidence index

| Source | Назначение |
|---|---|
| `README.md` | Архитектурные контракты и заявленные production gates |
| `package.json`, `package-lock.json` | Scripts, dependency policy и lock graph |
| `server/app.ts` | HTTP auth, rate limiting, payments, downloads, admin routes |
| `server/config.ts` | Production fail-closed configuration |
| `server/db.ts`, `server/pg-db.ts`, `server/sqlite-db.ts` | DB selection, migrations, SQL translation, native SQLite path |
| `server/storage.ts`, `server/scanner.ts` | Storage isolation, token lifecycle и upload scanning |
| `server/schema.ts`, `server/telegram.ts`, `server/logging.ts` | Telegram verification, bot handling и error redaction |
| `Dockerfile`, `.github/workflows/ci.yml`, `playwright.config.ts` | Runtime image, CI gates и E2E startup |
| `AUDIT_REPORT.md` | Предыдущий baseline; использован только для comparison, не как текущий доказанный результат |
