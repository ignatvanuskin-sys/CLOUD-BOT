# CLOUD-BOT — дополнительный аудит производительности и безопасности

**Дата:** 16 августа 2026 года  
**Ревизия:** рабочая копия поверх `0759e25` с применёнными локальными исправлениями.  
**Режим:** verification-only; продуктовый код в рамках этого дополнительного анализа не изменялся.

## 1. Executive summary

Исправленная версия демонстрирует хорошую базовую производительность на локальном SQLite runtime: при 10 конкурентных клиентах и 100 запросах catalog/search endpoint средняя задержка составила примерно 10–11 ms, а p95 — 24–27 ms. Frontend build разделён на chunks, общий размер `dist` составляет около 700 KB, наиболее крупные uncompressed chunks — vendor 221 KB, motion 134 KB и GSAP 70 KB.

При этом обнаружены два существенных остаточных риска. Во-первых, **одноразовые download capability tokens попадают в HTTP access logs**, поскольку логгер записывает полный `req.path`, включая `/api/download/:token`. Это превращает логи, системы агрегации и потенциально сторонние reverse-proxy logs в дополнительный источник доступа к платным файлам. Во-вторых, **выдача S3-файлов проходит через Node.js process**, хотя в storage adapter уже реализована генерация signed URL; это ограничивает throughput, увеличивает egress/load на приложение и удерживает server connection на весь download.

Каталожный поиск имеет подтверждённый масштабируемый риск: четыре `lower(column) LIKE '%q%'` predicates. На синтетической SQLite базе со 100 000 published products query plan использовал status index, но затем создавал temporary B-trees для GROUP BY и ORDER BY; p50 был около 72.6 ms, p95 около 74.8 ms. На production PostgreSQL ситуация зависит от `pg_trgm` migration, но bounded `LIKE` fallback сохраняет риск sequential-scan деградации.

## 2. Методика и доказательства

Проверены HTTP middleware, auth/session boundaries, CORS, security headers, rate limiter, upload scanner, storage adapters, download flow, DB queries, logging, dependency audit, generated frontend artifacts и CI configuration. Локальный сервер запускался с SQLite, local storage, development login, `TRUST_PROXY_HOPS=0`; внешние PostgreSQL, Redis, S3 provider и реальные Telegram credentials в этот анализ не подключались.

| Проверка | Результат |
|---|---|
| `npm run security:scan` | PASS |
| `npm run deps:audit` | PASS, 0 vulnerabilities |
| Security headers | Helmet headers присутствуют |
| HTTP benchmark, `/health/live`, 1 000 requests / concurrency 20 | 0 errors; p50 ~7.8 ms, p95 ~15.2 ms |
| Catalog benchmark, 100 requests / concurrency 10 | 0 errors; p50 ~7.7 ms, p95 ~24.5 ms |
| Search benchmark, 100 requests / concurrency 10 | 0 errors; p50 ~8.7 ms, p95 ~27.2 ms |
| Stress beyond limiter, catalog 1 000 / concurrency 20 | 881 throttled responses; limiter сработал |
| Stress beyond limiter, search 1 000 / concurrency 20 | 1 000 throttled responses; общий `catalog` bucket сработал |
| Synthetic catalog query, 100 000 rows | p50 ~72.6 ms, p95 ~74.8 ms; temporary B-trees |
| Frontend artifacts | `dist` ~700 KB; largest chunk 221 KB uncompressed |

Низкие HTTP latency numbers получены на локальном пустом SQLite catalog и не являются capacity targets для production. Их назначение — обнаружить грубые regressions и подтвердить поведение rate limiting.

## 3. Security findings

### SEC-01 — capability download token записывается в access log

**Severity:** High.  
**Location:** `server/app.ts`, HTTP logger around request completion; download route `/api/download/:token`.

Access logger формирует запись с `path: req.path`. Практическая проверка запроса к `/api/download/THIS_IS_A_TEST_CAPABILITY_TOKEN` дала log record с полным значением `"path":"/api/download/THIS_IS_A_TEST_CAPABILITY_TOKEN"`. В рабочем сценарии на этом месте будет реальный одноразовый токен, являющийся bearer capability для скачивания entitlement.

**Impact:** токен может попасть в stdout, log collector, APM, reverse-proxy access log, debug archive или third-party log storage. Любой доступ к этим системам может превратиться в доступ к защищённому файлу до истечения TTL. Hash в базе защищает состояние хранения, но не предотвращает утечку исходного токена после его выдачи.

**Recommendation:** нормализовать log path для чувствительных маршрутов: `/api/download/[redacted]`; не логировать query/path token values. Дополнительно рекомендуется передавать download capability через короткоживущий signed URL без access token в application logs либо использовать POST claim + HttpOnly одноразовую cookie. Нужен regression test, проверяющий отсутствие raw token в captured logs.

### SEC-02 — Redis provider error logs не используют общий production redaction

**Severity:** Medium.  
**Location:** `server/state.ts:28`.

Redis adapter пишет `error.message` напрямую: `{ event: 'redis_error', errorType: error.name, message: error.message }`. В отличие от HTTP, Telegram и process-level paths, этот logger не использует `safeErrorMeta`. Текущий локальный пример показал `connect ECONNREFUSED 127.0.0.1:1`; у реального provider error message могут присутствовать endpoint, topology, TLS details или иные внутренние сведения.

**Recommendation:** применять единый allowlist serializer с production-safe `errorType` и diagnostic ID; подробности отправлять только в защищённый debug sink. Добавить unit test, запрещающий `message`, `stack`, SQL и connection details в production Redis log event.

### SEC-03 — Bearer session хранится в localStorage

**Severity:** Medium, defence-in-depth risk.  
**Location:** `src/api/client.ts`.

Frontend хранит session bearer token в `localStorage` и отправляет его через `Authorization`. В текущем статическом анализе не обнаружены `dangerouslySetInnerHTML`, `innerHTML`, `eval` или `new Function`, поэтому подтверждённого XSS не найдено. Однако при будущей XSS или компрометации third-party frontend dependency любой script в origin сможет прочитать токен.

**Recommendation:** для production-режима рассмотреть HttpOnly Secure SameSite cookie с CSRF protection и короткой server-side session, либо отдельный изолированный origin для Mini App. Если bearer contract сохраняется, нужно поддерживать строгий CSP, dependency pinning, SRI/контроль third-party assets и минимальный TTL.

### SEC-04 — secret scan не является полным контролем репозитория

**Severity:** Low/Medium.  
**Location:** `scripts/security-scan.mjs`.

Сканер исключает `.env.example`, prompt markdown, сам scanner, `node_modules`, `dist`, `data`, `storage` и `.git`. Это оправдано для снижения false positives, но текущий `secret scan ok` не означает, что вся Git history, generated artifacts или excluded files безопасны.

**Recommendation:** добавить отдельный CI secret scanner по tracked files и Git history, provider secret scanning и policy для generated traces. Исключения должны быть перечислены и проверяться отдельными fixture tests.

### SEC-05 — development CORS permissive by design; production boundary требует operational control

**Severity:** Low в текущем коде, Medium при неверном deployment env.

Локальная development-конфигурация отвечает `Access-Control-Allow-Origin: https://evil.example`, поскольку `server/app.ts` разрешает любой origin вне production. В production `server/config.ts` требует HTTPS `CORS_ORIGIN`, а middleware сравнивает origin с allowlist. Следовательно, это не production bypass при корректном `NODE_ENV=production`, но ошибка environment labeling может открыть API более широко, чем ожидается.

**Recommendation:** не запускать публичное окружение с `NODE_ENV=development`; добавить startup marker и deployment test, который проверяет, что production rejects unknown origins. Желательно запретить `NODE_ENV=development` на production deployment platform policy level.

## 4. Performance findings

### PERF-01 — S3 download proxying ограничивает throughput приложения

**Severity:** High для каталога с большими файлами.  
**Location:** `server/app.ts` download route и `server/storage.ts:61`; `createDownloadUrl` реализован, но application flow его не использует.

После entitlement check приложение само вызывает `readAsset`, получает S3 stream и проксирует bytes через Node response. Это удерживает application connection и event-loop-adjacent resources на весь download, переносит bandwidth/egress через app и снижает горизонтальную масштабируемость. При больших ZIP и нескольких параллельных пользователях bottleneck возникнет раньше, чем CPU для catalog API.

**Recommendation:** после атомарного entitlement/token claim генерировать короткоживущий S3 signed URL server-side и возвращать его клиенту. Для одноразовой семантики оставить DB delivery event как issuance/claim record, но не передавать file bytes через application process. Если proxy обязателен, ввести per-download concurrency/bytes limits, streaming timeout, backpressure metrics и отдельный bandwidth budget.

### PERF-02 — catalog search масштабируется линейно по текстовым полям

**Severity:** Medium, High при росте каталога.

Текущий запрос использует четыре `lower(...) LIKE lower(?)` с leading wildcard `%q%`. На synthetic SQLite dataset из 100 000 rows query plan был:

```text
SEARCH p USING INDEX idx_products_status_updated (status=?)
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR ORDER BY
```

Измерение дало p50 около 72.6 ms и p95 около 74.8 ms на локальном окружении. Индекс по `status/updated_at` уменьшает часть работы, но не превращает substring search по четырём колонкам в индексированный поиск. PostgreSQL trigram migration улучшает основной production path только если extension/index действительно создан; fallback `LIKE` остаётся корректным, но более медленным.

**Recommendation:** для PostgreSQL сделать trigram GIN index обязательным production capability либо перейти на PostgreSQL full-text search с нормализованным search document. Для SQLite dev/test использовать FTS5 или отдельное normalized search column. Убрать unnecessary `GROUP BY`/`MIN` из запроса, если план/модель данных допускает precomputed price, и добавить `EXPLAIN (ANALYZE, BUFFERS)` budget test на staging-size dataset.

### PERF-03 — upload/scanner path memory amplification

**Severity:** Medium/High under concurrent admin abuse.

`multer.memoryStorage()` держит весь upload в RAM, затем scanner может читать ZIP entries до configured 200 MB total, а storage adapter может создавать ещё одну Buffer copy for checksums/local writes. Максимум задаётся через `MAX_UPLOAD_BYTES` и может достигать 200 MB согласно `server/config.ts`. Даже при admin auth и rate limiter несколько одновременных uploads способны создать значительную memory pressure.

**Recommendation:** перейти на streaming multipart to quarantine file, ограничивать concurrent scan jobs semaphore, отделить upload acceptance от asynchronous scan/publish workflow, применять cgroup/container memory budget и expose metrics `upload_bytes`, `scan_duration`, `scan_rejected`, `scan_queue_depth`. Минимум — снизить production max и протестировать concurrent uploads under memory limit.

### PERF-04 — readiness probe выполняет внешние checks на каждый запрос

**Severity:** Low/Medium.

`/health/ready` вызывает DB query, Redis `PING`, storage health check и Telegram readiness evaluation на каждый probe. При aggressive orchestrator polling или outage provider этот endpoint сам создаёт дополнительный load и error logs. S3 `HeadBucket` особенно нежелателен на очень коротком probe interval.

**Recommendation:** разделить liveness/readiness/dependency diagnostics, кэшировать dependency status на короткий interval, ограничить probe timeout и rate, а внешние health checks выполнять background loop. Readiness response не должна раскрывать provider details.

### PERF-05 — frontend initial payload можно уменьшить

**Severity:** Low.

Build уже использует code splitting, но крупные chunks включают vendor 221 KB, framer-motion 134 KB и GSAP 70 KB uncompressed. Gzip output из build был примерно 71 KB, 44 KB и 27 KB соответственно. Для Telegram Mini App на мобильной сети это заметная часть initial/inter-route transfer.

**Recommendation:** проверить, действительно ли GSAP и framer-motion нужны на initial route; оставить их в lazy chunks, заменить тяжёлые animation paths на CSS/Web Animations где возможно, включить bundle budget в CI и анализировать Brotli transfer size, а не только raw bytes.

## 5. Положительные результаты

Helmet выставляет CSP, `nosniff`, frame policy, referrer policy и HSTS headers в текущем runtime. Параметризация SQL и allowlists для sort/type/category снижают SQL injection risk. Rate limiter корректно возвращает `RateLimit-*` headers и после 80/120 запросов на bucket блокирует excess traffic; проведённый 1 000-request stress test подтвердил, что limiter не был silently bypassed.

Dependency audit и secret scan после предыдущих исправлений проходят. В статическом анализе не найдены `eval`, `new Function`, `dangerouslySetInnerHTML`, `innerHTML` или прямой `child_process` usage в application paths. Session, admin role, Telegram init data, webhook secret и entitlement ownership проверки остаются важными защитными слоями.

## 6. Приоритетный план

| Priority | Действие | Критерий закрытия |
|---|---|---|
| P0 | Исключить raw download token из всех HTTP/proxy/application logs | Captured production-like logs никогда не содержат token value |
| P0 | Перевести download bytes на signed URL или отдельный bandwidth service | App worker не проксирует большие S3 assets; есть revoke/TTL tests |
| P1 | Устранить raw Redis provider messages в production logs | Redaction tests для Redis/DB/S3/Telegram logger paths |
| P1 | Ввести FTS/trigram search и query plan budget | Staging-size benchmark без full-scan/temp-sort regression |
| P1 | Ограничить concurrent upload scan и memory amplification | Load test под memory limit проходит без OOM |
| P2 | Кэшировать readiness dependency checks | Probe storm не создаёт proportional provider traffic |
| P2 | Уменьшить initial frontend payload и ввести bundle budgets | CI проверяет Brotli/raw budgets на critical routes |

## 7. Ограничения анализа

Измерения выполнены на локальном sandbox с SQLite/local storage и synthetic dataset. Они не заменяют нагрузочный тест PostgreSQL 16, Redis 7, S3-compatible provider и production reverse proxy. Не проверялись реальные Telegram API, TLS handshakes, CDN behavior, multi-instance Redis rate-limit fairness, PostgreSQL lock contention, object-store egress, backup restore и cloud observability. Эти проверки должны быть отдельными staging gates.
