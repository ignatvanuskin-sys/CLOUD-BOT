import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Search, Download, ShieldCheck, ArrowLeft, Plus } from 'lucide-react';
import './style.css';

declare global {
  interface Window {
    Telegram?: any;
  }
}

const tg = window.Telegram?.WebApp;

type Product = {
  id: string;
  slug: string;
  type: string;
  category: string;
  title: string;
  result: string;
  description: string;
  stack: string;
  demo_url: string;
  version: string;
  changelog: string;
  price_from: number;
};

type Plan = {
  id: string;
  name: string;
  price_xtr: number;
  projects: number;
  commercial: number;
  support_days: number;
  updates_days: number;
  terms: string;
};

async function api(path: string, opts: RequestInit = {}) {
  const storage = tg?.WebAppStorage;
  let token: string | null = null;
  try { token = await storage?.getItem('token'); } catch { /* ignore */ }
  if (!token) token = localStorage.getItem('token');
  const response = await fetch('/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opts.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    const error = body?.error;
    const message = typeof error === 'string' ? error : error?.message || error?.code || 'request_failed';
    throw new Error(message);
  }

  return response.json();
}

function App() {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<any>({ name: 'home' });
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    tg?.ready();
    tg?.expand();
    const initData = tg?.initData || new URLSearchParams(location.hash.slice(1)).get('tgWebAppData') || '';
    if (!initData) {
      const hasTelegram = Boolean(window.Telegram?.WebApp);
      const platform = tg?.platform || 'unknown';
      setErr(`Telegram не передал initData. Откройте приложение именно через Mini App/Menu Button. Диагностика: Telegram.WebApp=${hasTelegram ? 'yes' : 'no'}, platform=${platform}, hash=${location.hash ? 'present' : 'empty'}.`);
      setReady(true);
      return;
    }
    api('/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData, devTelegramId: import.meta.env.DEV ? '777' : undefined }),
    })
      .then((auth) => {
        try { tg?.WebAppStorage?.setItem('token', auth.token); } catch { /* ignore */ }
          localStorage.setItem('token', auth.token);
        setReady(true);
        const startParam = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('tgWebAppStartParam') || '';
        return api('/start-param', { method: 'POST', body: JSON.stringify({ startParam }) });
      })
      .then((parsed) => {
        if (parsed?.kind === 'product') setPage({ name: 'product', id: parsed.id });
        if (parsed?.kind === 'category') setFilter(parsed.slug);
      })
      .catch((e) => {
        setErr(e.message);
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      api('/products?' + new URLSearchParams({ q, category: filter }).toString())
        .then((result) => setProducts(result.items))
        .catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [ready, q, filter]);

  useEffect(() => {
    if (!tg?.BackButton) return;
    const goHome = () => setPage({ name: 'home' });
    if (page.name === 'home') tg.BackButton.hide();
    else tg.BackButton.show();
    tg.BackButton.onClick(goHome);
    return () => tg.BackButton.offClick(goHome);
  }, [page.name]);

  if (!ready) return <Shell><Loader text="Запускаем Mini App" /></Shell>;
  if (err) return <Shell><State title="Ошибка" text={err} /></Shell>;
  if (page.name === 'product') return <ProductPage id={page.id} back={() => setPage({ name: 'home' })} />;
  if (page.name === 'purchases') return <Purchases back={() => setPage({ name: 'home' })} />;
  if (page.name === 'admin') return <Admin back={() => setPage({ name: 'home' })} />;

  return <Shell><Hero /><SearchBox q={q} setQ={setQ} /><Categories active={filter} set={setFilter} /><Section title="Популярное" items={products.slice(0, 3)} open={(id: string) => setPage({ name: 'product', id })} /><Section title="Новые шаблоны" items={products.slice(3)} open={(id: string) => setPage({ name: 'product', id })} /><button className="ghost" onClick={() => setPage({ name: 'purchases' })}>Мои покупки</button><button className="ghost" onClick={() => setPage({ name: 'admin' })}><Plus size={16} /> Админ</button></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) { return <main><div className="wrap">{children}</div></main>; }
function Hero() { return <header className="hero"><div className="kicker">Developer marketplace / launchpad</div><h1>Запускайте Telegram-автоматизацию без недель разработки</h1><p>Шаблоны ботов, Mini Apps, модули и установка — с понятной лицензией и выдачей после оплаты Stars.</p></header>; }
function SearchBox({ q, setQ }: { q: string; setQ: (value: string) => void }) { return <label className="search"><Search size={18} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по задаче, стеку, шаблону" /></label>; }
function Categories({ active, set }: { active: string; set: (value: string) => void }) { const cats = [['', 'Все'], ['store', 'Магазин'], ['booking', 'Запись'], ['content', 'Контент'], ['leads', 'Лиды'], ['support', 'FAQ'], ['ai', 'AI']]; return <div className="chips">{cats.map((c) => <button key={c[0]} className={active === c[0] ? 'on' : ''} onClick={() => set(c[0])}>{c[1]}</button>)}</div>; }
function Section({ title, items, open }: { title: string; items: Product[]; open: (id: string) => void }) { return <section><h2>{title}</h2>{!items.length ? <State title="Пока пусто" text="Попробуйте другой фильтр" /> : <div className="grid">{items.map((p) => <article className="card" key={p.id} onClick={() => open(p.id)}><div className="badge">{p.type}</div><h3>{p.title}</h3><p>{p.result}</p><div className="meta"><span>{p.stack?.split(',')[0]}</span><b>{p.price_from} ⭐</b></div><button>Открыть</button></article>)}</div>}</section>; }

function ProductPage({ id, back }: { id: string; back: () => void }) {
  const [data, setData] = useState<any>();
  const [plan, setPlan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api('/products/' + id).then((result) => { setData(result); setPlan(result.plans[0]?.id); }).catch((e) => setError(e.message)); }, [id]);

  if (error) return <Shell><button className="back" onClick={back}><ArrowLeft /> Назад</button><State title="Товар не найден" text="Откройте каталог и выберите доступный шаблон." /></Shell>;
  if (!data) return <Shell><Loader text="Загружаем товар" /></Shell>;

  const product = data.product as Product;
  async function buy() {
    try {
      setBusy(true);
      const order = await api('/orders', { method: 'POST', body: JSON.stringify({ licenseId: plan }) });
      const invoice = await api(`/orders/${order.order.id}/invoice`, { method: 'POST' });
      if (tg?.openInvoice) tg.openInvoice(invoice.invoiceLink, () => setBusy(false));
      else location.href = invoice.invoiceLink;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return <Shell><button className="back" onClick={back}><ArrowLeft /> Назад</button><article className="product"><div className="preview">DEMO / GIF / SCREENSHOTS</div><h1>{product.title}</h1><p className="lead">{product.result}</p><div className="cols"><Info title="Для кого" text="Малый бизнес, эксперты, агентства запуска." /><Info title="Что запускает" text={product.description} /><Info title="Стек" text={product.stack} /><Info title="Версия" text={`${product.version}: ${product.changelog}`} /></div><h2>Лицензия</h2><div className="plans">{data.plans.map((license: Plan) => <button key={license.id} className={plan === license.id ? 'on' : ''} onClick={() => setPlan(license.id)}><b>{license.name}</b><span>{license.price_xtr} ⭐</span><small>{license.projects} проект(ов), поддержка {license.support_days} дней</small></button>)}</div><div className="notice"><ShieldCheck /> Цифровой товар. Цена и права проверяются на сервере; возврат через поддержку Stars.</div><button className="main" disabled={busy || !plan} onClick={buy}>{busy ? 'Открываем invoice…' : 'Купить через Telegram Stars'}</button></article></Shell>;
}
function Info({ title, text }: { title: string; text: string }) { return <div className="info"><b>{title}</b><span>{text}</span></div>; }

function Purchases({ back }: { back: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => { api('/me/purchases').then((result) => setItems(result.items)); }, []);
  async function download(id: string) { const result = await api('/purchases/' + id + '/download', { method: 'POST' }); setMsg('Ссылка активна ' + result.expiresIn + ' сек: ' + result.url); }
  return <Shell><button className="back" onClick={back}><ArrowLeft /> Назад</button><h1>Мои покупки</h1>{msg && <p className="notice">{msg}</p>}{items.length ? items.map((item) => <div className="row" key={item.id}><b>{item.title}</b><span>{item.license_name} · v{item.version}</span><button onClick={() => download(item.id)}><Download size={16} /> Скачать</button></div>) : <State title="Покупок нет" text="После оплаты здесь появятся файлы, инструкции и обновления." />}</Shell>;
}

function Admin({ back }: { back: () => void }) {
  const [title, setTitle] = useState('');
  const [out, setOut] = useState('');
  async function add() { const result = await api('/admin/products', { method: 'POST', body: JSON.stringify({ title, result: 'Новый результат для бизнеса', type: 'template', category: 'store', status: 'draft' }) }); setOut('Создан черновик ' + result.id); }
  return <Shell><button className="back" onClick={back}><ArrowLeft /> Назад</button><h1>Админ: товар</h1><input className="adminInput" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название товара" /><button className="main" disabled={!title.trim()} onClick={add}>Добавить товар</button>{out && <p>{out}</p>}</Shell>;
}

function Loader({ text }: { text: string }) { return <div className="state"><div className="spin" /><h2>{text}</h2></div>; }
function State({ title, text }: { title: string; text: string }) { return <div className="state"><h2>{title}</h2><p>{text}</p></div>; }

createRoot(document.getElementById('root')!).render(<App />);
