/**
 * Singleton Prisma client (Prisma 7 driver-adapter model).
 *
 * Next.js hot-reloads server modules in dev, which would otherwise create a new
 * PrismaClient (and a new connection pool) on every file save. Stashing it on
 * `globalThis` survives the reload.
 *
 * The connection string always falls back to a syntactically-valid placeholder when
 * POSTGRES_PRISMA_URL isn't set. `PrismaPg` doesn't open a connection until the first
 * query, so this never throws at import time in any environment (local dev without
 * Docker, CI, or a test file that imports a store module) — dbHelper.isDbAvailable()
 * is what actually decides whether to use it, and it checks POSTGRES_PRISMA_URL itself
 * before ever issuing a query.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.POSTGRES_PRISMA_URL || 'postgresql://unconfigured:unconfigured@localhost:5432/unconfigured?schema=public';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(databaseUrl),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
