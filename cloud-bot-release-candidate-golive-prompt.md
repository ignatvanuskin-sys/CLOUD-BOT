# Промпт: CLOUD-BOT Release Candidate и Go-Live

Скопируй этот промпт в AI-кодер, который работает с репозиторием `C:\TGOD\BOT BOT\BOT\CLOUD-BOT`.

---

## Цель этапа

Текущая система — hardened single-server MVP для staging/pre-release. Доведи её до Release Candidate, который можно безопасно подключить к production-инфраструктуре и проверить на staging-боте перед реальными продажами.

Не добавляй новые бизнес-функции ради объёма. Закрой residual risks из последнего отчёта:

- local filesystem storage заменить production-ready S3-compatible adapter;
- in-memory sessions и rate limits заменить внешним TTL-backed хранилищем;
- SQLite вывести из production target и подготовить PostgreSQL;
- реализовать полноценный admin upload с validation, quarantine и secret scan;
- добавить CI pipeline, integration tests и browser/e2e tests;
- проверить реальный Telegram Stars payment/refund на staging;
- добавить backup, restore, migration, rollback и go-live runbooks;
- не заявлять production-ready до прохождения всех acceptance criteria.

Работай с текущим кодом, не переписывай приложение с нуля. Сохрани `createApp()`, текущую auth/payment idempotency, health endpoints, RBAC, audit log, приватную выдачу и существующие тесты.

## Правило работы

Сначала выполни аудит и зафиксируй фактическое состояние. Затем реализуй изменения вертикальными этапами. После каждого этапа запускай проверки. Не подменяй настоящий production adapter mock-ом и не оставляй молчаливый fallback на local/in-memory в production.

Если внешние credentials отсутствуют, создай интерфейс, `.env.example`, локальный adapter и тестовый service container, но явно остановись перед финальным go-live и укажи, какой ручной секрет нужен.

## Production target

Целевой production-профиль:

- PostgreSQL для основной БД;
- Redis-compatible service для сессий, rate limit и коротких locks;
- S3-compatible private bucket для архивов, инструкций, изображений и demo assets;
- один или несколько stateless application instances;
- HTTPS reverse proxy;
- Telegram webhook с secret token;
- отдельные staging и production bots, origins, базы, buckets и secrets;
- CI/CD с блокирующими проверками;
- backup и проверенный restore.

SQLite, local filesystem, in-memory sessions и in-memory rate limit разрешены только в `development`/`test`. Production должен завершать запуск, если включён неподходящий adapter.

## Этап 0. Аудит и контракт

1. Проверь дерево, package scripts, lockfile, `.env.example`, migrations, schema, DB access, storage, auth, webhook, admin, frontend, tests и README.
2. Найди все места, где есть `sqlite`, `fs`, `Map`, `setTimeout` TTL, raw token, публичный asset URL, `NODE_ENV`, `listen`, upload и payment state.
3. Составь таблицу: текущий adapter, production adapter, fallback policy, test adapter.
4. Зафиксируй точные файлы и строки, которые будут изменены.
5. Проверь, что текущие `npm test` и `npm run build` проходят до изменений.
6. Не начинай миграцию данных, пока не создан backup plan и dry-run команда.

## Этап 1. Storage: S3-compatible production adapter

Сделай интерфейс, например:

- `putObject`
- `getObject`
- `deleteObject`
- `createDownloadUrl`
- `headObject`
- `createUploadTarget` или авторизованный upload stream

Требования:

- production adapter поддерживает AWS S3 API или совместимый endpoint;
- bucket private, public ACL запрещён;
- object key генерируется сервером, а не берётся из имени пользователя;
- product/version/asset id не позволяет path traversal;
- signed download URL короткоживущий и создаётся только после entitlement check;
- signed upload URL либо upload stream выдаётся только owner/editor;
- storage credentials не попадают в frontend, URL или обычные логи;
- приложение использует timeout, retry с backoff и понятную ошибку;
- удаление asset не ломает уже опубликованную версию без явного подтверждения;
- checksum и content length фиксируются в БД;
- `Content-Disposition` задаётся сервером;
- можно проверить наличие object через `headObject`;
- local adapter остаётся только для dev/test.

Добавь production env:

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.example.com
S3_REGION=auto
S3_BUCKET=cloud-bot-production
S3_ACCESS_KEY_ID=change-me
S3_SECRET_ACCESS_KEY=change-me
S3_FORCE_PATH_STYLE=false
```

Не коммить реальные значения. Для локального запуска можно использовать MinIO service container или local adapter.

Проверь bucket policy:

- public read отсутствует;
- CORS содержит только нужный app/admin origin;
- lifecycle удаляет abandoned uploads из quarantine;
- versioning включён, если это поддерживает provider;
- server-side encryption включена, если доступна;
- credentials имеют минимально необходимые permissions.

## Этап 2. Admin upload, quarantine и secret scan

Доделай полноценный upload flow, а не просто запись файла в папку:

`request upload → upload quarantine → validate → scan → approve/reject → publish asset`

Для каждого asset добавь или используй статусы:

`pending`, `scanning`, `approved`, `rejected`, `published`, `deleted`.

Проверки до публикации:

- admin authentication и RBAC;
- ограничение размера на HTTP и storage уровне;
- allowlist форматов и MIME;
- проверка magic bytes, а не только расширения;
- безопасное имя и server-generated object key;
- checksum;
- archive bomb/decompression limits;
- zip-slip/path traversal внутри архива;
- symbolic links и неожиданные absolute paths;
- запрет или ручная проверка production `.env`, private keys, bot tokens, cookies и credential dumps;
- secret scan с понятным audit result;
- отсутствие доступа к asset до `approved`/`published`.

Не запрещай законный исходный код только потому, что в нём встречается слово `TOKEN`. Делай scan с правилами, false positive review и явным решением администратора.

Добавь:

- upload progress и безопасные ошибки в admin UI;
- audit events для upload, scan, approve, reject, publish, delete;
- endpoint повторного scan;
- endpoint отмены зависшего quarantine asset;
- cleanup job для abandoned uploads;
- тесты на zip-slip, oversized file, fake extension, leaked secret и valid source archive.

## Этап 3. PostgreSQL production database

Сделай PostgreSQL production target, сохранив SQLite для local/test только если это не усложняет поддержку.

Требования:

- production schema создаётся миграциями;
- migrations versioned, deterministic и не удаляют данные молча;
- PostgreSQL constraints соответствуют текущей бизнес-логике;
- Stars amount хранится в integer-compatible типе без float;
- все timestamps в UTC;
- unique index на `telegram_payment_charge_id`, `webhook update_id`, entitlement/order id и необходимые slugs;
- foreign keys и CHECK constraints сохранены;
- order/payment/entitlement/outbox transaction semantics сохранены;
- конкурентные webhook и checkout не создают двойной доступ;
- migrations используют advisory lock или эквивалент от параллельного запуска;
- приложение не выполняет destructive schema changes при обычном старте.

Добавь env:

```env
DB_DRIVER=postgres
DATABASE_URL=postgresql://user:password@host:5432/cloud_bot
DATABASE_SSL=true
DATABASE_POOL_MAX=10
```

Сделай отдельные команды:

- `db:migrate`
- `db:status`
- `db:rollback` только для безопасных обратимых миграций
- `db:backup` или документированный provider command
- `db:import-sqlite` для одноразового переноса
- `db:verify-import`

Импорт SQLite → PostgreSQL:

1. создать backup исходной SQLite DB;
2. выполнить dry-run без записи;
3. перенести users, products, versions, assets metadata, orders, payments, entitlements, audit entries и webhook dedupe records;
4. сохранить ids или документированное mapping;
5. проверить counts, unique constraints, order totals, entitlement ownership и payment charge ids;
6. не переносить dev sessions, test data и реальные секреты из локальных файлов;
7. иметь rollback plan до переключения production DATABASE_URL.

Если полный перенос сейчас небезопасен, не маскируй это: оставь production запуск заблокированным и укажи конкретную причину.

## Этап 4. Redis для sessions, rate limit и locks

В production убери in-memory state:

- sessions хранятся по hash токена с TTL;
- logout/revoke работает через Redis;
- rate limit атомарный и учитывает user id после auth, IP до auth и endpoint;
- ключи имеют namespace и TTL;
- sensitive endpoint rate limit fail-closed при недоступном Redis;
- harmless read endpoint может иметь документированный fallback, если это безопасно;
- distributed lock используется только там, где он действительно нужен;
- Redis credentials и URL не логируются;
- TLS проверяется в production;
- connection timeout и reconnect policy заданы явно;
- Redis memory policy не удаляет session/rate keys неожиданно до TTL.

Добавь env:

```env
REDIS_URL=rediss://:password@redis.example.com:6380
REDIS_KEY_PREFIX=cloud-bot:production:
REDIS_TLS=true
```

Local/test должны использовать отдельный namespace или отдельный service. Тесты не должны случайно подключаться к production Redis.

## Этап 5. Payment и Telegram staging verification

Не меняй уже работающую серверную проверку Stars без тестов. Добавь staging verification:

- отдельный staging bot token;
- отдельный staging database, storage bucket и Redis namespace;
- отдельный webhook secret;
- staging WEBAPP_URL и exact CORS origin;
- тестовый Stars environment согласно актуальной документации Telegram;
- тестовый товар с минимальной ценой;
- полный сценарий create order → invoice → pre-checkout → successful payment → entitlement → download;
- повторная доставка одного update;
- неверная сумма;
- неверный payload;
- refund через реальный Telegram API environment;
- повторный refund;
- проверка статуса заказа после refund;
- обращение через `/paysupport`.

Не помещай тестовые токены в CI logs. Реальные production secrets вводятся только через secret manager/CI secrets.

Сохрани в README ручной staging checklist и evidence: дата, bot username, order id без секретов, результат payment/refund, ссылка на лог/request id.

## Этап 6. Tests: API, integration, browser

Добавь стабильные тестовые слои:

### Unit

- initData validation;
- state transitions;
- price snapshot;
- payload parser;
- object key/path safety;
- archive validation;
- secret scanner rules;
- signed URL policy.

### Integration

Используй PostgreSQL, Redis и S3-compatible test service containers либо надёжные test doubles с теми же контрактами.

Покрой:

- auth/session create, expiry, revoke;
- rate limit across two app instances;
- migrations from empty DB;
- product publish and asset visibility;
- order/payment/entitlement transaction;
- duplicate `update_id` and duplicate charge;
- outbox retry after storage failure;
- download ownership and expiry;
- upload quarantine and approval;
- admin RBAC and audit log;
- webhook secret;
- health readiness when DB/Redis/storage unavailable.

### Browser/e2e

Добавь Playwright или текущий e2e framework, не подменяя весь Telegram webview production logic:

- mock `Telegram.WebApp` initData only through an explicit test fixture;
- app open;
- catalog and product detail;
- license selection;
- checkout loading/error/success states;
- my purchases;
- download error and retry;
- light/dark theme;
- 360 px viewport and no horizontal overflow;
- BackButton and BottomButton behavior;
- no console errors.

Для e2e payment используй backend test fixture, а не реальный Stars payment. Реальный Stars flow проверяется отдельным staging smoke test.

## Этап 7. CI/CD

Создай или обнови CI workflow под фактический provider. На pull request и push в main должны выполняться:

1. clean checkout;
2. `npm ci`;
3. typecheck;
4. lint;
5. unit tests;
6. integration tests with isolated Postgres/Redis/S3 services;
7. browser/e2e tests;
8. production build;
9. migration dry-run;
10. dependency audit по high/critical;
11. secret scan repository, git diff и build artifacts;
12. upload build/test reports.

CI должен падать при критичной ошибке. Не обходи checks флагами и не скрывай flaky test: исправь или явно изолируй причину.

Добавь deploy stages:

- staging deploy;
- smoke checks health/live и health/ready;
- migration step с lock;
- application deploy;
- post-deploy API smoke;
- manual approval перед production;
- rollback по предыдущему image/build;
- уведомление об успешном или проваленном deploy.

Если проект не использует Docker, не добавляй Docker только ради моды. Но production artifact должен быть воспроизводимым, а Node version и package manager зафиксированы.

## Этап 8. Security и operations

Проверь дополнительно:

- security headers;
- trusted proxy configuration;
- HTTPS redirect на reverse proxy;
- точный CORS;
- webhook secret rotation plan;
- bot token rotation plan;
- secrets только через environment/secret manager;
- backup encryption и retention;
- database least-privilege user;
- S3 least-privilege credentials;
- Redis TLS и least-privilege credentials;
- отсутствие stack trace и raw payment data в ответах;
- dependency vulnerabilities;
- log retention и redaction;
- data deletion/retention policy для Telegram user data;
- `/terms`, `/privacy`, `/support`, `/paysupport` доступны.

Добавь runbooks:

- payment succeeded but delivery failed;
- webhook stuck or replaying;
- storage unavailable;
- Redis unavailable;
- database restore;
- rollback release;
- leaked secret/token;
- refund dispute;
- accidental public bucket policy.

## Этап 9. Performance и smoke load

Без преждевременного overengineering проверь:

- pagination каталога;
- индексы по product slug, status, order user/status, charge id, webhook update id;
- ограничение размера upload;
- lazy loading demo assets;
- connection pools;
- response time для health, catalog, product, create order;
- checkout не блокируется storage delivery;
- два app instance используют одну БД, Redis и storage без расхождений.

Сделай небольшой repeatable smoke load test для read catalog и idempotent webhook. Не называй это полноценным capacity test, если он им не является.

## Go-Live gates

Не объявляй production-ready, пока не выполнено всё ниже:

- production config использует PostgreSQL, Redis и S3-compatible storage;
- SQLite/local/in-memory adapters невозможно случайно включить в production;
- S3 bucket private, upload quarantine и secret scan работают;
- migration и SQLite import проверены на копии данных;
- backup создан и restore реально протестирован;
- sessions и rate limit работают после перезапуска и между двумя app instances;
- CI проходит unit, integration, e2e, build, audit и secret scan;
- staging bot проходит полный Stars payment/refund smoke test;
- duplicate update и duplicate charge не создают второй доступ;
- download чужого и отозванного entitlement невозможен;
- webhook secret, CORS, RBAC и admin audit проверены;
- health/readiness корректно показывают недоступность dependency;
- deploy и rollback выполнены на staging;
- README содержит все внешние настройки и runbooks;
- отсутствуют известные critical/high security issues.

Если отсутствуют credentials или невозможно выполнить реальный staging payment, остановись на `Release Candidate pending external verification`, а не ставь ложный статус ready.

## Команды проверки

Добавь или адаптируй scripts так, чтобы были доступны:

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
```

Команда не должна называться production check, если она проверяет только локальный mock. В README разделяй local, CI, staging и production verification.

## Формат финального отчёта

Верни:

1. Audit до изменений.
2. Архитектурное решение и почему выбраны PostgreSQL/Redis/S3.
3. Полный список изменённых файлов.
4. Новые env variables без секретных значений.
5. Миграции и план переноса SQLite.
6. Storage/upload/scan flow.
7. Payment/refund staging evidence.
8. Тестовые команды и точный результат.
9. CI/CD и rollback описание.
10. Backup/restore verification.
11. Go-Live gates: passed / pending.
12. Остаточные риски и конкретный владелец ручного действия.

Запрещено писать «полностью production ready», если хотя бы один Go-Live gate не пройден. В таком случае честно укажи `pending external verification` и заблокируй опасный переход.
