# CLOUD-BOT — отчёт о внесённых улучшениях

**Дата:** 16 августа 2026 года  
**Базовая ревизия:** `0759e25` с ранее применёнными исправлениями.  
**Статус:** изменения внесены в рабочую копию; commit и push в GitHub не выполнялись.

## Исправленные проблемы

| Область | Реализованное изменение | Эффект |
|---|---|---|
| Download security | HTTP logger заменяет `/api/download/<token>` на `/api/download/[redacted]` | Capability tokens больше не попадают в application access logs |
| S3 delivery | Для S3 после entitlement/token claim выдаётся короткоживущий signed URL и выполняется redirect; Node.js больше не проксирует bytes S3-файла | Меньше нагрузки, памяти и bandwidth на application workers |
| Redis logging | Production Redis errors проходят через `safeErrorMeta`; provider message/stack не раскрываются | Единая политика redaction для production error logs |
| Catalog query | License prices предварительно агрегируются в derived table; убран внешний `GROUP BY` и добавлен `NULLS LAST` для price sort | Уменьшен внешний sort/group spill и стабилизирован price ordering |
| Catalog indexes | Добавлены SQLite индексы для `products(status, updated_at)`, `products(status, created_at)` и `license_plans(product_id, price_xtr)`; PostgreSQL migration `004_catalog_sort_indexes` | Более дешёвые status/sort/price paths на растущем каталоге |
| Upload abuse | Multipart limits расширены: `fields=8`, `parts=10`, `fieldSize=16 KiB`, один файл и существующий file-size cap | Снижена поверхность multipart field/metadata abuse |
| Admin validation | Product status теперь allowlisted; добавлены bounds для category, description, stack, URLs, version и changelog | Убрана возможность записывать произвольные status и чрезмерные metadata payloads |
| Regression coverage | Добавлен тест, проверяющий отсутствие raw download token в logs; migration contract обновлён для версии 004 | Критичные исправления защищены автоматическими тестами |

## Проверки после изменений

| Проверка | Результат |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, только существующие warnings без ошибок |
| `npm test` | PASS |
| `npm run test:integration` | PASS |
| `npm run test:production-fixes` | PASS, 12/12 |
| `npm run build` | PASS |
| `npm run security:scan` | PASS |
| `npm run deps:audit` | PASS, 0 vulnerabilities |
| `npm run test:e2e` | PASS, 3/3 |
| `git diff --check` | PASS |

В процессе проверки была обнаружена и исправлена регрессия совместимости с legacy SQLite schema: новые индексы теперь создаются условно после проверки наличия колонок, поэтому старые базы не ломаются при миграции.

## Изменённые файлы

Изменены `server/app.ts`, `server/state.ts`, `server/db.ts`, `tests/core.test.ts`, `tests/postgres-migration.test.ts`, `server/db/postgres-migrations/004_catalog_sort_indexes.sql`, а также ранее изменённые dependency/config/CI файлы.

## Остаточные эксплуатационные задачи

Полный production sign-off всё ещё требует staging-проверок с реальными PostgreSQL, Redis TLS, S3 signed URL behavior, reverse proxy и Telegram Stars. Для upload path по-прежнему используется `multer.memoryStorage`; multipart limits усилены, но полноценное streaming-to-quarantine решение остаётся отдельным крупным улучшением для очень больших файлов и высокой конкурентности. Bearer session в frontend localStorage также остаётся defence-in-depth риском; переход на HttpOnly Secure cookie требует отдельного изменения клиентского auth contract.
