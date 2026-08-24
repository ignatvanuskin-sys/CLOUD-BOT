import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { authTelegram, getMe } from '../api/queries';
import { session, setAuthRefreshHandler } from '../api/client';
import type { User } from '../types/api';
import { initTelegram, isTelegram, onTelegramEvent, telegram } from '../services/telegram';
import { useFavorites, usePreferences, type Preferences } from '../stores/preferences';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: false }, mutations: { retry: 0 } } });
type SessionValue = { user: User | null; authenticated: boolean; loading: boolean; guest: boolean; logoutLocal: () => void };
const SessionContext = createContext<SessionValue | null>(null);
const PreferencesContext = createContext<ReturnType<typeof usePreferences> | null>(null);
const FavoritesContext = createContext<ReturnType<typeof useFavorites> | null>(null);

function SessionProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true); const [guest, setGuest] = useState(false);
  useEffect(() => {
    const initData = telegram?.initData;
    setAuthRefreshHandler(initData && isTelegram() ? async () => { const auth = await authTelegram(initData); if (auth.token) session.set(auth.token); queryClient.setQueryData(['me'], { user: auth.user }); return auth.token || null; } : null);
    return () => setAuthRefreshHandler(null);
  }, []);
  useEffect(() => { let active = true; initTelegram(); async function boot() { try { const initData = telegram?.initData; if (!session.get() && initData && isTelegram()) { const auth = await authTelegram(initData); if (auth.token) session.set(auth.token); } if (!session.get()) setGuest(true); } catch (error) { if (import.meta.env.PROD) console.error('auth_bootstrap_failed', error); setGuest(true); } finally { if (active) setBooting(false); } } void boot(); return () => { active = false; }; }, []);
  const me = useQuery({ queryKey: ['me'], queryFn: async () => { try { return await getMe(); } catch (error) { const initData = telegram?.initData; if (!session.get() && initData && isTelegram()) { const auth = await authTelegram(initData); if (auth.token) session.set(auth.token); return getMe(); } throw error; } }, enabled: !booting && Boolean(session.get()), retry: false });
  const value = useMemo<SessionValue>(() => ({ user: me.data?.user || null, authenticated: Boolean(me.data?.user), loading: booting || me.isLoading, guest, logoutLocal: () => { session.clear(); queryClient.clear(); setGuest(true); } }), [me.data, me.isLoading, booting, guest]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
function Inner({ children }: { children: ReactNode }) { const prefs = usePreferences(); const favorites = useFavorites(); useEffect(() => { const apply = () => { const webApp = telegram as (typeof telegram & { safeAreaInset?: { top?: number; bottom?: number; left?: number; right?: number }; contentSafeAreaInset?: { top?: number; bottom?: number; left?: number; right?: number } }) | undefined; document.documentElement.style.setProperty('--tg-viewport-height', `${webApp?.viewportStableHeight || webApp?.viewportHeight || window.innerHeight}px`); document.documentElement.style.setProperty('--tg-safe-top', `${webApp?.safeAreaInset?.top || 0}px`); document.documentElement.style.setProperty('--tg-safe-bottom', `${webApp?.safeAreaInset?.bottom || 0}px`); document.documentElement.style.setProperty('--tg-content-safe-top', `${webApp?.contentSafeAreaInset?.top || 0}px`); document.documentElement.style.setProperty('--tg-content-safe-bottom', `${webApp?.contentSafeAreaInset?.bottom || 0}px`); document.documentElement.dataset.telegramTheme = telegram?.colorScheme || 'dark';document.documentElement.dataset.theme = telegram?.colorScheme || 'dark'; }; apply(); return onTelegramEvent('themeChanged', apply); }, []); return <MotionConfig reducedMotion={prefs.preferences.reducedMotion ? 'always' : 'user'}><PreferencesContext.Provider value={prefs}><FavoritesContext.Provider value={favorites}><SessionProvider>{children}</SessionProvider></FavoritesContext.Provider></PreferencesContext.Provider></MotionConfig>; }
export function AppProviders({ children }: { children: ReactNode }) { return <QueryClientProvider client={queryClient}><Inner>{children}</Inner></QueryClientProvider>; }
export function useSession() { const value = useContext(SessionContext); if (!value) throw new Error('SessionProvider missing'); return value; }
export function useAppPreferences() { const value = useContext(PreferencesContext); if (!value) throw new Error('PreferencesProvider missing'); return value; }
export function useAppFavorites() { const value = useContext(FavoritesContext); if (!value) throw new Error('FavoritesProvider missing'); return value; }
export type { Preferences };
