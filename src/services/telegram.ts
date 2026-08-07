declare global{interface Window{Telegram?:{WebApp:any}}}
type TelegramWebApp=any;
export const telegram:TelegramWebApp=window.Telegram?.WebApp;
export const isTelegram=()=>Boolean(telegram?.initData);
export const haptic={tap:(style:'light'|'medium'|'heavy'='light')=>telegram?.HapticFeedback?.impactOccurred?.(style),select:()=>telegram?.HapticFeedback?.selectionChanged?.(),success:()=>telegram?.HapticFeedback?.notificationOccurred?.('success'),error:()=>telegram?.HapticFeedback?.notificationOccurred?.('error')};
export function initTelegram(){telegram?.ready?.();telegram?.expand?.();telegram?.enableClosingConfirmation?.();}
export function onTelegramEvent(name:string,handler:()=>void){telegram?.onEvent?.(name,handler);return()=>telegram?.offEvent?.(name,handler)}
export function openInvoice(url:string){return new Promise<'paid'|'cancelled'|'failed'|'pending'>((resolve)=>telegram?.openInvoice?telegram.openInvoice(url,resolve):(location.href=url));}
export function showPopup(title:string,message:string){return new Promise<string>((resolve)=>telegram?.showPopup?telegram.showPopup({title,message,buttons:[{id:'ok',type:'ok'}]},resolve):(alert(`${title}\n\n${message}`),resolve('ok')))}
export function confirmPopup(title:string,message:string){return new Promise<boolean>((resolve)=>telegram?.showPopup?telegram.showPopup({title,message,buttons:[{id:'cancel',type:'cancel'},{id:'confirm',type:'destructive',text:'Подтвердить'}]},(id:string)=>resolve(id==='confirm')):resolve(confirm(message)))}
export async function share(url:string,text:string){const shareUrl=`https://t.me/share/url?${new URLSearchParams({url,text})}`;if(telegram?.openTelegramLink)telegram.openTelegramLink(shareUrl);else if(navigator.share)await navigator.share({url,text});else await navigator.clipboard.writeText(url)}
export function scanQr(){return new Promise<string|null>((resolve)=>{if(!telegram?.showScanQrPopup)return resolve(null);telegram.showScanQrPopup({text:'Наведите камеру на QR-код'},(text:string)=>{resolve(text);return true})})}
export function readClipboard(){return new Promise<string>((resolve)=>telegram?.readTextFromClipboard?telegram.readTextFromClipboard((text:string)=>resolve(text||'')):navigator.clipboard?.readText().then(resolve).catch(()=>resolve('')))}
export function cloudGet(key:string){return new Promise<string>((resolve)=>telegram?.CloudStorage?.getItem?telegram.CloudStorage.getItem(key,(_e:string,v:string)=>resolve(v||'')):resolve(''))}
export function cloudSet(key:string,value:string){return new Promise<void>((resolve)=>telegram?.CloudStorage?.setItem?telegram.CloudStorage.setItem(key,value,()=>resolve()):resolve())}
export async function authenticateBiometry(){const manager=telegram?.BiometricManager;if(!manager)return false;return new Promise<boolean>((resolve)=>manager.init(()=>{if(!manager.isBiometricAvailable)return resolve(false);manager.requestAccess({reason:'Защитить доступ к покупкам'},(granted:boolean)=>granted?manager.authenticate({reason:'Подтвердите вход'},resolve):resolve(false))}))}
export const startParam=()=>telegram?.initDataUnsafe?.start_param||new URLSearchParams(location.hash.slice(1)).get('tgWebAppStartParam')||new URLSearchParams(location.search).get('startapp')||'';
