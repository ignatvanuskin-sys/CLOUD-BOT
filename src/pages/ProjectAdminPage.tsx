import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Shield, Star } from 'lucide-react';
import { createLicensePlan, createProject, getAccess, getAdminPlans, publishProjectAsset, uploadProjectAsset } from '../api/queries';
import type { LicensePlanInput } from '../types/api';
import { Button, Card, EmptyState, PageLoader } from '../components/ui';
import { useSession } from '../providers/AppProviders';
import { formatStars } from '../utils/cn';

type ProjectForm = { title: string; slug: string; type: 'ready_bot' | 'module' | 'service'; category: string; result: string; description: string; stack: string; version: string };
const initialForm: ProjectForm = { title: '', slug: '', type: 'ready_bot', category: '', result: '', description: '', stack: '', version: '1.0.0' };
const initialPlan: LicensePlanInput = { name: 'Стандарт', price_xtr: 100, projects: 1, commercial: 0, support_days: 30, updates_days: 365, terms: '' };

export default function ProjectAdminPage() {
  const auth = useSession();
  const client = useQueryClient();
  const access = useQuery({ queryKey: ['access'], queryFn: getAccess, enabled: auth.authenticated });
  const [form, setForm] = useState(initialForm), [planForm, setPlanForm] = useState<LicensePlanInput>(initialPlan);
  const [file, setFile] = useState<File | null>(null), [projectId, setProjectId] = useState(''), [assetId, setAssetId] = useState(''), [message, setMessage] = useState('');
  const create = useMutation({
    mutationFn: () => createProject(form),
    onSuccess: result => { setProjectId(result.id); setMessage(`Проект создан как draft: ${result.id}`); },
    onError: error => setMessage(error instanceof Error ? error.message : 'Не удалось создать проект'),
  });
  const plans = useQuery({ queryKey: ['adminPlans', projectId], queryFn: () => getAdminPlans(projectId), enabled: Boolean(projectId) });
  const createPlan = useMutation({
    mutationFn: () => createLicensePlan(projectId, planForm),
    onSuccess: () => { setMessage('Тариф сохранён. Без тарифа товар нельзя продавать — теперь можно публиковать.'); client.invalidateQueries({ queryKey: ['adminPlans', projectId] }); },
    onError: error => setMessage(error instanceof Error ? error.message : 'Не удалось сохранить тариф'),
  });
  const set = (key: keyof ProjectForm, value: string) => setForm(current => ({ ...current, [key]: value }));
  const setPlan = (key: keyof LicensePlanInput, value: string | number) => setPlanForm(current => ({ ...current, [key]: value }));
  async function upload() {
    if (!projectId || !file) return setMessage('Сначала создайте проект и выберите ZIP-файл');
    try { const result = await uploadProjectAsset(projectId, form.version, file); setAssetId(result.id); setMessage(`Файл проверен: ${result.status}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось загрузить файл'); }
  }
  async function publish() {
    if (!assetId) return;
    if (!(plans.data?.items.length)) return setMessage('Создайте тариф, прежде чем публиковать товар');
    try { await publishProjectAsset(assetId); setMessage('Файл опубликован и доступен покупателям'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось опубликовать файл'); }
  }
  if (!auth.authenticated) return <div className="page"><EmptyState title="Нужен вход через Telegram" text="Управление проектами доступно только авторизованным администраторам." /></div>;
  if (access.isLoading) return <div className="page"><PageLoader /></div>;
  if (!access.data?.canCreateProjects) return <div className="page"><EmptyState title="Доступ запрещён" text="Создавать проекты могут только owner и editor." /></div>;
  return <div className="page">
    <div className="page-heading"><span className="eyebrow">Admin workspace · {access.data.role}</span><h1>Добавить проект</h1><p>Проект создаётся как draft. Добавьте тариф и цену, затем архив проверяется сервером и публикуется отдельно.</p></div>
    <Card className="form-card">
      <label>Название<input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Telegram-магазин" /></label>
      <label>Slug<input value={form.slug} onChange={e => set('slug', e.target.value)} placeholder="telegram-store" /></label>
      <label>Тип<select value={form.type} onChange={e => set('type', e.target.value)}><option value="template">Шаблон</option><option value="ready_bot">Готовый бот</option><option value="module">Модуль</option><option value="service">Сервис</option></select></label>
      <label>Категория<input value={form.category} onChange={e => set('category', e.target.value)} placeholder="Автоматизация" /></label>
      <label>Результат для клиента<input value={form.result} onChange={e => set('result', e.target.value)} placeholder="Запускает продажи в Telegram" /></label>
      <label>Описание<textarea value={form.description} onChange={e => set('description', e.target.value)} rows={4} /></label>
      <label>Стек<input value={form.stack} onChange={e => set('stack', e.target.value)} placeholder="Node.js, PostgreSQL" /></label>
      <label>Версия<input value={form.version} onChange={e => set('version', e.target.value)} /></label>
      <Button className="primary" disabled={create.isPending || Boolean(projectId)} onClick={() => create.mutate()}><FolderPlus />Создать draft</Button>
    </Card>
    {projectId && <Card className="form-card">
      <h2>Тариф и цена</h2>
      <p>Без тарифа товар нельзя продавать: покупатель выбирает тариф и оплачивает Stars.</p>
      {plans.data?.items.length ? <div className="plan-list">{plans.data.items.map(p => <div className="plan-card" key={p.id}><div><b>{p.name}</b><small>{p.projects} проект · поддержка {p.support_days} дней · обновления {p.updates_days} дней</small></div><strong>{formatStars(p.price_xtr)}</strong></div>)}</div> : <p className="muted">Тарифов пока нет.</p>}
      <label>Название тарифа<input value={planForm.name} onChange={e => setPlan('name', e.target.value)} placeholder="Стандарт" /></label>
      <label>Цена (⭐ Stars)<input type="number" min={1} max={2500} value={planForm.price_xtr} onChange={e => setPlan('price_xtr', Number(e.target.value))} /></label>
      <label>Проектов<input type="number" min={1} value={planForm.projects} onChange={e => setPlan('projects', Number(e.target.value))} /></label>
      <label>Поддержка (дней)<input type="number" min={0} value={planForm.support_days} onChange={e => setPlan('support_days', Number(e.target.value))} /></label>
      <label>Обновления (дней)<input type="number" min={0} value={planForm.updates_days} onChange={e => setPlan('updates_days', Number(e.target.value))} /></label>
      <label>Коммерческое использование<select value={planForm.commercial} onChange={e => setPlan('commercial', Number(e.target.value))}><option value={0}>Нет</option><option value={1}>Да</option></select></label>
      <label>Условия лицензии<textarea value={planForm.terms} onChange={e => setPlan('terms', e.target.value)} rows={2} /></label>
      <Button className="primary" disabled={createPlan.isPending} onClick={() => createPlan.mutate()}><Star />Сохранить тариф</Button>
    </Card>}
    {projectId && <Card className="form-card">
      <h2>Файл проекта</h2>
      <p>Загрузите ZIP-архив (или текстовый файл). Он будет проверен до публикации.</p>
      <input type="file" accept=".zip,application/zip,.txt,text/plain" onChange={e => setFile(e.target.files?.[0] || null)} />
      <div className="hero-actions">
        <Button disabled={!file} onClick={upload}>Проверить и загрузить</Button>
        <Button className="primary" disabled={!assetId || !(plans.data?.items.length)} onClick={publish}>Опубликовать</Button>
      </div>
      {!(plans.data?.items.length) ? <p className="muted">Опубликовать можно после создания тарифа.</p> : null}
    </Card>}
    {message && <Card className="info-banner"><Shield /><div><b>Статус операции</b><span>{message}</span></div></Card>}
  </div>;
}
