import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Filter, Search as SearchIcon, SlidersHorizontal, X } from 'lucide-react';
import { CATEGORIES } from '../constants/app';
import { ProductGrid } from '../features/catalog';
import { useCatalog } from '../hooks/useCatalog';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import type { ProductType } from '../types/api';
import { haptic, readClipboard } from '../services/telegram';

const MAX_QUERY_LENGTH = 120;
const sortValues = ['new', 'price', 'popular'] as const;
const productTypes = ['ready_bot', 'module', 'service'] as const;
type Sort = (typeof sortValues)[number];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(() => (params.get('q') || '').slice(0, MAX_QUERY_LENGTH));
  const [category, setCategory] = useState(params.get('category') || '');
  const initialType = params.get('type');
  const [type, setType] = useState<ProductType | undefined>(productTypes.includes(initialType as ProductType) ? initialType as ProductType : undefined);
  const initialSort = params.get('sort') as Sort | null;
  const [sort, setSort] = useState<Sort>(initialSort && sortValues.includes(initialSort) ? initialSort : 'popular');
  const query = useCatalog({ q, category, type, sort, limit: 50 });

  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (category) next.set('category', category);
    if (type) next.set('type', type);
    if (sort !== 'popular') next.set('sort', sort);
    setParams(next, { replace: true });
  }, [category, q, setParams, sort, type]);

  async function paste() {
    const text = (await readClipboard()).slice(0, MAX_QUERY_LENGTH);
    if (text) setQ(text);
  }

  function resetFilters() {
    setQ(''); setCategory(''); setType(undefined); setSort('popular');
  }

  return <div className="page">
    <div className="page-heading"><span className="eyebrow">Smart discovery</span><h1>Найдите готовое решение</h1><p>По задаче, технологии, категории или бюджету.</p></div>
    <form className="search-sticky" role="search" onSubmit={event => event.preventDefault()}>
      <label className="search-box" htmlFor="catalog-search"><SearchIcon aria-hidden/><span className="sr-only">Поиск по каталогу</span><input id="catalog-search" value={q} maxLength={MAX_QUERY_LENGTH} onChange={event => setQ(event.target.value)} placeholder="AI-бот, магазин, бронирование…" autoFocus/><button type="button" onClick={q ? () => setQ('') : paste} aria-label={q ? 'Очистить поиск' : 'Вставить из буфера'}><>{q ? <X aria-hidden /> : <SlidersHorizontal aria-hidden />}</></button></label>
      <div className="filter-row" aria-label="Категория">
        {CATEGORIES.map(([id, label]) => <button type="button" key={id} className={category === id ? 'active' : ''} aria-pressed={category === id} onClick={() => { setCategory(id); haptic.select(); }}>{label}</button>)}
      </div>
      <div className="select-row"><label><Filter aria-hidden/>Тип<select aria-label="Тип продукта" value={type || ''} onChange={event => setType((event.target.value || undefined) as ProductType | undefined)}><option value="">Любой</option><option value="ready_bot">Готовые боты</option><option value="module">Модули</option><option value="service">Сервисы</option></select></label><label>Сортировка<select aria-label="Сортировка результатов" value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="popular">Актуальные</option><option value="new">Сначала новые</option><option value="price">Сначала доступные</option></select></label></div>
    </form>
    <AnimatePresence mode="wait">{query.isLoading ? <motion.div className="product-grid" role="status" aria-label="Загрузка результатов"><Skeleton/><Skeleton/><Skeleton/><Skeleton/></motion.div> : query.error ? <ErrorState error={query.error} retry={() => query.refetch()}/> : query.data?.items.length ? <motion.div key={`${q}-${category}-${type}-${sort}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}><div className="result-count" aria-live="polite">Найдено: <b>{query.data.items.length}</b></div><ProductGrid items={query.data.items}/></motion.div> : <EmptyState title="Совпадений нет" text="Измените запрос или сбросьте фильтры." action={resetFilters}/>}</AnimatePresence>
  </div>;
}
