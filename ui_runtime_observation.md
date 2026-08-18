# UI runtime observation

Local app was opened at `http://127.0.0.1:5173/` after restarting backend with `SEED_DEV_DATA=true`.

Observed page state:

- Title: `Главная — Cloud Bot`.
- Catalog metric changed from `0 доступно сейчас` to `3 доступно сейчас`.
- Visible products: `Запись и бронирование`, `Лиды в CRM`, `AI FAQ поддержка`.
- Visible product types: `Готовый бот`, `Модуль`, `Готовый бот`.
- Prices rendered as `от 299 ⭐`.
- Product card actions have accessible labels such as `Открыть Запись и бронирование`.
- No template product or template label appeared in the rendered content.

The initial empty catalog was caused by the normal development server not loading development fixtures. The runtime now loads fixtures only when `NODE_ENV=development` and `SEED_DEV_DATA` is not `false`; production configuration rejects `SEED_DEV_DATA=true`.
