import 'dotenv/config';
import { db, migrate } from './db';
import { ensureDemoAsset } from './storage';

if (process.env.NODE_ENV === 'production') throw new Error('Seed is disabled in production');
await migrate();
const items = [
  ['tg-shop-starter', 'Магазин товаров в Telegram', 'Каталог, корзина и заявки без сайта', 'template', 'store'],
  ['booking-bot-pro', 'Запись и бронирование', 'Слоты, напоминания и заявки мастеру', 'ready_bot', 'booking'],
  ['closed-content-kit', 'Закрытый контент', 'Выдача доступа к курсам и материалам', 'template', 'content'],
  ['lead-crm-router', 'Лиды в CRM', 'Формы, квалификация и отправка менеджеру', 'module', 'leads'],
  ['faq-support-ai', 'AI FAQ поддержка', 'Ответы по базе знаний и эскалация', 'ready_bot', 'support'],
  ['miniapp-window', 'Mini App витрина', 'Мобильная витрина с Telegram Stars', 'template', 'ai'],
];
for (const [id, title, result, type, cat] of items) {
  await db.prepare('insert into products(id,slug,type,category,title,result,description,stack,demo_url,preview,version,changelog,status) values(?,?,?,?,?,?,?,?,?,?,?,?,?) on conflict(id) do update set slug=excluded.slug,type=excluded.type,category=excluded.category,title=excluded.title,result=excluded.result,description=excluded.description,stack=excluded.stack,demo_url=excluded.demo_url,preview=excluded.preview,version=excluded.version,changelog=excluded.changelog,status=excluded.status').run(id,id,type,cat,title,result,`Готовый запуск: ${result}. В комплекте исходный код, инструкция, лицензия и демо-данные.`,'Node.js, TypeScript, Telegram Bot API, React Mini App','https://t.me/demo','/preview.svg','1.0.0','Первый релиз MVP','published');
  for (const plan of [['starter',299,1,0,14,30],['pro',799,1,1,30,90],['agency',1999,5,1,60,180]]) await db.prepare('insert into license_plans(id,product_id,name,price_xtr,projects,commercial,support_days,updates_days,terms) values(?,?,?,?,?,?,?,?,?) on conflict(id) do update set product_id=excluded.product_id,name=excluded.name,price_xtr=excluded.price_xtr,projects=excluded.projects,commercial=excluded.commercial,support_days=excluded.support_days,updates_days=excluded.updates_days,terms=excluded.terms').run(`${id}-${plan[0]}`,id,String(plan[0]).toUpperCase(),plan[1],plan[2],plan[3],plan[4],plan[5],'Нельзя перепродавать исходник отдельно. Можно изменять код под разрешённые проекты.');
  const asset = await ensureDemoAsset(id, '1.0.0');
  await db.prepare('insert into product_assets(id,product_id,version,storage_key,file_name,mime_type,size_bytes,checksum_sha256,status) values(?,?,?,?,?,?,?,?,?) on conflict(id) do update set product_id=excluded.product_id,version=excluded.version,storage_key=excluded.storage_key,file_name=excluded.file_name,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,checksum_sha256=excluded.checksum_sha256,status=excluded.status').run(`${id}-asset-1`, id, '1.0.0', asset.key, 'demo-package.txt', 'text/plain', asset.size, asset.checksum, 'published');
}
for (const id of (process.env.ADMIN_TELEGRAM_IDS || '').split(',').filter(Boolean)) await db.prepare('insert into admin_users(telegram_id,role) values(?,?) on conflict(telegram_id) do nothing').run(id.trim(), 'owner');
console.log('seeded', items.length, 'products');
