import { Bot } from 'grammy';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../server/config';
import type { DbClient } from '../server/pg-db';
import type { TtlStore } from '../server/state';
import { BOT_COMMANDS, registerBotHandlers, TELEGRAM_ALLOWED_UPDATES } from '../server/telegram';

class TestStore implements TtlStore {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string) { this.values.set(key, value); }
  async del(key: string) { this.values.delete(key); }
  async incrWithTtl(key: string) { const value = Number(this.values.get(key) || 0) + 1; this.values.set(key, String(value)); return value; }
  async close() { this.values.clear(); }
  async healthy() { return true; }
}

function testDb(): DbClient {
  return {
    prepare(sql: string) {
      return {
        async get() {
          if (sql.includes('select id,name from users')) return { id: 1, name: 'Test User' };
          if (sql.includes('select count(*)')) return { n: 2 };
          if (sql.includes('select id from users')) return { id: 1 };
          return undefined;
        },
        async all() { return []; },
        async run() { return { changes: 1 }; },
      };
    },
    async exec() {},
    async transaction(fn) { return fn(this); },
    async close() {},
  };
}

function commandUpdate(id: number, command: string) {
  const text = `/${command}`;
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 42, type: 'private' as const, first_name: 'Test' },
      from: { id: 42, is_bot: false, first_name: 'Test', language_code: 'ru' },
      text,
      entities: [{ offset: 0, length: text.length, type: 'bot_command' as const }],
    },
  };
}

function setup() {
  const bot = new Bot('123:ABC', { botInfo: { id: 123, is_bot: true, first_name: 'Test Bot', username: 'test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: true } as any });
  const calls: Array<{ method: string; payload: any }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const message = { message_id: 999, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: 'private' }, text: (payload as any).text };
    return { ok: true, result: method === 'sendMessage' || method === 'editMessageReplyMarkup' ? message : true } as any;
  });
  const config = { WEBAPP_URL: 'https://example.com', isProduction: false } as AppConfig;
  const store = new TestStore();
  registerBotHandlers(bot, { config, db: testDb(), ttlStore: store });
  return { bot, calls, store };
}

describe('Telegram command contract', () => {
  it('registers the complete production command and update contract', () => {
    expect(BOT_COMMANDS.map(({ command }) => command)).toEqual(['start', 'help', 'profile', 'settings', 'terms', 'support', 'paysupport']);
    expect(TELEGRAM_ALLOWED_UPDATES).toEqual(expect.arrayContaining(['message', 'callback_query', 'inline_query', 'pre_checkout_query']));
  });

  for (const [index, command] of BOT_COMMANDS.map(({ command }) => command).entries()) {
    it(`/${command} invokes a handler and replies`, async () => {
      const { bot, calls } = setup();
      await bot.handleUpdate(commandUpdate(index + 1, command));
      expect(calls.some(({ method }) => method === 'sendMessage')).toBe(true);
    });
  }

  it('unknown commands receive a helpful response', async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(commandUpdate(50, 'unknown'));
    expect(calls.find(({ method }) => method === 'sendMessage')?.payload.text).toContain('/help');
  });

  it('settings callback is acknowledged and message markup is updated', async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate({
      update_id: 60,
      callback_query: {
        id: 'callback-1',
        chat_instance: 'chat-instance',
        from: { id: 42, is_bot: false, first_name: 'Test' },
        data: 'settings:notifications',
        message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: 'private', first_name: 'Test' }, text: 'Настройки профиля:' },
      },
    });
    expect(calls.some(({ method }) => method === 'answerCallbackQuery')).toBe(true);
    expect(calls.some(({ method }) => method === 'editMessageReplyMarkup')).toBe(true);
  });

  it('support flow persists the next text and confirms receipt', async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(commandUpdate(70, 'support'));
    await bot.handleUpdate({
      update_id: 71,
      message: { message_id: 71, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: 'private', first_name: 'Test' }, from: { id: 42, is_bot: false, first_name: 'Test' }, text: 'Заказ 123 не открылся' },
    });
    expect(calls.filter(({ method }) => method === 'sendMessage').at(-1)?.payload.text).toContain('передано поддержке');
  });
});
