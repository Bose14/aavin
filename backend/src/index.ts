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

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const isLocalOrigin = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0) {
      callback(null, true);
      return;
    }
    const allowsLocal = allowedOrigins.some(isLocalOrigin);
    if (allowedOrigins.includes(origin) || (allowsLocal && isLocalOrigin(origin))) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

app.use('/auth', authRouter);
app.use('/zones', zonesRouter);
app.use('/units', unitsRouter);
app.use('/milk', milkRouter);
app.use('/tanker', tankerRouter);
app.use('/analytics', analyticsRouter);
app.use('/export', exportRouter);
app.use('/users', usersRouter);

app.listen(PORT, () => {
  console.log(`Aavin backend running on port ${PORT}`);
});
