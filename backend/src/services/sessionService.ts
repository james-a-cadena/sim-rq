import crypto from 'crypto';
import { query } from '../db';
import { logger } from '../middleware/logger';
import {
  SESSION_EXPIRATION_DAYS,
  MAX_SESSIONS_PER_USER,
} from '../config/session';

export interface Session {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface SessionUser {
  id: string;
  userId: string; // Alias for id, for backward compatibility
  email: string;
  name: string;
  role: string;
  authenticatedAt?: Date;
}

/**
 * Generate a cryptographically secure session ID
 */
export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Hash a session ID for storage
 */
export function hashSessionId(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

/**
 * Store a session in the database
 * Uses the existing refresh_tokens table (structure is compatible)
 */
export async function storeSession(
  userId: string,
  sessionId: string,
  userAgent?: string,
  ipAddress?: string
): Promise<void> {
  const sessionHash = hashSessionId(sessionId);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRATION_DAYS);

  try {
    // First, enforce session limit by revoking oldest sessions if needed
    await enforceSessionLimit(userId);

    // Insert new session (using refresh_tokens table)
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, sessionHash, expiresAt.toISOString(), userAgent || null, ipAddress || null]
    );

    logger.info(`Session created for user ${userId}`);
  } catch (error) {
    logger.error('Error storing session:', error);
    throw error;
  }
}

/**
 * Validate a session and return user data if valid
 *
 * Defense-in-depth: Checks expiration at both DB level (via SQL) and
 * application level (via TypeScript) to protect against clock drift issues.
 *
 * @throws Error on database/unexpected errors (callers should handle)
 * @returns SessionUser if valid, null if session not found/expired/revoked
 */
export async function validateSession(sessionId: string): Promise<SessionUser | null> {
  const sessionHash = hashSessionId(sessionId);

  // Let database errors propagate - callers should handle them appropriately
  // This allows proper "fail closed" behavior in security-sensitive contexts
  // Note: We query expires_at for app-level verification but still check in SQL as primary defense
  const result = await query(
    `SELECT u.id, u.email, u.name, u.role, u.deleted_at, rt.expires_at, rt.created_at
     FROM refresh_tokens rt
     JOIN users u ON rt.user_id = u.id
     WHERE rt.token_hash = $1
     AND rt.expires_at > NOW()
     AND rt.revoked_at IS NULL`,
    [sessionHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  // App-level expiration check (defense-in-depth against clock drift between app and DB)
  const expiresAt = new Date(result.rows[0].expires_at);
  if (expiresAt <= new Date()) {
    logger.warn(`Session validation rejected: App-level expiration check failed (DB: ${expiresAt.toISOString()}, Now: ${new Date().toISOString()})`);
    return null;
  }

  // Check if user is deactivated (soft-deleted)
  if (result.rows[0].deleted_at) {
    logger.info(`Session validation rejected: User ${result.rows[0].id} is deactivated`);
    return null;
  }

  const userId = result.rows[0].id;
  return {
    id: userId,
    userId: userId, // Alias for backward compatibility
    email: result.rows[0].email,
    name: result.rows[0].name,
    role: result.rows[0].role,
    authenticatedAt: result.rows[0].created_at ? new Date(result.rows[0].created_at) : undefined,
  };
}

/**
 * Revoke a specific session by session ID
 */
export async function revokeSession(
  sessionId: string,
  reason: string = 'logout'
): Promise<boolean> {
  const sessionHash = hashSessionId(sessionId);

  try {
    const result = await query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW(), revoked_reason = $2
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [sessionHash, reason]
    );

    return result.rowCount !== null && result.rowCount > 0;
  } catch (error) {
    logger.error('Error revoking session:', error);
    return false;
  }
}

/**
 * Revoke all sessions for a user
 */
export async function revokeAllUserSessions(
  userId: string,
  reason: string = 'logout_all'
): Promise<number> {
  try {
    const result = await query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW(), revoked_reason = $2
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, reason]
    );

    const count = result.rowCount || 0;
    logger.info(`Revoked ${count} sessions for user ${userId}`);
    return count;
  } catch (error) {
    logger.error('Error revoking all user sessions:', error);
    return 0;
  }
}

/**
 * Revoke all sessions for a user except the current one
 */
export async function revokeOtherUserSessions(
  userId: string,
  currentSessionId: string,
  reason: string = 'logout_all_others'
): Promise<number> {
  const currentSessionHash = hashSessionId(currentSessionId);

  try {
    const result = await query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW(), revoked_reason = $2
       WHERE user_id = $1 AND revoked_at IS NULL AND token_hash != $3`,
      [userId, reason, currentSessionHash]
    );

    const count = result.rowCount || 0;
    logger.info(`Revoked ${count} other sessions for user ${userId}`);
    return count;
  } catch (error) {
    logger.error('Error revoking other user sessions:', error);
    return 0;
  }
}

/**
 * Enforce maximum session limit per user with atomic row-level locking
 * Revokes oldest sessions if user exceeds limit
 *
 * Uses SELECT FOR UPDATE to prevent race conditions in concurrent login scenarios
 */
async function enforceSessionLimit(userId: string): Promise<void> {
  try {
    // Use a single transaction with row-level locking to prevent race conditions
    await query('BEGIN');

    // Lock and count active sessions atomically
    const countResult = await query(
      `SELECT id FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at ASC
       FOR UPDATE`,
      [userId]
    );

    const activeCount = countResult.rows.length;

    if (activeCount >= MAX_SESSIONS_PER_USER) {
      // Revoke oldest sessions to make room (already locked by FOR UPDATE)
      const sessionsToRevoke = activeCount - MAX_SESSIONS_PER_USER + 1;
      const idsToRevoke = countResult.rows.slice(0, sessionsToRevoke).map(row => row.id);

      await query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW(), revoked_reason = 'session_limit'
         WHERE id = ANY($1)`,
        [idsToRevoke]
      );

      logger.info(`Revoked ${sessionsToRevoke} old sessions for user ${userId} due to session limit`);
    }

    await query('COMMIT');
  } catch (error) {
    await query('ROLLBACK');
    logger.error('Error enforcing session limit:', error);
    // Don't throw - this is a best-effort operation
  }
}

/**
 * Clean up expired and revoked sessions (call periodically)
 * Expired sessions are deleted after 1 hour (reduced from 1 day for faster cleanup)
 * Revoked sessions are kept for 7 days for audit purposes
 */
export async function cleanupExpiredSessions(): Promise<number> {
  try {
    // Delete sessions that are expired (1 hour grace) OR have been revoked for more than 7 days
    const result = await query(
      `DELETE FROM refresh_tokens
       WHERE expires_at < NOW() - INTERVAL '1 hour'
       OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days')`
    );

    const count = result.rowCount || 0;
    if (count > 0) {
      logger.info(`Cleaned up ${count} expired/revoked sessions`);
    }
    return count;
  } catch (error) {
    logger.error('Error cleaning up sessions:', error);
    return 0;
  }
}

/**
 * Get active sessions for a user (for session management UI)
 */
export async function getUserSessions(userId: string): Promise<{
  id: string;
  createdAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}[]> {
  try {
    const result = await query(
      `SELECT id, created_at, user_agent, ip_address
       FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows.map(row => ({
      id: row.id,
      createdAt: row.created_at,
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
    }));
  } catch (error) {
    logger.error('Error getting user sessions:', error);
    return [];
  }
}

/**
 * Revoke a specific session by database ID (for session management UI)
 */
export async function revokeSessionById(
  sessionId: string,
  userId: string
): Promise<boolean> {
  try {
    const result = await query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW(), revoked_reason = 'user_revoke'
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId]
    );

    return result.rowCount !== null && result.rowCount > 0;
  } catch (error) {
    logger.error('Error revoking session by ID:', error);
    return false;
  }
}
