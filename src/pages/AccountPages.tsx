import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Award, Bell, BellRing, ChevronRight, Copy, Crown, Fingerprint, Globe2, Heart, History, Languages, LockKeyhole, LogOut, Moon, Palette, ReceiptText, Settings, Shield, Trash2, Users, MoreHorizontal, Sparkles, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getPurchases, logout } from '../api/queries';
import { session } from '../api/client';
import { Badge, Button, Card, EmptyState, Switch } from '../components/ui';
import { useAppFavorites, useAppPreferences, useSession } from '../providers/AppProviders';
import { authenticateBiometry, confirmPopup, haptic, share, showPopup, telegram } from '../services/telegram';

const profileMenu = [
  [History, 'История покупок', 'Покупки, статусы и файлы', '/history'],
  [ReceiptText, 'Платежи', 'Заказы и подтверждения', '/payments'],
  [Heart, 'Избранное', 'Сохранённые решения', '/favorites'],
  [Award, 'Достижения', 'Ваш прогресс', '/achievements'],
  [Users, 'Реферальная ссылка', 'Пригласить команду', '/referral'],
  [MoreHorizontal, 'Помощь и документы', 'FAQ, поддержка и legal', '/more'],
] as const;

export function ProfilePage() {
  const nav = useNavigate();
  const auth = useSession();
  const favorites = useAppFavorites();
  const { preferences } = useAppPreferences();
  const purchases = useQuery({ queryKey: ['purchases'], queryFn: getPurchases, enabled: auth.authenticated });
  const first = preferences.privateMode ? 'Приватный профиль' : telegram?.initDataUnsafe?.user?.first_name || auth.user?.name || 'Гость';
  const last = preferences.privateMode ? '' : telegram?.initDataUnsafe?.user?.last_name || '';
  const username = !preferences.privateMode && telegram?.initDataUnsafe?.user?.username ? `@${telegram.initDataUnsafe.user.username}` : 'Данные защищены Telegram';
  const licenseCount = purchases.data?.items.length || 0;
  const level = Math.min(12, licenseCount + favorites.ids.length);

  return <div className="page profile-page">
    <section className="profile-hero">
      <div className="profile-hero-top">
        <div className="profile-avatar-large" aria-hidden="true">{first[0]?.toUpperCase()}<span /></div>
        <div className="profile-hero-copy">
          <Badge><CheckCircle2 />{auth.authenticated ? 'Telegram подтверждён' : 'Гостевой режим'}</Badge>
          <h1>{first} {last}</h1>
          <p>{username}</p>
        </div>
        <Button className="profile-settings-button" aria-label="Открыть настройки" onClick={() => nav('/settings')}><Settings /></Button>
      </div>
      <div className="profile-status"><span><i /> Рабочее пространство активно</span><small>Синхронизация с Telegram CloudStorage</small></div>
    </section>

    <section className="profile-stats" aria-label="Статистика профиля">
      <Card><span className="stat-icon violet"><Crown /></span><div><b>{licenseCount}</b><small>активных лицензий</small></div></Card>
      <Card><span className="stat-icon cyan"><Heart /></span><div><b>{favorites.ids.length}</b><small>в избранном</small></div></Card>
      <Card><span className="stat-icon green"><Sparkles /></span><div><b>{level}</b><small>уровень workspace</small></div></Card>
    </section>

    <section className="profile-section">
      <div className="profile-section-heading"><div><span className="eyebrow">Workspace center</span><h2>Ваш профиль</h2><p>Управляйте покупками, доступом и настройками пространства.</p></div><Badge>{licenseCount ? 'Есть активные лицензии' : 'Готов к запуску'}</Badge></div>
      <div className="profile-menu-grid">{profileMenu.map(([Icon, title, text, to], i) => <motion.button className="profile-menu-item" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }} key={to} onClick={() => nav(to)}><span className="menu-icon"><Icon /></span><span className="menu-copy"><b>{title}</b><small>{text}</small></span><ChevronRight /></motion.button>)}</div>
    </section>

    <Card className="profile-premium-card"><span className="premium-mark"><Crown /></span><div><span className="eyebrow">Cloud Bot Premium</span><b>Больше скорости. Меньше рутины.</b><small>Лицензированные решения и защищённая выдача в одном пространстве.</small></div><Button className="primary" onClick={() => nav('/premium')}>Открыть Premium</Button></Card>
  </div>;
}

export function SettingsPage() {
  const { preferences, update } = useAppPreferences();
  const auth = useSession();
  const client = useQueryClient();
  const [bio, setBio] = useState(false);
  const logoutMutation = useMutation({ mutationFn: logout, onSettled: () => { session.clear(); client.clear(); auth.logoutLocal(); } });
  async function biometry() { const ok = await authenticateBiometry(); setBio(ok); if (ok) haptic.success(); else haptic.error(); }
  async function erase() { if (await confirmPopup('Очистить данные', 'Избранное, тема и локальные настройки будут удалены с этого устройства.')) { localStorage.clear(); location.reload(); } }
  async function accountDelete() { await showPopup('Удаление аккаунта', 'Для проверки личности отправьте боту команду /support и напишите «Удаление аккаунта». Поддержка удалит данные и связанные записи после подтверждения.'); }

  return <div className="page settings-page">
    <section className="settings-hero"><div className="settings-hero-icon"><Settings /></div><div><span className="eyebrow">Workspace controls</span><h1>Настройки</h1><p>Оформите пространство под себя. Изменения сохраняются в Telegram CloudStorage.</p></div><Badge><Shield /> Данные защищены</Badge></section>
    <Card className="settings-account-card"><div className="settings-account-avatar">{(auth.user?.name || telegram?.initDataUnsafe?.user?.first_name || 'Г')[0]?.toUpperCase()}</div><div><span className="eyebrow">Текущий аккаунт</span><b>{auth.user?.name || telegram?.initDataUnsafe?.user?.first_name || 'Гостевой режим'}</b><small>{auth.authenticated ? 'Telegram-сессия активна' : 'Войдите через Telegram для синхронизации'}</small></div><Badge>{auth.authenticated ? 'Online' : 'Guest'}</Badge></Card>
    <SettingsGroup title="Интерфейс" caption="Внешний вид приложения и комфорт использования"><Setting icon={Palette} title="Тема" text="Следовать системе, светлая или тёмная"><select aria-label="Тема интерфейса" value={preferences.theme} onChange={e => update({ theme: e.target.value as 'system' | 'dark' | 'light' })}><option value="system">Система</option><option value="dark">Тёмная</option><option value="light">Светлая</option></select></Setting><Setting icon={Languages} title="Язык" text="Язык интерфейса"><select aria-label="Язык интерфейса" value={preferences.language} onChange={e => update({ language: e.target.value as 'ru' | 'en' })}><option value="ru">Русский</option><option value="en">English</option></select></Setting><Setting icon={Moon} title="Меньше анимаций" text="Уменьшить motion effects"><Switch label="Уменьшить анимации" checked={preferences.reducedMotion} onChange={v => update({ reducedMotion: v })} /></Setting></SettingsGroup>
    <SettingsGroup title="Приватность и уведомления" caption="Контролируйте видимость данных и статусы покупок"><Setting icon={Bell} title="Уведомления" text="Обновления покупок и новые версии"><Switch label="Уведомления" checked={preferences.notifications} onChange={v => update({ notifications: v })} /></Setting><Setting icon={Shield} title="Приватный режим" text="Скрывать чувствительные детали профиля"><Switch label="Приватный режим" checked={preferences.privateMode} onChange={v => update({ privateMode: v })} /></Setting><Setting icon={Fingerprint} title="Биометрия" text={bio ? 'Подтверждена на этом устройстве' : 'Если поддерживается Telegram'}><Button className="compact" onClick={biometry}>{bio ? 'Активна' : 'Настроить'}</Button></Setting></SettingsGroup>
    <SettingsGroup title="Аккаунт" caption="Сессия и управление локальными данными"><Button className="setting-action" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}><LogOut />{logoutMutation.isPending ? 'Выходим…' : 'Выйти из Telegram-сессии'}</Button><Button className="setting-action" onClick={erase}><Trash2 />Очистить данные устройства</Button><Button className="setting-action danger" onClick={accountDelete}><Trash2 />Запросить удаление аккаунта</Button></SettingsGroup>
    <div className="settings-footnote"><LockKeyhole /><span>Настройки не передают покупки или платежные данные. Сервер принимает только проверенные Telegram-сессии.</span></div>
  </div>;
}

export function NotificationsPage() { const { preferences, update } = useAppPreferences(); const auth = useSession(); const purchases = useQuery({ queryKey: ['purchases'], queryFn: getPurchases, enabled: auth.authenticated }); return <div className="page"><div className="page-heading row-heading"><div><span className="eyebrow">Notification center</span><h1>Уведомления</h1></div><Switch checked={preferences.notifications} onChange={v => update({ notifications: v })} label="Уведомления" /></div>{preferences.notifications ? <div className="timeline"><Card><span className="timeline-icon"><BellRing /></span><div><b>Системные уведомления включены</b><p>Важные статусы оплаты и новые версии будут доступны здесь.</p><small>Сейчас</small></div></Card>{purchases.data?.items.slice(0, 5).map(item => <Card key={item.id}><span className="timeline-icon success"><Crown /></span><div><b>Лицензия активна</b><p>{preferences.privateMode ? 'Детали покупки скрыты' : `${item.title} · ${item.license_name}`}</p><small>{new Date(item.created_at).toLocaleDateString('ru-RU')}</small></div></Card>)}</div> : <EmptyState title="Уведомления выключены" text="Включите их, чтобы видеть обновления лицензий и статусы покупок." action={() => update({ notifications: true })} />}</div>; }

export function ReferralPage() { const auth = useSession(); const code = auth.user ? `ref_${auth.user.id}` : 'cloud_bot'; const url = new URL(location.origin); url.searchParams.set('startapp', code); async function copy() { await navigator.clipboard.writeText(url.toString()); haptic.success(); await showPopup('Ссылка скопирована', 'Теперь её можно отправить команде или клиенту.'); } return <div className="page"><section className="referral-hero"><div className="referral-orbit"><Users /><i /><i /></div><Badge>Invite workspace</Badge><h1>Делитесь инструментами</h1><p>Отправьте персональную ссылку. Telegram откроет Mini App сразу в вашем контексте.</p></section><Card className="referral-link"><span>{url.toString()}</span><Button aria-label="Скопировать реферальную ссылку" onClick={copy}><Copy /></Button></Card><div className="hero-actions"><Button className="primary" onClick={() => share(url.toString(), 'Инструменты для быстрого запуска в Telegram')}><Globe2 />Поделиться</Button></div><Card className="info-banner"><LockKeyhole /><div><b>Без доступа к вашим данным</b><span>Ссылка содержит только код приглашения и не передаёт покупки или настройки.</span></div></Card></div>; }

function SettingsGroup({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) { return <section className="settings-group"><div className="settings-group-heading"><div><h2>{title}</h2><p>{caption}</p></div></div><Card>{children}</Card></section>; }
function Setting({ icon: Icon, title, text, children }: { icon: typeof Palette; title: string; text: string; children: React.ReactNode }) { return <div className="setting-row"><span className="setting-icon"><Icon /></span><div><b>{title}</b><small>{text}</small></div><div className="setting-control">{children}</div></div>; }
