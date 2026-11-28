import dotenv from 'dotenv';
import path from 'path';
import { getJwtSecret } from '../server/security/controlAuth.js';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export function resolveServerPort(env = process.env) {
  const raw = env.PORT || env.RADIO_PORT || '25637';
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid server port "${raw}": expected an integer between 1 and 65535`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid server port "${raw}": must be between 1 and 65535`);
  }
  return parsed;
}

export const appConfig = {
  port: resolveServerPort(process.env),
  host: process.env.RADIO_LISTEN_HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  get jwtSecret() {
    return getJwtSecret();
  },
  bridgeApiKey: process.env.BRIDGE_API_KEY || '',
};

export function resolveDatabaseUrl(env = process.env) {
  const explicit = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  if (explicit) {
    let parsed;
    try {
      parsed = new URL(explicit);
    } catch {
      throw new Error('Invalid DATABASE_URL: must be a valid PostgreSQL connection URI.');
    }
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      throw new Error(`Invalid DATABASE_URL protocol "${parsed.protocol}": expected postgresql:// or postgres://`);
    }
    if (!parsed.hostname) {
      throw new Error('Invalid DATABASE_URL: hostname is required.');
    }
    return explicit;
  }

  const user = env.POSTGRES_USER || 'ronnbot';
  const pass = env.POSTGRES_PASSWORD || '';
  const host = env.POSTGRES_HOST || 'localhost';
  const portRaw = String(env.POSTGRES_PORT || '5432').trim();
  if (!/^\d+$/.test(portRaw)) {
    throw new Error(`Invalid POSTGRES_PORT "${portRaw}"`);
  }
  const dbName = env.POSTGRES_DB || 'ronnbot_radio';
  const auth = pass
    ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`
    : encodeURIComponent(user);
  return `postgresql://${auth}@${host}:${portRaw}/${encodeURIComponent(dbName)}?schema=public`;
}

export const dbConfig = {
  url: resolveDatabaseUrl(process.env),
};

export const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
};

export const radioConfig = {
  statusUrl: process.env.RADIO_STATUS_URL || `http://${process.env.RADIO_HOST || 'localhost'}:${appConfig.port}/status`,
  streamUrl: process.env.RADIO_STREAM_URL || `http://${process.env.RADIO_HOST || 'localhost'}:${appConfig.port}/stream`,
};

export default {
  app: appConfig,
  db: dbConfig,
  redis: redisConfig,
  radio: radioConfig,
};
