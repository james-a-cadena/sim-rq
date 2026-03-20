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

import pool from '../../db';
import {
  logAudit,
  getUserFromRequest,
  getIpFromRequest,
  getUserAgentFromRequest,
  logRequestAudit,
  getAuditLogs,
  getAuditLogCount,
  logSecurityEvent,
  redactEmail,
  AuditAction,
  EntityType,
} from '../auditService';
import type { Request } from 'express';

const mockPoolQuery = pool.query as ReturnType<typeof vi.fn>;

// Helper to create a mock QueryResult
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

// Helper to create mock Express request
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    user: {
      id: 'user-123',
      userId: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      role: 'Admin',
    },
    headers: {
      'x-forwarded-for': '192.168.1.100',
      'user-agent': 'Mozilla/5.0 Test Browser',
    },
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

describe('AuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AuditAction enum', () => {
    it('should have all authentication actions', () => {
      expect(AuditAction.LOGIN).toBe('LOGIN');
      expect(AuditAction.LOGOUT).toBe('LOGOUT');
      expect(AuditAction.SSO_LOGIN).toBe('SSO_LOGIN');
    });

    it('should have all request operation actions', () => {
      expect(AuditAction.CREATE_REQUEST).toBe('CREATE_REQUEST');
      expect(AuditAction.UPDATE_REQUEST).toBe('UPDATE_REQUEST');
      expect(AuditAction.DELETE_REQUEST).toBe('DELETE_REQUEST');
      expect(AuditAction.ASSIGN_ENGINEER).toBe('ASSIGN_ENGINEER');
      expect(AuditAction.UPDATE_REQUEST_STATUS).toBe('UPDATE_REQUEST_STATUS');
    });

    it('should have all attachment actions', () => {
      expect(AuditAction.ADD_ATTACHMENT).toBe('ADD_ATTACHMENT');
      expect(AuditAction.DELETE_ATTACHMENT).toBe('DELETE_ATTACHMENT');
      expect(AuditAction.DOWNLOAD_ATTACHMENT).toBe('DOWNLOAD_ATTACHMENT');
    });

    it('should have all user operation actions', () => {
      expect(AuditAction.CREATE_USER).toBe('CREATE_USER');
      expect(AuditAction.UPDATE_USER).toBe('UPDATE_USER');
      expect(AuditAction.DELETE_USER).toBe('DELETE_USER');
      expect(AuditAction.DEACTIVATE_USER).toBe('DEACTIVATE_USER');
      expect(AuditAction.RESTORE_USER).toBe('RESTORE_USER');
      expect(AuditAction.UPDATE_USER_ROLE).toBe('UPDATE_USER_ROLE');
    });
  });

  describe('EntityType enum', () => {
    it('should have all entity types', () => {
      expect(EntityType.REQUEST).toBe('request');
      expect(EntityType.PROJECT).toBe('project');
      expect(EntityType.USER).toBe('user');
      expect(EntityType.COMMENT).toBe('comment');
      expect(EntityType.ATTACHMENT).toBe('attachment');
      expect(EntityType.AUTH).toBe('auth');
    });
  });

  describe('logAudit', () => {
    it('should insert audit log entry into database', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({}));

      await logAudit({
        userId: 'user-123',
        userEmail: 'test@example.com',
        userName: 'Test User',
        action: AuditAction.LOGIN,
        entityType: EntityType.AUTH,
        entityId: 'session-456',
        details: { method: 'password' },
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });

      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining([
          'user-123',
          'test@example.com',
          'Test User',
          'LOGIN',
          'auth',
          'session-456',
          expect.any(String), // JSON stringified details
          '192.168.1.1',
          'Mozilla/5.0',
        ])
      );
    });

    it('should handle null optional fields', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({}));

      await logAudit({
        userEmail: 'test@example.com',
        userName: 'Test User',
        action: AuditAction.LOGIN,
        entityType: EntityType.AUTH,
      });

      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining([
          null, // userId
          'test@example.com',
          'Test User',
          'LOGIN',
          'auth',
          null, // entityId
          null, // details
          null, // ipAddress
          null, // userAgent
        ])
      );
    });

    it('should not throw on database error (fail-safe)', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Database error'));

      // Should not throw
      await expect(
        logAudit({
          userEmail: 'test@example.com',
          userName: 'Test User',
          action: AuditAction.LOGIN,
          entityType: EntityType.AUTH,
        })
      ).resolves.toBeUndefined();
    });

    it('should stringify details object to JSON', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({}));

      const details = { key1: 'value1', key2: 123, nested: { a: 'b' } };
      await logAudit({
        userEmail: 'test@example.com',
        userName: 'Test User',
        action: AuditAction.CREATE_REQUEST,
        entityType: EntityType.REQUEST,
        details,
      });

      const callArgs = mockPoolQuery.mock.calls[0][1];
      expect(callArgs[6]).toBe(JSON.stringify(details));
    });
  });

  describe('getUserFromRequest', () => {
    it('should extract user info from request', () => {
      const req = createMockRequest();
      const user = getUserFromRequest(req);

      expect(user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      });
    });

    it('should use userId as fallback for id', () => {
      const req = createMockRequest({
        user: {
          userId: 'user-456',
          email: 'other@example.com',
          name: 'Other User',
          role: 'Engineer',
        },
      } as unknown as Partial<Request>);

      const user = getUserFromRequest(req);
      expect(user.id).toBe('user-456');
    });

    it('should throw if no user in request', () => {
      const req = createMockRequest({ user: undefined });

      expect(() => getUserFromRequest(req)).toThrow('User not found in request');
    });
  });

  describe('getIpFromRequest', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const req = createMockRequest({
        headers: { 'x-forwarded-for': '203.0.113.1, 70.41.3.18' },
      } as unknown as Partial<Request>);

      const ip = getIpFromRequest(req);
      expect(ip).toBe('203.0.113.1');
    });

    it('should use req.ip as fallback', () => {
      const req = createMockRequest({
        headers: {},
        ip: '10.0.0.1',
      } as unknown as Partial<Request>);

      const ip = getIpFromRequest(req);
      expect(ip).toBe('10.0.0.1');
    });

    it('should use connection.remoteAddress as final fallback', () => {
      const req = createMockRequest({
        headers: {},
        ip: undefined,
        connection: { remoteAddress: '172.16.0.1' },
      } as unknown as Partial<Request>);

      const ip = getIpFromRequest(req);
      expect(ip).toBe('172.16.0.1');
    });

    it('should return "unknown" if no IP available', () => {
      const req = createMockRequest({
        headers: {},
        ip: undefined,
        connection: {},
      } as unknown as Partial<Request>);

      const ip = getIpFromRequest(req);
      expect(ip).toBe('unknown');
    });

    it('should trim whitespace from forwarded IP', () => {
      const req = createMockRequest({
        headers: { 'x-forwarded-for': '  192.168.1.1  , 10.0.0.1' },
      } as unknown as Partial<Request>);

      const ip = getIpFromRequest(req);
      expect(ip).toBe('192.168.1.1');
    });
  });

  describe('getUserAgentFromRequest', () => {
    it('should extract user-agent from headers', () => {
      const req = createMockRequest({
        headers: { 'user-agent': 'Mozilla/5.0 Chrome/120.0' },
      } as unknown as Partial<Request>);

      const ua = getUserAgentFromRequest(req);
      expect(ua).toBe('Mozilla/5.0 Chrome/120.0');
    });

    it('should return "unknown" if no user-agent', () => {
      const req = createMockRequest({
        headers: {},
      } as unknown as Partial<Request>);

      const ua = getUserAgentFromRequest(req);
      expect(ua).toBe('unknown');
    });
  });

  describe('logRequestAudit', () => {
    it('should log audit entry with request context', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({}));

      const req = createMockRequest();
      await logRequestAudit(
        req,
        AuditAction.CREATE_REQUEST,
        EntityType.REQUEST,
        'req-789',
        { title: 'New Request' }
      );

      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockPoolQuery.mock.calls[0][1];
      expect(callArgs[0]).toBe('user-123'); // userId
      expect(callArgs[1]).toBe('test@example.com'); // userEmail
      expect(callArgs[2]).toBe('Test User'); // userName
      expect(callArgs[3]).toBe('CREATE_REQUEST'); // action
      expect(callArgs[4]).toBe('request'); // entityType
      expect(callArgs[5]).toBe('req-789'); // entityId
    });

    it('should not throw on missing user (fail-safe)', async () => {
      const req = createMockRequest({ user: undefined });

      // Should not throw
      await expect(
        logRequestAudit(req, AuditAction.LOGIN, EntityType.AUTH)
      ).resolves.toBeUndefined();
    });
  });

  describe('getAuditLogs', () => {
    it('should return audit logs with no filters', async () => {
      const mockLogs = [
        {
          id: '1',
          user_id: 'user-1',
          user_email: 'user1@example.com',
          user_name: 'User One',
          action: 'LOGIN',
          entity_type: 'auth',
          entity_id: null,
          details: null,
          ip_address: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
          timestamp: new Date('2024-01-15'),
        },
      ];

      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: mockLogs }));

      const result = await getAuditLogs({});

      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('LOGIN');
    });

    it('should filter by userId', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [] }));

      await getAuditLogs({ userId: 'user-123' });

      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = $1'),
        ['user-123']
      );
    });

    it('should filter by action', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [] }));

      await getAuditLogs({ action: 'LOGIN' });

      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('action = $1'),
        ['LOGIN']
      );
    });

    it('should filter by entityType', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [] }));

      await getAuditLogs({ entityType: 'request' });

      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('entity_type = $1'),
        ['request']
      );
    });

    it('should filter by date range', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [] }));

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      await getAuditLogs({ startDate, endDate });

      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('timestamp >= $1'),
        expect.arrayContaining([startDate, endDate])
      );
    });

    it('should apply pagination', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [] }));

      await getAuditLogs({ limit: 10, offset: 20 });

      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1'),
        expect.arrayContaining([10, 20])
      );
    });

    it('should combine multiple filters', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [] }));

      await getAuditLogs({
        userId: 'user-123',
        action: 'CREATE_REQUEST',
        entityType: 'request',
        limit: 50,
      });

      const query = mockPoolQuery.mock.calls[0][0];
      expect(query).toContain('user_id = $1');
      expect(query).toContain('action = $2');
      expect(query).toContain('entity_type = $3');
      expect(query).toContain('LIMIT $4');
    });

    it('should order by timestamp DESC', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [] }));

      await getAuditLogs({});

      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY timestamp DESC'),
        []
      );
    });
  });

  describe('getAuditLogCount', () => {
    it('should return total count with no filters', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [{ count: '42' }] }));

      const count = await getAuditLogCount({});

      expect(count).toBe(42);
    });

    it('should filter by userId', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [{ count: '5' }] }));

      const count = await getAuditLogCount({ userId: 'user-123' });

      expect(count).toBe(5);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = $1'),
        ['user-123']
      );
    });

    it('should filter by action', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [{ count: '10' }] }));

      const count = await getAuditLogCount({ action: 'LOGIN' });

      expect(count).toBe(10);
    });

    it('should filter by date range', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [{ count: '25' }] }));

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const count = await getAuditLogCount({ startDate, endDate });

      expect(count).toBe(25);
    });

    it('should combine multiple filters', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({ rows: [{ count: '3' }] }));

      await getAuditLogCount({
        userId: 'user-123',
        action: 'DELETE_REQUEST',
        entityType: 'request',
      });

      const query = mockPoolQuery.mock.calls[0][0];
      expect(query).toContain('user_id = $1');
      expect(query).toContain('action = $2');
      expect(query).toContain('entity_type = $3');
    });
  });

  describe('redactEmail', () => {
    it('should return a string starting with "hmac:"', () => {
      const result = redactEmail('john@example.com');
      expect(result).toMatch(/^hmac:/);
    });

    it('should produce the same output for the same input (deterministic)', () => {
      const email = 'john@example.com';
      expect(redactEmail(email)).toBe(redactEmail(email));
    });

    it('should produce different outputs for different inputs', () => {
      expect(redactEmail('alice@example.com')).not.toBe(redactEmail('bob@example.com'));
    });

    it('should never contain the original email substring', () => {
      const email = 'john@example.com';
      const result = redactEmail(email);
      expect(result).not.toContain(email);
      expect(result).not.toContain('john');
      expect(result).not.toContain('example.com');
    });

    it('should produce a token of the expected format "hmac:<16 hex chars>"', () => {
      const result = redactEmail('test@example.com');
      expect(result).toMatch(/^hmac:[0-9a-f]{16}$/);
    });

    it('should throw when LOG_REDACTION_SECRET is missing in production', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalSecret = process.env.LOG_REDACTION_SECRET;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.LOG_REDACTION_SECRET;
        expect(() => redactEmail('test@example.com')).toThrow('LOG_REDACTION_SECRET must be set in production');
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalSecret !== undefined) process.env.LOG_REDACTION_SECRET = originalSecret;
      }
    });

    it('should use provided LOG_REDACTION_SECRET when set', () => {
      const originalSecret = process.env.LOG_REDACTION_SECRET;
      try {
        process.env.LOG_REDACTION_SECRET = 'test-secret-value';
        const result = redactEmail('test@example.com');
        expect(result).toMatch(/^hmac:[0-9a-f]{16}$/);
        // Different secret should produce different output than dev fallback
        delete process.env.LOG_REDACTION_SECRET;
        const devResult = redactEmail('test@example.com');
        expect(result).not.toBe(devResult);
      } finally {
        if (originalSecret !== undefined) {
          process.env.LOG_REDACTION_SECRET = originalSecret;
        } else {
          delete process.env.LOG_REDACTION_SECRET;
        }
      }
    });
  });

  describe('logSecurityEvent', () => {
    it('should store the redacted email (not the raw email) in the DB INSERT', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({}));

      const rawEmail = 'victim@example.com';
      await logSecurityEvent(
        AuditAction.AUTH_FAILURE,
        { reason: 'invalid password', userEmail: rawEmail },
        '1.2.3.4',
        'TestAgent/1.0'
      );

      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockPoolQuery.mock.calls[0][1];

      // user_email (index 1) must NOT contain raw email, user_name (index 2) is a placeholder
      expect(callArgs[1]).not.toBe(rawEmail);
      expect(callArgs[2]).not.toBe(rawEmail);

      // user_email should be the hmac token; user_name is a semantic placeholder
      expect(callArgs[1]).toMatch(/^hmac:[0-9a-f]{16}$/);
      expect(callArgs[2]).toBe('[security_event]');

      // The redacted value should match what redactEmail produces
      expect(callArgs[1]).toBe(redactEmail(rawEmail));

      // The details JSON (index 6) must NOT contain the raw email
      const detailsJson = callArgs[6];
      expect(detailsJson).not.toContain(rawEmail);
      expect(detailsJson).toContain(redactEmail(rawEmail));
    });

    it('should store "anonymous" when no email is provided', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockResult({}));

      await logSecurityEvent(
        AuditAction.AUTH_FAILURE,
        { reason: 'missing token' },
        '1.2.3.4'
      );

      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockPoolQuery.mock.calls[0][1];
      expect(callArgs[1]).toBe('anonymous'); // user_email
      expect(callArgs[2]).toBe('[security_event]'); // user_name is always the semantic placeholder
    });

    it('should not throw on database error (fail-safe)', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        logSecurityEvent(AuditAction.ACCESS_DENIED, { reason: 'forbidden' })
      ).resolves.toBeUndefined();
    });
  });
});
