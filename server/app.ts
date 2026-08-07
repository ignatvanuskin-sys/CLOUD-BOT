import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import { Bot, InlineKeyboard } from 'grammy';
import { nanoid } from 'nanoid';
import { db, migrate } from './db';
import { loadConfig } from './config';
import { parseStartParam, validateTelegramInitData } from './schema';
import { createAssetKey, ensureDemoAsset, hashToken, readAsset, storage } from './storage';
import { scanArchiveBuffer } from './scanner';
import { createTtlStore } from './state';

export function createApp() {
  const config = loadConfig();
  void migrate();
  const app = express();
  const bot = config.BOT_TOKEN && config.BOT_TOKEN !== 'TEST_TOKEN' ? new Bot(config.BOT_TOKEN) : null;
  const ttlStore = createTtlStore(config);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } });

  app.use((req, res, next) => { res.locals.requestId = nanoid(10); res.setHeader('x-request-id', res.locals.requestId); next(); });
  app.use(helmet());
  app.use(cors({ origin: (origin, cb) => (!origin || !config.isProduction || origin === config.allowedOrigin ? cb(null, true) : cb(new Error('cors_denied'))), credentials: false }));
  app.use(express.json({ limit: '128kb' }));

  const distDir = path.resolve('dist');
  app.use(express.static(distDir));

  function log(level: string, event: string, meta: Record<string, unknown> = {}) { console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...meta })); }
  function safeError(res: any, status: number, code: string, message = 'Ошибка запроса') { return res.status(status).json({ error: { code, message, requestId: res.locals.requestId } }); }
  async function limiter(req: any, res: any, next: any) {
    try { const key = `rl:${req.path}:${req.userId || req.ip}`; const count = await ttlStore.incrWithTtl(key, 60); if (count > 80) return safeError(res, 429, 'rate_limited', 'Слишком много запросов'); next(); }
    catch { return safeError(res, 503, 'rate_limit_unavailable', 'Сервис временно недоступен'); }
  }
  async function user(req: any, res: any, next: any) {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const raw = await ttlStore.get(`session:${hashToken(token)}`);
    if (!raw) return safeError(res, 401, 'auth_required', 'Требуется вход через Telegram');
    req.userId = JSON.parse(raw).userId; next();
  }
  function adminRole(roles: string[]) { return async (req: any, res: any, next: any) => {
    const u = await db.prepare('select telegram_id from users where id = ?').get(req.userId) as any;
    const a = u && await db.prepare('select role from admin_users where telegram_id = ?').get(u.telegram_id) as any;
    if (!a || !roles.includes(a.role)) { await audit(req.userId, 'admin_denied', 'route', req.path, 'denied'); return safeError(res, 403, 'admin_required', 'Недостаточно прав'); }
    req.adminRole = a.role; next();
  }; }
  async function audit(actor: number | null, action: string, objectType?: string, objectId?: string, result = 'ok', meta?: any) { await db.prepare('insert into audit_log(id,actor_user_id,action,object_type,object_id,result,meta) values(?,?,?,?,?,?,?)').run(nanoid(), actor, action, objectType || null, objectId || null, result, meta ? JSON.stringify(meta) : null); }
  async function event(userId: number, eventName: string, productId?: string, meta?: any) { await db.prepare('insert into analytics(user_id,event,product_id,meta) values(?,?,?,?)').run(userId, eventName, productId || null, meta ? JSON.stringify(meta) : null); }

  app.get('/health/live', (_req, res) => res.json({ ok: true }));
  app.get('/health/ready', async (_req, res) => { try { await db.prepare('select 1').get(); const storeOk = await ttlStore.healthy(); const storageOk = await storage.healthy(); res.status(storeOk && storageOk ? 200 : 503).json({ ok: storeOk && storageOk, db: 'ok', store: storeOk ? 'ok' : 'unavailable', storage: storageOk ? 'ok' : 'unavailable' }); } catch { res.status(503).json({ ok: false }); } });

  app.post('/api/auth/telegram', limiter, async (req, res) => {
    try {
      let auth: any;
      if (!config.isProduction && config.ALLOW_DEV_LOGIN === 'true' && req.body.devTelegramId) auth = { telegramId: String(req.body.devTelegramId), user: { first_name: 'Dev' } };
      else auth = validateTelegramInitData(req.body.initData, config.BOT_TOKEN || 'TEST_TOKEN');
      const info = auth.user;
      const row = await db.prepare('insert into users(telegram_id,name) values(?,?) on conflict(telegram_id) do update set name=excluded.name returning id').get(auth.telegramId, [info.first_name, info.last_name].filter(Boolean).join(' ')) as any;
      const token = nanoid(48); await ttlStore.set(`session:${hashToken(token)}`, JSON.stringify({ userId: row.id }), config.SESSION_TTL_SECONDS); await event(row.id, 'app_open');
      res.json({ token, expiresIn: config.SESSION_TTL_SECONDS, user: { id: row.id, name: info.first_name || 'Telegram user' } });
    } catch { log('warn', 'auth_failed', { requestId: res.locals.requestId }); return safeError(res, 401, 'telegram_auth_failed', 'Не удалось подтвердить вход через Telegram'); }
  });

  app.get('/api/me', user, async (req: any, res) => res.json({ user: await db.prepare('select id,name from users where id=?').get(req.userId) }));
  app.get('/api/products', async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 30), 50); const offset = Math.max(Number(req.query.offset || 0), 0);
    const sort = ['popular', 'new', 'price'].includes(String(req.query.sort)) ? String(req.query.sort) : 'popular';
    let sql = "select p.id,p.slug,p.type,p.category,p.title,p.result,p.description,p.stack,p.demo_url,p.version,p.changelog,min(l.price_xtr) price_from from products p left join license_plans l on l.product_id=p.id where p.status='published'"; const args: any[] = [];
    if (req.query.q) { sql += ' and (p.title like ? or p.result like ? or p.description like ? or p.stack like ?)'; const q = `%${String(req.query.q).slice(0,80)}%`; args.push(q,q,q,q); }
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
    let link = `tg://invoice?slug=test-${order.id}`; if (bot) link = await bot.api.createInvoiceLink(`Покупка: ${order.product_title}`, 'Цифровой товар. Доступ выдаётся после successful_payment.', order.payload, '', 'XTR', [{ label: order.product_title, amount: order.amount_xtr }]);
    await db.prepare('update orders set invoice_link=? where id=?').run(link, order.id); await event(req.userId, 'invoice_opened', order.product_id); res.json({ invoiceLink: link });
  });

  app.post('/api/webhooks/telegram', async (req: any, res) => {
    if (config.WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== config.WEBHOOK_SECRET) return safeError(res, 403, 'bad_webhook_secret', 'Forbidden');
    const update = req.body; if (update.update_id != null) { const inserted = await db.prepare('insert or ignore into webhook_updates(update_id) values(?)').run(String(update.update_id)); if (inserted.changes === 0) return res.json({ ok: true, duplicate: true }); }
    if (update.pre_checkout_query) { const q = update.pre_checkout_query; const order = await db.prepare('select * from orders where payload=?').get(q.invoice_payload) as any; const ok = Boolean(order && order.status === 'pending' && q.currency === 'XTR' && Number(q.total_amount) === Number(order.amount_xtr)); if (!ok) log('warn','pre_checkout_rejected',{ payload: q.invoice_payload?.slice(0,20) }); if (bot) await bot.api.answerPreCheckoutQuery(q.id, ok, ok ? undefined : { error_message: 'Заказ устарел или цена изменилась. Создайте новый заказ.' }); return res.json({ ok }); }
    const payment = update.message?.successful_payment;
    if (payment) { const order = await db.prepare('select * from orders where payload=?').get(payment.invoice_payload) as any; const valid = order && payment.currency === 'XTR' && Number(payment.total_amount) === Number(order.amount_xtr); if (valid && order.status !== 'paid' && order.status !== 'fulfilled') { await db.transaction(async () => { await db.prepare("update orders set status='fulfilled',telegram_charge_id=?,paid_at=CURRENT_TIMESTAMP,fulfilled_at=CURRENT_TIMESTAMP where id=? and status='pending'").run(payment.telegram_payment_charge_id, order.id); await db.prepare('insert or ignore into entitlements(id,user_id,product_id,license_id,order_id) values(?,?,?,?,?)').run(nanoid(), order.user_id, order.product_id, order.license_id, order.id); }); await event(order.user_id, 'payment_success', order.product_id, { orderId: order.id }); } else if (!valid) { log('warn', 'payment_rejected', { payload: payment.invoice_payload?.slice(0,20) }); } }
    res.json({ ok: true });
  });

  app.get('/api/me/purchases', user, async (req: any, res) => res.json({ items: await db.prepare('select e.*,p.title,p.version,l.name license_name from entitlements e join products p on p.id=e.product_id join license_plans l on l.id=e.license_id where e.user_id=? and e.active=1 order by e.created_at desc').all(req.userId) }));
  app.post('/api/purchases/:id/download', user, limiter, async (req: any, res) => {
    const e = await db.prepare('select e.*,p.version from entitlements e join products p on p.id=e.product_id where e.id=? and e.user_id=? and e.active=1').get(req.params.id, req.userId) as any; if (!e) return safeError(res, 404, 'entitlement_not_found', 'Покупка не найдена');
    let asset = await db.prepare("select * from product_assets where product_id=? and version=? and status in ('approved','published') order by created_at desc").get(e.product_id, e.version) as any;
    if (!asset) { const demo = await ensureDemoAsset(e.product_id, e.version); const id = nanoid(); await db.prepare('insert into product_assets(id,product_id,version,storage_key,file_name,mime_type,size_bytes,checksum_sha256,status) values(?,?,?,?,?,?,?,?,?)').run(id,e.product_id,e.version,demo.key,'demo-package.txt','text/plain',demo.size,demo.checksum,'published'); asset = await db.prepare('select * from product_assets where id=?').get(id); }
    const token = nanoid(40); const ttl = config.DOWNLOAD_TTL_SECONDS; await db.prepare('insert into delivery_events(id,entitlement_id,asset_id,token_hash,expires_at) values(?,?,?,?,?)').run(nanoid(), e.id, asset.id, hashToken(token), Math.floor(Date.now()/1000)+ttl); await event(req.userId,'delivery_opened',e.product_id); res.json({ url: `/api/download/${token}`, expiresIn: ttl });
  });
  app.get('/api/download/:token', async (req, res) => { const d = await db.prepare('select d.*,a.storage_key,a.file_name,a.mime_type from delivery_events d join product_assets a on a.id=d.asset_id where d.token_hash=?').get(hashToken(req.params.token)) as any; if (!d || d.expires_at < Math.floor(Date.now()/1000)) return res.status(410).send('Link expired'); await db.prepare("update delivery_events set used_at=CURRENT_TIMESTAMP,status='used' where id=?").run(d.id); res.setHeader('Content-Type', d.mime_type); res.setHeader('Content-Disposition', `attachment; filename="${String(d.file_name).replace(/"/g,'')}"`); (await readAsset(d.storage_key)).pipe(res); });

  app.post('/api/admin/products', user, adminRole(['owner','editor']), limiter, async (req: any, res) => { const p = req.body; if (!p.title || p.title.length > 120 || !p.result || p.result.length > 240 || !['template','ready_bot','module','service'].includes(p.type) || !p.category) return safeError(res,400,'validation_failed','Проверьте поля товара'); const id = p.id || nanoid(8); await db.prepare('insert into products(id,slug,type,category,title,result,description,stack,demo_url,preview,version,changelog,status) values(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,p.slug||id,p.type,p.category,p.title,p.result,p.description||'',p.stack||'',p.demo_url||'',p.preview||'',p.version||'1.0.0',p.changelog||'',p.status||'draft'); await audit(req.userId,'product_create','product',id); res.json({ id }); });
  app.post('/api/admin/orders/:id/refund', user, adminRole(['owner']), limiter, async (req: any, res) => { const reason = String(req.body.reason || '').trim(); if (reason.length < 5) return safeError(res,400,'reason_required','Укажите причину возврата'); const order = await db.prepare('select * from orders where id=?').get(req.params.id) as any; if (!order?.telegram_charge_id) return safeError(res,404,'charge_not_found','Оплаченный заказ не найден'); if (order.status === 'refunded') return res.json({ ok:true, idempotent:true }); const refundUser = await db.prepare('select telegram_id from users where id=?').get(order.user_id) as any; if (bot) await bot.api.refundStarPayment(Number(refundUser.telegram_id), order.telegram_charge_id); await db.transaction(async ()=>{ await db.prepare('update orders set status="refunded",refund_reason=?,refunded_at=CURRENT_TIMESTAMP where id=?').run(reason,order.id); await db.prepare('update entitlements set active=0,revoked_at=CURRENT_TIMESTAMP where order_id=?').run(order.id); }); await audit(req.userId,'refund','order',order.id,'ok',{ reason }); res.json({ ok:true }); });


  app.post('/api/admin/assets/upload', user, adminRole(['owner','editor']), limiter, upload.single('file'), async (req: any, res) => {
    const file = req.file; const productId = String(req.body.productId || ''); const version = String(req.body.version || '');
    if (!file || !productId || !version) return safeError(res, 400, 'upload_required', 'Нужен файл, productId и version');
    const product = await db.prepare('select * from products where id=?').get(productId) as any; if (!product) return safeError(res, 404, 'product_not_found', 'Товар не найден');
    const scan = await scanArchiveBuffer(file.buffer, file.originalname, file.mimetype);
    const assetId = nanoid(); const key = createAssetKey(productId, version, assetId, file.originalname, !scan.ok);
    const stored = await storage.putObject({ key, body: file.buffer, contentType: file.mimetype, fileName: file.originalname });
    await db.prepare('insert into product_assets(id,product_id,version,storage_key,file_name,mime_type,size_bytes,checksum_sha256,status,scan_findings,quarantine_key) values(?,?,?,?,?,?,?,?,?,?,?)').run(assetId, productId, version, key, file.originalname.replace(/[^a-zA-Z0-9_.-]/g,'_'), file.mimetype, stored.size, stored.checksum, scan.ok ? 'approved' : 'rejected', JSON.stringify(scan.findings), scan.ok ? null : key);
    await audit(req.userId, 'asset_upload_scan', 'asset', assetId, scan.ok ? 'approved' : 'rejected', { findings: scan.findings });
    res.status(scan.ok ? 201 : 422).json({ id: assetId, status: scan.ok ? 'approved' : 'rejected', findings: scan.findings });
  });
  app.post('/api/admin/assets/:id/publish', user, adminRole(['owner','editor']), limiter, async (req: any, res) => { const asset = await db.prepare('select * from product_assets where id=?').get(req.params.id) as any; if (!asset || !['approved','published'].includes(asset.status)) return safeError(res, 409, 'asset_not_approved', 'Asset не прошёл проверку'); await db.prepare("update product_assets set status='published' where id=?").run(asset.id); await audit(req.userId,'asset_publish','asset',asset.id); res.json({ ok: true }); });

  if (bot) { bot.command('start', (ctx) => ctx.reply('Открой каталог шаблонов ботов', { reply_markup: new InlineKeyboard().webApp('Открыть магазин', config.WEBAPP_URL || 'https://example.com') })); bot.command('terms', (ctx) => ctx.reply('Terms: цифровой товар, доступ после оплаты Stars. Возвраты через поддержку.')); bot.command('support', (ctx) => ctx.reply('Поддержка: напишите сообщение с номером заказа.')); bot.command('paysupport', (ctx) => ctx.reply('Вопросы по платежам Stars и возвратам принимаются здесь.')); bot.command('help', (ctx) => ctx.reply('/start /terms /support /paysupport')); }
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/health/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });

  return app;
}
