import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { validateConfig } from '../configValidator';

const ORIGINAL_ENV = { ...process.env };

describe('configValidator', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('rejects the committed production database password fallback', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://sim-rq.example.com';
    process.env.DB_PASSWORD = 'SimRQ2025!Secure';

    const result = validateConfig();

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      'DB_PASSWORD uses a committed repository default. Set a unique password in production.'
    );
  });

  it('rejects the legacy qAdmin default password in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://sim-rq.example.com';
    process.env.DB_PASSWORD = 'A-Strong-Password-123!';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'admin123';

    const result = validateConfig();

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      'BOOTSTRAP_ADMIN_PASSWORD uses a known development default. Set a unique bootstrap admin password in production.'
    );
  });

  it('accepts strong production bootstrap settings', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://sim-rq.example.com';
    process.env.DB_PASSWORD = 'A-Strong-Password-123!';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'Another-Strong-Password-456!';
    process.env.ENTRA_SSO_ENCRYPTION_KEY = 'abcdefghijklmnopqrstuvwxyz123456';

    const result = validateConfig();

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
