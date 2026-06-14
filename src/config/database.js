import { PrismaClient } from '@prisma/client';
import { dbConfig } from './index.js';

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbConfig.url,
    },
  },
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

export default prisma;
