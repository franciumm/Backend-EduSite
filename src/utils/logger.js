import pino from 'pino';
import { config } from '../../config/index.js';

export const logger = pino({
  level: process.env.LOG_LEVEL || (config.env === 'production' ? 'info' : 'debug'),
  transport:
    config.env === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
});