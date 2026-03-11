# Security Policy

## Supported Versions

We release security patches for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via:

1. **GitHub Security Advisories** (preferred): Navigate to the Security tab and click "Report a vulnerability"
2. **Email**: Open a private issue and we'll provide a secure contact method

### What to Include

Please include the following information:

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Suggested fix (if any)
- Your contact information

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Status Updates**: Every 7 days until resolved
- **Fix Timeline**: Critical issues within 30 days, others within 90 days

### Security Best Practices

When deploying Sim RQ:

- Change default admin password immediately
- Use strong database passwords
- Set `SSO_ENCRYPTION_KEY` for SSO deployments
- Configure `CORS_ORIGIN` to your specific domain
- Use HTTPS with a reverse proxy in production
- Restrict database port (5432) to localhost only
- Keep Docker images updated
- Enable rate limiting (enabled by default)
- Review audit logs regularly

### Known Security Features

- Session-based authentication with HTTP-only cookies
- Rate limiting on authentication endpoints
- Helmet.js security headers
- Input sanitization with DOMPurify
- Bcrypt password hashing
- Database connection pooling with prepared statements
- CORS protection
- Audit logging for sensitive operations

---

## Security Architecture

### Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   Nginx     │────▶│   Express   │
│             │◀────│  (TLS 1.3)  │◀────│   Backend   │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                    ┌─────────────────────────┤
                    │                         │
              ┌─────▼─────┐           ┌───────▼───────┐
              │ PostgreSQL│           │ Microsoft     │
              │ Sessions  │           │ Entra ID (SSO)│
              └───────────┘           └───────────────┘
```

**Local Authentication:**
1. User submits email/password to `/api/auth/login`
2. Backend validates credentials, checks lockout status
3. Session created in PostgreSQL, HTTP-only cookie set
4. Cookie includes `SameSite: strict` for CSRF protection

**SSO Authentication (Microsoft Entra ID):**
1. Frontend redirects to `/api/sso/authorize`
2. Backend initiates PKCE flow, stores state in database
3. User authenticates with Microsoft
4. Callback at `/api/auth/sso/callback` validates code
5. Session created, user redirected to frontend

### Authorization Model (4-Tier RBAC)

| Role | Permissions |
|------|-------------|
| **Admin** | Full system access, user management, SSO configuration, audit logs |
| **Manager** | Approve/deny requests, assign engineers, manage projects, view reports |
| **Engineer** | Work on assigned requests, log time, update status (own requests only) |
| **End-User** | Submit requests, view own requests, add comments |

### Data Protection Layers

| Layer | Protection |
|-------|------------|
| **Transport** | TLS 1.2/1.3, HSTS with preload |
| **Session** | HTTP-only cookies, 24h expiry, max 5 per user |
| **Passwords** | bcrypt (12 rounds), minimum length enforced |
| **SSO Secrets** | AES-256-GCM encryption at rest |
| **Database** | Prepared statements, connection pooling |
| **Input** | Zod validation, DOMPurify sanitization |
| **Output** | CSP headers, X-Content-Type-Options |

---

## Operational Security Runbook

### Incident Response Checklist

**1. Detection**
- [ ] Check CSP violation logs: `docker compose logs backend | grep "CSP Violation"`
- [ ] Check failed login attempts: `docker compose logs backend | grep "Failed login"`
- [ ] Review audit logs in Settings > Audit Log

**2. Containment**
- [ ] Lock compromised accounts (Settings > User Management > Deactivate)
- [ ] Revoke all sessions for affected users:
  ```sql
  DELETE FROM sessions WHERE user_id = '<user_id>';
  ```
- [ ] If SSO compromised, disable SSO temporarily:
  ```sql
  UPDATE sso_config SET enabled = false;
  ```

**3. Investigation**
- [ ] Export audit logs for timeframe
- [ ] Check login attempts table:
  ```sql
  SELECT * FROM login_attempts
  WHERE email = '<email>'
  ORDER BY attempted_at DESC LIMIT 50;
  ```

**4. Recovery**
- [ ] Reset affected user passwords
- [ ] Re-enable accounts after password reset
- [ ] Update SSO encryption key if compromised:
  ```bash
  # Generate new 32-character key
  openssl rand -base64 32
  # Update ENTRA_SSO_ENCRYPTION_KEY in .env
  # Restart services - users will need to re-authenticate
  ```

### Log Locations

| Log | Location | Contents |
|-----|----------|----------|
| Backend | `docker compose logs backend` | API requests, auth events, errors |
| Nginx | `docker compose logs frontend` | HTTP access, TLS errors |
| PostgreSQL | `docker compose logs postgres` | Query errors, connection issues |

### Session Management Commands

```bash
# View active sessions count
docker compose exec postgres psql -U sim-rq_user -d sim-rq \
  -c "SELECT user_id, COUNT(*) FROM sessions GROUP BY user_id;"

# Force logout all users
docker compose exec postgres psql -U sim-rq_user -d sim-rq \
  -c "DELETE FROM sessions;"

# Clear login lockouts
docker compose exec postgres psql -U sim-rq_user -d sim-rq \
  -c "DELETE FROM login_attempts WHERE successful = false;"
```

### Database Backup Security

```bash
# Create encrypted backup
docker compose exec postgres pg_dump -U sim-rq_user sim-rq | \
  gpg --symmetric --cipher-algo AES256 > backup-$(date +%Y%m%d).sql.gpg

# Restore from encrypted backup
gpg -d backup-20250101.sql.gpg | \
  docker compose exec -T postgres psql -U sim-rq_user sim-rq
```

---

## Penetration Test Scope

### In-Scope

**Authentication Endpoints:**
- `POST /api/auth/login` - Local authentication
- `POST /api/auth/logout` - Session termination
- `GET /api/sso/authorize` - SSO initiation
- `POST /api/auth/sso/callback` - SSO callback

**Authorization Testing:**
- Role-based access control on all `/api/*` endpoints
- Resource ownership validation (users can only access own data)
- Engineer assignment validation for time entries

**Input Validation:**
- All form inputs (request creation, comments, project data)
- File upload validation (type, size, content)
- SQL injection testing on all database queries

**Session Management:**
- Cookie security attributes
- Session fixation testing
- Concurrent session limits

**Security Headers:**
- CSP enforcement and bypass attempts
- Clickjacking via framing
- MIME type sniffing

### Out-of-Scope

- Microsoft Entra ID infrastructure (third-party)
- AWS/Cloudflare infrastructure (if applicable)
- Physical security
- Social engineering
- Denial of Service attacks

### Test Environment Setup

```bash
# 1. Clone repository and start dev environment
git clone <repo> && cd sim-rq
cp .env.example .env
make dev

# 2. Test credentials (development only)
# Admin: qadmin@sim-rq.local / admin123
# Manager: bob@sim-rq.local / manager123
# Engineer: charlie@sim-rq.local / engineer123
# End-User: alice@sim-rq.local / user123

# 3. API documentation
# http://localhost:3001/api-docs
```

### Expected Security Controls

| Control | Expected Behavior |
|---------|-------------------|
| Rate limiting | 30 requests/15min on auth, 1000/15min on API |
| Account lockout | 5 failed attempts triggers 15-min lockout |
| Session expiry | 24 hours, max 5 concurrent sessions |
| CSRF protection | SameSite=strict cookies |
| XSS protection | CSP blocks inline scripts, DOMPurify on input |

---

## Deployment Security Checklist

### Pre-Deployment Verification

**Environment Variables:**
- [ ] `BOOTSTRAP_ADMIN_PASSWORD` is set only if a temporary local bootstrap admin is needed
- [ ] `DB_PASSWORD` is strong and unique
- [ ] `ENTRA_SSO_ENCRYPTION_KEY` set (32+ characters)
- [ ] `CORS_ORIGIN` set to specific production domain
- [ ] `NODE_ENV=production`
- [ ] `SECURE_COOKIES=true` (if behind HTTPS proxy)

**Network Security:**
- [ ] Database port (5432) not exposed externally
- [ ] Redis port (6379) not exposed externally
- [ ] Only ports 80/443 exposed to internet
- [ ] Firewall rules restrict backend access to nginx only

**TLS Configuration:**
- [ ] Valid TLS certificate installed
- [ ] TLS 1.2+ enforced (no TLS 1.0/1.1)
- [ ] HSTS header present with long max-age
- [ ] Certificate auto-renewal configured (Let's Encrypt)

**Docker Security:**
- [ ] Images pulled from trusted sources
- [ ] No containers running as root (where possible)
- [ ] Secrets not in docker-compose.yaml (use .env)
- [ ] Volume permissions restricted

### Post-Deployment Verification

```bash
# Test security headers
curl -I https://your-domain.com | grep -E "(Strict-Transport|Content-Security|X-Frame)"

# Verify HTTPS redirect
curl -I http://your-domain.com  # Should return 301 to HTTPS

# Test rate limiting
for i in {1..35}; do curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://your-domain.com/api/auth/login; done
# Should see 429 after 30 requests

# Verify CSP reporting
# Check backend logs after browsing the application
docker compose logs backend | grep "CSP Violation"
```

### Security Monitoring

- Enable log aggregation (ELK, CloudWatch, etc.)
- Set up alerts for:
  - Multiple failed login attempts (>10/hour per IP)
  - CSP violations (potential XSS attempts)
  - 5xx error spikes (potential attack)
  - Session creation spikes (credential stuffing)

## Disclosure Policy

When we receive a security bug report, we will:

1. Confirm the issue and determine affected versions
2. Audit code to find similar issues
3. Prepare fixes for all supported versions
4. Release security patches as soon as possible

We appreciate your help in keeping Sim RQ secure!
