# Database Migrations

The database schema has been consolidated into `../init.sql`.

## For Fresh Installations

The `init.sql` file contains the schema for fresh installations. Development-only local accounts live in `../seed-dev.sql` and are mounted only by `docker-compose.dev.yaml`.

## For Existing Databases

If you need to apply changes to an existing database, create a new migration file here with the format:

```text
NNN_description.sql
```

Then apply it manually:

```bash
docker compose exec postgres psql -U "sim-rq_user" -d "sim-rq" -f /docker-entrypoint-initdb.d/migrations/NNN_description.sql
```

## Current Migrations

| Migration                        | Description                      |
|----------------------------------|----------------------------------|
| 001_add_pkce_state_storage.sql   | PKCE state storage for SSO       |
| 002_add_sso_columns.sql          | SSO configuration columns        |
| 019_add_notification_types.sql   | Extended notification type enum  |
| 020_add_email_tracking.sql       | Email digest tracking            |
| 021_add_attachments.sql          | File attachments table           |

## Archive

The `archive/` directory contains the original incremental migrations (003-018) for historical reference. These were consolidated into `init.sql` for cleaner fresh installs.
