import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// The Prisma CLI only auto-loads .env by default; this project follows the Next.js
// convention of keeping local config in .env.local, so load it explicitly here.
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    // CLI commands (migrate, db push) run against the direct/non-pooled connection —
    // pooled connections (e.g. pgbouncer on Vercel Postgres/Neon) don't support the
    // advisory locks and multi-statement transactions Prisma Migrate needs.
    url: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL,
  },
});
