import crypto from 'node:crypto';
import { z } from 'zod';

export type ProductType = 'ready_bot' | 'module' | 'service';
export type StartParamResult =
  | { kind: 'catalog' }
  | { kind: 'product'; id: string }
  | { kind: 'category'; slug: string }
  | { kind: 'ref'; code: string };

export const StartParam = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);

export function parseStartParam(input = ''): StartParamResult {
  const value = StartParam.safeParse(input);
  if (!value.success) return { kind: 'catalog' };

  if (input.startsWith('product_')) {
    const id = input.slice('product_'.length);
    return id ? { kind: 'product', id } : { kind: 'catalog' };
  }

  if (input.startsWith('category_')) {
    const slug = input.slice('category_'.length);
    return slug ? { kind: 'category', slug } : { kind: 'catalog' };
  }

  if (input.startsWith('ref_')) {
    const code = input.slice('ref_'.length);
    return code ? { kind: 'ref', code } : { kind: 'catalog' };
  }

  return { kind: 'catalog' };
}

function timingSafeHexEqual(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function validateTelegramInitData(raw: string, botToken: string, maxAgeSec = 86400) {
  if (!raw) throw new Error('missing initData');

  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) throw new Error('missing hash');

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Telegram Mini Apps validation: secret key is HMAC_SHA256(bot_token, key='WebAppData').
  // Node's createHmac takes the key as the second argument, so 'WebAppData' must be the key.
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  if (!timingSafeHexEqual(calculatedHash, hash)) throw new Error('bad signature');

  const authDate = Number(params.get('auth_date') || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > maxAgeSec || authDate > now + 60) throw new Error('expired initData');

  let user: any;
  try {
    user = JSON.parse(params.get('user') || '{}');
  } catch {
    throw new Error('bad user');
  }

  if (!user.id) throw new Error('missing user');
  return { telegramId: String(user.id), user, authDate };
}
