import { logger } from '../middleware/logger';

interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates critical configuration settings at startup
 * In production mode, insecure defaults will prevent the server from starting
 * In development mode, warnings are logged but the server will start
 */
export function validateConfig(): ConfigValidationResult {
  const isProduction = process.env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownDevPasswords = ['admin123', 'manager123', 'engineer123', 'user123'];

  // Validate CORS_ORIGIN
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin || corsOrigin === '*') {
    const message = 'CORS_ORIGIN is set to allow all origins (*). Set specific origins in production.';
    if (isProduction) {
      errors.push(message);
    } else {
      warnings.push(message + ' (acceptable for development)');
    }
  } else {
    // Validate CORS_ORIGIN is a valid URL
    try {
      const url = new URL(corsOrigin);
      // Must be http or https
      if (!['http:', 'https:'].includes(url.protocol)) {
        const message = `CORS_ORIGIN has invalid protocol "${url.protocol}". Must be http: or https:`;
        if (isProduction) {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }
      // In production, should use https (unless localhost)
      if (isProduction && url.protocol === 'http:' && !url.hostname.includes('localhost')) {
        warnings.push('CORS_ORIGIN uses HTTP instead of HTTPS. Consider using HTTPS in production.');
      }
    } catch {
      const message = `CORS_ORIGIN "${corsOrigin}" is not a valid URL. Must be a valid URL like "https://example.com"`;
      if (isProduction) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  // Validate DB_PASSWORD
  const dbPassword = process.env.DB_PASSWORD;
  const insecureDbPasswords = ['password', '123456', 'sim-rq', 'simrq', 'postgres', 'admin'];
  if (dbPassword === 'SimRQ2025!Secure') {
    const message = 'DB_PASSWORD uses a committed repository default. Set a unique password in production.';
    if (isProduction) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  } else if (dbPassword && insecureDbPasswords.some(insecure => dbPassword.toLowerCase() === insecure)) {
    const message = 'DB_PASSWORD appears to be a weak password. Use a strong password in production.';
    if (isProduction) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  // Validate S3 credentials (if storage is enabled)
  const s3AccessKey = process.env.S3_ACCESS_KEY_ID;
  const s3SecretKey = process.env.S3_SECRET_ACCESS_KEY;

  if (s3AccessKey) {
    const defaultDevAccessKey = 'GK0000000000000000deadbeef';
    const defaultDevSecretKey = '0000000000000000000000000000000000000000000000000000000000000001';

    if (s3AccessKey === defaultDevAccessKey || s3SecretKey === defaultDevSecretKey) {
      const message = 'S3 credentials use default development values. Generate unique credentials for production.';
      if (isProduction) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  const bootstrapAdminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.QADMIN_PASSWORD;
  if (bootstrapAdminPassword && knownDevPasswords.includes(bootstrapAdminPassword)) {
    const message = 'BOOTSTRAP_ADMIN_PASSWORD uses a known development default. Set a unique bootstrap admin password in production.';
    if (isProduction) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  // Validate ENTRA_SSO_ENCRYPTION_KEY (required for SSO if SSO is enabled)
  // Note: The encryption service will fail fast if this is missing and SSO is configured
  // This validation provides early warning about the requirement
  if (!process.env.ENTRA_SSO_ENCRYPTION_KEY) {
    const message = 'ENTRA_SSO_ENCRYPTION_KEY is not set. Required if SSO will be configured. Generate with: openssl rand -base64 32';
    warnings.push(message);
  } else if (process.env.ENTRA_SSO_ENCRYPTION_KEY.length < 32) {
    const message = 'ENTRA_SSO_ENCRYPTION_KEY appears to be weak (less than 32 characters). Generate a stronger key with: openssl rand -base64 32';
    if (isProduction) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Run configuration validation and exit if invalid in production
 */
export function enforceSecureConfig(): void {
  const result = validateConfig();
  const isProduction = process.env.NODE_ENV === 'production';

  // Log warnings
  result.warnings.forEach(warning => {
    logger.warn(`CONFIG WARNING: ${warning}`);
  });

  // Log errors
  result.errors.forEach(error => {
    logger.error(`CONFIG ERROR: ${error}`);
  });

  // In production, exit if configuration is invalid
  if (!result.isValid) {
    logger.error('');
    logger.error('═══════════════════════════════════════════════════════════════');
    logger.error('  SECURITY CONFIGURATION ERROR - SERVER CANNOT START');
    logger.error('═══════════════════════════════════════════════════════════════');
    logger.error('');
    logger.error('  The server detected insecure configuration that cannot be');
    logger.error('  used in production. Please fix the following issues:');
    logger.error('');
    result.errors.forEach((error, index) => {
      logger.error(`  ${index + 1}. ${error}`);
    });
    logger.error('');
    logger.error('  For help, see .env.example for proper configuration.');
    logger.error('');
    logger.error('═══════════════════════════════════════════════════════════════');
    process.exit(1);
  }

  // Log success message
  if (isProduction) {
    logger.info('Security configuration validated successfully');
  } else if (result.warnings.length > 0) {
    logger.info(`Running in development mode with ${result.warnings.length} configuration warning(s)`);
  }
}
