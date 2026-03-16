/**
 * Storage Service
 *
 * Provides optional S3-compatible storage for file attachments.
 * Uses Garage (https://garagehq.deuxfleurs.fr/) as the storage backend.
 *
 * If S3_ACCESS_KEY_ID is not set, file uploads are disabled.
 * Supports multipart uploads for large files (>5 MB).
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
// file-type is ESM-only, imported dynamically in validateFileContent()
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import DOMPurify from 'isomorphic-dompurify';
import { logger } from '../middleware/logger';
import { getCorsOrigin } from '../utils/envConfig';

let s3Client: S3Client | null = null;
let publicS3Client: S3Client | null = null; // Client with public endpoint for browser-accessible signed URLs
let isConnected = false;
let connectionAttempted = false;

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'sim-rq-attachments';
const SIGNED_URL_EXPIRES_IN = 3600; // 1 hour

// Configurable limits
export const DEFAULT_MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || String(DEFAULT_MAX_FILE_SIZE_MB), 10) * 1024 * 1024;
const ALLOWED_FILE_TYPES = (
  process.env.ALLOWED_FILE_TYPES ||
  'pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,png,jpg,jpeg,gif,svg,webp,heic,heif,zip,mp4,mov,avi,webm,mkv,m4v'
).split(',');

// Image types that support thumbnails
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];

// Video types that need compression and thumbnail extraction
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska', 'video/x-m4v'];

export interface UploadResult {
  key: string;
  bucket: string;
  contentType: string;
  size: number;
}

export interface StorageConfig {
  maxFileSize: number;
  allowedFileTypes: string[];
  bucket: string;
  enabled: boolean;
}

/**
 * Check if storage is configured via environment variables
 */
export function isStorageEnabled(): boolean {
  return !!process.env.S3_ACCESS_KEY_ID && !!process.env.S3_ENDPOINT;
}

/**
 * Check if storage is currently connected
 */
export function isStorageConnected(): boolean {
  return isConnected;
}

/**
 * Get storage configuration
 */
export function getStorageConfig(): StorageConfig {
  return {
    maxFileSize: MAX_FILE_SIZE,
    allowedFileTypes: ALLOWED_FILE_TYPES,
    bucket: BUCKET_NAME,
    enabled: isStorageConnected(),
  };
}

/**
 * Check if a content type is an image
 */
export function isImageType(contentType: string): boolean {
  return IMAGE_TYPES.includes(contentType.toLowerCase());
}

/**
 * Check if a content type is a video
 */
export function isVideoType(contentType: string): boolean {
  return VIDEO_TYPES.includes(contentType.toLowerCase());
}

/**
 * Check if a content type is a media file that needs processing
 */
export function isMediaType(contentType: string): boolean {
  return isImageType(contentType) || isVideoType(contentType);
}

/**
 * Initialize S3 connection and ensure bucket exists
 */
export async function initializeStorage(): Promise<void> {
  if (connectionAttempted) {
    return;
  }
  connectionAttempted = true;

  if (!isStorageEnabled()) {
    logger.info('Storage not configured (S3_ACCESS_KEY_ID not set) - file uploads disabled');
    return;
  }

  const endpoint = process.env.S3_ENDPOINT;
  // For browser-accessible signed URLs: S3_PUBLIC_ENDPOINT > CORS_ORIGIN > S3_ENDPOINT
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || getCorsOrigin() || endpoint;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const region = process.env.S3_REGION || 'garage';

  try {
    // Main client for internal operations (uploads, deletes, etc.)
    s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
      forcePathStyle: true, // Required for Garage/MinIO
    });

    // Public client for generating browser-accessible signed URLs
    // Uses public endpoint (e.g., http://localhost:3900) instead of internal Docker hostname
    publicS3Client = new S3Client({
      endpoint: publicEndpoint,
      region,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
      forcePathStyle: true,
      // Disable automatic checksum calculation for presigned URLs
      // S3-compatible services like Garage don't handle AWS SDK v3's checksum headers
      // Without this, the SDK includes x-amz-checksum-crc32 in signed headers,
      // which browsers can't provide when uploading via presigned URLs
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    // Check if bucket exists
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
      logger.info(`Storage bucket '${BUCKET_NAME}' verified`);
    } catch (bucketError: unknown) {
      // Bucket doesn't exist - try to create it
      const error = bucketError as { name?: string };
      if (error.name === 'NotFound' || error.name === '404') {
        logger.info(`Bucket '${BUCKET_NAME}' not found, attempting to create...`);
        try {
          await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
          logger.info(`Storage bucket '${BUCKET_NAME}' created successfully`);
        } catch (createError) {
          logger.warn(`Could not create bucket '${BUCKET_NAME}':`, createError);
          throw createError;
        }
      } else {
        throw bucketError;
      }
    }

    isConnected = true;
    logger.info(`Storage connected to ${endpoint}, bucket: ${BUCKET_NAME}`);
    if (publicEndpoint !== endpoint) {
      logger.info(`Storage public endpoint: ${publicEndpoint}`);
    }
  } catch (error) {
    logger.warn('Failed to connect to storage - file uploads disabled:', error);
    s3Client = null;
    isConnected = false;
  }
}

/**
 * Validate file before upload
 */
export function validateFile(
  fileName: string,
  contentType: string,
  size: number
): { valid: boolean; error?: string } {
  if (!isStorageConnected()) {
    return { valid: false, error: 'File storage is not available' };
  }

  if (size > MAX_FILE_SIZE) {
    const maxSizeMB = Math.round(MAX_FILE_SIZE / 1024 / 1024);
    return { valid: false, error: `File size exceeds maximum of ${maxSizeMB}MB` };
  }

  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext || !ALLOWED_FILE_TYPES.includes(ext)) {
    return { valid: false, error: `File type .${ext} is not allowed` };
  }

  return { valid: true };
}

// Map of allowed extensions to expected MIME type prefixes for content validation
const EXTENSION_MIME_MAP: Record<string, string[]> = {
  // Documents
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml'],
  // Images
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  heic: ['image/heic'],
  heif: ['image/heif'],
  // Video
  mp4: ['video/mp4', 'video/x-m4v'], // M4V is essentially MP4 with Apple DRM support
  mov: ['video/quicktime'],
  avi: ['video/x-msvideo', 'video/avi'],
  webm: ['video/webm'],
  mkv: ['video/x-matroska'],
  m4v: ['video/x-m4v', 'video/mp4'],
  // Archives
  zip: ['application/zip', 'application/x-zip-compressed'],
};

// Extensions that are text-based and don't have magic bytes
const TEXT_EXTENSIONS = ['txt', 'csv', 'json', 'xml', 'md', 'svg'];

// Dangerous patterns in SVG files that could enable XSS attacks
const SVG_DANGEROUS_PATTERNS = [
  /<script[\s>]/i,
  /javascript:/i,
  /on\w+\s*=/i, // Event handlers like onclick, onerror, onload
  /<foreignObject/i, // Can embed HTML
  /xlink:href\s*=\s*["']?javascript:/i,
  /href\s*=\s*["']?javascript:/i,
];

/**
 * Validate and sanitize SVG content
 * Removes potentially dangerous elements that could enable XSS attacks
 */
export function validateSvgContent(
  buffer: Buffer,
  fileName: string
): { valid: boolean; error?: string; sanitized?: Buffer } {
  const content = buffer.toString('utf-8');

  // Check for dangerous patterns before sanitization
  for (const pattern of SVG_DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      logger.warn(`SVG file ${fileName} contains potentially dangerous pattern: ${pattern}`);
      // Use DOMPurify to sanitize the SVG
      const sanitized = DOMPurify.sanitize(content, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ['use'], // Allow <use> for SVG symbols
        FORBID_TAGS: ['script', 'foreignObject'],
        FORBID_ATTR: ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur'],
      });

      // Verify sanitization removed dangerous content
      for (const dangerousPattern of SVG_DANGEROUS_PATTERNS) {
        if (dangerousPattern.test(sanitized)) {
          return {
            valid: false,
            error: `SVG contains disallowed content that could not be sanitized`,
          };
        }
      }

      return {
        valid: true,
        sanitized: Buffer.from(sanitized, 'utf-8'),
      };
    }
  }

  // No dangerous patterns found, return as-is
  return { valid: true };
}

/**
 * Validate file content by checking magic bytes against declared MIME type
 * This prevents attackers from disguising malicious files with safe extensions
 */
export async function validateFileContent(
  buffer: Buffer,
  fileName: string,
  _declaredMime: string
): Promise<{ valid: boolean; error?: string; detectedMime?: string; sanitizedBuffer?: Buffer }> {
  const ext = fileName.split('.').pop()?.toLowerCase();

  // SVG files need special validation for XSS prevention
  if (ext === 'svg') {
    const svgResult = validateSvgContent(buffer, fileName);
    if (!svgResult.valid) {
      return { valid: false, error: svgResult.error };
    }
    // Return sanitized buffer if SVG was cleaned
    return { valid: true, sanitizedBuffer: svgResult.sanitized };
  }

  // Other text files have no magic bytes - skip content validation
  if (ext && TEXT_EXTENSIONS.includes(ext)) {
    return { valid: true };
  }

  // Need at least some bytes to detect file type
  if (buffer.length < 12) {
    logger.warn(`File ${fileName} too small for MIME detection (${buffer.length} bytes)`);
    return { valid: true }; // Allow but log warning
  }

  // Dynamic import for ESM-only module
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    // No magic bytes detected - could be text file or unknown format
    logger.warn(`Could not detect MIME type for ${fileName}, allowing upload`);
    return { valid: true };
  }

  // Check if detected MIME matches expected for extension
  const expectedMimes = ext ? EXTENSION_MIME_MAP[ext] : [];
  if (expectedMimes?.length && !expectedMimes.some((m) => detected.mime.startsWith(m))) {
    logger.warn(
      `File content mismatch for ${fileName}: detected ${detected.mime}, expected one of ${expectedMimes.join(', ')}`
    );
    return {
      valid: false,
      error: `File content (${detected.mime}) does not match extension .${ext}`,
      detectedMime: detected.mime,
    };
  }

  return { valid: true, detectedMime: detected.mime };
}

/**
 * Fetch the first N bytes of a file from S3 for MIME validation
 * Used for direct S3 uploads where we don't have the buffer
 */
export async function getFileHead(key: string, bytes: number): Promise<Buffer | null> {
  if (!s3Client || !isConnected) {
    return null;
  }

  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Range: `bytes=0-${bytes - 1}`,
      })
    );

    if (!response.Body) {
      return null;
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    logger.warn(`Failed to fetch file head for ${key}:`, error);
    return null;
  }
}

/**
 * Generate a unique storage key for a file
 */
export function generateStorageKey(requestId: string, fileName: string): string {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `requests/${requestId}/${timestamp}-${sanitizedFileName}`;
}

/**
 * Generate a storage key for a thumbnail
 */
export function generateThumbnailKey(requestId: string, originalFileName: string): string {
  const timestamp = Date.now();
  const baseName = originalFileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9.-]/g, '_');
  return `requests/${requestId}/thumbnails/${timestamp}-${baseName}.webp`;
}

/**
 * Upload a file to storage
 * Uses multipart upload for files larger than 5MB
 */
export async function uploadFile(
  key: string,
  body: Buffer | Readable,
  contentType: string,
  size: number
): Promise<UploadResult> {
  if (!s3Client || !isConnected) {
    throw new Error('Storage is not connected');
  }

  // Use multipart upload for files larger than 5MB
  if (size > 5 * 1024 * 1024) {
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
      },
      queueSize: 4,
      partSize: 5 * 1024 * 1024, // 5MB parts
    });

    await upload.done();
  } else {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: size,
      })
    );
  }

  return {
    key,
    bucket: BUCKET_NAME,
    contentType,
    size,
  };
}

/**
 * Generate a signed URL for downloading a file
 * Uses the public S3 client to generate browser-accessible URLs
 */
export async function getSignedDownloadUrl(key: string, fileName?: string): Promise<string> {
  if (!publicS3Client || !isConnected) {
    throw new Error('Storage is not connected');
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: fileName ? `attachment; filename="${fileName}"` : undefined,
  });

  return getSignedUrl(publicS3Client, command, { expiresIn: SIGNED_URL_EXPIRES_IN });
}

/**
 * Create a presigned URL for direct browser upload to S3
 * Uses publicS3Client so the URL is accessible from the browser
 */
export async function createPresignedUploadUrl(
  key: string,
  contentType: string,
  contentLength: number
): Promise<{ uploadUrl: string; expiresAt: Date }> {
  if (!publicS3Client || !isConnected) {
    throw new Error('Storage is not connected');
  }

  const expiresIn = SIGNED_URL_EXPIRES_IN; // 1 hour
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  const uploadUrl = await getSignedUrl(publicS3Client, command, { expiresIn });

  return { uploadUrl, expiresAt };
}

/**
 * Verify a file exists in S3 and matches expected size
 * Used after direct upload to confirm success before creating attachment record
 */
export async function verifyUploadedFile(
  key: string,
  expectedSize: number
): Promise<{ exists: boolean; size?: number; matches: boolean }> {
  if (!s3Client || !isConnected) {
    return { exists: false, matches: false };
  }

  try {
    const command = new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key });
    const response = await s3Client.send(command);
    const size = response.ContentLength || 0;
    return {
      exists: true,
      size,
      matches: size === expectedSize,
    };
  } catch {
    return { exists: false, matches: false };
  }
}

/**
 * Get a file stream for proxied downloads
 * Uses the internal S3 client (not public) for server-to-server access
 */
export async function getFileStream(
  key: string
): Promise<{ stream: Readable; contentType: string; contentLength: number }> {
  if (!s3Client || !isConnected) {
    throw new Error('Storage is not connected');
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('No file body returned from storage');
  }

  return {
    stream: response.Body as Readable,
    contentType: response.ContentType || 'application/octet-stream',
    contentLength: response.ContentLength || 0,
  };
}

/**
 * Delete a file from storage
 */
export async function deleteFile(key: string): Promise<void> {
  if (!s3Client || !isConnected) {
    throw new Error('Storage is not connected');
  }

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    })
  );
}

/**
 * Delete multiple files from storage
 */
export async function deleteFiles(keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await deleteFile(key);
    } catch (error) {
      logger.warn(`Failed to delete file ${key}:`, error);
    }
  }
}

/**
 * List files in a prefix
 */
export async function listFiles(prefix: string): Promise<string[]> {
  if (!s3Client || !isConnected) {
    return [];
  }

  try {
    const result = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
      })
    );
    return result.Contents?.map((obj) => obj.Key || '') || [];
  } catch {
    return [];
  }
}

/**
 * Get storage status for health checks
 */
export function getStorageStatus(): {
  enabled: boolean;
  connected: boolean;
  bucket?: string;
  endpoint?: string;
} {
  return {
    enabled: isStorageEnabled(),
    connected: isConnected,
    bucket: isStorageEnabled() ? BUCKET_NAME : undefined,
    endpoint: isStorageEnabled() ? process.env.S3_ENDPOINT : undefined,
  };
}

/**
 * Gracefully shutdown storage connection
 */
export async function shutdownStorage(): Promise<void> {
  if (s3Client) {
    s3Client.destroy();
    s3Client = null;
  }
  if (publicS3Client) {
    publicS3Client.destroy();
    publicS3Client = null;
  }
  if (isConnected) {
    isConnected = false;
    logger.info('Storage connection closed');
  }
}

/**
 * Get the S3 client (for advanced operations)
 */
export function getS3Client(): S3Client | null {
  return isConnected ? s3Client : null;
}
