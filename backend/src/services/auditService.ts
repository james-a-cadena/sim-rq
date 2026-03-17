import crypto from 'crypto';
import { Request } from 'express';
import pool from '../db';
import { logger } from '../middleware/logger';

/**
 * Redact an email address using HMAC-SHA256.
 * Returns a token of the form "hmac:<first16charsOfHexDigest>" to allow
 * log correlation without exposing PII.
 */
export const redactEmail = (email: string): string => {
  const secret = process.env.LOG_REDACTION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('LOG_REDACTION_SECRET must be set in production');
    }
    logger.warn('LOG_REDACTION_SECRET is not set; using dev fallback for email redaction');
    return `hmac:${crypto.createHmac('sha256', 'sim-rq-log-redaction-dev').update(email).digest('hex').slice(0, 16)}`;
  }
  const digest = crypto.createHmac('sha256', secret).update(email).digest('hex');
  return `hmac:${digest.slice(0, 16)}`;
};

export enum AuditAction {
  // Authentication
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  SSO_LOGIN = 'SSO_LOGIN',
  AUTH_FAILURE = 'AUTH_FAILURE',
  ACCESS_DENIED = 'ACCESS_DENIED',

  // Request operations
  CREATE_REQUEST = 'CREATE_REQUEST',
  UPDATE_REQUEST = 'UPDATE_REQUEST',
  DELETE_REQUEST = 'DELETE_REQUEST',
  ASSIGN_ENGINEER = 'ASSIGN_ENGINEER',
  UPDATE_REQUEST_STATUS = 'UPDATE_REQUEST_STATUS',

  // Project operations
  CREATE_PROJECT = 'CREATE_PROJECT',
  UPDATE_PROJECT = 'UPDATE_PROJECT',
  DELETE_PROJECT = 'DELETE_PROJECT',
  ARCHIVE_PROJECT = 'ARCHIVE_PROJECT',

  // User operations
  CREATE_USER = 'CREATE_USER',
  UPDATE_USER = 'UPDATE_USER',
  DELETE_USER = 'DELETE_USER',
  DEACTIVATE_USER = 'DEACTIVATE_USER',
  RESTORE_USER = 'RESTORE_USER',
  UPDATE_USER_ROLE = 'UPDATE_USER_ROLE',
  CHANGE_QADMIN_PASSWORD = 'CHANGE_QADMIN_PASSWORD',
  DISABLE_QADMIN = 'DISABLE_QADMIN',
  ENABLE_QADMIN = 'ENABLE_QADMIN',
  SYNC_USER = 'SYNC_USER',
  BULK_IMPORT_USERS = 'BULK_IMPORT_USERS',

  // Comment operations
  ADD_COMMENT = 'ADD_COMMENT',

  // Attachment operations
  ADD_ATTACHMENT = 'ADD_ATTACHMENT',
  DELETE_ATTACHMENT = 'DELETE_ATTACHMENT',
  DOWNLOAD_ATTACHMENT = 'DOWNLOAD_ATTACHMENT',

  // Time tracking
  ADD_TIME_ENTRY = 'ADD_TIME_ENTRY',
  UPDATE_PROJECT_HOURS = 'UPDATE_PROJECT_HOURS',

  // Workflow operations
  REQUEST_TITLE_CHANGE = 'REQUEST_TITLE_CHANGE',
  APPROVE_TITLE_CHANGE = 'APPROVE_TITLE_CHANGE',
  REJECT_TITLE_CHANGE = 'REJECT_TITLE_CHANGE',
  CREATE_DISCUSSION = 'CREATE_DISCUSSION',
  APPROVE_DISCUSSION = 'APPROVE_DISCUSSION',
  REJECT_DISCUSSION = 'REJECT_DISCUSSION',

  // SSO Configuration
  UPDATE_SSO_CONFIG = 'UPDATE_SSO_CONFIG',
  ENABLE_SSO = 'ENABLE_SSO',
  DISABLE_SSO = 'DISABLE_SSO',
}

export enum EntityType {
  REQUEST = 'request',
  PROJECT = 'project',
  USER = 'user',
  COMMENT = 'comment',
  TIME_ENTRY = 'time_entry',
  TITLE_CHANGE = 'title_change',
  DISCUSSION = 'discussion',
  SSO_CONFIG = 'sso_config',
  AUTH = 'auth',
  SYSTEM = 'system',
  ATTACHMENT = 'attachment',
}

interface AuditLogEntry {
  userId?: string;
  userEmail: string;
  userName: string;
  action: AuditAction;
  entityType: EntityType;
  entityId?: string | number;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  user_email: string;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: Date;
}

/**
 * Log an audit entry to the database
 */
export const logAudit = async (entry: AuditLogEntry): Promise<void> => {
  try {
    const query = `
      INSERT INTO audit_logs (
        user_id, user_email, user_name, action, entity_type,
        entity_id, details, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    const values = [
      entry.userId || null,
      entry.userEmail,
      entry.userName,
      entry.action,
      entry.entityType,
      entry.entityId || null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.ipAddress || null,
      entry.userAgent || null,
    ];

    await pool.query(query, values);

    logger.info('Audit log created', {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      user: entry.userEmail,
    });
  } catch (error) {
    // Don't throw - audit logging should not break application flow
    logger.error('Failed to create audit log', { error, entry });
  }
};

/**
 * Extract user info from authenticated request
 */
export const getUserFromRequest = (req: Request): { id: string; email: string; name: string } => {
  const user = req.user;
  if (!user) {
    throw new Error('User not found in request');
  }
  return {
    id: user.id || user.userId,
    email: user.email,
    name: user.name,
  };
};

/**
 * Extract IP address from request
 */
export const getIpFromRequest = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection.remoteAddress || 'unknown';
};

/**
 * Extract user agent from request
 */
export const getUserAgentFromRequest = (req: Request): string => {
  return req.headers['user-agent'] || 'unknown';
};

/**
 * Helper to log request-related audit events
 */
export const logRequestAudit = async (
  req: Request,
  action: AuditAction,
  entityType: EntityType,
  entityId?: string | number,
  details?: Record<string, unknown>
): Promise<void> => {
  try {
    const user = getUserFromRequest(req);

    await logAudit({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      action,
      entityType,
      entityId,
      details,
      ipAddress: getIpFromRequest(req),
      userAgent: getUserAgentFromRequest(req),
    });
  } catch (error) {
    logger.error('Failed to log request audit', { error, action, entityType, entityId });
  }
};

/**
 * Get audit logs with filtering and pagination
 */
export const getAuditLogs = async (filters: {
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string | number;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<AuditLogRow[]> => {
  let query = `
    SELECT
      id, user_id, user_email, user_name, action, entity_type,
      entity_id, details, ip_address, user_agent, timestamp
    FROM audit_logs
    WHERE 1=1
  `;

  const values: (string | number | Date)[] = [];
  let paramCount = 1;

  if (filters.userId) {
    query += ` AND user_id = $${paramCount++}`;
    values.push(filters.userId);
  }

  if (filters.action) {
    query += ` AND action = $${paramCount++}`;
    values.push(filters.action);
  }

  if (filters.entityType) {
    query += ` AND entity_type = $${paramCount++}`;
    values.push(filters.entityType);
  }

  if (filters.entityId) {
    query += ` AND entity_id = $${paramCount++}`;
    values.push(filters.entityId);
  }

  if (filters.startDate) {
    query += ` AND timestamp >= $${paramCount++}`;
    values.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ` AND timestamp <= $${paramCount++}`;
    values.push(filters.endDate);
  }

  query += ` ORDER BY timestamp DESC`;

  if (filters.limit) {
    query += ` LIMIT $${paramCount++}`;
    values.push(filters.limit);
  }

  if (filters.offset) {
    query += ` OFFSET $${paramCount++}`;
    values.push(filters.offset);
  }

  const result = await pool.query(query, values);
  return result.rows;
};

/**
 * Get audit log count with filtering
 */
export const getAuditLogCount = async (filters: {
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string | number;
  startDate?: Date;
  endDate?: Date;
}): Promise<number> => {
  let query = `SELECT COUNT(*) FROM audit_logs WHERE 1=1`;

  const values: (string | number | Date)[] = [];
  let paramCount = 1;

  if (filters.userId) {
    query += ` AND user_id = $${paramCount++}`;
    values.push(filters.userId);
  }

  if (filters.action) {
    query += ` AND action = $${paramCount++}`;
    values.push(filters.action);
  }

  if (filters.entityType) {
    query += ` AND entity_type = $${paramCount++}`;
    values.push(filters.entityType);
  }

  if (filters.entityId) {
    query += ` AND entity_id = $${paramCount++}`;
    values.push(filters.entityId);
  }

  if (filters.startDate) {
    query += ` AND timestamp >= $${paramCount++}`;
    values.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ` AND timestamp <= $${paramCount++}`;
    values.push(filters.endDate);
  }

  const result = await pool.query(query, values);
  return parseInt(result.rows[0].count);
};

/**
 * Log a security event (authentication failure or access denial)
 * Used by middleware to track 401/403 responses for security analysis
 */
export const logSecurityEvent = async (
  action: AuditAction.AUTH_FAILURE | AuditAction.ACCESS_DENIED,
  details: {
    reason: string;
    path?: string;
    method?: string;
    userId?: string;
    userEmail?: string;
    requiredRoles?: string[];
    currentRole?: string;
  },
  ipAddress?: string,
  userAgent?: string
): Promise<void> => {
  try {
    const query = `
      INSERT INTO audit_logs (
        user_id, user_email, user_name, action, entity_type,
        entity_id, details, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    const redactedEmail = details.userEmail ? redactEmail(details.userEmail) : 'anonymous';

    const values = [
      details.userId || null,
      redactedEmail,
      redactedEmail,
      action,
      EntityType.AUTH,
      null,
      JSON.stringify(details),
      ipAddress || null,
      userAgent || null,
    ];

    await pool.query(query, values);

    // Also log at warning level for immediate visibility
    logger.warn('Security event logged', {
      action,
      reason: details.reason,
      path: details.path,
      ip: ipAddress,
    });
  } catch (error) {
    // Don't throw - security logging should not break application flow
    logger.error('Failed to log security event', { error, action, details });
  }
};
