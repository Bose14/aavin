import pino from 'pino';

/** One JSON line per event in production (easy to search in Render logs); readable text locally. */
export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.temp_password'],
    censor: '[redacted]',
  },
});
