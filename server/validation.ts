import { z } from 'zod';

export type ValidatedBody<T> = { ok: true; data: T } | { ok: false; issues: string[] };

function fail(error: z.ZodError): ValidatedBody<never> {
  return { ok: false, issues: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`) };
}

export function validateBody<T>(schema: z.ZodType<T>, value: unknown): ValidatedBody<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) return fail(parsed.error);
  return { ok: true, data: parsed.data };
}

export const OrderBodySchema = z.object({
  licenseId: z.string().min(1).max(128),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional(),
});

export const FavoriteBodySchema = z.object({
  productId: z.string().min(1).max(128),
});

export const AdminProductBodySchema = z.object({
  id: z.string().max(80).optional(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).optional(),
  title: z.string().min(1).max(120),
  result: z.string().min(1).max(240),
  type: z.enum(['template', 'ready_bot', 'module', 'service']),
  category: z.string().min(1).max(64),
  description: z.string().max(4000).optional(),
  stack: z.string().max(1000).optional(),
  demo_url: z.string().url().max(500).optional().or(z.literal('')),
  preview: z.string().max(500).optional(),
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/).optional(),
  changelog: z.string().max(4000).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

// License plan fields follow the existing license_plans table schema.
// Currency is fixed to XTR by the checkout flow — no currency field exists in the schema.
export const LicensePlanBodySchema = z.object({
  name: z.string().min(1).max(120),
  // price_xtr: Telegram Stars invoice amount (integer); capped at 2500 per Telegram invoice limit.
  price_xtr: z.number().int().min(1).max(2500),
  projects: z.number().int().min(1).max(1000).optional(),
  commercial: z.union([z.literal(0), z.literal(1)]).optional(),
  support_days: z.number().int().min(0).max(3650).optional(),
  updates_days: z.number().int().min(0).max(3650).optional(),
  terms: z.string().max(2000).optional(),
});

export const RefundBodySchema = z.object({
  reason: z.string().min(5).max(2000),
});

export const ReconcileBodySchema = z.object({
  outcome: z.enum(['confirmed', 'not_refunded']),
  note: z.string().min(5).max(2000),
});
