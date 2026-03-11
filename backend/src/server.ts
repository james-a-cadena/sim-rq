import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import http from 'http';
import swaggerUi from 'swagger-ui-express';
import { apiLimiter } from './middleware/rateLimiter';
import { logger } from './middleware/logger';
import { addRequestId, errorHandler, notFoundHandler } from './middleware/errorHandler';
import { enforceSecureConfig } from './utils/configValidator';
import { getCorsOrigin } from './utils/envConfig';
import { cleanupExpiredSessions } from './services/sessionService';
import { cleanupOldLoginAttempts } from './services/loginAttemptService';
import { cleanupExpiredPKCEStates } from './services/msalService';
import { recordHttpRequest, generatePrometheusMetrics } from './services/metricsService';
import { initializeWebSocket, shutdownWebSocket } from './services/websocketService';
import { initializeNotificationCleanup, stopNotificationCleanup } from './services/notificationCleanupService';
import { initializeEmailService, shutdownEmailService } from './services/emailService';
import { initializeEmailDigestService, stopEmailDigestService } from './services/emailDigestService';
import { initializeRedis, shutdownRedis, getRedisStatus } from './services/redisService';
import { initializeStorage, shutdownStorage, getStorageStatus } from './services/storageService';
import { startCleanupInterval as startPendingUploadsCleanup, stopCleanupInterval as stopPendingUploadsCleanup } from './services/cleanupService';
import { ensureBootstrapAdmin } from './services/bootstrapAdminService';
import { swaggerSpec } from './config/swagger';
import authRouter from './routes/auth';
import requestsRouter from './routes/requests';
import usersRouter from './routes/users';
import projectsRouter from './routes/projects';
import ssoRouter from './routes/sso';
import userManagementRouter from './routes/userManagement';
import auditLogsRouter from './routes/auditLogs';
import analyticsRouter from './routes/analytics';
import notificationsRouter from './routes/notifications';
import attachmentsRouter from './routes/attachments';
import cspReportRouter from './routes/cspReport';
import pool from './db';

// Load environment variables
dotenv.config();

// Validate security configuration before starting
// In production, this will exit if critical settings are missing or insecure
enforceSecureConfig();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy - required for correct client IP and protocol detection behind reverse proxies
// Set to 1 to trust first proxy (Docker's internal nginx or external proxy)
// This enables: req.ip, req.protocol, req.secure, req.hostname to work correctly
app.set('trust proxy', 1);

// Security middleware with explicit Content Security Policy
// CSP helps prevent XSS, clickjacking, and other code injection attacks
const isProduction = process.env.NODE_ENV === 'production';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // SECURITY NOTE: 'unsafe-inline' for styles is required by TailwindCSS and React UI libraries
      // that inject dynamic styles. This is a known limitation - nonce-based CSP for styles would
      // require changes to the build pipeline and all UI component libraries.
      // Risk is mitigated by: strict scriptSrc (no unsafe-inline/unsafe-eval), DOMPurify input
      // sanitization, and HttpOnly cookies preventing session hijacking even if XSS occurs.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://api.dicebear.com", "blob:"], // Allow avatars and data URIs
      fontSrc: ["'self'"],
      connectSrc: ["'self'", "wss:", ...(isProduction ? [] : ["ws:"])], // wss: only in production, ws: allowed in dev
      frameSrc: ["'none'"], // Prevent clickjacking
      objectSrc: ["'none'"], // Block plugins
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"], // Prevent embedding in iframes (clickjacking protection)
      // CSP violation reporting - violations are logged for security monitoring
      reportUri: ['/api/csp-report'],
      // Only add upgradeInsecureRequests in production
      ...(isProduction && { upgradeInsecureRequests: [] }),
    },
  },
  // Strict-Transport-Security: max-age=31536000; includeSubDomains
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  // X-Content-Type-Options: nosniff
  noSniff: true,
  // X-Frame-Options: DENY (also handled by CSP frame-ancestors)
  frameguard: { action: 'deny' },
  // Referrer-Policy: strict-origin-when-cross-origin
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

/**
 * CORS Configuration
 *
 * CSRF Protection Notes:
 * - SameSite: 'strict' cookies prevent CSRF by default (session cookie won't be sent on cross-origin requests)
 * - CORS with credentials: true requires explicit origin (no wildcards)
 * - All state-changing endpoints require authentication via session cookie
 * - No token-based CSRF protection needed when using SameSite: strict
 */
app.use(cors({
  origin: getCorsOrigin(),
  credentials: true,
}));

// Cookie parser for session cookies
app.use(cookieParser());

// General API rate limiting (auth endpoints have stricter limits applied in their routes)
app.use('/api/', apiLimiter);

// Body parsing with explicit size limits
// Prevents DoS via large request bodies (default is 100kb, we set 1mb for flexibility)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Parse CSP violation reports (browsers send these with application/csp-report content type)
app.use(express.json({ type: 'application/csp-report', limit: '10kb' }));

// Add request ID to all requests
app.use(addRequestId);

// Request logging and metrics
app.use((req, res, next) => {
  const startTime = Date.now();
  logger.info(`${req.method} ${req.path}`, { requestId: req.requestId });

  // Record metrics after response is sent
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    recordHttpRequest(req.method, req.path, res.statusCode, duration);
  });

  next();
});

// Health check - basic liveness probe
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Readiness check - verifies database connectivity and optional service status
app.get('/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const redisStatus = getRedisStatus();
    const storageStatus = getStorageStatus();
    res.status(200).json({
      status: 'ready',
      database: 'connected',
      redis: redisStatus,
      storage: storageStatus,
    });
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({
      status: 'not ready',
      database: 'disconnected'
    });
  }
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    const metrics = await generatePrometheusMetrics();
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(metrics);
  } catch (error) {
    logger.error('Error generating metrics:', error);
    res.status(500).send('Error generating metrics');
  }
});

// Swagger API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Sim RQ API Documentation',
}));

// OpenAPI spec as JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// API routes
app.use('/api/auth', authRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/users', usersRouter);
app.use('/api/users/management', userManagementRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/sso', ssoRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api', attachmentsRouter);
app.use('/api', cspReportRouter);

// 404 handler - must be before error handler
app.use(notFoundHandler);

// Centralized error handler - must be last
app.use(errorHandler);

// Create HTTP server and attach Express app
const httpServer = http.createServer(app);

/**
 * Initialize services and start server
 * Redis is initialized first (if configured), then WebSocket can use Redis adapter
 */
async function startServer(): Promise<void> {
  await ensureBootstrapAdmin({
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.QADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.QADMIN_PASSWORD,
  });

  // Initialize Redis first (if configured) - rate limiting and WebSocket depend on it
  await initializeRedis();

  // Initialize S3-compatible storage (if configured) - for file attachments
  await initializeStorage();

  // Start cleanup for expired pending uploads (direct S3 upload tracking)
  startPendingUploadsCleanup();

  // Initialize WebSocket for real-time notifications (uses Redis if available)
  await initializeWebSocket(httpServer);

  // Start HTTP server
  httpServer.listen(PORT, () => {
    logger.info(`Sim RQ API server running on port ${PORT}`);
    logger.info(`WebSocket server initialized`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

    const redisStatus = getRedisStatus();
    if (redisStatus.enabled) {
      logger.info(`Redis: ${redisStatus.connected ? 'connected' : 'not connected'} (${redisStatus.host})`);
    }
  });
}

// Start server
startServer().then(() => {

  // Schedule periodic cleanup of expired sessions, login attempts, and PKCE states (every hour)
  setInterval(async () => {
    try {
      await cleanupExpiredSessions();
      await cleanupOldLoginAttempts();
      await cleanupExpiredPKCEStates();
    } catch (error) {
      logger.error('Error during scheduled cleanup:', error);
    }
  }, 60 * 60 * 1000); // 1 hour

  // Run initial cleanup on startup (use allSettled to handle partial failures)
  Promise.allSettled([
    cleanupExpiredSessions(),
    cleanupOldLoginAttempts(),
    cleanupExpiredPKCEStates(),
  ]).then((results) => {
    const cleanupNames = ['sessions', 'login attempts', 'PKCE states'];
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.error(`Initial cleanup failed for ${cleanupNames[index]}:`, result.reason);
      }
    });
  });

  // Initialize notification cleanup job
  initializeNotificationCleanup();

  // Initialize email services
  initializeEmailService();
  initializeEmailDigestService();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  httpServer.close(async () => {
    logger.info('HTTP server closed');
    stopNotificationCleanup();
    stopPendingUploadsCleanup();
    stopEmailDigestService();
    shutdownEmailService();
    await shutdownWebSocket();
    await shutdownStorage();
    await shutdownRedis();
    await pool.end();
    logger.info('Database pool closed');
    process.exit(0);
  });
});

export default app;
