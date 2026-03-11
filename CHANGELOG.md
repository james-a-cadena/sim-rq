# Changelog

All notable changes to Sim RQ will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- markdownlint-disable MD024 -->

## [Unreleased]

### Security

- Removed seeded local users from the production database initialization path
- Added first-start bootstrap admin support via `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`
- Hardened production config validation to reject committed repository defaults for database and bootstrap credentials

### Changed

- **Redis 8 upgrade** - Updated from Redis 7 to Redis 8 (Phase 1 of major dependency upgrades)
  - 112% throughput improvement with io-threads
  - Now open source again under AGPLv3
  - Backward compatible - no code changes required
  - Tested with full E2E suite (82 passed)

- **Backend dependency upgrades** - Phase 2 of major dependency upgrades
  - dotenv: 16.3.1 → 17.2.3 (new config options)
  - bcrypt: 5.1.1 → 6.0.0 (prebuildify migration, faster installs)
  - helmet: 7.1.0 → 8.1.0 (CSP improvements)
  - file-type: 20.5.0 → 21.1.1 (better format detection)
  - sharp: 0.33.5 → 0.34.5 (image processing improvements)
  - Added node-gyp to devDependencies (enables sharp source builds on Alpine)
  - All upgrades tested with the full automated suite

## [0.9.9] - 2025-12-13

### Added

- **Comprehensive frontend unit tests** - Added 94 new frontend tests for major components
  - Dashboard.test.tsx (27 tests): needsAttentionCount, stats calculation, role-based UI
  - RequestList.test.tsx (25 tests): Role-based filtering, search, sorting, empty states
  - AuthContext.test.tsx (18 tests): Hook validation, SSO callback, session verification
  - Projects.test.tsx (23 tests): Permissions, creation, status transitions, deletion
  - Analytics.test.tsx (13 tests): Loading/error states, data rendering, completion rate
- **Test infrastructure** - New shared test utilities and mock factories
  - `src/test/mockData.ts`: Type-safe factories for User, Request, Project, Comment, Notification
  - `src/test/utils.tsx`: renderWithProviders helper with full context stack

### Changed

- **Test coverage improved** - Frontend tests increased from 30 to 124 (313% increase)
  - Total test count: 547 tests (124 frontend + 423 backend)

## [0.9.8] - 2025-12-13

### Added

- **Video processing progress indicator** - Real-time progress percentage displayed during video compression
  - WebSocket emits progress updates (throttled to 1 update/second)
  - Frontend shows "Processing X%" instead of just "Processing..."
  - Progress scales thumbnail extraction (0-10%) and compression (10-95%)

### Fixed

- **M4V video format support** - Videos from Apple devices with `video/x-m4v` MIME type now accepted for `.mp4` extension
  - M4V is essentially MP4 with Apple DRM support, commonly used by iOS devices

## [0.9.7] - 2025-12-13

### Fixed

- **SSO redirect for side-by-side dev/prod deployments** - SSO login now correctly redirects to the originating environment
  - Previously, SSO callback always redirected to production URL regardless of which environment initiated login
  - Added `DEV_CORS_ORIGIN` environment variable for development deployments
  - Created `envConfig.ts` utility with `getCorsOrigin()` and `getFrontendUrl()` helpers
  - Updated authController, server, websocketService, emailService, and storageService to use environment-aware URLs

## [0.9.6] - 2025-12-12

### Security

- **MIME type validation** - File uploads now verify content matches extension using magic bytes
  - Prevents attackers from disguising malicious files (e.g., `malware.exe` renamed to `document.pdf`)
  - Uses `file-type` library to detect actual file format from first 4KB
  - Validates both buffer uploads and direct S3 uploads
- **Production S3 credential validation** - Server refuses to start in production with default dev credentials
  - Prevents accidental deployment with insecure storage configuration
  - Follows existing pattern for DB_PASSWORD and ENTRA_SSO_ENCRYPTION_KEY validation

### Added

- **Dependabot configuration** - Automated weekly dependency scanning for security vulnerabilities
  - Monitors both frontend (`/`) and backend (`/backend`) npm packages
  - Opens PRs automatically when updates are available

### Changed

- **Updated npm dependencies** - Security-relevant packages updated:
  - axios: 1.6.2 → 1.13.2 (security patches)
  - isomorphic-dompurify: 2.9.0 → 2.34.0
  - zod: 3.22.4 → 3.25.76

### Documentation

- Updated test counts: 543 tests total (120 E2E + 423 backend unit tests)

## [0.9.5] - 2025-12-12

### Added

- **Direct S3 uploads** - Large file uploads now bypass nginx/backend entirely
  - Browser uploads directly to S3 using presigned URLs
  - Eliminates timeout issues for large files on slow connections
  - Real-time upload progress indicator with percentage
  - Automatic cleanup of expired pending uploads (hourly)
- **Processing status notifications** - WebSocket events notify when media processing completes
  - UI automatically refreshes thumbnails without manual page reload
  - Works behind Cloudflare Tunnel and other reverse proxies
- **Upload cancellation** - Cancel in-progress uploads with proper cleanup
- **New API endpoints** for direct upload workflow:
  - `POST /api/requests/:id/attachments/init` - Get presigned upload URL
  - `POST /api/requests/:id/attachments/complete` - Finalize upload after S3 PUT
  - `DELETE /api/requests/:id/attachments/cancel` - Cancel pending upload

### Security

- **Authorization check on attachments endpoint** - `GET /api/requests/:id/attachments` now verifies user has permission to view the request (creator, assigned engineer, Manager, or Admin)
- **CSP documentation** - Added security comment explaining why `unsafe-inline` is required for styles and the mitigating controls in place

### Changed

- **nginx API timeouts reduced** - `/api/` proxy timeouts reduced from 3600s to 120s (uploads no longer pass through)
- **nginx CORS for storage** - Added CORS preflight handling for direct browser-to-S3 uploads

### Technical

- New `pending_uploads` database table to track in-progress direct uploads
- `useDirectUpload` hook in frontend with XHR for upload progress tracking
- `emitToUser` WebSocket function for per-user event delivery
- Cleanup service runs hourly to remove expired pending uploads and orphaned S3 files

## [0.9.4] - 2025-12-12

### Added

- **HEIC/HEIF image support** - Apple device photos now supported for file attachments

### Fixed

- **S3 presigned URL signature mismatch** - Fixed file downloads failing behind reverse proxy by using path-style URLs
- **Large file uploads** - Increased nginx proxy timeouts to 1 hour (supports 3GB uploads on slow connections) and removed hardcoded body size limit
- **Docker build performance** - Excluded `data/` directory from build context via `.dockerignore`
- **TypeScript build** - Excluded test files from production build, fixed ESLint tsconfig for type-aware linting
- **Docker Compose validation** - Removed invalid empty `volumes` key

## [0.9.3] - 2025-12-10

### Added

- **Storage proxy for reverse proxy deployments** - nginx now proxies `/storage/` to Garage S3, allowing file attachments to work behind Cloudflare Tunnel and other reverse proxies

### Fixed

- **Broken thumbnails behind reverse proxy** - Signed S3 URLs now use the public domain instead of internal Docker hostnames
- **File downloads failing** - S3 storage is now accessible through the `/storage/` path on the main domain
- **SSO configuration error toast** - Settings page no longer shows error when SSO is not configured via environment variables (returns empty config instead of 404)

### Changed

- **S3_PUBLIC_ENDPOINT default** - Now defaults to `http://localhost:8080/storage` for easier local testing

## [0.9.2] - 2025-12-10

### Fixed

- **WebSocket proxy** - Added explicit `/socket.io/` location block in nginx for reliable real-time notifications
- **Health endpoint routing** - Fixed nginx `/health` endpoint being caught by SPA routing (now uses exact match)
- **E2E test rate limiting** - Added missing `DISABLE_RATE_LIMITING` env var to dev docker-compose

### Changed

- **Redis container naming** - Renamed from `simflow-redis-*` to `sim-rq-redis-*` for consistency
- **Health check tests** - Now test backend `/health` and `/ready` endpoints through proxy (works in both dev and prod)
- **Notification preferences test** - Changed to validate structure instead of hardcoded defaults (fixes flaky test)

### Added

- **Vite health proxies** - Added `/health` and `/ready` proxy routes for dev server monitoring
- **nginx WebSocket timeouts** - 24-hour timeouts for long-lived WebSocket connections

### Documentation

- Updated CLAUDE.md with user lifecycle, session limits, and test count information
- Removed dead reference to non-existent REVERSE-PROXY.md

## [0.9.1] - 2025-12-10

### Added

- **File attachments** - S3-compatible storage for request attachments
  - Garage storage backend auto-configured in Docker
  - Drag-and-drop upload on New Request form
  - Add attachments to existing requests via Request Detail page
  - Support for documents, images, videos, archives (up to 3GB)
  - Multipart upload for large files (> 5MB)
  - Signed download URLs for secure access
  - `attachments` database table with full metadata tracking
- **Bind mounts for data storage** - All persistent data now stored in `./data/` directory
  - `./data/postgres/` for database files
  - `./data/garage/` for S3 file storage
  - Easier backups - just copy the `./data/` directory
  - Survives container recreation
- **Dual S3 endpoint configuration** - Separate internal and public endpoints
  - `S3_ENDPOINT` for backend operations (Docker internal)
  - `S3_PUBLIC_ENDPOINT` for browser-accessible download URLs
- **Email testing with Mailhog** - Development email server at `http://localhost:8025`

### Changed

- **Data storage architecture** - Switched from Docker named volumes to bind mounts
- **Analytics queries** - Now include "Accepted" status in completion and allocation analysis

### Fixed

- **Time entry logging** - Fixed column name mismatch (`user_id` vs `engineer_id`) in time_entries table
- **File download URLs** - Fixed signed URLs using internal Docker hostname instead of browser-accessible endpoint
- **Analytics empty state** - Completion Time and Hour Allocation now show data for accepted requests

### Documentation

- Updated README with file attachments feature and data storage section
- Updated CLAUDE.md with storage service and file attachment documentation
- Updated .env.example with complete S3/Garage configuration

## [0.9.0] - 2025-12-08

### Added

- **qAdmin account disable/enable functionality** - Entra ID admins can now disable the local qAdmin account for enhanced security
  - New API endpoints: `GET /api/users/management/qadmin-status`, `POST /api/users/management/qadmin/disable`, `POST /api/users/management/qadmin/enable`
  - Requires at least one active Entra ID admin before qAdmin can be disabled
  - Only Entra ID administrators can manage qAdmin status
  - Login controller blocks disabled qAdmin account from authenticating
  - New `system_settings` database table for configuration storage
  - UI component in Settings → Security tab with modern modal dialogs
  - Audit logging for all qAdmin disable/enable actions
  - Enforces SSO-only authentication when qAdmin is disabled

### Changed

- **Complete rebrand from "Sim-Flow" to "SimRQ"** - Comprehensive update of all identifiers and branding
  - Application name: "SimRQ" (user-facing)
  - Technical identifiers: `sim-rq` (URLs, containers, database, files)
  - GitHub repository: `j-cadena1/sim-rq`
  - Docker containers: `sim-rq-db`, `sim-rq-api`, `sim-rq-frontend`, `sim-rq-playwright`
  - Docker networks: `sim-rq-network`, `sim-rq-dev`
  - Database name: `sim-rq`, user: `sim-rq_user`
  - Test email domain: `@sim-rq.local` (e.g., `qadmin@sim-rq.local`)
  - Prometheus metrics prefix: `sim_rq_*`
  - Backup files: `sim-rq_*.sql.gz`
  - 60+ files updated for complete consistency
- **Tailwind CSS v4 migration** - Migrated from CDN to build-time processing with `@tailwindcss/vite` plugin
  - Eliminates "CDN should not be used in production" warning
  - Faster page loads with pre-compiled CSS
  - Custom theme defined in `index.css` using `@theme` directive
- **WebSocket connection reliability** - Added 100ms delay before Socket.IO connection to prevent race conditions during Vite hot reload
- **README updated** - Added "Deployment Model" section clarifying SSO-first approach and purpose of local accounts
- **API documentation** - Updated to 73/73 endpoints (100% coverage) with new qAdmin management endpoints
- **Database migrations consolidated** - Archived 21 incremental migrations into single `init.sql` for cleaner fresh installs

### Fixed

- WebSocket proxy configuration for Vite dev server (`/socket.io` proxy with `ws: true`)
- Dashboard "Personal Overview" section now correctly hidden for End-User role
- Recharts responsive container dimension warnings (using explicit height instead of percentage)
- Favicon paths corrected (removed `/public/` prefix)
- Docker development volume mounts for `index.tsx`, `index.css`, and `hooks/` directory

## [0.8.1] - 2025-12-08

### Security

- **CRITICAL: Authentication required for `/api/users`** - Fixed unauthenticated user enumeration vulnerability
- **CRITICAL: Encryption key required in production** - Server now fails to start if `SSO_ENCRYPTION_KEY` not set in production
- **HIGH: Authentication required for all project endpoints** - All `/api/projects/*` read endpoints now require authentication
- **HIGH: Rate limiting on session management** - Added `sensitiveOpLimiter` to `/api/auth/sessions` endpoints
- **HIGH: Stronger password requirements for qAdmin** - Minimum 12 characters, uppercase, lowercase, number, special character, no common patterns
- **MEDIUM: Account lockout** - Temporary account lockout after 5 failed login attempts (15 minute cooldown)
- **MEDIUM: Content Security Policy** - Explicit CSP headers configured via Helmet (prevents XSS, clickjacking)
- **Dependency update** - Fixed `jws` high severity vulnerability (improper HMAC signature verification)

### Added

- Login attempt tracking with automatic cleanup (24 hour retention)
- Account lockout service with configurable thresholds

### Changed

- Password complexity requirements: 12+ chars, mixed case, numbers, special characters
- Project listing endpoints now require authentication (prevents business intelligence leakage)
- Session endpoints rate limited to 30 operations per hour
- Enhanced security headers: HSTS (1 year), X-Frame-Options DENY, strict referrer policy

### Documentation

- Added security limitation documentation for PKCE in-memory store (single-instance only)
- Documented CSRF protection strategy (SameSite: strict cookies)
- Updated Swagger docs with security requirements and rate limit info

## [0.8.0] - 2025-12-08

### Added

- **Internal comments**: Engineers, Managers, and Admins can now post private comments not visible to requesters via "Show requester" checkbox
- **Project request workflow**: End-Users can now request projects (created as "Pending" for Manager/Admin approval)
- **100% API documentation**: All 70 endpoints fully documented in Swagger/OpenAPI
- **Comprehensive unit tests**: 51 new tests for project lifecycle state machine (78 total backend tests)
- **True Docker-first architecture**: All testing now runs in containers (`make test`, `make test-e2e`)

### Changed

- Version changed from 1.0.0 to 0.8.0-beta to reflect development status
- Project creation: Managers/Admins create Active projects directly; End-Users/Engineers create Pending projects
- Default comment visibility: Internal (unchecked) by default for staff roles
- Component modularization: Large components split into subdirectories (analytics, projects, settings, request-detail)

### Removed

- Legacy `Approved` project status (migrated to `Active`)
- Redundant documentation files (CONTRIBUTING.md, backend/TESTING.md consolidated into README)

### Fixed

- Dashboard chart tooltips now theme-aware (light/dark mode)
- E2E test race conditions with explicit waits

## [0.7.0] - 2025-12-06

### Added

- Role-based access control (Admin, Manager, Engineer, End-User)
- Complete request lifecycle management with enforced workflow stages
- Database CHECK constraints preventing invalid lifecycle states
- Automatic lifecycle transitions via PostgreSQL triggers
- Project hour tracking and budget allocation
- Microsoft Entra ID (Azure AD) SSO with PKCE authentication
- Session-based authentication with HTTP-only cookies
- Real-time analytics dashboard with charts and metrics
- Comprehensive E2E test suite (86 tests)
- Request status tracking and notifications
- User management with soft delete and historical data preservation
- Audit logging for sensitive operations
- Rate limiting on authentication endpoints
- Dark/light mode theme support
- Responsive design for mobile, tablet, and desktop
- Docker-first deployment strategy
- Makefile for simplified operations
- Database migrations system
- Health check endpoints
- Prometheus metrics endpoint
- Swagger API documentation at `/api-docs`
- Comprehensive security features (Helmet.js, DOMPurify, bcrypt)

### Security

- Session-based authentication (no JWT tokens)
- Rate limiting (30 login attempts per 15 minutes in production)
- Input sanitization with DOMPurify
- Bcrypt password hashing
- Database connection pooling with prepared statements
- CORS protection
- Security headers via Helmet.js
- SSO credentials encrypted at rest

### Documentation

- Comprehensive README with quick start guide
- CONTRIBUTING.md with development workflow
- SECURITY.md with vulnerability reporting process
- GitHub issue and PR templates
- Complete inline code documentation
- Environment variable configuration guide

### Testing

- 86 E2E tests covering all major features
- Authentication and authorization tests
- Lifecycle enforcement verification tests
- Role-based access control tests
- Form validation and sanitization tests
- Analytics dashboard tests
- Navigation and UI tests

[0.9.8]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.9.8
[0.9.7]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.9.7
[0.9.6]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.9.6
[0.9.5]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.9.5
[0.9.4]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.9.4
[0.9.3]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.9.3
[0.9.2]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.9.2
[0.9.1]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.9.1
[0.9.0]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.9.0
[0.8.1]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.8.1
[0.8.0]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.8.0
[0.7.0]: https://github.com/j-cadena1/sim-rq/releases/tag/v0.7.0
