import 'dotenv/config';

const parseOrigins = (v) => (v ? v.split(',').map((s) => s.trim()) : ['http://localhost:3000']);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGOCONNECT,
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me',
    expiresIn: process.env.JWT_EXPIRES || '7d',
  },
  cors: {
    origins: parseOrigins(process.env.CORS_ORIGINS),
  },
};