import type { Request, Response, NextFunction } from 'express';

export function requireRole(...roles: string[]) {
  const allowed = roles.map((r) => r.toLowerCase());
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req.profile?.role || '').toLowerCase();
    if (!allowed.includes(userRole)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
