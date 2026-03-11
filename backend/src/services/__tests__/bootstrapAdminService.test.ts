import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';

vi.mock('../../db', () => ({
  query: vi.fn(),
}));

vi.mock('../../middleware/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(),
  },
}));

import bcrypt from 'bcrypt';
import { query } from '../../db';
import { ensureBootstrapAdmin } from '../bootstrapAdminService';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockBcryptHash = bcrypt.hash as ReturnType<typeof vi.fn>;

function mockResult<T extends QueryResultRow>(
  data: { rows?: T[]; rowCount?: number }
): QueryResult<T> {
  return {
    rows: data.rows ?? [],
    rowCount: data.rowCount ?? (data.rows?.length ?? 0),
    command: 'SELECT',
    oid: 0,
    fields: [],
  };
}

describe('bootstrapAdminService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the bootstrap admin on first initialization', async () => {
    mockQuery
      .mockResolvedValueOnce(mockResult({ rows: [] }))
      .mockResolvedValueOnce(mockResult({ rowCount: 1 }));
    mockBcryptHash.mockResolvedValueOnce('hashed-bootstrap-password');

    const result = await ensureBootstrapAdmin({
      email: 'bootstrap@example.com',
      password: 'StrongPassword123!',
    });

    expect(result).toBe('created');
    expect(mockBcryptHash).toHaveBeenCalledWith('StrongPassword123!', 12);
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.arrayContaining([
        'qAdmin',
        'bootstrap@example.com',
        'hashed-bootstrap-password',
        'Admin',
      ])
    );
  });

  it('does not recreate the bootstrap admin if it already exists', async () => {
    mockQuery.mockResolvedValueOnce(
      mockResult({
        rows: [{ id: 'existing-admin-id' }],
      })
    );

    const result = await ensureBootstrapAdmin({
      email: 'bootstrap@example.com',
      password: 'StrongPassword123!',
    });

    expect(result).toBe('existing');
    expect(mockBcryptHash).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('skips bootstrap creation when no password is configured', async () => {
    const result = await ensureBootstrapAdmin({
      email: 'bootstrap@example.com',
      password: '',
    });

    expect(result).toBe('skipped');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockBcryptHash).not.toHaveBeenCalled();
  });
});
