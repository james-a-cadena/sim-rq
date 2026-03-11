-- SimRQ Database Schema
-- PostgreSQL 16
-- Consolidated schema (replaces individual migration files)

-- =============================================================================
-- EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- CORE TABLES
-- =============================================================================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(50) NOT NULL CHECK (role IN ('Admin', 'Manager', 'Engineer', 'End-User')),
    avatar_url TEXT,
    auth_source VARCHAR(50) DEFAULT 'local' CHECK (auth_source IN ('local', 'entra_id')),
    entra_id VARCHAR(255) UNIQUE,
    last_sync_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    is_disabled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Deleted users archive (for historical reference)
CREATE TABLE deleted_users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    deleted_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_by UUID,
    deletion_reason VARCHAR(500),
    original_created_at TIMESTAMPTZ,
    entra_id VARCHAR(255)
);

COMMENT ON TABLE deleted_users IS 'Archive of permanently deleted users for historical reference';

-- =============================================================================
-- PROJECT MANAGEMENT
-- =============================================================================

-- Projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    priority VARCHAR(20) DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
    status VARCHAR(50) NOT NULL CHECK (status IN (
        'Pending', 'Active', 'On Hold', 'Suspended',
        'Completed', 'Cancelled', 'Expired', 'Archived'
    )),
    total_hours INTEGER NOT NULL CHECK (total_hours >= 0),
    used_hours INTEGER DEFAULT 0 CHECK (used_hours >= 0),
    start_date DATE,
    end_date DATE,
    deadline DATE,
    completed_at TIMESTAMPTZ,
    completion_notes TEXT,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    owner_name VARCHAR(255),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT projects_hours_valid CHECK (used_hours <= total_hours),
    CONSTRAINT projects_code_format_check CHECK (code ~ '^\d{6}-\d{4}$')
);

-- Project status history
CREATE TABLE project_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_status VARCHAR(50),
    to_status VARCHAR(50) NOT NULL,
    reason TEXT,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Project milestones
CREATE TABLE project_milestones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    target_date DATE,
    completed_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Skipped')),
    sort_order INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Project hour transactions
CREATE TABLE project_hour_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id UUID,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN (
        'ALLOCATION', 'DEALLOCATION', 'ADJUSTMENT', 'TIME_ENTRY', 'ROLLBACK'
    )),
    hours INTEGER NOT NULL,
    previous_used_hours INTEGER NOT NULL,
    new_used_hours INTEGER NOT NULL,
    reason TEXT,
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    performed_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- REQUEST MANAGEMENT
-- =============================================================================

-- Requests table
CREATE TABLE requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    vendor VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN (
        'Submitted', 'Manager Review', 'Engineering Review', 'Discussion',
        'In Progress', 'Completed', 'Revision Requested', 'Revision Approval',
        'Accepted', 'Denied'
    )),
    priority VARCHAR(20) NOT NULL CHECK (priority IN ('Low', 'Medium', 'High')),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    allocated_hours INTEGER CHECK (allocated_hours >= 0),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_by_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_admin_name VARCHAR(255),
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_to_name VARCHAR(255),
    estimated_hours INTEGER,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT requests_assigned_to_status_check CHECK (
        (assigned_to IS NULL AND status IN ('Submitted', 'Manager Review')) OR
        (assigned_to IS NOT NULL AND status IN (
            'Engineering Review', 'Discussion', 'In Progress', 'Completed',
            'Accepted', 'Denied', 'Revision Requested', 'Revision Approval'
        ))
    )
);

COMMENT ON COLUMN requests.created_by_admin_id IS 'ID of admin who created this request on behalf of another user';
COMMENT ON CONSTRAINT requests_assigned_to_status_check ON requests IS 'Engineers can only be assigned after Manager Review';

-- Comments table
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES requests(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name VARCHAR(255) NOT NULL,
    author_role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    visible_to_requester BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN comments.visible_to_requester IS 'When false, comment is only visible to Engineers, Managers, and Admins';

-- Activity log
CREATE TABLE activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES requests(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Time entries
CREATE TABLE time_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES requests(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255) NOT NULL,
    hours DECIMAL(5,2) NOT NULL CHECK (hours > 0),
    description TEXT,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Title change requests
CREATE TABLE title_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    engineer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_title VARCHAR(255) NOT NULL,
    proposed_title VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Denied')),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewer_comment TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ
);

-- Discussion requests
CREATE TABLE discussion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    engineer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    suggested_hours INTEGER,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Denied')),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    manager_response TEXT,
    allocated_hours INTEGER,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ
);

-- File attachments
CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL CHECK (file_size > 0),
    storage_key VARCHAR(500) NOT NULL UNIQUE,
    thumbnail_key VARCHAR(500),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    uploaded_by_name VARCHAR(255) NOT NULL,
    processing_status VARCHAR(50) DEFAULT 'pending',
    processing_error TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE attachments IS 'File attachments for simulation requests stored in S3-compatible storage';

-- =============================================================================
-- AUTHENTICATION & SECURITY
-- =============================================================================

-- SSO configuration
CREATE TABLE sso_configuration (
    id SERIAL PRIMARY KEY,
    provider VARCHAR(50) NOT NULL DEFAULT 'entra',
    tenant_id VARCHAR(255),
    client_id VARCHAR(255),
    client_secret_encrypted TEXT,
    redirect_uri VARCHAR(512),
    authority VARCHAR(512),
    scopes TEXT DEFAULT 'openid,profile,email',
    enabled BOOLEAN DEFAULT false,
    auto_provision_users BOOLEAN DEFAULT true,
    default_role VARCHAR(50) DEFAULT 'End-User' CHECK (default_role IN ('Admin', 'Manager', 'Engineer', 'End-User')),
    allowed_domains TEXT[],
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Insert default disabled SSO configuration (prevents 404 on Settings page)
INSERT INTO sso_configuration (enabled, scopes) VALUES (false, 'openid,profile,email');

-- Refresh tokens (for session management)
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMPTZ,
    user_agent TEXT,
    ip_address VARCHAR(45),
    revoked BOOLEAN DEFAULT false,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(100)
);

-- Login attempts (rate limiting)
CREATE TABLE login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45),
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    successful BOOLEAN DEFAULT false
);

-- PKCE state storage (for SSO authentication)
CREATE TABLE pkce_states (
    state VARCHAR(255) PRIMARY KEY,
    code_verifier VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE pkce_states IS 'PKCE code verifiers for OAuth 2.0 SSO flow (multi-instance safe)';

-- System settings
CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Pending uploads (for direct S3 upload tracking)
CREATE TABLE pending_uploads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    storage_key VARCHAR(512) NOT NULL UNIQUE,
    file_name VARCHAR(255) NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    uploaded_by_name VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pending_uploads IS 'Tracks in-progress direct uploads to S3. Records expire after 1 hour.';

-- =============================================================================
-- AUDIT & NOTIFICATIONS
-- =============================================================================

-- Audit logs
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_email VARCHAR(255) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(50),
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail of all user actions';

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN (
        'REQUEST_ASSIGNED', 'REQUEST_STATUS_CHANGED', 'REQUEST_COMMENT_ADDED',
        'REQUEST_PENDING_REVIEW', 'PROJECT_PENDING_APPROVAL',
        'APPROVAL_NEEDED', 'APPROVAL_REVIEWED', 'TIME_LOGGED', 'PROJECT_UPDATED',
        'ADMIN_ACTION', 'TITLE_CHANGE_REQUESTED', 'TITLE_CHANGE_REVIEWED',
        'DISCUSSION_REQUESTED', 'DISCUSSION_REVIEWED'
    )),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    link VARCHAR(500),
    read BOOLEAN DEFAULT false NOT NULL,
    entity_type VARCHAR(50) CHECK (entity_type IN ('Request', 'Project', 'User', 'TitleChange', 'Discussion')),
    entity_id UUID,
    triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    emailed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Notification preferences
CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    in_app_enabled BOOLEAN DEFAULT true NOT NULL,
    email_enabled BOOLEAN DEFAULT false NOT NULL,
    email_digest_frequency VARCHAR(20) DEFAULT 'daily' NOT NULL
        CHECK (email_digest_frequency IN ('instant', 'hourly', 'daily', 'weekly', 'never')),
    request_assigned BOOLEAN DEFAULT true NOT NULL,
    request_status_changed BOOLEAN DEFAULT true NOT NULL,
    request_comment_added BOOLEAN DEFAULT true NOT NULL,
    approval_needed BOOLEAN DEFAULT true NOT NULL,
    time_logged BOOLEAN DEFAULT false NOT NULL,
    project_updated BOOLEAN DEFAULT false NOT NULL,
    admin_action BOOLEAN DEFAULT true NOT NULL,
    retention_days INTEGER DEFAULT 30 NOT NULL CHECK (retention_days >= 1 AND retention_days <= 365),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_auth_source ON users(auth_source);
CREATE INDEX idx_users_entra_id ON users(entra_id) WHERE entra_id IS NOT NULL;
CREATE INDEX idx_users_active ON users(id) WHERE deleted_at IS NULL;

-- Projects
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_code ON projects(code);
CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_projects_deadline ON projects(deadline) WHERE deadline IS NOT NULL;

-- Requests
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_created_by ON requests(created_by);
CREATE INDEX idx_requests_assigned_to ON requests(assigned_to);
CREATE INDEX idx_requests_project_id ON requests(project_id);
CREATE INDEX idx_requests_created_at ON requests(created_at DESC);

-- Comments
CREATE INDEX idx_comments_request_id ON comments(request_id);
CREATE INDEX idx_comments_created_at ON comments(created_at);

-- Activity log
CREATE INDEX idx_activity_log_request_id ON activity_log(request_id);
CREATE INDEX idx_activity_log_created_at ON activity_log(created_at DESC);

-- Time entries
CREATE INDEX idx_time_entries_request_id ON time_entries(request_id);
CREATE INDEX idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX idx_time_entries_date ON time_entries(date);

-- Title change requests
CREATE INDEX idx_title_change_requests_request_id ON title_change_requests(request_id);
CREATE INDEX idx_title_change_requests_status ON title_change_requests(status);

-- Discussion requests
CREATE INDEX idx_discussion_requests_request_id ON discussion_requests(request_id);
CREATE INDEX idx_discussion_requests_status ON discussion_requests(status);

-- Attachments
CREATE INDEX idx_attachments_request_id ON attachments(request_id);
CREATE INDEX idx_attachments_uploaded_by ON attachments(uploaded_by);
CREATE INDEX idx_attachments_created_at ON attachments(created_at DESC);
CREATE INDEX idx_attachments_processing_status ON attachments(processing_status) WHERE processing_status != 'completed';

-- Refresh tokens
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- Login attempts
CREATE INDEX idx_login_attempts_email ON login_attempts(email);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address);
CREATE INDEX idx_login_attempts_time ON login_attempts(attempted_at);

-- PKCE states
CREATE INDEX idx_pkce_states_expires_at ON pkce_states(expires_at);

-- Pending uploads
CREATE INDEX idx_pending_uploads_expires_at ON pending_uploads(expires_at);
CREATE INDEX idx_pending_uploads_request_id ON pending_uploads(request_id);

-- Audit logs
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

-- Notifications
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read) WHERE read = false;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_email_pending ON notifications(user_id, created_at) WHERE emailed_at IS NULL;

-- =============================================================================
-- FUNCTIONS & TRIGGERS
-- =============================================================================

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Cleanup old login attempts
CREATE OR REPLACE FUNCTION cleanup_old_login_attempts()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Cleanup expired PKCE states
CREATE OR REPLACE FUNCTION cleanup_expired_pkce_states()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM pkce_states WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Log project status changes
CREATE OR REPLACE FUNCTION log_project_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO project_status_history (
            project_id, from_status, to_status, changed_by, changed_by_name
        ) VALUES (
            NEW.id, OLD.status, NEW.status, NULL, 'System'
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Enforce request lifecycle
CREATE OR REPLACE FUNCTION enforce_request_lifecycle()
RETURNS TRIGGER AS $$
BEGIN
    -- Auto-transition to Engineering Review when engineer assigned
    IF NEW.assigned_to IS NOT NULL AND OLD.assigned_to IS NULL THEN
        IF NEW.status IN ('Submitted', 'Feasibility Review', 'Resource Allocation') THEN
            NEW.status := 'Engineering Review';
        END IF;
    END IF;
    -- Rollback status when engineer unassigned
    IF NEW.assigned_to IS NULL AND OLD.assigned_to IS NOT NULL THEN
        IF NEW.status IN ('Engineering Review', 'In Progress') THEN
            NEW.status := 'Resource Allocation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_requests_updated_at
    BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER log_project_status_changes
    AFTER UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION log_project_status_change();

-- =============================================================================
-- VIEWS
-- =============================================================================

-- Project health metrics
CREATE VIEW project_health_metrics AS
SELECT
    id, name, code, status, priority,
    total_hours, used_hours,
    (total_hours - used_hours) AS available_hours,
    CASE WHEN total_hours = 0 THEN 0
         ELSE ROUND((used_hours::NUMERIC / total_hours::NUMERIC) * 100, 2)
    END AS utilization_percentage,
    deadline,
    CASE
        WHEN deadline IS NULL THEN NULL
        WHEN deadline < CURRENT_DATE AND status NOT IN ('Completed', 'Cancelled', 'Archived', 'Expired') THEN 'Overdue'
        WHEN deadline <= CURRENT_DATE + INTERVAL '7 days' THEN 'Due Soon'
        ELSE 'On Track'
    END AS deadline_status,
    created_at, updated_at
FROM projects;

-- No local users are seeded in the production schema.
-- Development-only accounts live in database/seed-dev.sql.
