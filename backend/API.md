# Sim RQ API Documentation

This document provides information about the Sim RQ API and how to access the interactive documentation.

## Interactive API Documentation

Sim RQ provides interactive API documentation using Swagger UI (OpenAPI 3.0).

### Accessing the Documentation

**Local Development:**

```text
http://localhost:3001/api-docs
```

**Production/Server:**

```text
http://<your-server>:3001/api-docs
```

### Features

The interactive documentation includes:

- **All API endpoints** organized by category (Auth, Requests, Projects, etc.)
- **Request/Response schemas** with validation rules
- **Try it out** functionality to test endpoints directly from the browser
- **Authentication** support for testing protected endpoints
- **Example requests** and responses
- **Download OpenAPI spec** in JSON format

## API Overview

### Base URL

```text
/api
```

### Authentication

Sim RQ uses **session-based authentication** with HTTP-only cookies:

1. **Login**: `POST /api/auth/login`
   - Credentials: email + password
   - Returns: User object and sets session cookie

2. **SSO Login**: `GET /api/auth/sso/login` (if SSO is configured)
   - Redirects to Microsoft Entra ID
   - Callback: `GET /api/auth/sso/callback`

3. **Session Verification**: `GET /api/auth/verify`
   - Checks if current session is valid
   - Returns user information

4. **Logout**: `POST /api/auth/logout`
   - Clears session cookie

### Role-Based Access Control

The API implements four user roles:

- **Admin**: Full system access
- **Manager**: Approve requests, assign engineers, manage projects
- **Engineer**: Work on assigned requests, track time
- **User**: Submit requests, view their own requests

## API Endpoints

### Authentication (10 endpoints)

- ✅ Fully documented
- `POST /auth/login` - Login with credentials
- `GET /auth/verify` - Verify session
- `POST /auth/logout` - Logout (current session)
- `POST /auth/logout-all` - Logout all sessions
- `POST /auth/logout-others` - Logout other sessions
- `GET /auth/sessions` - List active sessions
- `DELETE /auth/sessions/:id` - Revoke specific session
- `GET /auth/sso/status` - Check SSO configuration
- `GET /auth/sso/login` - Initiate SSO login
- `GET /auth/sso/callback` - SSO callback handler

### Requests (19 endpoints)

- ✅ Fully documented
- **CRUD Operations**: Create, read, update, delete requests
- **Status Management**: Update request status through lifecycle
- **Assignment**: Assign engineers to requests
- **Comments**: Add comments to requests
- **Time Tracking**: Log hours worked
- **Title Changes**: Request and approve title changes
- **Discussions**: Request and approve discussions with managers

### Projects (19 endpoints)

- ✅ Fully documented
- Project CRUD operations
- Status transitions and lifecycle management
- Hour budget tracking
- Request association and reassignment
- Metrics, history, and activity tracking

### Analytics (3 endpoints)

- ✅ Fully documented
- Dashboard statistics
- Completion time analysis
- Hour allocation analysis

### SSO Configuration (3 endpoints)

- ✅ Fully documented
- Get/update SSO settings (qAdmin only)
- Test SSO connection

### User Management (14 endpoints)

- ✅ Fully documented
- List users with management info
- Role management and user sync
- Bulk import from Entra ID directory
- User deactivation/restoration (soft delete)
- Permanent deletion with archival
- Deleted user lookups for historical tooltips
- qAdmin password management
- **qAdmin account disable/enable** (Entra ID admins only):
  - `GET /user-management/qadmin-status` - Check qAdmin status
  - `POST /user-management/qadmin/disable` - Disable local qAdmin login
  - `POST /user-management/qadmin/enable` - Enable local qAdmin login

### Audit Logs (3 endpoints)

- ✅ Fully documented
- Query audit logs with filtering
- Export audit logs to CSV
- Get audit statistics

### Users (2 endpoints)

- ✅ Fully documented
- Get all users
- Get current user profile

**Total API Coverage**: 73/73 endpoints documented (100%) ✅

## Downloading the OpenAPI Specification

The complete OpenAPI 3.0 specification can be downloaded in JSON format:

**Local:**

```bash
curl http://localhost:3001/api-docs.json > sim-rq-api.json
```

**Production:**

```bash
curl http://<your-server>:3001/api-docs.json > sim-rq-api.json
```

You can import this specification into:

- **Postman**: Import > Link > Paste URL
- **Insomnia**: Import/Export > Import from URL
- **VS Code REST Client**: Use the JSON spec to generate requests

## Testing the API

### Using Swagger UI (Recommended)

1. Navigate to `http://localhost:3001/api-docs`
2. Click "Authorize" button (lock icon)
3. Login to get session cookie
4. Click any endpoint to expand
5. Click "Try it out"
6. Fill in parameters
7. Click "Execute"
8. View the response

### Using curl

**Login:**

```bash
# Replace <password> with the current local admin password
curl -c cookies.txt -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"qadmin@sim-rq.local","password":"<password>"}'
```

**Make authenticated request:**

```bash
curl -b cookies.txt http://localhost:3001/api/requests
```

### Using Postman

1. Download spec: `http://localhost:3001/api-docs.json`
2. Import into Postman
3. All endpoints will be available in a collection
4. Set up environment variables for base URL

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **Authentication endpoints**: 30 requests per 15 minutes per IP
- **General API endpoints**: 100 requests per 15 minutes per IP
- **SSO endpoints**: 10 requests per 15 minutes per IP

Rate limit headers are included in responses:

```text
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1234567890
```

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "timestamp": "2025-12-07T12:00:00.000Z",
    "requestId": "abc123"
  }
}
```

Common HTTP status codes:

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (not logged in)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

## Development

### Adding New Endpoints

When adding new API endpoints, document them using Swagger/JSDoc comments:

```typescript
/**
 * @swagger
 * /your-endpoint:
 *   post:
 *     summary: Brief description
 *     tags: [Category]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [field1]
 *             properties:
 *               field1:
 *                 type: string
 *     responses:
 *       201:
 *         description: Success
 */
router.post('/your-endpoint', authenticate, yourHandler);
```

The documentation will automatically appear in Swagger UI.

### Updating Schemas

Edit `backend/src/config/swagger.ts` to add or update schema definitions in the `components.schemas` section.

## Support

For API questions or issues:

- Review the interactive documentation at `/api-docs`
- Check the OpenAPI specification at `/api-docs.json`
- Refer to the source code in `backend/src/routes/`

## Version History

- **v1.1.0** (2025-12-07)
  - Enhanced request documentation (19 endpoints)
  - Added Discussion status support
  - Added Revision Approval status
  - Updated API description with features
  - Created comprehensive API documentation guide

- **v1.0.0** (Initial Release)
  - Basic API documentation structure
  - Authentication endpoints fully documented
  - Core schemas defined
