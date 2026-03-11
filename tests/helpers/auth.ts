import { Page, request as playwrightRequest } from '@playwright/test';

/**
 * Test Authentication Helper
 *
 * Provides session-based authentication for E2E tests without hitting rate limits.
 * Uses direct session creation instead of login form submission.
 */

export interface TestUser {
  email: string;
  password: string;
  name: string;
  role: 'Admin' | 'Manager' | 'User' | 'Engineer';
}

/**
 * Test user credentials
 *
 * Defaults match database/seed-dev.sql and can be overridden for custom test fixtures.
 */
export const TEST_USERS = {
  admin: {
    email: 'qadmin@sim-rq.local',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.QADMIN_PASSWORD || 'admin123',
    name: 'qAdmin',
    role: 'Admin' as const,
  },
  manager: {
    email: 'bob@sim-rq.local',
    password: process.env.TEST_MANAGER_PASSWORD || 'manager123',
    name: 'Bob Manager',
    role: 'Manager' as const,
  },
  engineer: {
    email: 'charlie@sim-rq.local',
    password: process.env.TEST_ENGINEER_PASSWORD || 'engineer123',
    name: 'Charlie Engineer',
    role: 'Engineer' as const,
  },
  user: {
    email: 'alice@sim-rq.local',
    password: process.env.TEST_USER_PASSWORD || 'user123',
    name: 'Alice User',
    role: 'User' as const,
  },
};

/**
 * Authenticate a user by setting their session cookie directly
 * This bypasses the login form and rate limiting
 */
export async function authenticateUser(page: Page, user: TestUser, baseURL?: string) {
  // Use baseURL from parameter or fall back to environment/default
  const url = baseURL || process.env.BASE_URL || 'http://localhost:8080';

  // Create a new API request context
  const apiContext = await playwrightRequest.newContext({
    baseURL: url,
  });

  try {
    // Call the login API directly to get a session cookie
    const response = await apiContext.post('/api/auth/login', {
      data: {
        email: user.email,
        password: user.password,
      },
    });

    if (!response.ok()) {
      throw new Error(`Login failed: ${response.status()} ${await response.text()}`);
    }

    // Extract the session cookie from the response
    const cookies = await apiContext.storageState();

    // Set the cookies in the browser page context
    await page.context().addCookies(cookies.cookies);

    // Navigate to home page to activate the session
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  } finally {
    await apiContext.dispose();
  }
}

/**
 * Login as admin user (shorthand)
 */
export async function loginAsAdmin(page: Page, baseURL?: string) {
  await authenticateUser(page, TEST_USERS.admin, baseURL);
}

/**
 * Login as manager user (shorthand)
 */
export async function loginAsManager(page: Page, baseURL?: string) {
  await authenticateUser(page, TEST_USERS.manager, baseURL);
}

/**
 * Login as engineer user (shorthand)
 */
export async function loginAsEngineer(page: Page, baseURL?: string) {
  await authenticateUser(page, TEST_USERS.engineer, baseURL);
}

/**
 * Logout the current user
 */
export async function logout(page: Page) {
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.context().clearCookies();
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}
