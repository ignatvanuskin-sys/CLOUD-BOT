import crypto from 'node:crypto';

export type SafeErrorMeta = {
  errorType: string;
  diagnosticId: string;
  message?: string;
  stack?: string;
  sql?: string;
  cause?: string;
};

export function safeErrorMeta(error: unknown, isProduction = process.env.NODE_ENV === 'production', diagnosticId: string = crypto.randomUUID()): SafeErrorMeta {
  const value = error instanceof Error ? error : new Error(String(error));
  const base = { errorType: value.name || 'Error', diagnosticId };
  if (isProduction) return base;
  return {
    ...base,
    message: value.message,
    stack: value.stack,
    sql: (value as Error & { sql?: string }).sql,
    cause: value.cause instanceof Error ? value.cause.message : value.cause == null ? undefined : String(value.cause),
  };
}
