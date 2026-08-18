# CLOUD-BOT — аудит и топ-20 улучшений

**Дата:** 16 августа 2026 года  
**Проверенная ревизия:** `749213a` — `Harden downloads and optimize catalog delivery`  
**Статус:** аудит выполнен без изменения исходного кода.

## Executive summary

Текущая версия заметно сильнее исходного Release Candidate: dependency audit возвращает **0 vulnerabilities**, CI для `749213a` завершился успешно, локальные unit/integration/adapter/E2E проверки проходят, а критические проблемы native SQLite и утечки download tokens уже закрыты.

При этом проект ещё не следует считать полностью production-ready. Главный оставшийся риск — не отдельная критическая уязвимость, а сочетание архитектурных ограничений: токенная модель с хранением Bearer session в браузерном storage, memory-based upload/scanning, ручная SQL portability layer, отсутствие полноценной наблюдаемости и отсутствие реального staging deployment gate. Ниже приведён backlog из двадцати улучшений, отсортированный по совокупному риску и ожидаемой отдаче.

> **Приоритет P0** означает исправить до следующего production-релиза. **P1** — ближайший hardening sprint. **P2** — плановая оптимизация и зрелость платформы.

## Топ-20 улучшений

| № | Приоритет | Область | Улучшение | Доказательство | Эффект |
|---:|:---:|---|---|---|---|
| 1 | P0 | Аутентификация | Перейти с Bearer token в `localStorage` на HttpOnly, Secure, SameSite cookie или Telegram-backed server session. | Frontend хранит пользовательские настройки в `localStorage`; server принимает `Authorization: Bearer` в `server/app.ts:99-105`; login возвращает raw token в `server/app.ts:134-137`. | Снижает последствия XSS и исключает доступ JavaScript к session credential. Нужны CSRF token/origin checks для state-changing routes. |
| 2 | P0 | Upload security | Перевести upload на disk/streaming quarantine, сканировать файл до постоянного storage и ограничить concurrency. | `multer.memoryStorage()` остаётся в `server/app.ts:62`; `scanArchiveBuffer()` и `yauzl.fromBuffer()` удерживают весь archive buffer в памяти (`server/scanner.ts:31-83`). | Устраняет memory amplification и снижает риск OOM при нескольких параллельных 50–200 MB загрузках. |
| 3 | P0 | Production release | Создать обязательный staging deployment gate с PostgreSQL, Redis TLS, S3/R2 и реальными health checks перед merge/release. | `.github/workflows/ci.yml` проверяет контейнерные контракты, но не выполняет внешний deployment; `docs/runbooks/railway-staging.md` описывает ручные шаги. | Закрывает главный operational blind spot: локальный CI не доказывает работу реальной инфраструктуры и секретов. |
| 4 | P0 | Webhook security | Добавить replay window, update freshness check и отдельный idempotency/audit policy для Telegram webhook updates. | Webhook проверяет secret header и `update_id`, но в `server/app.ts:187-220` отсутствует явная проверка возраста update и метрика rejected replay. | Снижает риск повторной доставки старых валидных updates и делает расследование платёжных инцидентов воспроизводимым. |
| 5 | P0 | Database portability | Убрать runtime SQL translation из `server/pg-db.ts` и сделать typed dialect/query layer с тестами на каждый SQL statement. | PostgreSQL adapter вручную преобразует `?`, `INSERT OR IGNORE`, `CURRENT_TIMESTAMP` и related syntax. | Снижает вероятность тихой divergence между SQLite и PostgreSQL, особенно в payment/refund state machines. |
| 6 | P1 | Authorization | Ввести централизованный policy layer для ownership/admin checks и object-level authorization. | Проверки `user_id` и admin role распределены inline по `server/app.ts`; OWASP относит broken object-level authorization к API1:2023 [1]. | Уменьшает риск будущего endpoint, который забудет ownership predicate, и упрощает security review. |
| 7 | P1 | Session management | Добавить session rotation, revocation version, device/session listing и global logout. | Session хранится как hash в TTL store; logout удаляет один token в `server/app.ts:337`, но нет session family/version model. | Даёт управляемое отзывание скомпрометированных устройств и аудит активных сессий. |
| 8 | P1 | Rate limiting | Разделить лимиты по route class, user identity и IP; добавить bounded Redis key cardinality и fail-open/fail-closed policy per endpoint. | `server/app.ts:87-98` использует несколько фиксированных scopes и ключ `req.userId || req.ip`; catalog/search и expensive upload flows требуют разных budgets. | Защищает search, login, upload и admin mutation от взаимного истощения общего budget. |
| 9 | P1 | Search performance | Перейти с `OFFSET` на cursor/keyset pagination и полноценно включить PostgreSQL trigram/FTS path; добавить SQLite FTS5 или denormalized search column. | Catalog route принимает `limit`/`offset` в `server/app.ts:142-150`; substring `LIKE` остаётся fallback для SQLite. PostgreSQL уже имеет trigram migration 003. | Стабилизирует latency на глубоких страницах и больших каталогах; PostgreSQL indexes ускоряют поиск [2]. |
| 10 | P1 | Download reliability | Ввести signed URL issuance service с explicit provider abstraction, range support, checksum/ETag response и cleanup job для `delivery_events`. | S3 branch теперь выдаёт redirect, local branch стримит через Node; `delivery_events` содержит status/claimed/used, но не видно scheduled cleanup path. | Уменьшает DB growth, поддерживает resume больших файлов и сокращает application bandwidth. |
| 11 | P1 | Secrets | Перейти от env-only secret handling к secret manager/Vault/KMS, rotation policy и startup secret version checks. | Production config требует множество raw env secrets (`server/config.ts:7-37`), runbook указывает ручное заполнение Railway variables. | Снижает blast radius утечки environment и позволяет ротацию без ручного редеплоя всех компонентов. |
| 12 | P1 | Observability | Добавить OpenTelemetry traces/metrics: request latency, DB pool wait, Redis errors, S3 latency, scanner duration, rate-limit rejects, payment state transitions. | Сейчас есть JSON console logs и request duration, но нет histograms, trace IDs across providers или dashboards. OpenTelemetry предоставляет vendor-neutral instrumentation for Node.js [3]. | Позволяет видеть деградацию до инцидента и быстро находить узкое место между API, DB, Redis и S3. |
| 13 | P1 | Error handling | Ввести единый async route wrapper и schema validation на body/query/params вместо большого числа inline `any` и неявных thrown errors. | `server/app.ts` содержит inline async handlers и `req: any`; ошибки часто проходят в global error handler. | Уменьшает uncaught rejection surface, делает error codes стабильными и сокращает повторяющийся boilerplate. |
| 14 | P1 | Admin workflow | Сделать asset publish операцией с optimistic concurrency/version check, audit reason и rollback/unpublish state. | `server/app.ts:336` публикует asset одним update по id; нет version/expected-status predicate и отдельного unpublish endpoint. | Исключает race, когда устаревший admin action публикует заменённый asset. |
| 15 | P2 | Database correctness | Усилить constraints и state-machine tables: foreign-key enforcement, unique active entitlement rules, CHECK constraints для delivery/refund transitions и periodic invariant checker. | SQLite schema создаёт многие таблицы и индексы, но часть бизнес-инвариантов реализована только в application code (`server/db.ts`). | Переносит критические гарантии ближе к данным и упрощает recovery после partial failure. |
| 16 | P2 | Worker architecture | Вынести scanner, thumbnails/metadata и payment reconciliation в background queue с retry/backoff/dead-letter. | Upload route синхронно сканирует и пишет asset в request lifecycle (`server/app.ts:321-334`). | Сокращает request timeout risk и позволяет контролировать CPU/memory отдельно от web workers. |
| 17 | P2 | Frontend performance | Добавить route-level lazy loading, bundle budget в CI и performance budget для LCP/JS transfer. | Build выдаёт vendor chunk около 221 KB, motion около 134 KB и несколько крупных shared chunks; `dist` около 700 KB. | Ускоряет Mini App на мобильных сетях и предотвращает незаметный bundle regression. |
| 18 | P2 | Dependency governance | Настроить Dependabot/Renovate, еженедельный lockfile update PR, SBOM и signed provenance для Docker image. | `npm audit` чист, но `npm outdated` уже показывает drift для AWS SDK, better-sqlite3, TypeScript и других пакетов. | Сохраняет текущий clean audit без ручного накопления version drift и повышает supply-chain visibility. |
| 19 | P2 | Container hardening | Добавить multi-stage минимизацию native build tools из runtime, read-only filesystem, healthcheck, resource limits и image scan. | `Dockerfile` устанавливает `python3 build-essential` и в build, и в production-deps stage; runtime запускается от `node`, но без HEALTHCHECK/read-only policy. | Уменьшает image attack surface и делает деградацию контейнера видимой оркестратору. |
| 20 | P2 | Disaster recovery | Автоматизировать encrypted PostgreSQL backups, S3 object lifecycle/versioning, restore drills и documented RTO/RPO alerts. | `scripts/db.mjs` для backup сообщает использовать provider/pg_dump, а runbook прямо оставляет backup/restore внешним gate. | Превращает backup из инструкции в проверяемую способность восстановления после потери DB, bucket или deploy. |

## Приоритизация по этапам

| Этап | Содержание | Результат выхода |
|---|---|---|
| Sprint 1: P0 | Cookie/session redesign, streaming quarantine, staging gate, webhook replay policy, typed SQL dialect | Можно безопасно подключать реальные staging credentials и проводить controlled payment tests. |
| Sprint 2: P1 security | Policy layer, session revocation, route-aware rate limits, secrets rotation, schema validation | Снижается вероятность auth/authorization regression и эксплуатационной атаки. |
| Sprint 3: P1 performance | Keyset/FTS search, signed-download lifecycle, OpenTelemetry, async error wrapper | Latency и provider failures становятся измеримыми, expensive work уходит с request path. |
| Sprint 4: P2 platform | Worker queue, frontend budgets, SBOM, container hardening, restore drills | Проект получает зрелый release/operations baseline. |

## Что уже сделано хорошо

В текущей ревизии уже присутствуют важные защитные меры: production fail-closed configuration, Telegram init-data validation, webhook secret, hashed download tokens, S3 private-storage design, secure proxy configuration, structured redacted errors, dependency pinning, migration checksums, CI services for PostgreSQL/Redis/MinIO, automated E2E и secret/dependency scans. Это объясняет, почему текущие проверки проходят и `npm audit` сообщает 0 vulnerabilities.

## Ограничения аудита

Аудит выполнен по исходному коду и локальным/CI контрактам. Реальные PostgreSQL/Redis/S3/Railway production traffic, Telegram Stars payment/refund, network latency, database size и backup restore не проверялись, потому что deployment target и production credentials в текущей сессии не подключены. Поэтому пункты, связанные с реальной инфраструктурой, являются release gates, а не утверждением о подтверждённом production-инциденте.

## References

[1]: https://owasp.org/API-Security/editions/2023/en/0x11-t10/ "OWASP API Security Top 10 — 2023"

[2]: https://www.postgresql.org/docs/current/indexes.html "PostgreSQL Documentation — Indexes"

[3]: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/ "OpenTelemetry — Getting Started with Node.js"
