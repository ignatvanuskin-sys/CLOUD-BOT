# CLOUD-BOT — финальный production closure

Дата проверки: 2026-08-09  
Режим: verification-only; продуктовый код и тесты не изменялись. Секреты не публикуются.

## Итоговая таблица

| Проверка | Статус | Доказательство |
|---|---|---|
| Typecheck | PASS | exit 0 |
| Lint | PASS | exit 0 |
| Unit | PASS | 25/25, exit 0 |
| Integration | PASS | 2/2, exit 0 |
| E2E | PASS | 3/3, exit 0 |
| Build | PASS | exit 0 |
| Security scan | PASS | `secret scan ok`, exit 0 |
| Dependency audit | PASS | 0 vulnerabilities, exit 0 (`deps:audit` и прямой `npm audit`) |
| `git diff --check` | PASS | exit 0 |
| PostgreSQL/Redis/S3 contracts | PASS | 3/3 реально выполнены, 0 skipped; PostgreSQL 16, Redis 7, MinIO S3-compatible |
| Production image build | PASS | `cloud-bot:audit`, build завершён |
| Container startup + migrations | PASS | non-root `node`; `database_migrations_ready`; `server_started` |
| `/health/live` | PASS | HTTP 200, `{ "ok": true }` |
| `/health/ready` | UNVERIFIED | HTTP 503: DB/Redis/S3 `ok`, Telegram `failed` из-за намеренно фиктивного токена; реальные Telegram вызовы/платежи не выполнялись |
| Graceful SIGTERM | PASS | `shutdown_started`, `shutdown_completed`, container exit 0 |
| External production gates | UNVERIFIED | реальные Telegram Stars payment/refund; provider S3 policy/encryption/versioning; Redis TLS/failover; PostgreSQL backup/restore/failover |

## Adapter environment и services (без секретов)

Contract gate включён через `RUN_PRODUCTION_ADAPTER_CONTRACTS=true`, `NODE_ENV=test`, `DB_DRIVER=postgres`, `DATABASE_URL`, `DATABASE_SSL=false`, `REDIS_URL`, `REDIS_KEY_PREFIX`, `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION=us-east-1`, `S3_BUCKET=cloud-bot-contracts`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=true`.

Локально подняты реальные containers без mocks: PostgreSQL 16, Redis 7 и MinIO. Создан отдельный S3-compatible bucket. Suite выполнил PostgreSQL migration/query/transaction, Redis TTL/atomic increment и S3 put/head/get: **3 passed из 3**.

CI содержит service containers PostgreSQL/Redis/MinIO и тот же adapter gate. Docker Compose в репозитории не найден. Docker daemon локально доступен.

## Production container

Image использует `node --import tsx server/index.ts`, runtime user `node`. Для локальной production-проверки использованы PostgreSQL/Redis/MinIO containers и обязательные production env; Railway marker применён только для разрешённого локального `redis://` пути. Startup и migrations прошли. Liveness прошёл. Readiness корректно остался неготовым только по Telegram, поскольку безопасная проверка использовала фиктивный токен и реальные Telegram Stars операции запрещены scope. SIGTERM завершился штатно с exit 0.

## Разделение gates

**Local PASS:** статические проверки, unit/integration/E2E/build/security/dependency audits, git whitespace check, 3/3 adapter contracts, image build, startup/migrations, liveness, graceful shutdown.

**External UNVERIFIED:** полная readiness с реальным Telegram bot, Telegram Stars payment/replay/refund/reconciliation, production-provider TLS/policies/encryption/versioning, backup/restore и failover. Эти gates не считаются PASS.

---

# Архив предыдущего аудита (не является текущим статусом)

# CLOUD-BOT — финальный production audit-first

Дата: 2026-08-08  
Режим: **только аудит; продуктовый код не изменялся**  
Вердикт: **RELEASE CANDIDATE / NOT PRODUCTION-READY до внешних staging gates и закрытия подтверждённых findings ниже**.

## 1. Scope, метод и доказательства

Проверены текущие файлы проекта и рабочее дерево Git: production adapters PostgreSQL/Redis/S3, production-only integrations, Docker/startup/signals/migrations, security, API, frontend/Mini App, Telegram bot, SQLite/PostgreSQL schema и transactions, observability/reliability, performance, тесты и специальные пути. Bearer auth не менялась; внешние adapters не подменялись mock-ами; skipped не засчитывались как PASS. Секреты в отчёт не выводятся.

Принятый verified baseline пользователя (не перезапускался): typecheck PASS exit 0; lint PASS exit 0; unit PASS 22/22; integration PASS 2/2; build PASS exit 0; npm audit PASS, 0 vulnerabilities; E2E PASS 3/3 exit 0. Дополнительно выполнен безопасный `git diff --check`: PASS exit 0. Runtime production adapters, Docker image и реальные Telegram Stars не объявлены PASS без внешнего окружения.

## 2. Executive summary

Архитектура корректно fail-closed выбирает PostgreSQL, Redis и S3 в production (`server/config.ts:43-63`), сохраняет opaque Bearer session contract (`server/app.ts:99-106`, `src/api/client.ts:3-7`), проверяет Telegram initData, webhook secret, ownership и admin roles. Текущий diff закрывает прежние download/refund/idempotency/storage/rate-limit проблемы и добавляет CI contracts.

Подтверждены **0 Critical, 1 High, 3 Medium, 3 Low** открытых проблемы. Главный code blocker: PostgreSQL migration не является безопасно повторяемой из-за безусловного `ADD CONSTRAINT`. Главные release gates: реальные production integrations и Docker не доказаны локальным baseline. Итог: кодовая база близка к RC, но production go-live нельзя утверждать до исправления HIGH-01 и выполнения внешних gates.

## 3. Verified baseline и непроверенные gates

| Проверка | Статус |
|---|---|
| Typecheck / lint / build | PASS (verified baseline) |
| Unit | PASS 22/22 (verified baseline) |
| Integration | PASS 2/2 (verified baseline) |
| E2E | PASS 3/3 exit 0 (verified baseline) |
| npm audit | PASS, 0 vulnerabilities (verified baseline) |
| `git diff --check` | PASS exit 0, выполнено в этом аудите |
| PostgreSQL/Redis/S3 contract suite | **UNVERIFIED здесь**; suite существует, но локальный skip не PASS |
| Docker build/run | **UNVERIFIED**; не запускался |
| Telegram Stars payment/refund/webhook | **UNVERIFIED** без staging credentials |
| S3 policy/encryption/versioning, Redis TLS, PG backup/restore/failover | **UNVERIFIED external gates** |

## 4. Git working tree и артефакты

Ветка `main...origin/main`. Изменены 21 tracked-файл: 326 additions / 85 deletions. Новые untracked: `tests/production-adapters.test.ts`, `tests/sqlite-migration.test.ts`, `.postman/`, `postman/`, `AUDIT_REPORT.md`, `trace-inspect/`. Ничего не удалялось, не коммитилось и не пушилось.

| Путь | Git | Назначение / классификация | Решение для fix stage |
|---|---|---|---|
| `AUDIT_REPORT.md` | untracked | полезный handoff-аудит | сохранить и review перед добавлением |
| `.postman/resources.yaml` | untracked | metadata локального Postman workspace, содержит только workspace id | полезно при совместной работе; не runtime |
| `postman/` | untracked | Postman Local View scaffold; фактически только пустые разделы и globals без значений | generated/useful metadata; не продуктовый runtime |
| `trace-inspect/` | untracked, не ignored | Playwright trace extraction: 454 файла, 7,664,980 bytes; 426 JPEG, trace/network/stacks/resources | generated diagnostic artifact; потенциально содержит UI/network payloads, не добавлять без redaction/policy |

`data/`, `storage/`, `dist/`, `node_modules/`, test results игнорируются. Специальные пути не tracked. `trace-inspect/` отсутствует в `.gitignore`, что создаёт риск случайного commit большого/чувствительного trace bundle (см. MEDIUM-03).

## 5. Production adapters и integrations

- **PostgreSQL:** `pg.Pool`, parameter translation, transactions, pool limits/timeouts; production требует `DB_DRIVER=postgres` и `DATABASE_URL`. TLS certificate verification default secure.
- **Redis:** sessions, support state, preferences и rate limits; atomic INCR+EXPIRE Lua; production требует URL/TLS, кроме явно разрешённого Railway internal `redis://`.
- **S3:** private object put/head/get/delete, checksum, health; production требует S3 config. Download endpoint stream-ит объект через backend, presigner сейчас не используется в flow.
- **Telegram:** bot init, commands, webhook registration/verification, secret header, pre-checkout validation, payment idempotency, refund state/reconciliation.
- **Fallback:** production config блокирует SQLite/local storage/missing Redis; mock fallback не обнаружен.
- **Evidence gap:** CI contract suite покрывает базовые PG/Redis/S3 операции, но не реальные provider policy/TLS/failover и не Telegram Stars.

## 6. Docker, startup, signals и migrations

`Dockerfile:1-24` — multi-stage Node 22 slim, runtime под `USER node`, production env, exec-form CMD. `.dockerignore` исключает secrets/data/storage/docs. Startup (`server/index.ts:9-56`) выполняет migration до listen, затем bootstrap admins; SIGINT/SIGTERM закрывают HTTP, TTL stores и DB с 10s forced timeout. Railway readiness использует `/health/ready`.

Риски: runtime копирует полный build `node_modules`, включая devDependencies (LOW-01); Docker image не был собран/запущен; migration defect HIGH-01 блокирует доказанную повторяемость startup на PostgreSQL.

## 7. Security review

Подтверждено: Telegram HMAC + age/future checks (`server/schema.ts:42-75`); opaque 48-char Bearer token хранится только как SHA-256 key в TTL store; exact production CORS; Helmet CSP; webhook secret; SQL parameters; ownership checks; role gates; upload size/magic/ZIP bomb/path/symlink/secret checks; private storage; production error redaction в Express path.

Не найдено подтверждённых IDOR, SQL injection, path traversal или committed secrets. Bearer auth оставлена стабильной. Остаточные проблемы: Telegram handler/startup/pool logs всё ещё могут писать stack/message/SQL в production (MEDIUM-02); static secret scanner имеет ограниченный scope и не заменяет secret manager/provider scanning.

## 8. Полная API endpoint matrix

| Method/path | Auth | Authorization/validation | Side effects / controls |
|---|---|---|---|
| GET `/health/live` | public | none | liveness |
| GET `/health/ready` | public | none | DB migration row + Redis + storage + Telegram readiness |
| POST `/api/auth/telegram` | signed initData | Telegram HMAC/age; dev login non-prod only | user upsert, Bearer TTL; 80/min |
| GET `/api/me` | Bearer | own session | own user |
| GET `/api/products` | public | published; bounded q/limit/offset | catalog query; 120/min |
| GET `/api/products/:slug` | public | published | product/plans; 120/min |
| POST `/api/start-param` | Bearer | allowlisted parser | analytics |
| POST `/api/orders` | Bearer | published plan/product; scoped idempotency key | create/reuse order; 80/min |
| GET `/api/orders/:id` | Bearer | `id + user_id` | owner-only status |
| POST `/api/orders/:id/invoice` | Bearer | owner + pending | Telegram invoice; 80/min |
| POST `/api/webhooks/telegram` | webhook secret | payer/payload/currency/amount/status | pre-checkout, payment transaction, grammY |
| GET `/api/me/purchases` | Bearer | own active entitlements | list purchases |
| POST `/api/purchases/:id/download` | Bearer | entitlement owner + published matching asset | hashed one-time token; 80/min |
| GET `/api/download/:token` | capability token | issued/unexpired/published | atomic streaming lifecycle |
| POST `/api/admin/products` | Bearer | owner/editor + manual validation | create product, audit; 80/min |
| POST `/api/admin/orders/:id/refund` | Bearer | owner + reason + fulfilled | Telegram refund/state machine; 80/min |
| POST `/api/admin/orders/:id/refund/reconcile` | Bearer | owner + outcome/note | manual reconciliation/audit; 80/min |
| POST `/api/admin/assets/upload` | Bearer | owner/editor + multer/scanner | storage + DB compensation; 80/min |
| POST `/api/admin/assets/:id/publish` | Bearer | owner/editor + approved/published | publish/audit; 80/min |
| POST `/api/auth/logout` | Bearer | own session | TTL delete + analytics |
| GET SPA fallback | public | excludes `/api/`, `/health/` | `dist/index.html` |

## 9. Frontend / Mini App

React/Vite routes lazy-loaded; Telegram ready/expand/theme/reduced-motion/deep links/CloudStorage/Main UI integrations присутствуют. API client сохраняет стабильный Bearer contract и single-flight refresh. Checkout использует stable idempotency key, 30-minute recovery TTL и owner-only order status. E2E baseline покрывает mobile render/routes/runtime errors, но не реальный Telegram SDK/payment/download/refund и не desktop/keyboard/accessibility depth (LOW-03).

## 10. Telegram bot

Команды, callbacks, inline query, support state, profile, settings и webhook allowed updates реализованы. Bot init регистрирует commands/scopes и проверяет webhook URL. Payment validates payer/currency/amount/payload; update id deduplicates successful payment. Refund имеет durable manual-review/reconcile path. Реальный staging payment/refund остаётся обязательным external gate.

## 11. SQLite/PostgreSQL schema, migrations и transactions

SQLite: WAL, busy timeout, FK, process mutex, `BEGIN IMMEDIATE`, backward-compatible column additions и scoped idempotency index. PostgreSQL: pool transaction BEGIN/COMMIT/ROLLBACK, advisory migration lock, schema/indexes. Payment fulfillment и refund finalization транзакционны. Cross-resource upload имеет delete compensation. Подтверждённый migration defect описан в HIGH-01.

## 12. Observability / reliability

Есть request id, structured request duration/status logs, readiness dependency breakdown, graceful shutdown, DB/Redis errors, audit log и refund reconciliation. Нет metrics/tracing/SLO/alert definitions; readiness делает внешние checks на каждый probe; background reconciliation job отсутствует — manual review требует оператора. Это release-operational gaps, но без production telemetry не объявлены runtime defects.

## 13. Performance

Плюсы: frontend code splitting/manual chunks, DB pool, indexes, bounded catalog pagination, rate limits, async request-path FS, upload limits. Риски: `%query%` по четырём `lower()` columns не индексируется обычными indexes и деградирует с ростом каталога (MEDIUM-01); upload/scanner держит весь файл и ZIP entries в памяти до 50/200 MB limits; readiness вызывает Redis/S3/DB/Telegram state per probe. `smoke:load` — только 20 последовательных catalog requests, не capacity test.

## 14. Только подтверждённые открытые проблемы (fix-stage list)

### HIGH-01 — PostgreSQL migration не идемпотентна
- **Severity:** High
- **Location:** `server/db/postgres-schema.sql:12-14`, `server/db.ts:migrate` lines 8-18
- **Root cause:** migration каждый startup выполняет `DROP CONSTRAINT IF EXISTS`, затем безусловный `ADD CONSTRAINT`; concurrent lock защищает гонку, но не повторный DDL lifecycle и создаёт table lock/validation на каждом старте. Кроме того, schema version rows не управляют применением отдельных migration scripts.
- **Impact:** каждый restart изменяет/валидирует constraint на `orders`; на большой production table возможны длительная блокировка/startup timeout, а частично несовместимая схема блокирует deploy.
- **Reproduction:** на PostgreSQL выполнить `migrate()` дважды и наблюдать повторный DROP/ADD/VALIDATE и lock; измерить `pg_locks`/startup duration на заполненной `orders`.
- **Fix:** immutable versioned migrations; выполнять 002 только если version отсутствует, отдельно add/validate constraint, не переигрывать весь schema на startup; добавить repeat-migration/lock contract.
- **Status:** OPEN, production blocker.

### MEDIUM-01 — Catalog search не масштабируется
- **Severity:** Medium
- **Location:** `server/app.ts:142-151`, handler `GET /api/products`
- **Root cause:** четыре `lower(column) LIKE '%q%'` predicates + group/min; leading wildcard исключает обычный B-tree index.
- **Impact:** sequential scans, DB CPU/latency и amplification под public traffic даже с rate limit.
- **Reproduction:** загрузить большой catalog, выполнить `EXPLAIN ANALYZE` для q search; увидеть scan и рост latency.
- **Fix:** измерить workload; PostgreSQL FTS/trigram indexes, normalized search document, cache и query timeout.
- **Status:** OPEN.

### MEDIUM-02 — Production error redaction неполна
- **Severity:** Medium
- **Location:** `server/telegram.ts:errorDetails` lines 21-30 and `bot.catch` lines 45-51; `server/index.ts:server error/uncaught/startup` lines 15-16, 40-55; `server/pg-db.ts:pool.on(error)` lines 100-102
- **Root cause:** production-safe `errorMeta` применяется только в Express app; другие log paths всегда сериализуют message/stack, Telegram также SQL/cause.
- **Impact:** internal paths, SQL text и provider error details могут попасть в production logs.
- **Reproduction:** вызвать Telegram handler DB error или startup/pool error в production и проверить structured log fields.
- **Fix:** единый allowlist serializer с environment-aware redaction и diagnostic id; protected debug sink отдельно.
- **Status:** OPEN.

### MEDIUM-03 — `trace-inspect/` не ignored и может утечь в Git
- **Severity:** Medium
- **Location:** `.gitignore:1-19`; `trace-inspect/` (454 files, 7.66 MB)
- **Root cause:** generated Playwright trace extraction directory отсутствует в ignore policy.
- **Impact:** случайный commit большого bundle; screenshots/network traces могут содержать пользовательские или request данные.
- **Reproduction:** `git status --short -- trace-inspect` показывает `?? trace-inspect/`; `git check-ignore` не находит rule.
- **Fix:** после review/redaction определить artifact retention; добавить ignore rule или хранить в защищённых CI artifacts. Не удалять до решения владельца.
- **Status:** OPEN; ничего не удалено.

### LOW-01 — Runtime image содержит devDependencies/build toolchain packages
- **Severity:** Low
- **Location:** `Dockerfile:17-20`
- **Root cause:** runtime копирует весь `/app/node_modules` из build stage после обычного `npm ci`.
- **Impact:** больший image/startup transfer и лишняя dependency attack surface.
- **Reproduction:** собрать image и сравнить `npm ls --omit=dev`/size с pruned production install.
- **Fix:** production dependency stage или `npm prune --omit=dev` после build; затем smoke native `better-sqlite3`/tsx startup requirements.
- **Status:** OPEN; Docker runtime unverified.

### LOW-02 — Local storage adapter некорректно обрабатывает Readable/Uint8Array
- **Severity:** Low
- **Location:** `server/storage.ts:43`, `LocalStorageAdapter.putObject`
- **Root cause:** всё, что не Buffer, преобразуется через `Buffer.from(String(input.body))`; stream станет строкой `[object Object]`, Uint8Array — строковым представлением.
- **Impact:** corruption при будущем использовании declared adapter contract с stream/Uint8Array в local mode.
- **Reproduction:** вызвать local `putObject` с `Readable.from('abc')`, затем прочитать объект; содержимое не `abc`.
- **Fix:** корректно consume Readable и `Buffer.from(Uint8Array)` либо сузить тип contract; добавить adapter parity test.
- **Status:** OPEN; текущий upload/demo flow передаёт Buffer/string.

### LOW-03 — E2E accessibility/viewport coverage ограничена
- **Severity:** Low
- **Location:** `playwright.config.ts:11`, `tests/e2e/app.spec.ts:9-15`
- **Root cause:** один mobile viewport; проверки только unnamed buttons/navigation/overflow/routes.
- **Impact:** keyboard/focus/desktop/reduced-motion/accessibility regressions могут пройти CI.
- **Reproduction:** просмотреть test matrix: desktop и keyboard journeys отсутствуют.
- **Fix:** desktop project, keyboard/focus tests, reduced-motion/theme, accessibility tree/contrast checks.
- **Status:** OPEN.

## 15. Закрытые прежние findings, подтверждённые текущим кодом

Download lifecycle теперь `issued → streaming → used` с release при storage/stream/client abort (`server/app.ts:231-253`). Refund имеет requested/manual-review/refunded и owner reconciliation (`server/app.ts:257-309`). Order idempotency scoped `(user_id,idempotency_key)` (`server/app.ts:155-174`, schemas). Upload DB failure компенсируется delete (`server/app.ts:311-324`). Local request-path FS async (`server/storage.ts:43-47`). Catalog limiter присутствует (`server/app.ts:96,142,152`). CI запускает E2E и production adapter contracts (`.github/workflows/ci.yml:29-55`). Эти пункты не считаются открытыми.

## 16. Go-live gates

1. Исправить HIGH-01 и доказать repeatable PostgreSQL migration на заполненной staging DB.
2. Запустить production adapter contracts без skip против staging PostgreSQL/Redis/S3; сохранить exit codes/artifacts.
3. Собрать и запустить Docker image как non-root; проверить startup, readiness, SIGTERM drain и restart.
4. Выполнить реальный Telegram Stars payment, replay, download failure/retry, refund и reconciliation.
5. Проверить S3 private policy/encryption/versioning/CORS, Redis TLS/failover, PostgreSQL backup/restore/pool/failover.
6. Настроить metrics/alerts/SLO и operator procedure для `refund_manual_review`.
7. Review Git diff и generated artifacts; не включать traces без redaction.

## 17. Fix-stage handoff

Приоритет: **P0 HIGH-01**; затем **P1 MEDIUM-02/MEDIUM-03**, performance validation MEDIUM-01; затем LOW. Не менять стабильный Bearer auth. Не заменять production adapters mock-ами. Любой skipped gate остаётся UNVERIFIED, не PASS.

---

Ниже удалён устаревший предыдущий текст аудита, чтобы не смешивать закрытые findings и старый baseline с текущим доказательным состоянием.

## Executive summary

Проект имеет хорошую базовую защиту: серверная проверка Telegram initData, Bearer-сессии с хешированными ключами, ownership-проверки, транзакционная обработка платежа, webhook idempotency, одноразовые download-токены, роли администратора, параметризованный SQL, CSP/CORS, Redis rate limit и архивный scanner. Локальный baseline проходит.

Однако production-ready статус пока не подтверждён. Найдены **0 Critical, 3 High, 7 Medium, 6 Low** подтверждённых дефектов/пробелов. Главные блокеры: download-токен сгорает до успешной выдачи файла; refund может оставить внешний возврат и локальный статус несогласованными; production PostgreSQL/S3/Redis/Telegram flows не покрыты runtime-тестами. Docker daemon недоступен, поэтому Docker остаётся UNVERIFIED.

**Вердикт: READY WITH RISKS (не production-ready до закрытия P0/P1 и staging gates).**

## Project score

| Область | Балл |
|---|---:|
| Code Quality | 72/100 |
| Architecture | 78/100 |
| Security | 80/100 |
| Performance | 70/100 |
| UX / Accessibility | 72/100 |
| Functionality | 78/100 |
| Business Logic | 73/100 |
| Testing | 64/100 |
| Production | 55/100 |
| Product | 70/100 |
| **TOTAL** | **71/100** |

## Проверенный baseline

| Проверка | Результат |
|---|---|
| Typecheck | PASS |
| Lint | PASS |
| Unit | PASS — 21/21 |
| Integration | PASS — 2/2 |
| E2E | PASS — 3/3 |
| Build | PASS |
| Security scan | PASS |
| Dependency audit | PASS — 0 vulnerabilities |
| SQLite DB tests | PASS в unit/integration |
| PostgreSQL status | не выполнен: локальный `DATABASE_URL` отсутствует |
| Docker build | **UNVERIFIED** — Docker client есть, daemon недоступен |

Примечание: запуск `npm run db:status` в общей цепочке ожидаемо требует `DATABASE_URL`; это не регрессия приложения, но production DB gate локально не доказан.

## Git diff review

Рабочее дерево до создания отчёта содержало изменения в 14 tracked-файлах и новые `.postman/`, `postman/`. Diff усиливает TLS default, logout contract, readiness redaction, scanner limits, migration locking и тесты. Подозрительных секретов в tracked SQLite/env-файлах не найдено. Изменения не коммитились и не исправлялись.

Риск diff: изменения затрагивают auth/session, DB migration, scanner, Telegram и тесты одновременно; перед merge нужен отдельный review и staging regression. `audit-git-diff.tmp` существовал в корне как временный артефакт и не является продуктовым кодом.

# 1. Project map

| Слой | Реализация |
|---|---|
| Frontend | React/Vite, React Router, TanStack Query, Framer Motion/GSAP; `src/` |
| API client | Bearer из localStorage, refresh через Telegram initData; `src/api/` |
| Backend | Express; монолитный composition root `server/app.ts` |
| Authentication | Telegram initData → opaque Bearer token → Redis/memory TTL session |
| Authorization | user ownership в SQL; admin roles owner/editor/support |
| Database | SQLite dev/test; PostgreSQL production; custom adapter |
| Payments | Telegram Stars invoice, pre-checkout validation, successful_payment webhook, refund |
| Storage | local private FS dev; S3 production; DB metadata |
| Cache/state | memory dev/test; Redis production; sessions, rate limits, support state, preferences |
| Upload security | multer memory upload, magic bytes, ZIP limits, secret scan, quarantine status |
| Telegram | grammY webhook, commands, callbacks, support flow |
| Deployment | multi-stage Dockerfile, Railway config, health/readiness, graceful shutdown |
| Tests | Vitest unit/integration, Supertest, Playwright E2E, static secret scan |
| Queues/cron | отсутствуют |
| Background jobs | отсутствуют; bot initialization запускается in-process |

## Critical flows

1. **Login:** Mini App → `/api/auth/telegram` → validate initData → upsert user → TTL session → Bearer/localStorage → `/api/me`.
2. **Catalog:** UI → `/api/products` or `/api/products/:slug` → DB published products/plans → UI cache.
3. **Purchase:** product UI → `/api/orders` → DB price snapshot → `/invoice` → Telegram invoice → webhook pre-checkout → successful_payment transaction → entitlement → polling UI.
4. **Download:** library → entitlement ownership check → delivery token hash → `/api/download/:token` → storage stream → one-time claim.
5. **Refund:** owner endpoint → order `refund_pending` → Telegram refund → DB transaction marks refunded and revokes entitlement.
6. **Admin asset:** owner/editor → upload memory → scan → storage → asset DB status → explicit publish.
7. **Support:** Telegram `/support` → TTL state → next message → support_requests DB.

# 2. Feature inventory

| Feature | Frontend | Backend/API | DB | Tests | Status |
|---|---|---|---|---|---|
| Telegram login/session/logout | Да | Да | users + TTL | Unit/integration | Работает локально |
| Catalog/search/filter/sort | Да | Да | products/plans | E2E render only | Частично покрыто |
| Product detail/plans | Да | Да | products/plans | E2E local render | Частично покрыто |
| Favorites/preferences | Да | Telegram CloudStorage/local | Нет | Нет | Client-only |
| Stars checkout | Да | Да | orders | Unit smoke | Staging unverified |
| Payment fulfillment | Polling | Webhook | orders/entitlements/webhook_updates | Unit smoke | Локально подтверждено |
| Purchases/history | Да | Да | entitlements | Unit smoke | Работает локально |
| One-time download | Да | Да | delivery_events/assets | Частично | Есть High defect |
| Refund | Нет admin UI | Да | orders/entitlements | Нет | Staging unverified |
| Admin product create | Нет UI | Да | products | Нет | API-only |
| Asset upload/scan/publish | Нет UI | Да | product_assets | Scanner unit only | Частично покрыто |
| Telegram commands | Нет | Да | support/users | 12 tests | Хорошо локально |
| Support queue | UI-инструкция + bot | Bot | support_requests | Mock DB test | Нет operator workflow |
| Analytics | UI-derived + server events | Internal writes | analytics | Нет | Нет reporting API |
| Health/readiness | Нет | Да | DB/Redis/S3/Telegram | Integration | Production deps unverified |
| Referral | Да | start-param event | analytics | Нет | Нет reward logic |
| Notifications | UI preference | Bot TTL preference | Redis | Callback test | Нет delivery engine |
| Account deletion | UI-инструкция | Нет endpoint/workflow | Нет | Нет | Manual-only |

# 3. Endpoint authorization matrix

| Method/path | Auth | Authorization / ownership | Validation | DB/external | Rate/idempotency |
|---|---|---|---|---|---|
| GET `/health/live` | Public | N/A | N/A | none | none |
| GET `/health/ready` | Public | N/A | N/A | DB, TTL, storage, Telegram state | none |
| POST `/api/auth/telegram` | Public signed initData | Telegram identity | signature/age; dev login non-prod | users, TTL | 80/min/IP |
| GET `/api/me` | Bearer | own session user | token lookup | users | none |
| GET `/api/products` | Public | published only | bounded q/limit/offset; type/category loose | products/plans | none |
| GET `/api/products/:slug` | Public | published only | path string | products/plans | none |
| POST `/api/start-param` | Bearer | own analytics | allowlisted parser | analytics | none |
| POST `/api/orders` | Bearer | order bound to caller | license exists, product published | orders/analytics | 80/min; no idempotency key |
| POST `/api/orders/:id/invoice` | Bearer | `id + user_id` | pending status | orders, Telegram | 80/min; repeat creates links |
| POST `/api/webhooks/telegram` | webhook secret | payer/order checks | amount/currency/payer/payload | Telegram, transaction | update_id idempotency only for payment |
| GET `/api/me/purchases` | Bearer | `e.user_id=req.userId` | N/A | entitlements/products/plans | none |
| POST `/api/purchases/:id/download` | Bearer | entitlement owner + active | published matching asset | delivery_events | 80/min |
| GET `/api/download/:token` | capability token | token hash/status/expiry | one-time claim | storage + delivery_events | none |
| POST `/api/admin/products` | Bearer | owner/editor | partial manual validation | products/audit | 80/min |
| POST `/api/admin/orders/:id/refund` | Bearer | owner only | reason/status | Telegram + orders/entitlements | 80/min; partial idempotency |
| POST `/api/admin/assets/upload` | Bearer | owner/editor | size, product, scanner | storage/assets/audit | 80/min |
| POST `/api/admin/assets/:id/publish` | Bearer | owner/editor | approved/published | assets/audit | 80/min; effectively idempotent |
| POST `/api/auth/logout` | Bearer | own session | token lookup | TTL/analytics | idempotent only while token valid |

**IDOR result:** подтверждённые ownership checks присутствуют для invoice, purchases и download issuance. Admin endpoints role-gated. Прямой IDOR в просмотренных endpoint не подтверждён.

# 4. Confirmed findings

## HIGH-01 — Download token consumed before successful delivery

- **Evidence:** `server/app.ts:213-220`: storage stream открывается, затем delivery event сразу переводится в `used`, и только после этого stream pipe может завершиться ошибкой.
- **Reproduction:** создать entitlement/asset, получить token, заставить storage stream завершиться ошибкой после открытия; первый запрос вернёт/оборвёт 502, повторный получит 410.
- **Root cause:** claim означает «начата попытка», а не «файл успешно доставлен»; нет состояния `streaming/failed` и retry policy.
- **Impact:** оплаченный пользователь может безвозвратно потерять одноразовую ссылку из-за transient S3/network failure.
- **Fix:** атомарно claim в `streaming`, отмечать `used` только после успешного завершения; при ошибке возвращать `issued` либо выдавать новый token по entitlement с лимитом.
- **Files:** `server/app.ts`, DB schemas/migration, tests.
- **Complexity/risk:** Medium / Medium (race и повторная выдача должны быть строго протестированы).

## HIGH-02 — Refund external/local consistency gap

- **Evidence:** `server/app.ts:229-236`: Telegram refund выполняется до локальной transaction; если последующий DB commit упадёт, внешний refund уже завершён, а order может остаться `refund_pending` и entitlement активным.
- **Root cause:** distributed operation без durable reconciliation/outbox; rollback возможен только до успешного external call.
- **Impact:** пользователь получил Stars назад, но сохраняет доступ; финансовая и entitlement inconsistency.
- **Fix:** durable refund state machine, idempotency/reconciliation job, хранение external result, повторяемый finalize; entitlement revoke должен быть восстанавливаемым.
- **Files:** `server/app.ts`, schemas, migration, background reconciliation, tests.
- **Complexity/risk:** High / High.

## HIGH-03 — Production adapters and payment/refund path are not runtime-tested

- **Evidence:** `tests/core.test.ts:55-85` и `tests/integration.test.ts:8-56` принудительно используют SQLite/local/memory; `.github/workflows/ci.yml:8-38` поднимает Postgres/Redis/MinIO, но выполняет только migration для Postgres, не запускает API integration suite против этих adapters; refund не тестируется.
- **Root cause:** test architecture не параметризована по production adapters.
- **Impact:** custom PostgreSQL placeholder adapter, Redis sessions/rate limit, S3 streaming и Telegram refund могут сломаться только в staging/production.
- **Fix:** adapter contract tests и integration suite против Postgres/Redis/S3-compatible storage; Telegram API stub/contract tests; staging Stars gate.
- **Files:** tests, CI, `server/pg-db.ts`, `state.ts`, `storage.ts`, payment routes.
- **Complexity/risk:** High / Low для production кода, Medium для CI.

## MEDIUM-01 — Order creation is not idempotent

- **Evidence:** `server/app.ts:150-156`: каждый повтор POST создаёт новый pending order/payload; endpoint не принимает idempotency key.
- **Root cause:** duplicate click/network retry не моделируется как одна business operation.
- **Impact:** множество pending orders/invoices, путаница поддержки и аналитики; потенциально пользователь может оплатить несколько invoice.
- **Fix:** client-generated idempotency key + unique constraint, либо reuse свежего pending order для user/license.
- **Files:** API, schema, frontend checkout, tests.
- **Complexity/risk:** Medium / Medium.

## MEDIUM-02 — Pending payment blocks all future checkout indefinitely

- **Evidence:** `src/features/checkout.ts:3-9`: любой сохранённый pending order возвращает `processing`; `createdAt` записывается, но никогда не проверяется; cancelled/failed invoice не очищает pending, а pending после paid может жить бесконечно при webhook failure.
- **Root cause:** client state не имеет expiry/status endpoint/recovery action.
- **Impact:** пользователь не может купить другой продукт после зависшего платежа без ручной очистки localStorage.
- **Fix:** TTL, order-status endpoint, cancel/retry UI, привязка pending к license/product.
- **Files:** checkout, API order status, Payments UI, tests.
- **Complexity/risk:** Medium / Low.

## MEDIUM-03 — Upload stores object before DB metadata without compensation

- **Evidence:** `server/app.ts:238-245`: `storage.putObject` выполняется до INSERT; при DB error объект остаётся orphaned. Обратный сценарий cleanup отсутствует.
- **Root cause:** cross-resource operation без compensation.
- **Impact:** накопление orphaned/quarantine objects и storage cost; невозможность управлять ими через DB.
- **Fix:** try/catch с delete compensation, durable upload state/reconciliation; реализовать explicit S3 delete policy.
- **Files:** `server/app.ts`, `server/storage.ts`, tests.
- **Complexity/risk:** Medium / Medium.

## MEDIUM-04 — Local storage uses synchronous filesystem operations on request path

- **Evidence:** `server/storage.ts:38-44`: `mkdirSync`, `writeFileSync`, `statSync`, `existsSync`, `unlinkSync` внутри async adapter.
- **Root cause:** sync FS implementation.
- **Impact:** event-loop blocking при больших upload/download metadata operations в dev/self-hosted local mode.
- **Fix:** `fs/promises`, streaming writes, measured limits.
- **Files:** `server/storage.ts`.
- **Complexity/risk:** Low / Low.

## MEDIUM-05 — Public catalog endpoints have no rate limit

- **Evidence:** `server/app.ts:137-148`: `/api/products` и `/:slug` не используют limiter; search выполняет multi-column `lower(...) like '%q%'`.
- **Root cause:** limiter применён только к selected mutation endpoints.
- **Impact:** cheap application-layer DoS / DB load, особенно на большом каталоге.
- **Fix:** отдельный public read limiter/cache; DB search index/full-text strategy после измерений.
- **Files:** `server/app.ts`, DB indexes, tests.
- **Complexity/risk:** Low-Medium / Low.

## MEDIUM-06 — Error logging may expose SQL and stack traces in production logs

- **Evidence:** `server/app.ts:22-25`, `server/telegram.ts:18-27`, `server/index.ts:52-54`: structured logs включают stack и SQL context.
- **Root cause:** единый verbose error serializer без production redaction.
- **Impact:** logs могут раскрыть schema/query literals и внутренние пути; при ошибках внешних SDK возможны чувствительные details.
- **Fix:** production-safe serializer, allowlist fields, error fingerprint; full stack только в protected sink.
- **Files:** app, telegram, index, pg adapter.
- **Complexity/risk:** Low / Low.

## MEDIUM-07 — CI services do not prove Redis/MinIO behavior and E2E is omitted

- **Evidence:** `.github/workflows/ci.yml:8-38`: Redis/MinIO подняты, но env и tests их не используют; `npm run test:e2e` отсутствует; browser install step отсутствует.
- **Root cause:** CI topology шире фактических checks.
- **Impact:** ложное ощущение production coverage; UI regressions не блокируют merge.
- **Fix:** подключить adapter tests, MinIO bucket setup, Playwright install/run, artifacts.
- **Files:** CI, tests.
- **Complexity/risk:** Medium / Low.

## LOW-01 — API input validation is inconsistent

- **Evidence:** `server/app.ts:137-148,150-156,225`: query type/category и several admin fields не имеют schema validation; malformed numeric query can become `NaN` and reach DB.
- **Impact:** 500 вместо 400/422, inconsistent contracts.
- **Fix:** Zod schemas per endpoint and centralized validation.
- **Complexity/risk:** Medium / Low.

## LOW-02 — HTTP status semantics are inconsistent

- **Evidence:** create order/product return 200 instead of 201; invalid payment webhook returns HTTP 200 with `result=invalid`; expired download always 410, including unknown token.
- **Impact:** weaker observability/client contracts; webhook 200 may be intentional to stop retries but should be documented/metricized.
- **Fix:** explicit API contract and tests; preserve Telegram retry semantics.
- **Files:** app/tests/docs.
- **Complexity/risk:** Low / Medium compatibility.

## LOW-03 — Accessibility coverage is shallow

- **Evidence:** `tests/e2e/app.spec.ts:10-15` checks unnamed buttons and mobile overflow only; no keyboard, focus order, contrast, reduced motion, desktop viewport or automated accessibility tree checks.
- **Impact:** regressions for keyboard/screen-reader users can pass.
- **Fix:** keyboard journeys, focus assertions, desktop/mobile matrix, accessibility scan.
- **Complexity/risk:** Medium / Low.

## LOW-04 — Guest protected pages can look empty instead of explaining login

- **Evidence:** purchases queries are disabled when unauthenticated in Account/Premium/Insight pages, then render empty states indistinguishable from authenticated zero-data.
- **Impact:** UX confusion and conversion friction.
- **Fix:** explicit guest/login-required state and Telegram CTA.
- **Files:** pages/providers.
- **Complexity/risk:** Low / Low.

## LOW-05 — Product/admin/support operations are concentrated in a giant route file

- **Evidence:** `server/app.ts` contains auth, catalog, payment, webhook, delivery, admin, upload and error handling.
- **Impact:** reviewability and regression isolation degrade; not a runtime defect.
- **Fix:** after blockers, split routers/services without changing contracts.
- **Complexity/risk:** Medium / Medium.

## LOW-06 — Security scan has narrow patterns and intentional exclusions

- **Evidence:** `scripts/security-scan.mjs:1-4` uses four regexes and excludes broad path patterns including prompt files and `.env.example`.
- **Impact:** PASS is not proof of absence of secrets.
- **Fix:** documented allowlist, entropy/provider rules, CI secret scanner, scan git history separately.
- **Complexity/risk:** Low / Low.

# 5. Unverified staging/production risks

These are **not confirmed defects**:

1. Real Telegram Stars invoice, pre-checkout, successful payment and refund behavior.
2. PostgreSQL runtime query compatibility/concurrency under real traffic.
3. Redis TLS, reconnect/failover and rate-limit behavior.
4. S3 bucket privacy, encryption, versioning, CORS, checksum and stream failure behavior.
5. Backup/restore, migration rollback and deploy rollback.
6. Docker image build/start/health: daemon unavailable locally.
7. Railway proxy/IP assumptions and production CORS origin.
8. Load behavior and catalog query plans at production data volume.

# 6. Security and business conclusions

- Bearer/localStorage architecture preserved. CSRF is not applicable to Authorization-header Bearer in the same way as cookie auth; no CSRF change recommended.
- Main contextual risk of localStorage is token theft after XSS. Current React escaping + CSP reduce risk, but third-party frontend dependencies and any future HTML injection remain security-critical.
- SQL injection not confirmed: values are parameterized; dynamic sort is allowlisted.
- SSRF not confirmed: server does not fetch user-provided URLs in reviewed flows.
- Path traversal mitigated by key allowlist and resolved-root check.
- Upload scanner has useful ZIP bomb/slip/secret controls, but is not malware scanning.
- Payment amount/currency/payer and order status are server-verified; fulfillment is transactional and idempotent by update/order constraints.
- Direct IDOR not confirmed in protected resource endpoints.

# 7. Test quality matrix

| Feature | Unit | Integration | E2E | Gap |
|---|---|---|---|---|
| initData auth | Strong | Basic | Mocked | no real Telegram |
| Bearer/logout | Basic | Good | Indirect | Redis untested |
| Catalog | None | None | Render/navigation | filters/status/error contracts |
| Orders | Smoke | None | None | duplicate/concurrency/idempotency |
| Payment webhook | Good happy/invalid/duplicate | None | None | concurrent updates/Postgres |
| Refund | None | None | None | critical gap |
| Download | ownership/issuance only | None | None | stream failure/race/retry |
| Upload scanner | Basic | None | None | real ZIP corpus/S3 compensation |
| Admin roles | bootstrap only | None | None | role matrix/denials |
| Telegram commands | Good mocked | None | None | webhook/API failures |
| Frontend routes | None | None | 3 smoke tests | business actions/errors/a11y |
| Production adapters | None | migration only | None | Postgres/Redis/S3 runtime |

# 8. Product/UX audit

**Хорошо:** понятный Telegram-native marketplace, прозрачная Stars цена, no-autorenew messaging, private mode, empty/error/loading components, mobile-first navigation, secure delivery narrative.

**Friction:** guest pages выглядят пустыми; pending payment может заблокировать checkout; support требует перехода в bot и ручной команды; account deletion manual-only; admin/operator UI отсутствует; notifications/referral/achievements частично являются presentation features без backend lifecycle.

**Retention/conversion:** добавить recoverable payment status, release/update notifications, понятный guest CTA, download retry, support ticket status. Revenue: bundles/upgrade paths допустимы только после надёжного entitlement/refund lifecycle.

# 9. Roadmap

## P0 — до production

1. **Download delivery state machine** — устранить HIGH-01. Files: app/schema/tests. Complexity M, risk M.
2. **Refund reconciliation** — устранить HIGH-02. Files: payment service/schema/job/tests. Complexity H, risk H.
3. **Production adapter test gate** — устранить HIGH-03 и MEDIUM-07. Complexity H, risk L.
4. **Staging Go-Live gates** — real Stars payment/refund, S3 policy, Redis TLS, Postgres backup/restore, Docker build/start.

## P1 — высокая ценность

1. Order idempotency and duplicate-click tests.
2. Pending payment expiry/status/recovery UI.
3. Upload storage compensation/reconciliation.
4. Public read rate limiting and measured query plans.
5. Production log redaction.

## P2 — medium

1. Central Zod request validation and status-code contract.
2. CI E2E/accessibility/desktop matrix.
3. Guest-specific protected-page UX.
4. Async local filesystem adapter.
5. Admin/support operator workflows and audit views.

## P3 — improvements

1. Split `server/app.ts` into routers/services after behavior is locked by tests.
2. Expand secret scanning and observability dashboards/alerts.
3. Product analytics/reporting API, notification delivery, referral lifecycle.

# 10. Exact confirmed counts

- **Critical: 0**
- **High: 3**
- **Medium: 7**
- **Low: 6**
- **Code fixes made: 0**
- **New file created:** `AUDIT_REPORT.md`

## Final verdict

**READY WITH RISKS.** Локальная стабильность подтверждена, но проект нельзя объявлять production-ready до исправления delivery/refund consistency, реального тестирования production adapters и прохождения внешних staging/Docker gates.