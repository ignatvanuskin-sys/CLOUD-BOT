# Промпт: довести CLOUD-BOT до production

Скопируй этот промпт целиком в AI-кодер, который видит репозиторий `C:\TGOD\BOT BOT\BOT\CLOUD-BOT`.

---

## Роль и цель

Ты — senior production engineer, security engineer, QA lead и Telegram Mini App engineer. Доведи существующий проект `CLOUD-BOT` до состояния, в котором его можно безопасно запустить на реальных пользователях и реальных платежах.

Не переписывай проект с нуля. Сначала изучи текущую реализацию и сохрани рабочие функции. Текущий отчёт уже подтверждает:

- `npm test` проходит: 3 теста;
- `npm run build` проходит;
- добавлен ESM-режим в `package.json`;
- Telegram `initData` проверяется безопаснее;
- dev-login запрещён в production;
- Stars pre-checkout и `successful_payment` проверяют заказ, `XTR` и сумму;
- payment обработан транзакционно и идемпотентно;
- React BackButton, `key`, ошибки товара и checkout уже исправлены;
- admin create product получил базовую валидацию;
- изменены: `package.json`, `package-lock.json`, `server/index.ts`, `server/schema.ts`, `src/main.tsx`.

Не повторяй эти исправления механически. Проверь их фактическое состояние и усили только то, что нужно для production.

Если текущий стек или БД отличаются от предположений, адаптируй решение под фактический код. Не меняй технологический стек без необходимости.

## Главный принцип

Сначала получи подтверждение целостности, потом меняй код. Перед реализацией:

1. Просмотри дерево проекта, `package.json`, lockfile, `.env.example`, сервер, схему БД, миграции, frontend, бота, тесты и конфигурацию деплоя.
2. Найди все endpoints, обработчики Telegram updates, payment flow, admin routes и места выдачи файлов.
3. Проверь, запускает ли `server/index.ts` сервер сразу при импорте. Если да, отдели создание приложения от `listen`, чтобы API можно было тестировать.
4. Проверь, используется ли отдельная тестовая БД и не может ли тест изменить production-файл.
5. Составь короткий audit report: `critical`, `high`, `medium`, `low`, с файлами и строками.
6. Покажи план изменений и только после этого внедряй их.

Не останавливайся после аудита: если нет блокирующих секретов или внешнего сервиса, реализуй изменения сам, используя безопасные локальные адаптеры и тестовые заглушки.

## Жёсткие ограничения

- Не отключай существующую проверку Telegram `initData`.
- Не возвращай `devTelegramId` или любой dev-login в production-пути.
- Не принимай цену, валюту, product id, license plan или Telegram user id из клиента как источник истины.
- Не выдавай доступ после клиентского callback без подтверждённого Telegram payment update.
- Не делай архивы товаров публичными.
- Не храни токены, Stars secrets, bot token, реальные API keys и production credentials в репозитории, логах, seed или demo-файлах.
- Не добавляй Stripe, криптооплату или внешний checkout для цифровых товаров внутри Telegram Mini App.
- Не ломай существующий frontend, dev-login в тестовом окружении и успешный production build.
- Не добавляй multi-vendor marketplace, внутренний wallet, escrow и сложные подписки в эту итерацию.
- Не используй `any` для обхода типов, не глуши ошибки и не удаляй тесты ради зелёного CI.

## 1. Конфигурация и запуск

Сделай конфигурацию явной и проверяемой при старте:

- добавь schema validation для обязательных env variables;
- production должен завершать запуск с понятной ошибкой, если отсутствуют bot token, Telegram secret, database URL, Mini App origin или storage settings;
- значения для dev/test и production должны быть разделены;
- добавь `.env.example` без секретов и опиши каждую переменную;
- проверь `NODE_ENV` и не полагайся только на отсутствие dev-параметра;
- CORS разрешает только точный production origin Mini App, а не `*`;
- размер JSON/body ограничен;
- неизвестные env variables можно предупредить, но не ломать запуск без причины;
- добавь graceful shutdown: закрытие HTTP server, БД, очереди и webhook resources;
- не запускай два webhook consumer или два migration process случайно.

Добавь безопасные endpoints:

- `GET /health/live` — процесс жив;
- `GET /health/ready` — БД, storage и критичные зависимости доступны;
- не показывай в health response токены, connection strings, stack traces или персональные данные.

## 2. Авторизация Telegram

Проведи полный security review текущей проверки `initData`:

- валидация выполняется на сервере с bot token;
- hash сравнивается constant-time только после проверки длины;
- пустая, битая, просроченная и будущая `auth_date` отклоняются;
- поле user обрабатывается как потенциально битый JSON;
- проверяется возраст данных и защита от replay;
- `initDataUnsafe` не используется для авторизации или прав;
- user id берётся только из проверенного server-side результата;
- данные пользователя нормализуются и сохраняются без лишних персональных полей;
- повторная авторизация не создаёт дубликата пользователя;
- ошибки auth не раскрывают внутреннюю причину атакующему.

Используй текущую модель сессии, если она безопасна. Если Mini App работает через cookie:

- `HttpOnly`, `Secure` в production, подходящий `SameSite`;
- CSRF-защита для state-changing endpoints;
- logout/revocation при необходимости.

Если используется bearer session:

- короткое время жизни;
- ротация и отзыв;
- хранение только хэша токена;
- не передавать секреты в URL.

Dev-login разрешён только в test/local режиме и только при явном флаге вроде `ALLOW_DEV_LOGIN=true`. В production флаг должен принудительно игнорироваться или приводить к ошибке запуска.

## 3. Payment flow Telegram Stars

Сверяйся с актуальными официальными документами Telegram:

- https://core.telegram.org/bots/webapps
- https://core.telegram.org/bots/payments-stars
- https://core.telegram.org/bots/api/
- https://telegram.org/tos/stars

Проверь и доведи flow до следующих гарантий:

1. `POST /api/orders` создаёт pending order только из серверного product и license plan.
2. Цена, валюта, доступность и версия товара фиксируются snapshot-полями заказа.
3. Invoice payload содержит непротиворечивую ссылку на order, без доверия к данным клиента.
4. `pre_checkout_query` проверяет существование заказа, владельца или разрешённый payment context, `pending`, `XTR`, сумму, product, license plan и срок действия заказа.
5. Ответ на pre-checkout выполняется быстро и не ждёт медленную выдачу файла, email, внешнюю аналитику или тяжёлую транзакцию.
6. При любой несостыковке вызывается отказ с безопасным пользовательским сообщением и пишется redacted diagnostic log.
7. `successful_payment` дополнительно проверяет `XTR`, сумму, payload, order id и отсутствие уже обработанного charge.
8. Платёж и entitlement создаются атомарно в транзакции.
9. Повтор того же Telegram update, payload или `telegram_payment_charge_id` безопасен и не создаёт второй entitlement.
10. Сохраняются `telegram_payment_charge_id`, Telegram user id, payload, amount, currency, raw update только в минимально необходимом и безопасном виде.
11. Долгая выдача выполняется после быстрой фиксации оплаты через outbox/retry-механику, а не внутри критичного webhook timeout.
12. Ошибка выдачи видна администратору и может быть повторена без повторной оплаты.

Сделай явную state machine, например:

`pending → paid → fulfilled`

Допустимые дополнительные состояния:

`expired`, `cancelled`, `delivery_failed`, `refund_pending`, `refunded`.

Переходы должны быть ограничены и проверяться сервером. Нельзя вернуть заказ из `refunded` в `paid` обычным API вызовом.

Добавь admin-only endpoint для `refundStarPayment`:

- проверка admin role;
- обязательная причина;
- подтверждение существующего charge id;
- идемпотентность;
- audit log;
- после возврата отозвать будущий доступ к повторной выдаче и обновлениям;
- не притворяться, что уже скачанный архив технически отозван.

Добавь и проверь команды `/paysupport`, `/terms`, `/support`, `/start`, `/help`.

## 4. Webhook hardening

Проверь, что production webhook:

- использует HTTPS;
- проверяет Telegram `secret_token` в заголовке;
- отклоняет запросы с неправильным или отсутствующим secret;
- не полагается на IP allowlist как на единственную защиту;
- корректно обрабатывает неизвестные update types;
- не теряет update при временной ошибке;
- не обрабатывает дубликат повторно;
- имеет ограничение body size;
- не пишет raw update целиком в обычный лог, если там есть PII или платёжные поля;
- имеет метрики по `pre_checkout`, `successful_payment`, delivery failures и latency.

Если текущая библиотека Telegram уже имеет типы update, используй их. Для внешнего webhook handler добавь отдельный service layer, чтобы его можно было тестировать без реального Telegram.

## 5. База данных и целостность

Сначала изучи фактическую БД и не удаляй рабочие данные.

Сделай миграции, а не ручное пересоздание production schema. Проверь:

- индексы для Telegram user id, order status, product slug, payment charge id и entitlements owner;
- unique constraints для product slug, payment charge id и `entitlements.order_id`;
- foreign keys или эквивалентную проверку ссылочной целостности;
- NOT NULL и CHECK constraints там, где это возможно;
- decimal/integer тип для Stars amount без float;
- timestamps в UTC;
- version number для товара;
- soft archive товара вместо удаления купленного товара;
- transaction boundaries для payment + entitlement + outbox;
- безопасное поведение при конкурентных checkout и webhook запросах;
- индексы не добавлены без объяснения и проверки плана запросов.

Если текущая schema использует SQLite, проверь WAL, busy timeout, миграции и ограничения concurrent writes. Если используется другая БД, адаптируй рекомендации.

Добавь безопасный seed только для dev/test. Production seed не должен создавать фальшивые покупки, admin accounts или реальные секреты.

## 6. Выдача шаблонов и storage

Замени demo text выдачу на production-ready storage abstraction.

Требования:

- S3-compatible adapter или фактический storage проекта;
- локальный filesystem adapter только для dev/test;
- файлы не лежат в публичной web directory;
- entitlement ownership проверяется на сервере на каждый download;
- asset привязан к product version;
- ссылка короткоживущая и подписанная либо файл отдаётся авторизованным stream endpoint;
- срок ссылки и имя файла не берутся из клиента;
- защита от path traversal и подмены object key;
- ограничение размера и разрешённых типов загрузки;
- корректный `Content-Disposition`;
- download event записывается без секретов;
- повторная выдача разрешена владельцу активного entitlement;
- отозванный entitlement не получает новый download;
- ошибки storage не раскрывают bucket, credentials или внутренний путь.

Добавь upload validation для админки:

- auth и RBAC;
- размер;
- MIME и расширение;
- безопасное имя;
- checksum;
- запрет реальных `.env`, private key, token dumps и production config;
- желательно secret scan для архивов до публикации.

Не добавляй в тестовый seed реальные ZIP-файлы с секретами.

## 7. Admin security

Найди фактический способ защиты admin endpoints. Если доступ определяется query parameter, frontend-only флагом, username без Telegram auth или скрытым URL — замени это.

Минимум:

- verified Telegram identity;
- admin user/role в БД или безопасном конфиге;
- server-side authorization на каждом admin endpoint;
- роли `owner`, `editor`, `support`;
- owner-only для refund, secrets, admin management и destructive actions;
- audit log: кто, что, когда, какой объект, результат;
- rate limit на login и чувствительные действия;
- подтверждение для refund, archive и массовой выдачи;
- не показывать stack trace в UI.

Добавь валидацию payload для всех admin endpoints, не только для create product. Для каждого поля определи тип, длину, enum, диапазон, URL policy и нормализацию.

## 8. API и ошибки

Проведи ревизию всех API routes:

- единый формат ошибок с `code`, безопасным `message` и request id;
- корректные HTTP status codes;
- schema validation request body, params и query;
- pagination с limit cap;
- сортировка и фильтры allowlist-based;
- отсутствие N+1 запросов;
- сервер возвращает только необходимые поля;
- 404 не различает существование чужого приватного entitlement и отсутствие ресурса, если это раскрывает данные;
- request id проходит через лог и ответ;
- не возвращать stack trace клиенту.

Добавь rate limit минимум на:

- Telegram auth;
- create order;
- invoice creation;
- download;
- admin routes;
- support/refund actions;
- webhook по secret и разумному burst, не ломая legitimate retries.

Rate limit должен учитывать user id после auth, IP до auth и endpoint. Храни состояние в подходящем для production backend; для одного процесса допустим адаптер, но явно обозначь ограничение при нескольких инстансах.

## 9. Frontend production review

Проверь существующий React-клиент и доведи его до production UX:

- loading, empty, error, retry и success states для каждого API сценария;
- пользователь не может нажать Buy дважды;
- после checkout error busy state гарантированно сбрасывается;
- BackButton снимает ровно тот callback, который был добавлен;
- товар не найден даёт полезный fallback в каталог;
- license plan обязателен до покупки;
- нет React warnings в console;
- все `.map()` имеют стабильные keys;
- нет утечек event listeners и timers;
- Telegram theme params применяются в light/dark;
- safe area не перекрывает BottomButton;
- доступность: labels, focus, contrast, readable error messages;
- demo/image lazy loading и ограничение веса;
- mobile viewport 360–430 px без горизонтального overflow;
- не показывать внутренние ошибки backend и payment payload;
- после успешной покупки UI сразу отражает entitlement, но источником истины остаётся server refresh.

Проверь build size и убери только действительно неиспользуемые зависимости. Не добавляй оптимизации ради метрик без измерения.

## 10. Наблюдаемость и поддержка

Добавь production-friendly structured logging:

- timestamp UTC;
- level;
- event name;
- request id;
- route;
- duration;
- order id/product id без платёжных секретов;
- user id только если политика хранения это допускает;
- redaction для token, initData, authorization, cookies и signed URL.

Ошибки должны быть наблюдаемыми:

- payment pre-checkout mismatch;
- duplicate payment;
- unknown payload;
- delivery failure;
- storage timeout;
- refund failure;
- admin authorization failure;
- initData validation failure.

Сделай понятные сообщения поддержки: заказ, статус, время, следующий шаг. Не отправляй пользователю stack trace.

Если подключаешь Sentry/OpenTelemetry/Prometheus, сделай интеграцию опциональной через env. Не отправляй PII внешнему сервису без явной конфигурации.

## 11. Тесты

Не ограничивайся текущими 3 unit tests. Добавь тесты на реальный риск:

### Auth

- valid initData;
- empty initData;
- изменённый hash;
- hash с другой длиной;
- битый user JSON;
- auth_date в будущем;
- просроченный auth_date;
- dev-login доступен в test/local и недоступен в production.

### Orders

- нельзя создать заказ на отсутствующий товар;
- нельзя выбрать отсутствующий или архивный license plan;
- цена snapshot фиксируется сервером;
- клиентская подмена цены не проходит;
- два параллельных checkout не ломают state.

### Payments

- pre-checkout с неверной валютой отклоняется;
- неверная сумма отклоняется;
- неизвестный order отклоняется;
- неверный payload отклоняется;
- successful payment выдаёт entitlement только один раз;
- повторный update идемпотентен;
- duplicate charge не создаёт второй доступ;
- delivery failure можно повторить без повторной оплаты;
- refund доступен только owner/support policy и корректно меняет state.

### Delivery

- чужой entitlement не скачивается;
- истёкшая signed URL не работает;
- path traversal не работает;
- отозванный entitlement не получает новую ссылку;
- storage failure возвращает безопасную ошибку и пишет event.

### Admin/API

- не-admin не вызывает admin route;
- schema validation отвергает пустые и слишком длинные поля;
- rate limit срабатывает;
- CORS не разрешает посторонний origin;
- webhook без правильного secret отклоняется.

### Frontend

- production build;
- smoke test главного сценария;
- error/empty states;
- no console warnings;
- theme and mobile viewport.

Используй отдельную test DB/транзакции/fixtures. Тесты не должны зависеть от сети Telegram и реального Stars balance.

## 12. CI/CD и релиз

Добавь или приведи в порядок CI pipeline в соответствии с текущим хостингом:

1. чистая установка зависимостей через lockfile;
2. typecheck;
3. lint, если он есть или разумно добавить;
4. unit tests;
5. integration/API tests;
6. production build;
7. проверка миграций на чистой test DB;
8. dependency audit с фокусом на high/critical;
9. проверка, что секреты не попали в diff или build artifact.

Подготовь:

- `.env.example`;
- README с локальным запуском;
- Telegram BotFather setup;
- Mini App origin и menu button;
- webhook setup и secret token;
- Stars test environment;
- storage setup;
- migrations и rollback guidance;
- health/readiness checks;
- backup/restore strategy;
- deploy checklist;
- incident rollback plan.

Production migration не должна удалять данные без явного migration step и backup recommendation. Не запускать destructive seed при деплое.

## 13. Ручной pre-release checklist

Перед финальным отчётом проверь:

- новый пользователь открывает Mini App через bot menu;
- deep link из канала открывает правильный товар;
- unknown deep link ведёт в каталог с объяснением;
- товар нельзя купить по устаревшей цене;
- тестовый Stars payment проходит через весь lifecycle;
- повторный Telegram update безопасен;
- entitlement появляется после successful payment;
- скачивание доступно только покупателю;
- повторная выдача работает;
- refund path записывает audit event;
- `/terms`, `/support`, `/paysupport` доступны;
- production не принимает dev-login;
- webhook с неправильным secret получает отказ;
- health endpoints не раскрывают секреты;
- admin доступ не определяется frontend-only логикой;
- `npm test` проходит;
- integration tests проходят;
- production build проходит;
- нет новых warnings/error logs.

## Acceptance criteria

Работу можно считать завершённой только когда:

- production app можно запустить по README на чистой машине;
- все критичные платежные и download сценарии покрыты тестами;
- нет известного способа получить товар без entitlement;
- нет известного способа повторно зачесть payment update;
- нет dev-login или permissive CORS в production;
- файлы не публичны и не содержат секретов;
- admin actions защищены и аудируются;
- webhook защищён и устойчив к retry;
- ошибки диагностируются по request id/order id без утечки секретов;
- миграции обратимы или имеют документированный rollback;
- `npm test`, integration tests, typecheck и build проходят.

## Формат финального ответа

После реализации верни:

1. Что проверено.
2. Какие файлы изменены.
3. Какие production риски закрыты.
4. Какие миграции добавлены.
5. Какие env variables нужны.
6. Какие команды проверки запущены и их результат.
7. Какие внешние настройки Telegram и storage нужно выполнить вручную.
8. Что осталось за пределами этой итерации.
9. Любые residual risks, которые нельзя скрывать.

Не пиши «production ready», если хотя бы один Acceptance criterion не выполнен. В таком случае укажи точный блокер и безопасное состояние текущей системы.
