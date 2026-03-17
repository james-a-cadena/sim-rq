import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireRecentAuth } from '../requireRecentAuth';

function makeReq(overrides: Partial<Request> = {}): Request {
  return overrides as unknown as Request;
}

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  return { res, status, json };
}

describe('requireRecentAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STEP_UP_WINDOW_MINUTES;
  });

  afterEach(() => {
    delete process.env.STEP_UP_WINDOW_MINUTES;
  });

  it('should call next() when user authenticated within window (5 minutes ago)', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const req = makeReq({
      user: {
        id: 'user-1',
        userId: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        role: 'Admin',
        authenticatedAt: fiveMinutesAgo,
      },
    });
    const { res } = makeRes();
    const next: NextFunction = vi.fn();

    requireRecentAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('should return 403 step_up_required when user authenticated outside window (20 minutes ago)', () => {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
    const req = makeReq({
      user: {
        id: 'user-1',
        userId: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        role: 'Admin',
        authenticatedAt: twentyMinutesAgo,
      },
    });
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    requireRecentAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'step_up_required' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when no user on request', () => {
    const req = makeReq({});
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    requireRecentAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Authentication required' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when user has no authenticatedAt', () => {
    const req = makeReq({
      user: {
        id: 'user-1',
        userId: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        role: 'Admin',
        // no authenticatedAt
      },
    });
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    requireRecentAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'step_up_required' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should use STEP_UP_WINDOW_MINUTES env var to configure window (5 min window, 4 min old = pass)', () => {
    process.env.STEP_UP_WINDOW_MINUTES = '5';

    const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000);
    const req = makeReq({
      user: {
        id: 'user-1',
        userId: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        role: 'Admin',
        authenticatedAt: fourMinutesAgo,
      },
    });
    const { res } = makeRes();
    const next: NextFunction = vi.fn();

    requireRecentAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('should fall back to 15-min default when STEP_UP_WINDOW_MINUTES is non-numeric (NaN bypass prevention)', () => {
    process.env.STEP_UP_WINDOW_MINUTES = 'abc';

    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
    const req = makeReq({
      user: {
        id: 'user-1',
        userId: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        role: 'Admin',
        authenticatedAt: twentyMinutesAgo,
      },
    });
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    requireRecentAuth(req, res, next);

    // NaN would make age > NaN always false, allowing the request through — must reject instead
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'step_up_required' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should use STEP_UP_WINDOW_MINUTES env var to configure window (5 min window, 6 min old = fail)', () => {
    process.env.STEP_UP_WINDOW_MINUTES = '5';

    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    const req = makeReq({
      user: {
        id: 'user-1',
        userId: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        role: 'Admin',
        authenticatedAt: sixMinutesAgo,
      },
    });
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    requireRecentAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'step_up_required' })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
