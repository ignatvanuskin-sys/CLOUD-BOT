import { Bot, InlineKeyboard, type Context } from 'grammy';
import { nanoid } from 'nanoid';
import type { AppConfig } from './config';
import type { DbClient } from './pg-db';
import type { TtlStore } from './state';
import { safeErrorMeta } from './logging';

export const BOT_COMMANDS = [
  { command: 'start', description: 'Открыть магазин' },
  { command: 'help', description: 'Список команд' },
  { command: 'profile', description: 'Профиль и покупки' },
  { command: 'settings', description: 'Настройки' },
  { command: 'terms', description: 'Условия использования' },
  { command: 'support', description: 'Поддержка' },
  { command: 'paysupport', description: 'Вопросы по платежам' },
] as const;

export const TELEGRAM_ALLOWED_UPDATES = ['message', 'edited_message', 'callback_query', 'inline_query', 'pre_checkout_query'] as const;

function errorDetails(error: unknown, isProduction: boolean) {
  return safeErrorMeta(error, isProduction);
}

function updateContext(ctx: Context) {
  return {
    updateId: ctx.update.update_id,
    updateType: Object.keys(ctx.update).find((key) => key !== 'update_id'),
    command: ctx.message?.text?.match(/^\/([a-z0-9_]+)/i)?.[1]?.toLowerCase(),
  };
}

function webAppUrl(base: string, startParam?: string) {
  const url = new URL(base);
  if (startParam) url.searchParams.set('startapp', startParam);
  return url.toString();
}

export function registerBotHandlers(bot: Bot, deps: { config: AppConfig; db: DbClient; ttlStore: TtlStore }) {
  const { config, db, ttlStore } = deps;

  bot.catch(async (failure) => {
    const details = { ts: new Date().toISOString(), level: 'error', event: 'telegram_handler_failed', ...updateContext(failure.ctx), ...errorDetails(failure.error, config.isProduction) };
    console.error(JSON.stringify(details));
    try { await failure.ctx.reply('Произошла внутренняя ошибка. Попробуйте ещё раз через минуту или используйте /support.'); } catch (replyError) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'telegram_error_reply_failed', ...updateContext(failure.ctx), ...errorDetails(replyError, config.isProduction) }));
    }
  });

  bot.use(async (ctx, next) => {
    const startedAt = Date.now();
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'telegram_update_start', ...updateContext(ctx) }));
    try { await next(); }
    finally { console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'telegram_update_end', durationMs: Date.now() - startedAt, ...updateContext(ctx) })); }
  });

  bot.command('start', async (ctx) => {
    const keyboard = config.WEBAPP_URL ? new InlineKeyboard().webApp('Открыть магазин 🛍️', webAppUrl(config.WEBAPP_URL, String(ctx.match || '') || undefined)) : undefined;
    await ctx.reply('Добро пожаловать! 👋\nОткройте магазин цифровых товаров кнопкой ниже.', keyboard ? { reply_markup: keyboard } : undefined);
  });

  bot.command('help', (ctx) => ctx.reply([
    '/start — открыть магазин',
    '/profile — профиль и покупки',
    '/settings — настройки',
    '/terms — условия использования',
    '/support — обратиться в поддержку',
    '/paysupport — помощь с оплатой',
  ].join('\n')));

  bot.command('terms', (ctx) => ctx.reply('Цифровой товар выдаётся после оплаты Telegram Stars. Перепродажа исходников запрещена. По возвратам используйте /paysupport.'));
  bot.command('paysupport', async (ctx) => {
    await ttlStore.set(`support:${ctx.from?.id}`, 'payment', 600);
    await ctx.reply('Опишите проблему с оплатой и укажите номер заказа. Следующее сообщение будет передано поддержке.');
  });
  bot.command('support', async (ctx) => {
    await ttlStore.set(`support:${ctx.from?.id}`, 'general', 600);
    await ctx.reply('Опишите вопрос одним сообщением. Следующее сообщение будет передано поддержке.');
  });

  bot.command('profile', async (ctx) => {
    const sender = ctx.from;
    if (!sender) return;
    const user = await db.prepare('select id,name from users where telegram_id=?').get(String(sender.id)) as { id: number; name?: string } | undefined;
    if (!user) {
      await ctx.reply('Профиль ещё не создан. Откройте магазин через /start, чтобы войти через Telegram.');
      return;
    }
    const purchases = await db.prepare('select count(*) n from entitlements where user_id=? and active=1').get(user.id) as { n: number };
    const keyboard = config.WEBAPP_URL ? new InlineKeyboard().webApp('Открыть покупки', webAppUrl(config.WEBAPP_URL)) : undefined;
    await ctx.reply(`Профиль: ${user.name || sender.first_name}\nАктивных покупок: ${Number(purchases?.n || 0)}`, keyboard ? { reply_markup: keyboard } : undefined);
  });

  bot.command('settings', async (ctx) => {
    const sender = ctx.from;
    if (!sender) return;
    const current = await ttlStore.get(`notifications:${sender.id}`);
    const enabled = current !== 'off';
    const keyboard = new InlineKeyboard().text(enabled ? '🔔 Уведомления: вкл' : '🔕 Уведомления: выкл', 'settings:notifications');
    await ctx.reply('Настройки профиля:', { reply_markup: keyboard });
  });

  bot.callbackQuery('settings:notifications', async (ctx) => {
    const current = await ttlStore.get(`notifications:${ctx.from.id}`);
    const enabled = current === 'off';
    await ttlStore.set(`notifications:${ctx.from.id}`, enabled ? 'on' : 'off', 365 * 24 * 60 * 60);
    await ctx.answerCallbackQuery({ text: enabled ? 'Уведомления включены' : 'Уведомления выключены' });
    const keyboard = new InlineKeyboard().text(enabled ? '🔔 Уведомления: вкл' : '🔕 Уведомления: выкл', 'settings:notifications');
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  });

  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Эта кнопка больше не поддерживается' });
  });

  bot.on('inline_query', async (ctx) => {
    await ctx.answerInlineQuery([], { cache_time: 10, is_personal: true });
  });

  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply('Неизвестная команда. Используйте /help.');
      return;
    }
    const supportKind = await ttlStore.get(`support:${ctx.from.id}`);
    if (supportKind) {
      await db.prepare('insert into users(telegram_id,name) values(?,?) on conflict(telegram_id) do update set name=excluded.name').run(String(ctx.from.id), [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '));
      const user = await db.prepare('select id from users where telegram_id=?').get(String(ctx.from.id)) as { id: number };
      await db.prepare('insert into support_requests(id,user_id,message,status) values(?,?,?,?)').run(nanoid(), user.id, `[${supportKind}] ${ctx.message.text.slice(0, 4000)}`, 'open');
      await ttlStore.del(`support:${ctx.from.id}`);
      await ctx.reply('Сообщение передано поддержке. Мы ответим вам в Telegram.');
      return;
    }
    await ctx.reply('Я понимаю команды из меню. Используйте /help или /support.');
  });
}
