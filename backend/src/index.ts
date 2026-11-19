import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth';
import zonesRouter from './routes/zones';
import unitsRouter from './routes/units';
import milkRouter from './routes/milk';
import tankerRouter from './routes/tanker';
import analyticsRouter from './routes/analytics';
import exportRouter from './routes/export';
import usersRouter from './routes/users';
import settingsRouter from './routes/settings';
import teamsRouter from './routes/teams';

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
}));
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

app.use('/auth', authRouter);
app.use('/zones', zonesRouter);
app.use('/units', unitsRouter);
app.use('/milk', milkRouter);
app.use('/tanker', tankerRouter);
app.use('/analytics', analyticsRouter);
app.use('/export', exportRouter);
app.use('/users', usersRouter);
app.use('/teams', teamsRouter);
app.use('/settings', settingsRouter);

app.listen(PORT, () => {
  console.log(`Aavin backend running on port ${PORT}`);
});
