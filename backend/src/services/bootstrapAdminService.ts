import bcrypt from 'bcrypt';
import { query } from '../db';
import { logger } from '../middleware/logger';

const DEFAULT_BOOTSTRAP_ADMIN_EMAIL = 'qadmin@sim-rq.local';
const DEFAULT_BOOTSTRAP_ADMIN_NAME = 'qAdmin';
const DEFAULT_BOOTSTRAP_ADMIN_AVATAR = 'https://api.dicebear.com/7.x/avataaars/svg?seed=qAdmin';

export type BootstrapAdminResult = 'created' | 'existing' | 'skipped';

interface BootstrapAdminOptions {
  email?: string;
  password?: string;
}

export async function ensureBootstrapAdmin(
  options: BootstrapAdminOptions = {}
): Promise<BootstrapAdminResult> {
  const email = (options.email || DEFAULT_BOOTSTRAP_ADMIN_EMAIL).trim().toLowerCase();
  const password = options.password?.trim();

  if (!password) {
    return 'skipped';
  }

  const existingUser = await query(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [email]
  );

  if (existingUser.rows.length > 0) {
    logger.info(`Bootstrap admin already exists for ${email}`);
    return 'existing';
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await query(
    `INSERT INTO users (name, email, password_hash, role, avatar_url, auth_source)
     VALUES ($1, $2, $3, $4, $5, 'local')`,
    [
      DEFAULT_BOOTSTRAP_ADMIN_NAME,
      email,
      passwordHash,
      'Admin',
      DEFAULT_BOOTSTRAP_ADMIN_AVATAR,
    ]
  );

  logger.info(`Created bootstrap admin for ${email}`);
  return 'created';
}
