declare global {
  interface Window { Telegram?: { WebApp: TelegramWebApp } }
}

type TelegramNativeButton = { setParams?: (params: Record<string, unknown>) => void; showProgress?: () => void; hideProgress?: () => void; onClick?: (handler: () => void) => void; offClick?: (handler: () => void) => void; hide?: () => void };
type TelegramWebApp = {
  initData?: string; initDataUnsafe?: { start_param?: string; user?: { first_name?: string; last_name?: string; username?: string } }; viewportStableHeight?: number; colorScheme?: 'light' | 'dark';
  HapticFeedback?: { impactOccurred?: (style: 'light' | 'medium' | 'heavy') => void; selectionChanged?: () => void; notificationOccurred?: (type: 'success' | 'error') => void };
  ready?: () => void; expand?: () => void; enableClosingConfirmation?: () => void;
  onEvent?: (name: string, handler: () => void) => void; offEvent?: (name: string, handler: () => void) => void;
  openInvoice?: (url: string, callback: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void) => void;
  openTelegramLink?: (url: string) => void; openLink?: (url: string) => void;
  showPopup?: (params: { title: string; message: string; buttons: { id: string; type: string; text?: string }[] }, callback: (id: string) => void) => void;
  showScanQrPopup?: (params: { text: string }, callback: (text: string) => boolean) => void;
  closeScanQrPopup?: () => void;
  readTextFromClipboard?: (callback: (text: string) => void) => void;
  CloudStorage?: { getItem?: (key: string, callback: (error: string, value: string) => void) => void; setItem?: (key: string, value: string, callback: (error: string) => void) => void };
  BiometricManager?: { init: (callback: () => void) => void; isBiometricAvailable?: boolean; requestAccess: (params: { reason: string }, callback: (granted: boolean) => void) => void; authenticate: (params: { reason: string }, callback: (success: boolean) => void) => void };
  BackButton?: { show?: () => void; hide?: () => void; onClick?: (handler: () => void) => void; offClick?: (handler: () => void) => void }; MainButton?: TelegramNativeButton; SecondaryButton?: TelegramNativeButton;
};

export const telegram = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
export const isTelegram = () => Boolean(telegram?.initData);
export const haptic = { tap: (style: 'light' | 'medium' | 'heavy' = 'light') => telegram?.HapticFeedback?.impactOccurred?.(style), select: () => telegram?.HapticFeedback?.selectionChanged?.(), success: () => telegram?.HapticFeedback?.notificationOccurred?.('success'), error: () => telegram?.HapticFeedback?.notificationOccurred?.('error') };
export function initTelegram() { telegram?.ready?.(); telegram?.expand?.(); telegram?.enableClosingConfirmation?.(); }
export function onTelegramEvent(name: string, handler: () => void) { telegram?.onEvent?.(name, handler); return () => telegram?.offEvent?.(name, handler); }

export function openInvoice(url: string) {
  return new Promise<'paid' | 'cancelled' | 'failed' | 'pending'>((resolve) => {
    if (telegram?.openInvoice) return telegram.openInvoice(url, resolve);
    try { window.location.assign(url); } finally { resolve('pending'); }
  });
}
export function showPopup(title: string, message: string) {
  return new Promise<string>((resolve) => telegram?.showPopup ? telegram.showPopup({ title, message, buttons: [{ id: 'ok', type: 'ok' }] }, resolve) : (window.alert(`${title}\n\n${message}`), resolve('ok')));
}
export function confirmPopup(title: string, message: string) {
  return new Promise<boolean>((resolve) => telegram?.showPopup ? telegram.showPopup({ title, message, buttons: [{ id: 'cancel', type: 'cancel' }, { id: 'confirm', type: 'destructive', text: 'Подтвердить' }] }, id => resolve(id === 'confirm')) : resolve(window.confirm(`${title}\n\n${message}`)));
}
export async function share(url: string, text: string) {
  const shareUrl = `https://t.me/share/url?${new URLSearchParams({ url, text })}`;
  if (telegram?.openTelegramLink) return telegram.openTelegramLink(shareUrl);
  if (navigator.share) return navigator.share({ url, text }).catch(() => undefined);
  try { await navigator.clipboard?.writeText(url); } catch { /* user denied clipboard access */ }
}
export function scanQr() {
  return new Promise<string | null>((resolve) => {
    if (!telegram?.showScanQrPopup) return resolve(null);
    let settled = false;
    const finish = (value: string | null) => { if (settled) return; settled = true; telegram.closeScanQrPopup?.(); resolve(value); };
    const timer = window.setTimeout(() => finish(null), 60_000);
    telegram.showScanQrPopup({ text: 'Наведите камеру на QR-код' }, text => { window.clearTimeout(timer); finish(text || null); return false; });
  });
}
export function readClipboard() {
  return new Promise<string>((resolve) => {
    if (telegram?.readTextFromClipboard) return telegram.readTextFromClipboard(text => resolve((text || '').slice(0, 2000)));
    if (!navigator.clipboard?.readText) return resolve('');
    navigator.clipboard.readText().then(text => resolve(text.slice(0, 2000))).catch(() => resolve(''));
  });
}
function supportsCloudStorage() {
  const version = Number((telegram as TelegramWebApp & { version?: string })?.version || 0);
  return Boolean(telegram?.CloudStorage?.getItem && (!version || version >= 6.9));
}
export function cloudGet(key: string) {
  return new Promise<string>(resolve => {
    const storage = telegram?.CloudStorage;
    if (!supportsCloudStorage() || !storage?.getItem) return resolve('');
    try { storage.getItem(key, (error, value) => resolve(error ? '' : value || '')); } catch { resolve(''); }
  });
}
export function cloudSet(key: string, value: string) {
  return new Promise<void>(resolve => {
    const storage = telegram?.CloudStorage;
    if (!supportsCloudStorage() || !storage?.setItem) return resolve();
    try { storage.setItem(key, value, () => resolve()); } catch { resolve(); }
  });
}
export function authenticateBiometry() {
  return new Promise<boolean>(resolve => { const manager = telegram?.BiometricManager; if (!manager) return resolve(false); manager.init(() => { if (!manager.isBiometricAvailable) return resolve(false); manager.requestAccess({ reason: 'Защитить доступ к покупкам' }, granted => granted ? manager.authenticate({ reason: 'Подтвердите вход' }, resolve) : resolve(false)); }); });
}
export const startParam = () => telegram?.initDataUnsafe?.start_param || new URLSearchParams(location.hash.slice(1)).get('tgWebAppStartParam') || new URLSearchParams(location.search).get('startapp') || '';
