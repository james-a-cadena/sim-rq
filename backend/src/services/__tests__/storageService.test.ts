/**
 * Unit Tests for Storage Service
 *
 * Tests file storage functionality including validation, key generation,
 * and file type checks. S3 operations are mocked.
 */

import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';

// Mock environment variables before importing the service
vi.stubEnv('S3_ENDPOINT', 'http://localhost:3900');
vi.stubEnv('S3_ACCESS_KEY_ID', 'test-access-key');
vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test-secret-key');
vi.stubEnv('S3_BUCKET_NAME', 'test-bucket');
vi.stubEnv('MAX_FILE_SIZE_MB', '100');
vi.stubEnv('ALLOWED_FILE_TYPES', 'pdf,doc,docx,jpg,png,mp4');

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
  // Use a function (not arrow) so vitest 4 allows calling with `new`
  S3Client: vi.fn().mockImplementation(function () {
    return {
      send: vi.fn().mockResolvedValue({}),
      destroy: vi.fn(),
    };
  }),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  HeadBucketCommand: vi.fn(),
  CreateBucketCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
  HeadObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn().mockImplementation(() => ({
    done: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com/file'),
}));

// Mock logger
vi.mock('../../middleware/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  isStorageEnabled,
  validateFile as _validateFile,
  generateStorageKey,
  generateThumbnailKey,
  isImageType,
  isVideoType,
  isMediaType,
  getStorageConfig,
  getStorageStatus,
  DEFAULT_MAX_FILE_SIZE_MB,
  initializeStorage,
} from '../storageService';

describe('StorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isStorageEnabled', () => {
    test('should return true when S3 credentials are configured', () => {
      expect(isStorageEnabled()).toBe(true);
    });
  });

  describe('validateFile', () => {
    // Note: These tests need storage to be connected, which requires mocking
    // the initialization. For unit tests, we focus on testable utility functions.

    test('should reject files with invalid extensions', () => {
      // This test would require mocking isStorageConnected
      // For now, we test the logic indirectly through getStorageConfig
      const config = getStorageConfig();
      expect(config.allowedFileTypes).toContain('pdf');
      expect(config.allowedFileTypes).toContain('jpg');
      expect(config.allowedFileTypes).not.toContain('exe');
    });

    test('should have a positive max file size from config', () => {
      const config = getStorageConfig();
      // Config value depends on env, just verify it's positive
      expect(config.maxFileSize).toBeGreaterThan(0);
    });
  });

  describe('generateStorageKey', () => {
    test('should generate a unique storage key with request ID and timestamp', () => {
      const requestId = '123e4567-e89b-12d3-a456-426614174000';
      const fileName = 'test-document.pdf';

      const key = generateStorageKey(requestId, fileName);

      expect(key).toMatch(/^requests\/123e4567-e89b-12d3-a456-426614174000\/\d+-test-document\.pdf$/);
    });

    test('should sanitize special characters in filename', () => {
      const requestId = 'test-request-id';
      const fileName = 'test document (1).pdf';

      const key = generateStorageKey(requestId, fileName);

      expect(key).toContain('test_document__1_.pdf');
      expect(key).not.toContain(' ');
      expect(key).not.toContain('(');
      expect(key).not.toContain(')');
    });

    test('should handle unicode characters in filename', () => {
      const requestId = 'test-request-id';
      const fileName = 'tëst-dócument.pdf';

      const key = generateStorageKey(requestId, fileName);

      expect(key).toContain('requests/test-request-id/');
      expect(key).toContain('.pdf');
    });
  });

  describe('generateThumbnailKey', () => {
    test('should generate thumbnail key in thumbnails subfolder', () => {
      const requestId = 'test-request-id';
      const originalFileName = 'photo.jpg';

      const key = generateThumbnailKey(requestId, originalFileName);

      expect(key).toMatch(/^requests\/test-request-id\/thumbnails\/\d+-photo\.webp$/);
    });

    test('should strip original extension and add webp', () => {
      const requestId = 'test-request-id';
      const originalFileName = 'video.mp4';

      const key = generateThumbnailKey(requestId, originalFileName);

      expect(key).toContain('.webp');
      expect(key).not.toContain('.mp4');
    });
  });

  describe('isImageType', () => {
    test('should return true for common image types', () => {
      expect(isImageType('image/png')).toBe(true);
      expect(isImageType('image/jpeg')).toBe(true);
      expect(isImageType('image/jpg')).toBe(true);
      expect(isImageType('image/gif')).toBe(true);
      expect(isImageType('image/webp')).toBe(true);
      expect(isImageType('image/heic')).toBe(true);
      expect(isImageType('image/heif')).toBe(true);
    });

    test('should return false for non-image types', () => {
      expect(isImageType('video/mp4')).toBe(false);
      expect(isImageType('application/pdf')).toBe(false);
      expect(isImageType('text/plain')).toBe(false);
    });

    test('should be case-insensitive', () => {
      expect(isImageType('IMAGE/PNG')).toBe(true);
      expect(isImageType('Image/Jpeg')).toBe(true);
    });
  });

  describe('isVideoType', () => {
    test('should return true for common video types', () => {
      expect(isVideoType('video/mp4')).toBe(true);
      expect(isVideoType('video/quicktime')).toBe(true);
      expect(isVideoType('video/x-msvideo')).toBe(true);
      expect(isVideoType('video/webm')).toBe(true);
      expect(isVideoType('video/x-matroska')).toBe(true);
      expect(isVideoType('video/x-m4v')).toBe(true);
    });

    test('should return false for non-video types', () => {
      expect(isVideoType('image/png')).toBe(false);
      expect(isVideoType('application/pdf')).toBe(false);
      expect(isVideoType('audio/mpeg')).toBe(false);
    });

    test('should be case-insensitive', () => {
      expect(isVideoType('VIDEO/MP4')).toBe(true);
      expect(isVideoType('Video/Quicktime')).toBe(true);
    });
  });

  describe('isMediaType', () => {
    test('should return true for image types', () => {
      expect(isMediaType('image/png')).toBe(true);
      expect(isMediaType('image/jpeg')).toBe(true);
    });

    test('should return true for video types', () => {
      expect(isMediaType('video/mp4')).toBe(true);
      expect(isMediaType('video/quicktime')).toBe(true);
    });

    test('should return false for non-media types', () => {
      expect(isMediaType('application/pdf')).toBe(false);
      expect(isMediaType('text/plain')).toBe(false);
      expect(isMediaType('application/zip')).toBe(false);
    });
  });

  describe('getStorageConfig', () => {
    test('should return storage configuration', () => {
      const config = getStorageConfig();

      expect(config).toHaveProperty('maxFileSize');
      expect(config).toHaveProperty('allowedFileTypes');
      expect(config).toHaveProperty('bucket');
      expect(config).toHaveProperty('enabled');

      // Bucket should be a non-empty string when storage is configured
      expect(typeof config.bucket).toBe('string');
      expect(Array.isArray(config.allowedFileTypes)).toBe(true);
    });

    test('should include all configured file types', () => {
      const config = getStorageConfig();

      expect(config.allowedFileTypes).toContain('pdf');
      expect(config.allowedFileTypes).toContain('doc');
      expect(config.allowedFileTypes).toContain('jpg');
      expect(config.allowedFileTypes).toContain('mp4');
    });
  });

  describe('getStorageStatus', () => {
    test('should return storage status with enabled flag', () => {
      const status = getStorageStatus();

      expect(status).toHaveProperty('enabled');
      expect(status).toHaveProperty('connected');
      expect(status.enabled).toBe(true);
    });

    test('should include bucket and endpoint when enabled', () => {
      const status = getStorageStatus();

      if (status.enabled) {
        // Bucket and endpoint should be strings when enabled
        expect(typeof status.bucket).toBe('string');
        expect(typeof status.endpoint).toBe('string');
        expect(status.bucket!.length).toBeGreaterThan(0);
        expect(status.endpoint!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('File Size Validation', () => {
    test('should have a positive max file size', () => {
      const config = getStorageConfig();
      // Max file size should be positive (actual value depends on env)
      expect(config.maxFileSize).toBeGreaterThan(0);
    });
  });

  describe('Allowed File Types', () => {
    test('should have allowed file types configured', () => {
      const config = getStorageConfig();
      // Should have at least some allowed file types
      expect(config.allowedFileTypes.length).toBeGreaterThan(0);
      // Common types should be included
      expect(config.allowedFileTypes).toContain('pdf');
    });
  });

  describe('DEFAULT_MAX_FILE_SIZE_MB constant', () => {
    test('should export DEFAULT_MAX_FILE_SIZE_MB as 100', () => {
      expect(DEFAULT_MAX_FILE_SIZE_MB).toBe(100);
    });

    test('default max file size should not be 3072 (the old too-permissive value)', () => {
      expect(DEFAULT_MAX_FILE_SIZE_MB).not.toBe(3072);
    });
  });

  describe('validateFile with storage connected', () => {
    // Run initializeStorage once before these tests so isStorageConnected() returns
    // true. The @aws-sdk/client-s3 mock (defined above with vi.mock) ensures
    // HeadBucketCommand resolves successfully, setting the module-level isConnected
    // flag to true. We use beforeAll so it runs before vi.clearAllMocks() in the
    // outer beforeEach can interfere.
    beforeAll(async () => {
      await initializeStorage();
    });

    test('should reject a file that exceeds 100 MB when no env override is set', () => {
      // MAX_FILE_SIZE_MB is stubbed to '100' at the top of this file.
      // 101 MB should be rejected.
      const overLimitSize = 101 * 1024 * 1024;
      const result = _validateFile('document.pdf', 'application/pdf', overLimitSize);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/100MB/i);
    });

    test('should accept a file exactly at the 100 MB limit', () => {
      const atLimitSize = 100 * 1024 * 1024;
      const result = _validateFile('document.pdf', 'application/pdf', atLimitSize);
      expect(result.valid).toBe(true);
    });

    test('should reject a file just over the 100 MB limit', () => {
      // 1 byte over 100 MB
      const justOverLimitSize = 100 * 1024 * 1024 + 1;
      const result = _validateFile('document.pdf', 'application/pdf', justOverLimitSize);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/100MB/i);
    });
  });
});

describe('StorageService Edge Cases', () => {
  test('should handle empty filename', () => {
    const key = generateStorageKey('request-id', '');
    expect(key).toMatch(/^requests\/request-id\/\d+-$/);
  });

  test('should handle filename with only extension', () => {
    const key = generateStorageKey('request-id', '.pdf');
    expect(key).toMatch(/^requests\/request-id\/\d+-\.pdf$/);
  });

  test('should handle filename with multiple dots', () => {
    const key = generateStorageKey('request-id', 'file.name.with.dots.pdf');
    expect(key).toContain('file.name.with.dots.pdf');
  });

  test('should handle very long filename', () => {
    const longName = 'a'.repeat(200) + '.pdf';
    const key = generateStorageKey('request-id', longName);
    expect(key).toContain('request-id');
    expect(key).toContain('.pdf');
  });
});
