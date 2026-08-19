import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import { Bot } from 'grammy';
import { nanoid } from 'nanoid';
import { db } from './db';
import { loadConfig } from './config';
import { parseStartParam, validateTelegramInitData } from './schema';
import { createAssetKey, hashToken, readAsset, storage } from './storage';
import { validateBody, FavoriteBodySchema, OrderBodySchema, AdminProductBodySchema, RefundBodySchema, ReconcileBodySchema } from './validation';
import { scanArchiveBuffer } from './scanner';
import { createTtlStore, type TtlStore } from './state';
import { BOT_COMMANDS, registerBotHandlers, TELEGRAM_ALLOWED_UPDATES } from './telegram';
import { safeErrorMeta } from './logging';

const runtimeStores = new Set<TtlStore>();
export async function closeRuntimeResources() {
  await Promise.allSettled([...runtimeStores].map((store) => store.close()));
  runtimeStores.clear();
}

function errorMeta(error: unknown, diagnosticId?: string) {
  return safeErrorMeta(error, loadConfig().isProduction, diagnosticId);
}

export function createApp() {
  const config = loadConfig();
  const app = express();
  const ttlStore = createTtlStore(config);
  runtimeStores.add(ttlStore);
  const bot = config.BOT_TOKEN && config.BOT_TOKEN !== 'TEST_TOKEN' ? new Bot(config.BOT_TOKEN) : null;
  let botStatus: 'disabled' | 'initializing' | 'ready' | 'failed' = bot ? 'initializing' : 'disabled';

  if (bot) registerBotHandlers(bot, { config, db, ttlStore });
  const botReady = bot ? (async () => {
    try {
      await bot.init();
      const commandScopes = [{ type: 'default' } as const, { type: 'all_private_chats' } as const];
      for (const scope of commandScopes) {
        await bot.api.setMyCommands([...BOT_COMMANDS], { scope });
        await bot.api.setMyCommands([...BOT_COMMANDS], { scope, language_code: 'ru' });
        await bot.api.setMyCommands([...BOT_COMMANDS], { scope, language_code: 'en' });
      }
      if (!config.WEBAPP_URL) throw new Error('WEBAPP_URL is required for webhook mode');
      const webhookUrl = new URL('/api/webhooks/telegram', config.WEBAPP_URL).toString();
      await bot.api.setWebhook(webhookUrl, {
        secret_token: config.WEBHOOK_SECRET,
        allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
        drop_pending_updates: false,
      });
      const webhook = await bot.api.getWebhookInfo();
      if (webhook.url !== webhookUrl) throw new Error(`webhook_url_mismatch:${webhook.url}`);
      botStatus = 'ready';
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'telegram_bot_ready', webhookUrl, pendingUpdates: webhook.pending_update_count, allowedUpdates: webhook.allowed_updates }));
    } catch (error) {
      botStatus = 'failed';
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'telegram_bot_init_failed', ...errorMeta(error) }));
    }
  })() : Promise.resolve();

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } });
  app.set('trust proxy', 1);
  app.use((req, res, next) => { res.locals.requestId = nanoid(10); res.setHeader('x-request-id', res.locals.requestId); next(); });
  app.use(helmet({ contentSecurityPolicy: { directives: { scriptSrc: ["'self'", 'https://telegram.org'], connectSrc: ["'self'", 'https://telegram.org'] } } }));
  app.use(cors({ origin: (origin, cb) => {
    if (!origin || !config.isProduction) return cb(null, true);
    const allowed = new Set<string>();
    if (config.allowedOrigin) allowed.add(config.allowedOrigin.replace(/\/$/, ''));
    for (const o of ['https://t.me', 'https://web.telegram.org', 'https://telegram.org']) allowed.add(o);
    return allowed.has(origin.replace(/\/$/, '')) ? cb(null, true) : cb(new Error('cors_denied'));
  }, credentials: false }));
  app.use(express.json({ limit: '128kb' }));
  app.use((req, res, next) => { req.setTimeout(30_000); res.setTimeout(30_000); next(); });

  const distDir = path.resolve('dist');
  app.use('/assets', express.static(path.join(distDir, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(distDir, { maxAge: '1h' }));
  app.use((req, res, next) => {
    const startedAt = Date.now();
    let logged = false;
    const writeLog = (event: string) => {
      if (logged) return;
      logged = true;
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt, requestId: res.locals.requestId }));
    };
    res.on('finish', () => writeLog('http_request_end'));
    res.on('close', () => writeLog('http_request_aborted'));
    next();
  });

  function log(level: string, event: string, meta: Record<string, unknown> = {}) { console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...meta })); }
  function safeError(res: any, status: number, code: string, message = 'Ошибка запроса') { return res.status(status).json({ error: { code, message, requestId: res.locals.requestId } }); }
  function rateLimiter(limit: number, scope: string) { return async (req: any, res: any, next: any) => {
    try {
      const count = await ttlStore.incrWithTtl(`rl:${scope}:${req.userId || req.ip}`, 60);
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)));
      res.setHeader('RateLimit-Reset', '60');
      if (count > limit) { res.setHeader('Retry-After', '60'); return safeError(res, 429, 'rate_limited', 'Слишком много запросов'); }
      next();
    } catch (error) { log('error', 'rate_limit_failed', { requestId: res.locals.requestId, ...errorMeta(error, res.locals.requestId) }); return safeError(res, 503, 'rate_limit_unavailable', 'Сервис временно недоступен'); }
  }; }
  const limiter = rateLimiter(80, 'api');
  const catalogLimiter = rateLimiter(120, 'catalog');
  const meLimiter = rateLimiter(120, 'me');
  async function user(req: any, res: any, next: any) {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) return safeError(res, 401, 'auth_required', 'Требуется вход через Telegram');
    const raw = await ttlStore.get(`session:${hashToken(token)}`);
    if (!raw) return safeError(res, 401, 'auth_required', 'Требуется вход через Telegram');
    req.sessionToken = token; req.userId = JSON.parse(raw).userId; next();
  }
  function adminRole(roles: string[]) { return async (req: any, res: any, next: any) => {
    const u = await db.prepare('select telegram_id from users where id=?').get(req.userId) as any;
    const a = u ? await db.prepare('select role from admin_users where telegram_id=?').get(u.telegram_id) as any : null;
    if (!a || !roles.includes(a.role)) { if (req.userId) await audit(req.userId, 'admin_denied', 'route', req.path, 'denied'); return safeError(res, 403, 'admin_required', 'Недостаточно прав'); }
    req.adminRole = a.role; next();
  }; }
  async function audit(actor: number | null, action: string, objectType?: string, objectId?: string, result = 'ok', meta?: any, client = db) { await client.prepare('insert into audit_log(id,actor_user_id,action,object_type,object_id,result,meta) values(?,?,?,?,?,?,?)').run(nanoid(), actor, action, objectType || null, objectId || null, result, meta ? JSON.stringify(meta) : null); }
  async function event(userId: number, eventName: string, productId?: string, meta?: any) { await db.prepare('insert into analytics(user_id,event,product_id,meta) values(?,?,?,?)').run(userId, eventName, productId || null, meta ? JSON.stringify(meta) : null); }

  app.get('/health/live', (_req, res) => res.json({ ok: true }));
  app.get('/health/ready', async (_req, res) => {
    try {
      await db.prepare(config.isProduction ? "select version from schema_migrations where version='001_initial'" : 'select 1').get();
      const [storeOk, storageOk] = await Promise.all([ttlStore.healthy(), storage.healthy()]);
      const telegramOk = !config.isProduction || botStatus === 'ready';
      const ok = storeOk && storageOk && telegramOk;
      res.status(ok ? 200 : 503).json({ ok, db: 'ok', store: storeOk ? 'ok' : 'unavailable', storage: storageOk ? 'ok' : 'unavailable', telegram: telegramOk ? 'ok' : botStatus });
    } catch (error) { log('error', 'readiness_failed', errorMeta(error)); res.status(503).json({ ok: false, db: 'unavailable' }); }
  });

  app.post('/api/auth/telegram', limiter, async (req, res) => {
    let auth: any;
    try {
      if (!config.isProduction && config.ALLOW_DEV_LOGIN === 'true' && req.body.devTelegramId) auth = { telegramId: String(req.body.devTelegramId), user: { first_name: 'Dev' } };
      else auth = validateTelegramInitData(req.body.initData, config.BOT_TOKEN || 'TEST_TOKEN');
    } catch (error) { log('warn', 'telegram_auth_rejected', { requestId: res.locals.requestId, ...errorMeta(error) }); return safeError(res, 401, 'telegram_auth_failed', 'Не удалось подтвердить вход через Telegram'); }
    const info = auth.user;
    const row = await db.prepare('insert into users(telegram_id,name) values(?,?) on conflict(telegram_id) do update set name=excluded.name returning id').get(auth.telegramId, [info.first_name, info.last_name].filter(Boolean).join(' ')) as any;
    const token = nanoid(48);
    await ttlStore.set(`session:${hashToken(token)}`, JSON.stringify({ userId: row.id }), config.SESSION_TTL_SECONDS);
    await event(row.id, 'app_open');
    res.json({ token, expiresIn: config.SESSION_TTL_SECONDS, user: { id: row.id, name: info.first_name || 'Telegram user' } });
  });

  app.get('/api/me', user, meLimiter, async (req: any, res) => res.json({ user: await db.prepare('select id,name from users where id=?').get(req.userId) }));
  app.get('/api/me/access', user, meLimiter, async (req: any, res) => {
    const current = await db.prepare('select telegram_id from users where id=?').get(req.userId) as any;
    const admin = current ? await db.prepare('select role from admin_users where telegram_id=?').get(current.telegram_id) as any : null;
    res.json({ role: admin?.role || null, canCreateProjects: ['owner', 'editor'].includes(admin?.role), canPublishProjects: ['owner', 'editor'].includes(admin?.role) });
  });
  app.get('/api/products', catalogLimiter, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 50); const offset = Math.max(Number(req.query.offset || 0), 0);
    const sort = ['popular', 'new', 'price'].includes(String(req.query.sort)) ? String(req.query.sort) : 'popular';
    let sql = "select p.id,p.slug,p.type,p.category,p.title,p.result,p.description,p.stack,p.demo_url,p.version,p.changelog,min(l.price_xtr) price_from from products p left join license_plans l on l.product_id=p.id where p.status='published'"; const args: any[] = [];
    if (req.query.q) { const q = `%${String(req.query.q).slice(0, 80)}%`; if (config.DB_DRIVER === 'postgres') { sql += " and lower(coalesce(p.title,'') || ' ' || coalesce(p.result,'') || ' ' || coalesce(p.description,'') || ' ' || coalesce(p.stack,'')) like lower(?)"; args.push(q); } else { sql += ' and (lower(p.title) like lower(?) or lower(p.result) like lower(?) or lower(p.description) like lower(?) or lower(p.stack) like lower(?))'; args.push(q, q, q, q); } }
    if (req.query.type) { sql += ' and p.type=?'; args.push(String(req.query.type)); }
    if (req.query.category) { sql += ' and p.category=?'; args.push(String(req.query.category)); }
    sql += ' group by p.id ' + (sort === 'price' ? 'order by price_from asc' : sort === 'new' ? 'order by p.created_at desc' : 'order by p.updated_at desc') + ' limit ? offset ?'; args.push(limit, offset);
    res.json({ items: await db.prepare(sql).all(...args), limit, offset });
  });
  app.get('/api/products/:slug', catalogLimiter, async (req, res) => { const p = await db.prepare("select * from products where (slug=? or id=?) and status='published'").get(req.params.slug, req.params.slug) as any; if (!p) return safeError(res, 404, 'not_found', 'Товар не найден'); res.json({ product: p, plans: await db.prepare('select * from license_plans where product_id=? order by price_xtr').all(p.id) }); });
  app.post('/api/start-param', user, async (req: any, res) => { const parsed = parseStartParam(req.body.startParam); await event(req.userId, 'start_param_received', parsed.kind === 'product' ? parsed.id : undefined, parsed); res.json(parsed); });

  app.post('/api/orders', user, limiter, async (req: any, res) => {
    const parsed = validateBody(OrderBodySchema, req.body);
    if (!parsed.ok) return safeError(res, 400, 'validation_failed', parsed.issues.join('; '));
    const idempotencyKey = String(req.headers['idempotency-key'] || parsed.data.idempotencyKey || '').trim();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) return safeError(res, 400, 'idempotency_key_required', 'Передайте корректный Idempotency-Key');
    const plan = await db.prepare('select * from license_plans where id=?').get(parsed.data.licenseId) as any; if (!plan) return safeError(res, 404, 'license_not_found', 'Лицензия недоступна');
    const product = await db.prepare("select * from products where id=? and status='published'").get(plan.product_id) as any; if (!product) return safeError(res, 404, 'product_not_found', 'Товар недоступен');
    const existing = await db.prepare('select * from orders where user_id=? and idempotency_key=?').get(req.userId, idempotencyKey) as any;
    if (existing) {
      if (existing.license_id !== plan.id) return safeError(res, 409, 'idempotency_key_conflict', 'Ключ уже использован для другой покупки');
      return res.json({ order: { id: existing.id, product_id: existing.product_id, license_id: existing.license_id, amount_xtr: existing.amount_xtr, currency: existing.currency, status: existing.status }, idempotent: true });
    }
    const id = nanoid(); const payload = `order_${id}_${nanoid(8)}`;
    try {
      await db.prepare('insert into orders(id,user_id,product_id,license_id,product_title,product_version,license_name,amount_xtr,currency,status,payload,idempotency_key) values(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, req.userId, product.id, plan.id, product.title, product.version, plan.name, plan.price_xtr, 'XTR', 'pending', payload, idempotencyKey);
    } catch (error) {
      const raced = await db.prepare('select * from orders where user_id=? and idempotency_key=?').get(req.userId, idempotencyKey) as any;
      if (!raced) throw error;
      if (raced.license_id !== plan.id) return safeError(res, 409, 'idempotency_key_conflict', 'Ключ уже использован для другой покупки');
      return res.json({ order: { id: raced.id, product_id: raced.product_id, license_id: raced.license_id, amount_xtr: raced.amount_xtr, currency: raced.currency, status: raced.status }, idempotent: true });
    }
    await event(req.userId, 'checkout_started', product.id, { licenseId: plan.id }); res.status(201).json({ order: { id, product_id: product.id, license_id: plan.id, amount_xtr: plan.price_xtr, currency: 'XTR', status: 'pending' }, idempotent: false });
  });
  app.get('/api/orders/:id', user, async (req: any, res) => {
    const order = await db.prepare('select id,product_id,license_id,amount_xtr,currency,status,created_at from orders where id=? and user_id=?').get(req.params.id, req.userId) as any;
    if (!order) return safeError(res, 404, 'order_not_found', 'Заказ не найден');
    res.json({ order });
  });
  app.post('/api/orders/:id/invoice', user, limiter, async (req: any, res) => {
    const order = await db.prepare('select * from orders where id=? and user_id=?').get(req.params.id, req.userId) as any; if (!order) return safeError(res, 404, 'order_not_found', 'Заказ не найден'); if (order.status !== 'pending') return safeError(res, 409, 'order_not_pending', 'Заказ уже обработан');
    if (!bot || botStatus !== 'ready') return safeError(res, 503, 'telegram_unavailable', 'Telegram временно недоступен');
    const link = await bot.api.createInvoiceLink(`Покупка: ${order.product_title}`, 'Цифровой товар. Доступ выдаётся после successful_payment.', order.payload, '', 'XTR', [{ label: order.product_title, amount: order.amount_xtr }]);
    await db.prepare('update orders set invoice_link=? where id=?').run(link, order.id); await event(req.userId, 'invoice_opened', order.product_id); res.json({ invoiceLink: link });
  });

  app.post('/api/webhooks/telegram', async (req: any, res) => {
    if (!config.WEBHOOK_SECRET || req.headers['x-telegram-bot-api-secret-token'] !== config.WEBHOOK_SECRET) return safeError(res, 403, 'bad_webhook_secret', 'Forbidden');
    await botReady;
    if (bot && botStatus !== 'ready') return safeError(res, 503, 'telegram_unavailable', 'Telegram handler unavailable');
    const update = req.body;
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const order = await db.prepare('select o.*,u.telegram_id payer_telegram_id from orders o join users u on u.id=o.user_id where o.payload=?').get(q.invoice_payload) as any;
      const ok = Boolean(order && String(q.from?.id) === String(order.payer_telegram_id) && order.status === 'pending' && q.currency === 'XTR' && Number(q.total_amount) === Number(order.amount_xtr));
      if (bot) await bot.api.answerPreCheckoutQuery(q.id, ok, ok ? undefined : { error_message: 'Заказ устарел или цена изменилась. Создайте новый заказ.' });
      else if (config.NODE_ENV !== 'test') return safeError(res, 503, 'telegram_unavailable', 'Telegram handler unavailable');
      return res.json({ ok });
    }
    const payment = update.message?.successful_payment;
    if (payment) {
      const result = await db.transaction(async (tx) => {
        if (update.update_id != null) {
          const inserted = await tx.prepare('insert into webhook_updates(update_id) values(?) on conflict(update_id) do nothing').run(String(update.update_id));
          if (inserted.changes === 0) return { kind: 'duplicate' as const };
        }
        const order = await tx.prepare('select o.*,u.telegram_id payer_telegram_id from orders o join users u on u.id=o.user_id where o.payload=?').get(payment.invoice_payload) as any;
        if (!order || String(update.message?.from?.id) !== String(order.payer_telegram_id) || payment.currency !== 'XTR' || Number(payment.total_amount) !== Number(order.amount_xtr)) return { kind: 'invalid' as const };
        const fulfilled = await tx.prepare("update orders set status='fulfilled',telegram_charge_id=?,paid_at=CURRENT_TIMESTAMP,fulfilled_at=CURRENT_TIMESTAMP where id=? and status in ('pending','expired') returning id").get(payment.telegram_payment_charge_id, order.id);
        if (!fulfilled) return { kind: 'already_processed' as const };
        await tx.prepare('insert into entitlements(id,user_id,product_id,license_id,order_id) values(?,?,?,?,?) on conflict(order_id) do nothing').run(nanoid(), order.user_id, order.product_id, order.license_id, order.id);
        return { kind: 'fulfilled' as const, order };
      });
      if (result.kind === 'fulfilled') await event(result.order.user_id, 'payment_success', result.order.product_id, { orderId: result.order.id });
      if (result.kind === 'invalid') log('warn', 'payment_rejected', { updateId: update.update_id });
      return res.json({ ok: true, result: result.kind });
    }
    if (!bot) return safeError(res, 503, 'telegram_unavailable', 'Telegram handler unavailable');
    await bot.handleUpdate(update);
    return res.json({ ok: true, handledBy: 'grammy' });
  });

  app.get('/api/me/purchases', user, meLimiter, async (req: any, res) => res.json({ items: await db.prepare('select e.*,p.title,p.version,l.name license_name from entitlements e join products p on p.id=e.product_id join license_plans l on l.id=e.license_id where e.user_id=? and e.active=1 order by e.created_at desc').all(req.userId) }));
  app.get('/api/me/orders', user, meLimiter, async (req: any, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    res.json({ items: await db.prepare('select id,product_id,license_id,product_title,amount_xtr,currency,status,created_at,paid_at,fulfilled_at from orders where user_id=? order by created_at desc limit ? offset ?').all(req.userId, limit, offset) });
  });
  app.get('/api/me/favorites', user, meLimiter, async (req: any, res) => res.json({ items: await db.prepare('select f.id,f.product_id,f.created_at,p.slug,p.type,p.category,p.title,p.result,p.description,p.stack,p.version,(select min(l.price_xtr) from license_plans l where l.product_id=p.id) price_from from user_favorites f join products p on p.id=f.product_id where f.user_id=? order by f.created_at desc').all(req.userId) }));
  app.post('/api/me/favorites', user, limiter, async (req: any, res) => {
    const parsed = validateBody(FavoriteBodySchema, req.body);
    if (!parsed.ok) return safeError(res, 400, 'product_id_required', 'Укажите productId');
    const productId = parsed.data.productId;
    const product = await db.prepare("select id from products where id=? and status='published'").get(productId) as any;
    if (!product) return safeError(res, 404, 'product_not_found', 'Товар не найден');
    try { await db.prepare('insert into user_favorites(id,user_id,product_id) values(?,?,?)').run(nanoid(), req.userId, productId); }
    catch (error: any) { if (!error?.message?.includes('UNIQUE')) throw error; return res.json({ ok: true, idempotent: true }); }
    res.status(201).json({ ok: true });
  });
  app.delete('/api/me/favorites/:productId', user, async (req: any, res) => {
    const result = await db.prepare('delete from user_favorites where user_id=? and product_id=?').run(req.userId, req.params.productId);
    if (!result.changes) return safeError(res, 404, 'favorite_not_found', 'Товар не в избранном');
    res.json({ ok: true });
  });
  app.post('/api/purchases/:id/download', user, limiter, async (req: any, res) => {
    const e = await db.prepare('select e.*,p.version from entitlements e join products p on p.id=e.product_id where e.id=? and e.user_id=? and e.active=1').get(req.params.id, req.userId) as any; if (!e) return safeError(res, 404, 'entitlement_not_found', 'Покупка не найдена');
    const asset = await db.prepare("select * from product_assets where product_id=? and version=? and status='published' order by created_at desc").get(e.product_id, e.version) as any;
    if (!asset) return safeError(res, 404, 'asset_not_found', 'Файл ещё не опубликован');
    const token = nanoid(40); const ttl = config.DOWNLOAD_TTL_SECONDS; await db.prepare('insert into delivery_events(id,entitlement_id,asset_id,token_hash,expires_at) values(?,?,?,?,?)').run(nanoid(), e.id, asset.id, hashToken(token), Math.floor(Date.now() / 1000) + ttl); await event(req.userId, 'delivery_opened', e.product_id); res.json({ url: `/api/download/${token}`, expiresIn: ttl });
  });
  app.get('/api/download/:token', async (req, res) => {
    const hash = hashToken(req.params.token);
    const pending = await db.prepare("select d.id,a.storage_key,a.file_name,a.mime_type from delivery_events d join product_assets a on a.id=d.asset_id where d.token_hash=? and d.status='issued' and d.expires_at>=? and a.status='published'").get(hash, Math.floor(Date.now() / 1000)) as any;
    if (!pending) return res.status(410).send('Link expired or already used');
    const claimed = await db.prepare("update delivery_events set status='streaming',claimed_at=CURRENT_TIMESTAMP,last_error=NULL where id=? and status='issued' returning id").get(pending.id);
    if (!claimed) return res.status(410).send('Link already used');
    let stream;
    try { stream = await readAsset(pending.storage_key); }
    catch (error) {
      await db.prepare("update delivery_events set status='issued',claimed_at=NULL,last_error=? where id=? and status='streaming'").run(error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), pending.id);
      throw error;
    }
    let settled = false;
    const release = async (error: unknown) => {
      if (settled) return;
      settled = true;
      await db.prepare("update delivery_events set status='issued',claimed_at=NULL,last_error=? where id=? and status='streaming'").run(error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), pending.id);
    };
    res.setHeader('Content-Type', pending.mime_type); res.setHeader('Content-Disposition', `attachment; filename="${String(pending.file_name).replace(/"/g, '')}"`);
    stream.on('error', (error) => { void release(error).finally(() => { log('error', 'download_stream_failed', { requestId: res.locals.requestId, ...errorMeta(error) }); if (!res.headersSent) res.status(502).end(); else res.destroy(error); }); });
    res.on('finish', () => { if (!settled) { settled = true; void db.prepare("update delivery_events set used_at=CURRENT_TIMESTAMP,status='used',last_error=NULL where id=? and status='streaming'").run(pending.id); } });
    res.on('close', () => { if (!res.writableFinished) void release(new Error('client_aborted')); });
    stream.pipe(res);
  });

  app.post('/api/admin/products', user, adminRole(['owner', 'editor']), limiter, async (req: any, res) => { const parsed = validateBody(AdminProductBodySchema, req.body); if (!parsed.ok) return safeError(res, 400, 'validation_failed', parsed.issues.join('; ')); const p = parsed.data; const id = p.id || nanoid(8); await db.prepare('insert into products(id,slug,type,category,title,result,description,stack,demo_url,preview,version,changelog,status) values(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, p.slug || id, p.type, p.category, p.title, p.result, p.description || '', p.stack || '', p.demo_url || '', p.preview || '', p.version || '1.0.0', p.changelog || '', 'draft'); await audit(req.userId, 'product_create', 'product', id); res.status(201).json({ id, status: 'draft' }); });
  async function finalizeRefund(orderId: string, reason: string) {
    return db.transaction(async (tx) => {
      const finalized = await tx.prepare("update orders set status='refunded',refund_reason=?,refund_external_confirmed_at=COALESCE(refund_external_confirmed_at,CURRENT_TIMESTAMP),refunded_at=COALESCE(refunded_at,CURRENT_TIMESTAMP),refund_last_error=NULL where id=? and status in ('refund_requested','refund_manual_review','refunded') returning id").get(reason, orderId);
      if (!finalized) return false;
      await tx.prepare('update entitlements set active=0,revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) where order_id=?').run(orderId);
      return true;
    });
  }
  app.post('/api/admin/orders/:id/refund', user, adminRole(['owner']), limiter, async (req: any, res) => {
    const parsed = validateBody(RefundBodySchema, req.body); if (!parsed.ok) return safeError(res, 400, 'reason_required', 'Укажите причину возврата');
    const reason = parsed.data.reason.trim();
        if (!bot || botStatus !== 'ready') { if (config.NODE_ENV !== 'test') return safeError(res, 503, 'telegram_unavailable', 'Telegram временно недоступен'); }
    const order = await db.prepare("update orders set status='refund_requested',refund_reason=?,refund_requested_at=COALESCE(refund_requested_at,CURRENT_TIMESTAMP),refund_last_error=NULL where id=? and status='fulfilled' returning *").get(reason, req.params.id) as any;
    if (!order) {
      const existing = await db.prepare('select status from orders where id=?').get(req.params.id) as any;
      if (existing?.status === 'refunded') return res.json({ ok: true, idempotent: true });
      if (['refund_requested', 'refund_manual_review'].includes(existing?.status)) return res.status(202).json({ ok: false, status: existing.status, reconciliationRequired: true });
      return safeError(res, 409, 'refund_not_available', 'Возврат для заказа недоступен');
    }
    const refundUser = await db.prepare('select telegram_id from users where id=?').get(order.user_id) as any;
    await db.prepare("update orders set refund_attempted_at=CURRENT_TIMESTAMP where id=? and status='refund_requested'").run(order.id);
        try { if (bot) await bot.api.refundStarPayment(Number(refundUser.telegram_id), order.telegram_charge_id); }
    catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      await db.prepare("update orders set status='refund_manual_review',refund_last_error=? where id=? and status='refund_requested'").run(message, order.id);
      await audit(req.userId, 'refund_external_ambiguous', 'order', order.id, 'manual_review', { reason, error: message });
      return res.status(202).json({ ok: false, status: 'refund_manual_review', reconciliationRequired: true });
    }
    try {
      await db.prepare("update orders set refund_external_confirmed_at=CURRENT_TIMESTAMP where id=? and status='refund_requested'").run(order.id);
      await finalizeRefund(order.id, reason);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      await db.prepare("update orders set status='refund_manual_review',refund_last_error=? where id=? and status='refund_requested'").run(message, order.id);
      await audit(req.userId, 'refund_finalize_failed', 'order', order.id, 'manual_review', { reason, error: message });
      return res.status(202).json({ ok: false, status: 'refund_manual_review', reconciliationRequired: true });
    }
    await audit(req.userId, 'refund', 'order', order.id, 'ok', { reason }); res.json({ ok: true });
  });
  app.post('/api/admin/orders/:id/refund/reconcile', user, adminRole(['owner']), limiter, async (req: any, res) => {
    const parsed = validateBody(ReconcileBodySchema, req.body);
    if (!parsed.ok) return safeError(res, 400, 'reconciliation_required', 'Укажите outcome и примечание');
    const outcome = parsed.data.outcome;
    const note = parsed.data.note.trim();
    const order = await db.prepare("select * from orders where id=? and status in ('refund_requested','refund_manual_review','refunded','fulfilled')").get(req.params.id) as any;
    if (!order) return safeError(res, 409, 'reconciliation_not_available', 'Сверка недоступна');
    if (outcome === 'confirmed') {
      await finalizeRefund(order.id, order.refund_reason || note);
      await audit(req.userId, 'refund_reconcile_confirmed', 'order', order.id, order.status === 'refunded' ? 'idempotent' : 'ok', { note });
      return res.json({ ok: true, status: 'refunded', idempotent: order.status === 'refunded' });
    }
    if (order.status === 'refunded' || order.refund_external_confirmed_at) return safeError(res, 409, 'refund_already_confirmed', 'Подтверждённый возврат нельзя отменить');
    await db.prepare("update orders set status='fulfilled',refund_last_error=NULL where id=? and status in ('refund_requested','refund_manual_review')").run(order.id);
    await audit(req.userId, 'refund_reconcile_not_refunded', 'order', order.id, order.status === 'fulfilled' ? 'idempotent' : 'ok', { note });
    return res.json({ ok: true, status: 'fulfilled', idempotent: order.status === 'fulfilled' });
  });
  app.post('/api/admin/assets/upload', user, adminRole(['owner', 'editor']), limiter, upload.single('file'), async (req: any, res) => {
    const file = req.file; const productId = String(req.body.productId || ''); const version = String(req.body.version || '');
    if (!file || !productId || !version) return safeError(res, 400, 'upload_required', 'Нужен файл, productId и version');
    const product = await db.prepare("select * from products where id=? and status='draft'").get(productId) as any; if (!product) return safeError(res, 404, 'draft_product_not_found', 'Нужен существующий draft-проект');
    const scan = await scanArchiveBuffer(file.buffer, file.originalname, file.mimetype); const assetId = nanoid(); const key = createAssetKey(productId, version, assetId, file.originalname, !scan.ok);
    const stored = await storage.putObject({ key, body: file.buffer, contentType: file.mimetype, fileName: file.originalname });
    try {
      await db.prepare('insert into product_assets(id,product_id,version,storage_key,file_name,mime_type,size_bytes,checksum_sha256,status,scan_findings,quarantine_key) values(?,?,?,?,?,?,?,?,?,?,?)').run(assetId, productId, version, key, file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_'), file.mimetype, stored.size, stored.checksum, scan.ok ? 'approved' : 'rejected', JSON.stringify(scan.findings), scan.ok ? null : key);
    } catch (error) {
      try { await storage.deleteObject(key); }
      catch (cleanupError) { log('error', 'asset_upload_compensation_failed', { requestId: res.locals.requestId, storageKey: key, ...errorMeta(cleanupError, res.locals.requestId) }); }
      throw error;
    }
    await audit(req.userId, 'asset_upload_scan', 'asset', assetId, scan.ok ? 'approved' : 'rejected', { findings: scan.findings }); res.status(scan.ok ? 201 : 422).json({ id: assetId, status: scan.ok ? 'approved' : 'rejected', findings: scan.findings });
  });
  app.post('/api/admin/assets/:id/publish', user, adminRole(['owner', 'editor']), limiter, async (req: any, res) => { try { await db.transaction(async (tx) => { const asset = await tx.prepare("select a.*,p.status product_status from product_assets a join products p on p.id=a.product_id where a.id=?").get(req.params.id) as any; if (!asset || asset.product_status !== 'draft' || asset.status !== 'approved') throw Object.assign(new Error('asset_not_approved'), { statusCode: 409 }); const published = await tx.prepare("update product_assets set status='published' where id=? and status='approved'").run(asset.id); if (!published.changes) throw Object.assign(new Error('asset_publish_conflict'), { statusCode: 409 }); const project = await tx.prepare("update products set status='published',updated_at=CURRENT_TIMESTAMP where id=? and status='draft'").run(asset.product_id); if (!project.changes) throw Object.assign(new Error('project_publish_conflict'), { statusCode: 409 }); await audit(req.userId, 'asset_publish', 'asset', asset.id, 'ok', undefined, tx); }); res.json({ ok: true }); } catch (error) { const status = Number((error as { statusCode?: number }).statusCode) || 500; if (status === 409) return safeError(res, 409, 'asset_not_approved', 'Asset не прошёл проверку или проект уже опубликован'); throw error; } });
  app.post('/api/auth/logout', user, async (req: any, res) => { const token = String(req.headers.authorization || '').replace(/^Bearer /, ''); await ttlStore.del(`session:${hashToken(token)}`); await event(req.userId, 'logout'); res.json({ ok: true }); });

  app.get(/.*/, (req, res, next) => { if (req.path.startsWith('/api/') || req.path.startsWith('/health/')) return next(); res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(distDir, 'index.html')); });
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next;
    const err = error as { type?: string; status?: number };
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'invalid_json', message: 'Некорректное тело запроса', requestId: res.locals.requestId } });
    log('error', 'http_request_failed', { requestId: res.locals.requestId, method: req.method, path: req.path, ...errorMeta(error) });
    if (res.headersSent) return res.end();
    return res.status(500).json({ error: { code: 'internal_error', message: 'Внутренняя ошибка сервера', requestId: res.locals.requestId } });
  });
  return app;
}
