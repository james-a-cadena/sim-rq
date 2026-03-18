import { Request, Response, NextFunction } from 'express';

export const requireRecentAuth = (req: Request, res: Response, next: NextFunction) => {
  const parsedMinutes = parseInt(process.env.STEP_UP_WINDOW_MINUTES || '15', 10);
  const stepUpWindowMs = (Number.isNaN(parsedMinutes) || parsedMinutes <= 0 ? 15 : parsedMinutes) * 60 * 1000;

  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const authenticatedAt = user.authenticatedAt;
  if (!authenticatedAt) {
    return res.status(403).json({ error: 'step_up_required', message: 'Recent authentication required' });
  }
  const age = Date.now() - new Date(authenticatedAt).getTime();
  if (age > stepUpWindowMs) {
    return res.status(403).json({ error: 'step_up_required', message: 'Recent authentication required. Please sign in again.' });
  }
  next();
};
