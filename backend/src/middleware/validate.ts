import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

/**
 * Checks the shape of req.body before the handler runs (types, lengths, ranges).
 * Unknown fields are kept so existing handlers keep working; business rules stay in the handlers.
 */
export function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue.path.join('.') || 'body';
      res.status(400).json({ error: `Invalid ${field}: ${issue.message}` });
      return;
    }
    req.body = result.data;
    next();
  };
}
