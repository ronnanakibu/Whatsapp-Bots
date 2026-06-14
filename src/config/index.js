import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const appConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'ronnbot_default_jwt_secret_key_123456!',
  bridgeApiKey: process.env.BRIDGE_API_KEY || 'bridge_shared_secret_key',
};

export const dbConfig = {
  url: process.env.DATABASE_URL || 'postgresql://ronnbot:ronn_secure_pass@localhost:5432/ronnbot_radio?schema=public',
};

export const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
};

export const radioConfig = {
  statusUrl: process.env.RADIO_STATUS_URL || 'http://ap2.nzb.zelpstore.id:25637/status',
  streamUrl: process.env.RADIO_STREAM_URL || 'http://ap2.nzb.zelpstore.id:25637/stream',
};

export default {
  app: appConfig,
  db: dbConfig,
  redis: redisConfig,
  radio: radioConfig,
};
