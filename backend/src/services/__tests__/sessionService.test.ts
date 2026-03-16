import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';

// Mock the database module
vi.mock('../../db', () => ({
  default: { query: vi.fn() },
  query: vi.fn(),
}));

// Mock the logger
vi.mock('../../middleware/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock session config
vi.mock('../../config/session', () => ({
  SESSION_EXPIRATION_DAYS: 7,
  MAX_SESSIONS_PER_USER: 5,
}));

import { query } from '../../db';
import {
  generateSessionId,
  hashSessionId,
  storeSession,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  revokeOtherUserSessions,
  cleanupExpiredSessions,
  getUserSessions,
  revokeSessionById,
} from '../sessionService';

const mockQuery = query as ReturnType<typeof vi.fn>;

// Helper to create a mock QueryResult with required pg fields
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

describe('SessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateSessionId', () => {
    it('should generate a session ID', () => {
      const sessionId = generateSessionId();
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
    });

    it('should generate unique session IDs', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      expect(id1).not.toBe(id2);
    });

    it('should generate base64url encoded session IDs', () => {
      const sessionId = generateSessionId();
      // base64url uses alphanumeric, -, and _ (no + or /)
      expect(sessionId).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate session IDs of consistent length', () => {
      const sessionId = generateSessionId();
      // 32 bytes = 43 chars in base64url (without padding)
      expect(sessionId.length).toBe(43);
    });
  });

  describe('hashSessionId', () => {
    it('should hash a session ID', () => {
      const sessionId = 'test-session-id';
      const hash = hashSessionId(sessionId);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should produce consistent hashes', () => {
      const sessionId = 'test-session-id';
      const hash1 = hashSessionId(sessionId);
      const hash2 = hashSessionId(sessionId);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different session IDs', () => {
      const hash1 = hashSessionId('session-1');
      const hash2 = hashSessionId('session-2');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce SHA-256 hex encoded hashes (64 chars)', () => {
      const hash = hashSessionId('test-session');
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('storeSession', () => {
    it('should store a session in the database', async () => {
      const userId = 'user-123';
      const sessionId = 'session-abc';

      // Mock enforceSessionLimit query (BEGIN, SELECT FOR UPDATE, COMMIT)
      mockQuery
        .mockResolvedValueOnce(mockResult({ rows: [] })) // BEGIN
        .mockResolvedValueOnce(mockResult({ rows: [] })) // SELECT FOR UPDATE (no existing sessions)
        .mockResolvedValueOnce(mockResult({ rows: [] })) // COMMIT
        .mockResolvedValueOnce(mockResult({ rows: [] })); // INSERT

      await storeSession(userId, sessionId, 'Mozilla/5.0', '192.168.1.1');

      // Verify INSERT was called with correct parameters
      const insertCall = mockQuery.mock.calls.find(
        call => call[0]?.includes('INSERT INTO refresh_tokens')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]![0]).toBe(userId);
    });

    it('should pass user agent and IP address to database', async () => {
      const userId = 'user-123';
      const sessionId = 'session-abc';
      const userAgent = 'Mozilla/5.0 Test Browser';
      const ipAddress = '10.0.0.1';

      mockQuery
        .mockResolvedValueOnce(mockResult({ rows: [] })) // BEGIN
        .mockResolvedValueOnce(mockResult({ rows: [] })) // SELECT FOR UPDATE
        .mockResolvedValueOnce(mockResult({ rows: [] })) // COMMIT
        .mockResolvedValueOnce(mockResult({ rows: [] })); // INSERT

      await storeSession(userId, sessionId, userAgent, ipAddress);

      const insertCall = mockQuery.mock.calls.find(
        call => call[0]?.includes('INSERT INTO refresh_tokens')
      );
      expect(insertCall![1]).toContain(userAgent);
      expect(insertCall![1]).toContain(ipAddress);
    });

    it('should handle null user agent and IP address', async () => {
      const userId = 'user-123';
      const sessionId = 'session-abc';

      mockQuery
        .mockResolvedValueOnce(mockResult({ rows: [] })) // BEGIN
        .mockResolvedValueOnce(mockResult({ rows: [] })) // SELECT FOR UPDATE
        .mockResolvedValueOnce(mockResult({ rows: [] })) // COMMIT
        .mockResolvedValueOnce(mockResult({ rows: [] })); // INSERT

      await storeSession(userId, sessionId);

      const insertCall = mockQuery.mock.calls.find(
        call => call[0]?.includes('INSERT INTO refresh_tokens')
      );
      expect(insertCall![1]![3]).toBeNull(); // userAgent
      expect(insertCall![1]![4]).toBeNull(); // ipAddress
    });
  });

  describe('validateSession', () => {
    it('should return user data for valid session', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'Admin',
      };

      mockQuery.mockResolvedValueOnce(mockResult({ rows: [mockUser] }));

      const result = await validateSession('valid-session-id');

      expect(result).toBeDefined();
      expect(result?.id).toBe(mockUser.id);
      expect(result?.userId).toBe(mockUser.id); // backward compatibility
      expect(result?.email).toBe(mockUser.email);
      expect(result?.name).toBe(mockUser.name);
      expect(result?.role).toBe(mockUser.role);
    });

    it('should return null for invalid session', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rows: [] }));

      const result = await validateSession('invalid-session-id');

      expect(result).toBeNull();
    });

    it('should return null for expired session', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rows: [] })); // Query filters expired sessions

      const result = await validateSession('expired-session-id');

      expect(result).toBeNull();
    });

    it('should throw on database error (fail closed behavior)', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      await expect(validateSession('session-id')).rejects.toThrow('Database error');
    });

    it('should return authenticatedAt as a Date when created_at is present', async () => {
      const createdAt = new Date('2026-03-16T10:00:00.000Z');
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'Admin',
        created_at: createdAt.toISOString(),
      };

      mockQuery.mockResolvedValueOnce(mockResult({ rows: [mockUser] }));

      const result = await validateSession('valid-session-id');

      expect(result).toBeDefined();
      expect(result?.authenticatedAt).toBeInstanceOf(Date);
      expect(result?.authenticatedAt?.getTime()).toBe(createdAt.getTime());
    });

    it('should include authenticatedAt in SessionUser result', async () => {
      const createdAt = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      const mockUser = {
        id: 'user-456',
        email: 'another@example.com',
        name: 'Another User',
        role: 'Member',
        created_at: createdAt.toISOString(),
      };

      mockQuery.mockResolvedValueOnce(mockResult({ rows: [mockUser] }));

      const result = await validateSession('another-session-id');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('authenticatedAt');
      expect(result?.authenticatedAt).toBeInstanceOf(Date);
    });
  });

  describe('revokeSession', () => {
    it('should revoke a session and return true', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 1 }));

      const result = await revokeSession('session-id');

      expect(result).toBe(true);
    });

    it('should return false if session not found', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 0 }));

      const result = await revokeSession('nonexistent-session');

      expect(result).toBe(false);
    });

    it('should use default reason "logout"', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 1 }));

      await revokeSession('session-id');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens'),
        expect.arrayContaining(['logout'])
      );
    });

    it('should use custom reason when provided', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 1 }));

      await revokeSession('session-id', 'security_concern');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens'),
        expect.arrayContaining(['security_concern'])
      );
    });

    it('should return false on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const result = await revokeSession('session-id');

      expect(result).toBe(false);
    });
  });

  describe('revokeAllUserSessions', () => {
    it('should revoke all sessions for a user', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 3 }));

      const result = await revokeAllUserSessions('user-123');

      expect(result).toBe(3);
    });

    it('should return 0 if user has no active sessions', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 0 }));

      const result = await revokeAllUserSessions('user-no-sessions');

      expect(result).toBe(0);
    });

    it('should use default reason "logout_all"', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 1 }));

      await revokeAllUserSessions('user-123');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens'),
        expect.arrayContaining(['logout_all'])
      );
    });

    it('should return 0 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const result = await revokeAllUserSessions('user-123');

      expect(result).toBe(0);
    });
  });

  describe('revokeOtherUserSessions', () => {
    it('should revoke all sessions except current', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 2 }));

      const result = await revokeOtherUserSessions('user-123', 'current-session');

      expect(result).toBe(2);
    });

    it('should not revoke current session', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 0 }));

      await revokeOtherUserSessions('user-123', 'current-session');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('token_hash != $3'),
        expect.any(Array)
      );
    });

    it('should return 0 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const result = await revokeOtherUserSessions('user-123', 'session');

      expect(result).toBe(0);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should delete expired sessions and return count', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 10 }));

      const result = await cleanupExpiredSessions();

      expect(result).toBe(10);
    });

    it('should return 0 if no sessions to clean', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 0 }));

      const result = await cleanupExpiredSessions();

      expect(result).toBe(0);
    });

    it('should return 0 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const result = await cleanupExpiredSessions();

      expect(result).toBe(0);
    });
  });

  describe('getUserSessions', () => {
    it('should return active sessions for a user', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          created_at: new Date('2024-01-01'),
          user_agent: 'Chrome',
          ip_address: '192.168.1.1',
        },
        {
          id: 'session-2',
          created_at: new Date('2024-01-02'),
          user_agent: 'Firefox',
          ip_address: '192.168.1.2',
        },
      ];

      mockQuery.mockResolvedValueOnce(mockResult({ rows: mockSessions }));

      const result = await getUserSessions('user-123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('session-1');
      expect(result[0].userAgent).toBe('Chrome');
      expect(result[0].ipAddress).toBe('192.168.1.1');
    });

    it('should return empty array if no sessions', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rows: [] }));

      const result = await getUserSessions('user-no-sessions');

      expect(result).toEqual([]);
    });

    it('should return empty array on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const result = await getUserSessions('user-123');

      expect(result).toEqual([]);
    });
  });

  describe('revokeSessionById', () => {
    it('should revoke session by database ID', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 1 }));

      const result = await revokeSessionById('db-session-id', 'user-123');

      expect(result).toBe(true);
    });

    it('should verify user owns the session', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 1 }));

      await revokeSessionById('db-session-id', 'user-123');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = $2'),
        ['db-session-id', 'user-123']
      );
    });

    it('should return false if session not found or wrong user', async () => {
      mockQuery.mockResolvedValueOnce(mockResult({ rowCount: 0 }));

      const result = await revokeSessionById('nonexistent', 'user-123');

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const result = await revokeSessionById('session-id', 'user-123');

      expect(result).toBe(false);
    });
  });
});
