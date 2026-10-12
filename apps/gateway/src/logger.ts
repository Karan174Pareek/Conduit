import pino from 'pino';

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  'credential',
  'apiKey',
  'token',
  'secret',
  '*.password',
  '*.credential',
  '*.apiKey',
  '*.token',
  '*.secret',
  'body.password',
  'body.key',
  'body.token',
];

export function createLogger(level = 'info') {
  return pino({
    level,
    redact: {
      paths: REDACTED_PATHS,
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createLogger(process.env['LOG_LEVEL'] || 'info');
