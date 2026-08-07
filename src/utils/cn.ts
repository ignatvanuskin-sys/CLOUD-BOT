import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export const formatStars = (value:number|null|undefined) => `${Number(value || 0).toLocaleString('ru-RU')} ⭐`;
export const formatDate = (value:string) => new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value));
