import { describe, expect, it } from 'vitest';
import { safeErrorMeta } from '../server/logging';

describe('safe error serialization', () => {
  it('redacts production messages, stacks, SQL and causes while preserving a diagnostic id', () => {
    const error = Object.assign(new Error('secret user@example.com token=abc'), { sql: 'select secret from users', cause: new Error('provider secret') });
    const meta = safeErrorMeta(error, true, 'diag-123');
    expect(meta).toEqual({ errorType: 'Error', diagnosticId: 'diag-123' });
    expect(JSON.stringify(meta)).not.toMatch(/secret|example\.com|select|provider/i);
  });

  it('keeps development diagnostics', () => {
    const error = Object.assign(new Error('development detail'), { sql: 'select 1' });
    expect(safeErrorMeta(error, false, 'diag-dev')).toMatchObject({ diagnosticId: 'diag-dev', message: 'development detail', sql: 'select 1' });
  });
});
