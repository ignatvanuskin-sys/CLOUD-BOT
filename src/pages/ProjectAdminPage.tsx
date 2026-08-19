import {useState} from 'react';
import {useMutation, useQuery} from '@tanstack/react-query';
import {FolderPlus, Shield} from 'lucide-react';
import {createProject, getAccess, publishProjectAsset, uploadProjectAsset} from '../api/queries';
import {Button, Card, EmptyState, PageLoader} from '../components/ui';
import {useSession} from '../providers/AppProviders';

type ProjectForm = { title: string; slug: string; type: 'template' | 'ready_bot' | 'module' | 'service'; category: string; result: string; description: string; stack: string; version: string };
const initialForm: ProjectForm = { title: '', slug: '', type: 'template', category: '', result: '', description: '', stack: '', version: '1.0.0' };

export default function ProjectAdminPage() {
  const auth = useSession();
  const access = useQuery({queryKey: ['access'], queryFn: getAccess, enabled: auth.authenticated});
  const [form, setForm] = useState(initialForm), [file, setFile] = useState<File|null>(null), [projectId, setProjectId] = useState(''), [assetId, setAssetId] = useState(''), [message, setMessage] = useState('');
  const create = useMutation({mutationFn: () => createProject(form), onSuccess: result => {setProjectId(result.id);setMessage(`Проект создан как draft: ${result.id}`)}, onError: error => setMessage(error instanceof Error ? error.message : 'Не удалось создать проект')});
  const set = (key: keyof ProjectForm, value: string) => setForm(current => ({...current,[key]:value}));
  async function upload(){if(!projectId||!file)return setMessage('Сначала создайте проект и выберите ZIP-файл');try{const result=await uploadProjectAsset(projectId,form.version,file);setAssetId(result.id);setMessage(`Файл проверен: ${result.status}`)}catch(error){setMessage(error instanceof Error?error.message:'Не удалось загрузить файл')}}
  async function publish(){if(!assetId)return;try{await publishProjectAsset(assetId);setMessage('Файл опубликован и доступен покупателям')}catch(error){setMessage(error instanceof Error?error.message:'Не удалось опубликовать файл')}}
  if(!auth.authenticated)return <div className="page"><EmptyState title="Нужен вход через Telegram" text="Управление проектами доступно только авторизованным администраторам."/></div>;
  if(access.isLoading)return <div className="page"><PageLoader/></div>;
  if(!access.data?.canCreateProjects)return <div className="page"><EmptyState title="Доступ запрещён" text="Создавать проекты могут только owner и editor."/></div>;
  return <div className="page"><div className="page-heading"><span className="eyebrow">Admin workspace · {access.data.role}</span><h1>Добавить проект</h1><p>Проект создаётся как draft. Архив проверяется сервером и публикуется отдельно.</p></div><Card className="form-card"><label>Название<input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Telegram-магазин"/></label><label>Slug<input value={form.slug} onChange={e=>set('slug',e.target.value)} placeholder="telegram-store"/></label><label>Тип<select value={form.type} onChange={e=>set('type',e.target.value)}><option value="template">Шаблон</option><option value="ready_bot">Готовый бот</option><option value="module">Модуль</option><option value="service">Сервис</option></select></label><label>Категория<input value={form.category} onChange={e=>set('category',e.target.value)} placeholder="Автоматизация"/></label><label>Результат для клиента<input value={form.result} onChange={e=>set('result',e.target.value)} placeholder="Запускает продажи в Telegram"/></label><label>Описание<textarea value={form.description} onChange={e=>set('description',e.target.value)} rows={4}/></label><label>Стек<input value={form.stack} onChange={e=>set('stack',e.target.value)} placeholder="Node.js, PostgreSQL"/></label><label>Версия<input value={form.version} onChange={e=>set('version',e.target.value)}/></label><Button className="primary" disabled={create.isPending||Boolean(projectId)} onClick={()=>create.mutate()}><FolderPlus/>Создать draft</Button></Card>{projectId&&<Card className="form-card"><h2>Файл проекта</h2><p>Загрузите ZIP-архив. Он будет проверен до публикации.</p><input type="file" accept=".zip,application/zip" onChange={e=>setFile(e.target.files?.[0]||null)}/><div className="hero-actions"><Button disabled={!file} onClick={upload}>Проверить и загрузить</Button><Button className="primary" disabled={!assetId} onClick={publish}>Опубликовать</Button></div></Card>}{message&&<Card className="info-banner"><Shield/><div><b>Статус операции</b><span>{message}</span></div></Card>}</div>;
}
