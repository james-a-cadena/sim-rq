-- Development-only seed data
-- Loaded by docker-compose.dev.yaml for local development and E2E coverage.

-- Default users (bcrypt cost factor: 12)
-- qAdmin (bootstrap account): admin123
-- Test accounts: user123, manager123, engineer123
INSERT INTO users (name, email, password_hash, role, avatar_url) VALUES
    ('qAdmin', 'qadmin@sim-rq.local', '$2b$12$SjkgsTQA0fR2Wgep.ZOo0OTg2z9ZKgaiV9IVbD.Z1JpAAQ6uc05Ae', 'Admin', 'https://api.dicebear.com/7.x/avataaars/svg?seed=qAdmin'),
    ('Alice User', 'alice@sim-rq.local', '$2b$12$FhfkigL6Hans3oKrIUZffuRIjkrP6JnWLzpZUbF0J0uSzvpKzr4OC', 'End-User', 'https://api.dicebear.com/7.x/avataaars/svg?seed=alice'),
    ('Bob Manager', 'bob@sim-rq.local', '$2b$12$Pfeu0imhApEo2lG1NeTWZ.EGn6VKvHAtLOvL/heACYfIogysUWS9C', 'Manager', 'https://api.dicebear.com/7.x/avataaars/svg?seed=bob'),
    ('Charlie Engineer', 'charlie@sim-rq.local', '$2b$12$FLTxH1QvYc7d0d.f1l7VnePQ7n7vHiAjtMY98tWEN.l2sNDwAv2U6', 'Engineer', 'https://api.dicebear.com/7.x/avataaars/svg?seed=charlie');
