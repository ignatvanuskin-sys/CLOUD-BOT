import 'dotenv/config';
import { db, migrate } from './db';
import { ensureDemoAsset } from './storage';

if (process.env.NODE_ENV === 'production') throw new Error('Seed is disabled in production');
migrate();
const items = [
  ['tg-shop-starter', 'Магазин товаров в Telegram', 'Каталог, корзина и заявки без сайта', 'template', 'store'],
  ['booking-bot-pro', 'Запись и бронирование', 'Слоты, напоминания и заявки мастеру', 'ready_bot', 'booking'],
  ['closed-content-kit', 'Закрытый контент', 'Выдача доступа к курсам и материалам', 'template', 'content'],
  ['lead-crm-router', 'Лиды в CRM', 'Формы, квалификация и отправка менеджеру', 'module', 'leads'],
  ['faq-support-ai', 'AI FAQ поддержка', 'Ответы по базе знаний и эскалация', 'ready_bot', 'support'],
  ['miniapp-window', 'Mini App витрина', 'Мобильная витрина с Telegram Stars', 'template', 'ai'],
];
for (const [id, title, result, type, cat] of items) {
  db.prepare('insert or replace into products(id,slug,type,category,title,result,description,stack,demo_url,preview,version,changelog,status) values(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,id,type,cat,title,result,`Готовый запуск: ${result}. В комплекте исходный код, инструкция, лицензия и демо-данные.`,'Node.js, TypeScript, Telegram Bot API, React Mini App','https://t.me/demo','/preview.svg','1.0.0','Первый релиз MVP','published');
  for (const p of [['starter',299,1,0,14,30],['pro',799,1,1,30,90],['agency',1999,5,1,60,180]]) db.prepare('insert or replace into license_plans(id,product_id,name,price_xtr,projects,commercial,support_days,updates_days,terms) values(?,?,?,?,?,?,?,?,?)').run(`${id}-${p[0]}`,id,String(p[0]).toUpperCase(),p[1],p[2],p[3],p[4],p[5],'Нельзя перепродавать исходник отдельно. Можно изменять код под разрешённые проекты.');
  const asset = await ensureDemoAsset(id, '1.0.0');
  db.prepare('insert or replace into product_assets(id,product_id,version,storage_key,file_name,mime_type,size_bytes,checksum_sha256) values(?,?,?,?,?,?,?,?)').run(`${id}-asset-1`, id, '1.0.0', asset.key, 'demo-package.txt', 'text/plain', asset.size, asset.checksum);
}
for (const id of (process.env.ADMIN_TELEGRAM_IDS || '').split(',').filter(Boolean)) db.prepare('insert or ignore into admin_users(telegram_id,role) values(?,?)').run(id.trim(), 'owner');
console.log('seeded', items.length, 'products');
