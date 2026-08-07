# CLOUD-BOT: финальные блокеры и промпт закрытия

Текущий статус: **Release Candidate pending external verification**.

Главное: кодовая часть уже близка к staging, но внешние сервисы и реальные Telegram-сценарии ещё не доказаны. Не переводите приложение в production-продажи, пока не пройдены пункты ниже.

## Что должен сделать владелец проекта

Эти действия нельзя достоверно выполнить только AI-кодером, потому что они требуют доступа к вашим аккаунтам, домену и платежному окружению.

### 1. Создать отдельное staging-окружение

Используйте отдельные staging-ресурсы, не production:

- отдельный Telegram-бот для staging;
- отдельный HTTPS-домен, например `staging.example.com`;
- отдельная PostgreSQL database;
- отдельный Redis namespace или instance;
- отдельный private S3-compatible bucket;
- отдельные CI/CD secrets.

Не отправляйте bot token, database URL, Redis URL или S3 secret в чат, issue, README или обычный лог. Вносите их в secret manager хостинга и GitHub Actions Secrets.

### 2. Подготовить Telegram staging bot

Через `@BotFather`:

1. Создайте отдельного staging-бота.
2. Настройте username и Mini App URL на staging HTTPS-домен.
3. Настройте Menu Button/Main Mini App.
4. Подготовьте `WEBHOOK_SECRET` длиной минимум 16–32 случайных символа.
5. После staging deploy установите webhook на `/api/webhooks/telegram` с этим secret.
6. Проверьте `/start`, `/help`, `/terms`, `/support`, `/paysupport`.

Не используйте production bot token для тестов и не вставляйте токен в frontend.

### 3. Создать внешние сервисы

Подойдёт любой managed provider. Важно не название провайдера, а свойства:

- PostgreSQL: TLS, backup/PITR, отдельная staging database;
- Redis: TLS, TTL, отдельный namespace, доступ только от приложения;
- S3-compatible storage: private bucket, no public read, ограниченные credentials, encryption и lifecycle для quarantine;
- хостинг: HTTPS, secret manager, health checks, logs, restart policy.

Примеры совместимых вариантов: managed PostgreSQL, Redis Cloud/Upstash, AWS S3/Cloudflare R2/MinIO-compatible storage. Выберите один вариант и зафиксируйте его в `docs/runbooks/go-live.md`.

### 4. Добавить secrets в staging

Внесите значения только в hosting/CI secret manager:

```env
NODE_ENV=production
BOT_TOKEN=<staging bot token>
BOT_USERNAME=<staging bot username>
WEBAPP_URL=https://staging.example.com
CORS_ORIGIN=https://staging.example.com
WEBHOOK_SECRET=<staging webhook secret>
DB_DRIVER=postgres
DATABASE_URL=<staging postgres url>
DATABASE_SSL=true
REDIS_URL=<staging redis url>
REDIS_KEY_PREFIX=cloud-bot:staging:
REDIS_TLS=true
STORAGE_DRIVER=s3
S3_ENDPOINT=<provider endpoint>
S3_REGION=<region>
S3_BUCKET=<staging private bucket>
S3_ACCESS_KEY_ID=<staging key>
S3_SECRET_ACCESS_KEY=<staging secret>
S3_FORCE_PATH_STYLE=false
ALLOW_DEV_LOGIN=false
ADMIN_TELEGRAM_IDS=<your telegram id>
```

### 5. После deploy выполнить smoke-проверку

Проверьте в браузере:

- `https://staging.example.com/health/live` возвращает успешный ответ;
- `https://staging.example.com/health/ready` подтверждает DB, Redis и storage;
- Mini App открывается из staging-бота;
- staging deep link открывает нужный товар;
- нет ошибок в UI и server logs.

### 6. Провести реальный staging payment/refund

В staging:

1. Создайте тестовый товар с небольшой ценой в Telegram Stars.
2. Загрузите архив через admin upload.
3. Убедитесь, что он прошёл quarantine, scan и explicit publish.
4. Купите товар тестовым Telegram-аккаунтом.
5. Убедитесь, что entitlement появился только после `successful_payment`.
6. Откройте и скачайте файл.
7. Повторите webhook/update и убедитесь, что второй entitlement не создан.
8. Выполните refund через admin endpoint.
9. Убедитесь, что refund записан, audit log создан, повторная выдача запрещена согласно policy.
10. Проверьте `/paysupport`.

Сохраните только безопасное evidence: дата, staging bot username, order id, статус и request id. Не сохраняйте токены, raw initData, платёжные секреты и signed URLs.

### 7. Проверить backup/restore

На staging-копии:

1. Создайте backup PostgreSQL.
2. Проверьте его размер и checksum.
3. Разверните backup в отдельную пустую БД.
4. Запустите `db:verify-import` или эквивалентную проверку.
5. Сверьте users, products, orders, payments, entitlements, assets и webhook dedupe records.
6. Проверьте запуск приложения на восстановленной БД.
7. Зафиксируйте время восстановления и результат.

### 8. Что не нужно делать владельцу

- Не исправляйте самостоятельно серверный код поверх работы AI-кодера без фиксации в репозитории.
- Не вставляйте секреты в промпт или чат.
- Не переключайте production bot на staging URL.
- Не запускайте migration на production до backup и dry-run.
- Не объявляйте запуск успешным только потому, что `npm test` зелёный.

---

# Промпт для AI-кодера

Скопируй текст ниже в AI-кодер с доступом к `C:\TGOD\BOT BOT\BOT\CLOUD-BOT`.

## Роль

Ты — release engineer, security engineer, QA lead и Telegram Mini App engineer. Твоя задача — закрыть последние production blockers в существующем CLOUD-BOT и довести его до проверенного staging Release Candidate.

Текущий проект уже имеет:

- `createApp()` без автозапуска;
- config validation;
- Telegram initData validation;
- Stars payment validation и entitlement idempotency;
- webhook secret и `update_id` dedupe;
- private local storage abstraction;
- RBAC и audit log;
- health endpoints;
- PostgreSQL schema draft;
- S3/Redis production adapters;
- CI workflow draft;
- unit/integration smoke tests;
- Playwright config;
- runbooks.

Не переписывай проект и не дублируй уже выполненные исправления. Сначала проверь фактический код и тесты. Твоя задача — доказать работоспособность production adapters и реальных staging-сценариев.

## Запреты

- Не проси пользователя прислать секреты в чат.
- Не коммить и не печатай секреты в логах.
- Не используй production credentials для staging.
- Не оставляй silent fallback local/in-memory при `NODE_ENV=production`.
- Не называй `test:integration` интеграционным, если он запускает тот же unit test файл без PostgreSQL/Redis/S3 service.
- Не называй e2e пройденным, если браузеры Playwright не установлены и тест реально не запущен.
- Не заявляй production-ready без external verification.
- Не ломай текущие payment checks, RBAC, audit, health endpoints и working tests.

## Этап 1. Проверить локальные блокеры

1. Запусти до изменений:

```bash
npm run security:scan
npm run deps:audit
npm run typecheck
npm run lint
npm test
npm run build
```

2. Убери warning про unused `_key` в `server/storage.ts`, если он действительно не используется.
3. Проверь, что README и `.env.example` не содержат credential-like placeholders, которые ловит secret scanner.
4. Проверь package scripts и добавь отсутствующие scripts без подмены настоящих проверок.
5. Покажи список локальных и внешних blockers.

## Этап 2. Настоящие integration tests

Раздели тесты физически:

- `tests/unit/` — чистые функции и state transitions;
- `tests/integration/` — реальная БД, Redis и S3-compatible test service;
- `tests/e2e/` — Playwright Mini App.

Проверь, что `npm run test:integration` не указывает на `tests/core.test.ts` как на единственный suite.

В CI подними изолированные services:

- PostgreSQL;
- Redis;
- MinIO или другой S3-compatible test service.

Integration tests должны реально подключаться к этим services и покрывать:

- migrations на пустой PostgreSQL;
- products, orders, payments, entitlements и audit log;
- unique charge id и webhook update id;
- concurrent duplicate payment update;
- session TTL и revoke;
- rate limit;
- S3 upload, head, signed download и private access;
- delivery ownership;
- upload quarantine/approve/reject;
- readiness failure при недоступной зависимости;
- два app instances с общей PostgreSQL/Redis/S3 истиной.

Тесты не должны подключаться к staging или production endpoint.

## Этап 3. Playwright и frontend gate

Сделай рабочий e2e pipeline:

- в CI установи Playwright Chromium;
- в Windows README укажи `npx playwright install chromium`;
- в Linux CI используй подходящую установку browser dependencies;
- не подменяй e2e обычным HTTP smoke test.

Покрой:

- запуск Mini App через test Telegram WebApp fixture;
- каталог и карточку товара;
- выбор license plan;
- checkout loading/error/success;
- My Purchases;
- download error/retry;
- BackButton и BottomButton;
- light/dark theme;
- 360 px viewport;
- отсутствие horizontal overflow;
- отсутствие console errors.

Если тест невозможно запустить локально, настрой CI и честно обозначь `pending CI run`.

## Этап 4. CI workflow

Проверь `.github/workflows/ci.yml` и исправь его так, чтобы workflow реально запускался:

1. `npm ci`;
2. typecheck;
3. lint;
4. unit tests;
5. integration tests against services;
6. Playwright install и e2e;
7. build;
8. migrations;
9. security scan;
10. dependency audit;
11. artifact upload для logs, screenshots и reports.

CI должен падать при failing test, migration error, high/critical vulnerability или secret scan finding. Не скрывай ошибку через `|| true`.

После изменения workflow:

- проверь YAML syntax;
- сделай локальный максимально близкий запуск;
- запроси/зафиксируй remote CI run;
- не объявляй CI gate passed до фактического зелёного run.

## Этап 5. Проверить production adapters

### PostgreSQL

- `DB_DRIVER=postgres` обязателен в production;
- migrations versioned и не запускаются параллельно;
- есть dry-run и status;
- SQLite import не меняет исходный backup;
- verify-import сверяет counts и constraints;
- test restore запускает приложение на restored DB.

### Redis

- session state не теряется при рестарте одного instance;
- rate limit виден двум app instances;
- TTL реально истекает;
- `REDIS_TLS=true` проверяется в production;
- production не использует Memory adapter;
- fail behavior для auth/admin безопасен.

### S3

- production не использует local storage;
- bucket private;
- upload идёт через quarantine;
- asset не виден до publish;
- signed URL короткоживущий;
- чужой entitlement не получает URL;
- object key не берётся напрямую из user input;
- storage errors не показывают credentials или bucket internals.

## Этап 6. Admin upload security

Проверь полный flow:

`upload → quarantine → size/MIME/magic bytes → archive safety → secret scan → approve → publish`.

Добавь/исправь:

- maximum upload size на HTTP и storage;
- zip-slip и absolute path protection;
- archive bomb/decompression limit;
- symlink handling;
- checksum;
- secret scan для `.env`, PEM/private key, cookies, bot token patterns;
- безопасные false-positive review;
- audit log для каждого решения;
- cleanup abandoned quarantine;
- повторный scan;
- reject asset нельзя скачать;
- rejected asset нельзя случайно publish обычным user route.

Не отклоняй легитимный исходный код только по одному совпадению строки. Результат scan должен быть объяснимым.

## Этап 7. Staging runbook

Создай или обнови `docs/runbooks/staging-verification.md` с точными шагами, но без секретов:

- создать staging bot;
- указать Mini App URL;
- создать staging PostgreSQL/Redis/S3;
- добавить secret variables в secret manager;
- deploy;
- migrate;
- health check;
- set Telegram webhook;
- create product;
- upload/scan/publish;
- test deep link;
- payment;
- successful payment;
- delivery;
- duplicate update;
- refund;
- support;
- backup/restore.

Добавь в runbook поля evidence: timestamp, environment, bot username, order id, request id, status. Запрети записывать токены и raw initData.

## Этап 8. Go-Live decision

Сформируй таблицу:

| Gate | Evidence | Status | Owner |
|---|---|---|---|

Минимальные gates:

- remote CI green;
- integration tests с реальными services;
- Playwright e2e green;
- S3 private policy manually verified;
- Postgres migration/import/restore verified;
- Redis two-instance test verified;
- staging Stars payment verified;
- staging Stars refund verified;
- duplicate update/charge verified;
- download ownership verified;
- backup/restore verified;
- deploy/rollback staging verified;
- no critical/high security issues.

Финальные статусы используй только такие:

- `passed` — есть evidence;
- `pending external verification` — нужен ручной доступ/сервис;
- `blocked` — есть ошибка, которую нельзя обходить;
- `not applicable` — с объяснением.

## Финальный ответ

Верни:

1. Что проверено до изменений.
2. Какие локальные blockers исправлены.
3. Какие внешние blockers остаются.
4. Какие файлы изменены.
5. Какие команды реально запущены.
6. Remote CI run status.
7. Playwright result.
8. Integration services result.
9. Staging payment/refund evidence.
10. Backup/restore evidence.
11. Таблицу Go-Live gates.
12. Чёткую инструкцию владельцу проекта: что сделать вручную и в каком порядке.

Если хотя бы один критический пункт не проверен, итог должен быть `Release Candidate pending external verification`, а не `production-ready`.
