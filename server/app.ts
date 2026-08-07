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
import { scanArchiveBuffer } from './scanner';
import { createTtlStore, type TtlStore } from './state';
import { BOT_COMMANDS, registerBotHandlers, TELEGRAM_ALLOWED_UPDATES } from './telegram';

const runtimeStores = new Set<TtlStore>();
export async function closeRuntimeResources() {
  await Promise.allSettled([...runtimeStores].map((store) => store.close()));
  runtimeStores.clear();
}

function errorMeta(error: unknown) {
  const value = error instanceof Error ? error : new Error(String(error));
  return { errorType: value.name, message: value.message, stack: value.stack, sql: (value as Error & { sql?: string }).sql };
}

export function createApp() {
  const config = loadConfig();
  const app = express();
  const ttlStore = createTtlStore(config);
  runtimeStores.add(ttlStore);
  const bot = config.BOT_TOKEN && config.BOT_TOKEN !== 'TEST_TOKEN' ? new Bot(config.BOT_TOKEN) : null;
  let botStatus: 'disabled' | 'initializing' | 'ready' | 'failed' = bot ? 'initializing' : 'disabled';
  let botFailure = '';

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
      botFailure = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'telegram_bot_init_failed', ...errorMeta(error) }));
    }
  })() : Promise.resolve();

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } });
  app.set('trust proxy', 1);
  app.use((req, res, next) => { res.locals.requestId = nanoid(10); res.setHeader('x-request-id', res.locals.requestId); next(); });
  app.use(helmet({ contentSecurityPolicy: { directives: { scriptSrc: ["'self'", 'https://telegram.org'], connectSrc: ["'self'", 'https://telegram.org'] } } }));
  app.use(cors({ origin: (origin, cb) => (!origin || !config.isProduction || origin === config.allowedOrigin ? cb(null, true) : cb(new Error('cors_denied'))), credentials: false }));
  app.use(express.json({ limit: '128kb' }));
  app.use((req, res, next) => { req.setTimeout(30_000); res.setTimeout(30_000); next(); });

  const distDir = path.resolve('dist');
  app.use(express.static(distDir));
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
  async function limiter(req: any, res: any, next: any) {
    try { const key = `rl:${req.path}:${req.userId || req.ip}`; const count = await ttlStore.incrWithTtl(key, 60); if (count > 80) return safeError(res, 429, 'rate_limited', 'Слишком много запросов'); next(); }
    catch (error) { log('error', 'rate_limit_failed', { requestId: res.locals.requestId, ...errorMeta(error) }); return safeError(res, 503, 'rate_limit_unavailable', 'Сервис временно недоступен'); }
  }
  async function user(req: any, res: any, next: any) {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) return safeError(res, 401, 'auth_required', 'Требуется вход через Telegram');
    const raw = await ttlStore.get(`session:${hashToken(token)}`);
    if (!raw) return safeError(res, 401, 'auth_required', 'Требуется вход через Telegram');
    req.userId = JSON.parse(raw).userId; next();
  }
  function adminRole(roles: string[]) { return async (req: any, res: any, next: any) => {
    const u = await db.prepare('select telegram_id from users where id=?').get(req.userId) as any;
    const a = u ? await db.prepare('select role from admin_users where telegram_id=?').get(u.telegram_id) as any : null;
    if (!a || !roles.includes(a.role)) { if (req.userId) await audit(req.userId, 'admin_denied', 'route', req.path, 'denied'); return safeError(res, 403, 'admin_required', 'Недостаточно прав'); }
    req.adminRole = a.role; next();
  }; }
  async function audit(actor: number | null, action: string, objectType?: string, objectId?: string, result = 'ok', meta?: any) { await db.prepare('insert into audit_log(id,actor_user_id,action,object_type,object_id,result,meta) values(?,?,?,?,?,?,?)').run(nanoid(), actor, action, objectType || null, objectId || null, result, meta ? JSON.stringify(meta) : null); }
  async function event(userId: number, eventName: string, productId?: string, meta?: any) { await db.prepare('insert into analytics(user_id,event,product_id,meta) values(?,?,?,?)').run(userId, eventName, productId || null, meta ? JSON.stringify(meta) : null); }

  app.get('/health/live', (_req, res) => res.json({ ok: true }));
  app.get('/health/ready', async (_req, res) => {
    try {
      await db.prepare(config.isProduction ? "select version from schema_migrations where version='001_initial'" : 'select 1').get();
      const [storeOk, storageOk] = await Promise.all([ttlStore.healthy(), storage.healthy()]);
      const telegramOk = !config.isProduction || botStatus === 'ready';
      const ok = storeOk && storageOk && telegramOk;
      res.status(ok ? 200 : 503).json({ ok, db: 'ok', store: storeOk ? 'ok' : 'unavailable', storage: storageOk ? 'ok' : 'unavailable', telegram: telegramOk ? 'ok' : botStatus, ...(botStatus === 'failed' ? { telegramError: botFailure.slice(0, 160) } : {}) });
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

  app.get('/api/me', user, async (req: any, res) => res.json({ user: await db.prepare('select id,name from users where id=?').get(req.userId) }));
  app.get('/api/products', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 50); const offset = Math.max(Number(req.query.offset || 0), 0);
    const sort = ['popular', 'new', 'price'].includes(String(req.query.sort)) ? String(req.query.sort) : 'popular';
    let sql = "select p.id,p.slug,p.type,p.category,p.title,p.result,p.description,p.stack,p.demo_url,p.version,p.changelog,min(l.price_xtr) price_from from products p left join license_plans l on l.product_id=p.id where p.status='published'"; const args: any[] = [];
    if (req.query.q) { sql += ' and (lower(p.title) like lower(?) or lower(p.result) like lower(?) or lower(p.description) like lower(?) or lower(p.stack) like lower(?))'; const q = `%${String(req.query.q).slice(0, 80)}%`; args.push(q, q, q, q); }
    if (req.query.type) { sql += ' and p.type=?'; args.push(String(req.query.type)); }
    if (req.query.category) { sql += ' and p.category=?'; args.push(String(req.query.category)); }
    sql += ' group by p.id ' + (sort === 'price' ? 'order by price_from asc' : sort === 'new' ? 'order by p.created_at desc' : 'order by p.updated_at desc') + ' limit ? offset ?'; args.push(limit, offset);
    res.json({ items: await db.prepare(sql).all(...args), limit, offset });
  });
  app.get('/api/products/:slug', async (req, res) => { const p = await db.prepare("select * from products where (slug=? or id=?) and status='published'").get(req.params.slug, req.params.slug) as any; if (!p) return safeError(res, 404, 'not_found', 'Товар не найден'); res.json({ product: p, plans: await db.prepare('select * from license_plans where product_id=? order by price_xtr').all(p.id) }); });
  app.post('/api/start-param', user, async (req: any, res) => { const parsed = parseStartParam(req.body.startParam); await event(req.userId, 'start_param_received', parsed.kind === 'product' ? parsed.id : undefined, parsed); res.json(parsed); });

  app.post('/api/orders', user, limiter, async (req: any, res) => {
    const plan = await db.prepare('select * from license_plans where id=?').get(req.body.licenseId) as any; if (!plan) return safeError(res, 404, 'license_not_found', 'Лицензия недоступна');
    const product = await db.prepare("select * from products where id=? and status='published'").get(plan.product_id) as any; if (!product) return safeError(res, 404, 'product_not_found', 'Товар недоступен');
    const id = nanoid(); const payload = `order_${id}_${nanoid(8)}`;
    await db.prepare('insert into orders(id,user_id,product_id,license_id,product_title,product_version,license_name,amount_xtr,currency,status,payload) values(?,?,?,?,?,?,?,?,?,?,?)').run(id, req.userId, product.id, plan.id, product.title, product.version, plan.name, plan.price_xtr, 'XTR', 'pending', payload);
    await event(req.userId, 'checkout_started', product.id, { licenseId: plan.id }); res.json({ order: { id, product_id: product.id, license_id: plan.id, amount_xtr: plan.price_xtr, currency: 'XTR', status: 'pending' } });
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
      const order = await db.prepare('select * from orders where payload=?').get(q.invoice_payload) as any;
      const ok = Boolean(order && order.status === 'pending' && q.currency === 'XTR' && Number(q.total_amount) === Number(order.amount_xtr));
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
        const order = await tx.prepare('select * from orders where payload=?').get(payment.invoice_payload) as any;
        if (!order || payment.currency !== 'XTR' || Number(payment.total_amount) !== Number(order.amount_xtr)) return { kind: 'invalid' as const };
        const fulfilled = await tx.prepare("update orders set status='fulfilled',telegram_charge_id=?,paid_at=CURRENT_TIMESTAMP,fulfilled_at=CURRENT_TIMESTAMP where id=? and status='pending' returning id").get(payment.telegram_payment_charge_id, order.id);
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

  app.get('/api/me/purchases', user, async (req: any, res) => res.json({ items: await db.prepare('select e.*,p.title,p.version,l.name license_name from entitlements e join products p on p.id=e.product_id join license_plans l on l.id=e.license_id where e.user_id=? and e.active=1 order by e.created_at desc').all(req.userId) }));
  app.post('/api/purchases/:id/download', user, limiter, async (req: any, res) => {
    const e = await db.prepare('select e.*,p.version from entitlements e join products p on p.id=e.product_id where e.id=? and e.user_id=? and e.active=1').get(req.params.id, req.userId) as any; if (!e) return safeError(res, 404, 'entitlement_not_found', 'Покупка не найдена');
    const asset = await db.prepare("select * from product_assets where product_id=? and version=? and status in ('approved','published') order by created_at desc").get(e.product_id, e.version) as any;
    if (!asset) return safeError(res, 404, 'asset_not_found', 'Файл ещё не опубликован');
    const token = nanoid(40); const ttl = config.DOWNLOAD_TTL_SECONDS; await db.prepare('insert into delivery_events(id,entitlement_id,asset_id,token_hash,expires_at) values(?,?,?,?,?)').run(nanoid(), e.id, asset.id, hashToken(token), Math.floor(Date.now() / 1000) + ttl); await event(req.userId, 'delivery_opened', e.product_id); res.json({ url: `/api/download/${token}`, expiresIn: ttl });
  });
  app.get('/api/download/:token', async (req, res) => {
    const hash = hashToken(req.params.token);
    const pending = await db.prepare("select d.id,a.storage_key,a.file_name,a.mime_type from delivery_events d join product_assets a on a.id=d.asset_id where d.token_hash=? and d.status='issued' and d.expires_at>=?").get(hash, Math.floor(Date.now() / 1000)) as any;
    if (!pending) return res.status(410).send('Link expired or already used');
    const stream = await readAsset(pending.storage_key);
    const claimed = await db.prepare("update delivery_events set used_at=CURRENT_TIMESTAMP,status='used' where id=? and status='issued' returning id").get(pending.id);
    if (!claimed) { stream.destroy(); return res.status(410).send('Link already used'); }
    res.setHeader('Content-Type', pending.mime_type); res.setHeader('Content-Disposition', `attachment; filename="${String(pending.file_name).replace(/"/g, '')}"`);
    stream.on('error', (error) => { log('error', 'download_stream_failed', { requestId: res.locals.requestId, ...errorMeta(error) }); if (!res.headersSent) res.status(502).end(); else res.destroy(error); });
    stream.pipe(res);
  });

  app.post('/api/admin/products', user, adminRole(['owner', 'editor']), limiter, async (req: any, res) => { const p = req.body; if (!p.title || p.title.length > 120 || !p.result || p.result.length > 240 || !['template', 'ready_bot', 'module', 'service'].includes(p.type) || !p.category) return safeError(res, 400, 'validation_failed', 'Проверьте поля товара'); const id = p.id || nanoid(8); await db.prepare('insert into products(id,slug,type,category,title,result,description,stack,demo_url,preview,version,changelog,status) values(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, p.slug || id, p.type, p.category, p.title, p.result, p.description || '', p.stack || '', p.demo_url || '', p.preview || '', p.version || '1.0.0', p.changelog || '', p.status || 'draft'); await audit(req.userId, 'product_create', 'product', id); res.json({ id }); });
  app.post('/api/admin/orders/:id/refund', user, adminRole(['owner']), limiter, async (req: any, res) => {
    const reason = String(req.body.reason || '').trim(); if (reason.length < 5) return safeError(res, 400, 'reason_required', 'Укажите причину возврата');
    if (!bot || botStatus !== 'ready') return safeError(res, 503, 'telegram_unavailable', 'Telegram временно недоступен');
    const order = await db.prepare("update orders set status='refund_pending' where id=? and status='fulfilled' returning *").get(req.params.id) as any;
    if (!order) { const existing = await db.prepare('select status from orders where id=?').get(req.params.id) as any; if (existing?.status === 'refunded') return res.json({ ok: true, idempotent: true }); return safeError(res, 409, 'refund_not_available', 'Возврат для заказа недоступен'); }
    const refundUser = await db.prepare('select telegram_id from users where id=?').get(order.user_id) as any;
    try { await bot.api.refundStarPayment(Number(refundUser.telegram_id), order.telegram_charge_id); }
    catch (error) { await db.prepare("update orders set status='fulfilled' where id=? and status='refund_pending'").run(order.id); throw error; }
    await db.transaction(async (tx) => { await tx.prepare("update orders set status='refunded',refund_reason=?,refunded_at=CURRENT_TIMESTAMP where id=? and status='refund_pending'").run(reason, order.id); await tx.prepare('update entitlements set active=0,revoked_at=CURRENT_TIMESTAMP where order_id=?').run(order.id); });
    await audit(req.userId, 'refund', 'order', order.id, 'ok', { reason }); res.json({ ok: true });
  });
  app.post('/api/admin/assets/upload', user, adminRole(['owner', 'editor']), limiter, upload.single('file'), async (req: any, res) => {
    const file = req.file; const productId = String(req.body.productId || ''); const version = String(req.body.version || '');
    if (!file || !productId || !version) return safeError(res, 400, 'upload_required', 'Нужен файл, productId и version');
    const product = await db.prepare('select * from products where id=?').get(productId) as any; if (!product) return safeError(res, 404, 'product_not_found', 'Товар не найден');
    const scan = await scanArchiveBuffer(file.buffer, file.originalname, file.mimetype); const assetId = nanoid(); const key = createAssetKey(productId, version, assetId, file.originalname, !scan.ok);
    const stored = await storage.putObject({ key, body: file.buffer, contentType: file.mimetype, fileName: file.originalname });
    await db.prepare('insert into product_assets(id,product_id,version,storage_key,file_name,mime_type,size_bytes,checksum_sha256,status,scan_findings,quarantine_key) values(?,?,?,?,?,?,?,?,?,?,?)').run(assetId, productId, version, key, file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_'), file.mimetype, stored.size, stored.checksum, scan.ok ? 'approved' : 'rejected', JSON.stringify(scan.findings), scan.ok ? null : key);
    await audit(req.userId, 'asset_upload_scan', 'asset', assetId, scan.ok ? 'approved' : 'rejected', { findings: scan.findings }); res.status(scan.ok ? 201 : 422).json({ id: assetId, status: scan.ok ? 'approved' : 'rejected', findings: scan.findings });
  });
  app.post('/api/admin/assets/:id/publish', user, adminRole(['owner', 'editor']), limiter, async (req: any, res) => { const asset = await db.prepare('select * from product_assets where id=?').get(req.params.id) as any; if (!asset || !['approved', 'published'].includes(asset.status)) return safeError(res, 409, 'asset_not_approved', 'Asset не прошёл проверку'); await db.prepare("update product_assets set status='published' where id=?").run(asset.id); await audit(req.userId, 'asset_publish', 'asset', asset.id); res.json({ ok: true }); });
  app.post('/api/auth/logout', user, async (req: any, res) => { const token = String(req.headers.authorization || '').replace(/^Bearer /, ''); await ttlStore.del(`session:${hashToken(token)}`); await event(req.userId, 'logout'); res.json({ ok: true }); });

  app.get(/.*/, (req, res, next) => { if (req.path.startsWith('/api/') || req.path.startsWith('/health/')) return next(); res.sendFile(path.join(distDir, 'index.html')); });
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next;
    log('error', 'http_request_failed', { requestId: res.locals.requestId, method: req.method, path: req.path, ...errorMeta(error) });
    if (res.headersSent) return res.end();
    return safeError(res, 500, 'internal_error', 'Внутренняя ошибка сервера');
  });
  return app;
}
