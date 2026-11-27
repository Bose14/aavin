import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import dairyUnitsRouter from './routes/dairyUnits';
import bmcsRouter from './routes/bmcs';
import milkRouter from './routes/milk';
import tankerRouter from './routes/tanker';
import analyticsRouter from './routes/analytics';
import exportRouter from './routes/export';
import usersRouter from './routes/users';
import settingsRouter from './routes/settings';
import ratesRouter from './routes/rates';
import receiptsRouter from './routes/receipts';
import teamsRouter from './routes/teams';
import { clearAuthCache } from './middleware/auth';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import { logger } from './lib/logger';

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const isLocalOrigin = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

const isDev = process.env.NODE_ENV !== 'production';

if (allowedOrigins.length === 0) {
  if (isDev) {
    console.warn('[cors] FRONTEND_URL not set — allowing localhost origins only (development mode)');
  } else {
    console.error('[cors] FRONTEND_URL is not set in production — all cross-origin requests will be blocked');
  }
}

app.use(cors({
  origin: (origin, callback) => {
    // Same-origin requests (server-to-server, curl, etc.) have no Origin header — allow
    if (!origin) {
      callback(null, true);
      return;
    }
    // If explicit allow-list is configured, check it
    if (allowedOrigins.length > 0) {
      const allowsLocal = allowedOrigins.some(isLocalOrigin);
      if (allowedOrigins.includes(origin) || (allowsLocal && isLocalOrigin(origin))) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
      return;
    }
    // No allow-list configured: permit localhost in dev, block everything in production
    if (isDev && isLocalOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} not allowed — set FRONTEND_URL to permit it`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition'],
  // Let browsers remember the OPTIONS permission check instead of repeating it before every call
  maxAge: 7200,
}));
// Behind Render's proxy: use the real client address for rate limiting
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, hsts: { maxAge: 15552000, includeSubDomains: true } }));

// Request id + one structured log line per request (shown to the client as X-Request-Id for support)
app.use(pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  autoLogging: { ignore: (req) => req.url === '/health' },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
}));

// Simple per-client limit (fixed one-minute window) against scripted abuse
const RATE_LIMIT = 600;
const hits = new Map<string, { count: number; reset: number }>();
app.use((req, res, next) => {
  if (req.path === '/health') { next(); return; }
  const now = Date.now();
  const key = req.ip ?? 'unknown';
  const entry = hits.get(key);
  if (!entry || entry.reset <= now) {
    hits.set(key, { count: 1, reset: now + 60_000 });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT) {
    res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
    res.status(429).json({ error: 'Too many requests — please slow down' });
    return;
  }
  next();
});

// Tighter limit on account-changing routes (create/reset users etc.), per client address
const SENSITIVE_LIMIT = 60;
const sensitiveHits = new Map<string, { count: number; reset: number }>();
app.use(['/users', '/teams'], (req, res, next) => {
  if (req.method === 'GET') { next(); return; }
  const now = Date.now();
  const key = req.ip ?? 'unknown';
  const entry = sensitiveHits.get(key);
  if (!entry || entry.reset <= now) {
    sensitiveHits.set(key, { count: 1, reset: now + 60_000 });
    if (sensitiveHits.size > 10_000) for (const [k, v] of sensitiveHits) if (v.reset <= now) sensitiveHits.delete(k);
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > SENSITIVE_LIMIT) {
    res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
    res.status(429).json({ error: 'Too many requests — please slow down' });
    return;
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

// Anything that can change who a user is or what they may do invalidates the cached sessions
app.use(['/users', '/teams', '/bmcs'], (req, res, next) => {
  if (req.method !== 'GET') res.on('finish', clearAuthCache);
  next();
});

app.use('/dairy-units', dairyUnitsRouter);
app.use('/bmcs', bmcsRouter);
app.use('/milk', milkRouter);
app.use('/tanker', tankerRouter);
app.use('/analytics', analyticsRouter);
app.use('/export', exportRouter);
app.use('/users', usersRouter);
app.use('/teams', teamsRouter);
app.use('/settings', settingsRouter);
app.use('/rates', ratesRouter);
app.use('/receipts', receiptsRouter);

// Unknown routes
app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });

// Central error handler: never leak internals to the client, always log with the request id
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const e = err as { status?: number; statusCode?: number; type?: string; message?: string };
  const status = e.status ?? e.statusCode ?? 500;
  if (e.type === 'entity.too.large') { res.status(413).json({ error: 'Request is too large' }); return; }
  if (e.type === 'entity.parse.failed') { res.status(400).json({ error: 'Invalid JSON in request body' }); return; }
  if (status >= 400 && status < 500) { res.status(status).json({ error: e.message || 'Bad request' }); return; }
  req.log?.error({ err }, 'unhandled error');
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV ?? 'development' }, 'Aavin backend running');
});

// Finish in-flight requests on deploy/restart, and never die silently
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled promise rejection'));
process.on('uncaughtException', (err) => { logger.fatal({ err }, 'uncaught exception'); process.exit(1); });
