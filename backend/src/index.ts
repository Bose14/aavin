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
import teamsRouter from './routes/teams';
import { clearAuthCache } from './middleware/auth';

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
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

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

app.use(express.json({ limit: '5mb' }));

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

app.listen(PORT, () => {
  console.log(`Aavin backend running on port ${PORT}`);
});
