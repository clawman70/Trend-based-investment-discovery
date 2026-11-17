-- Bug B8: a watchlist item starred when its price failed to load was saved with a
-- cost basis of 0, which permanently blanked its gain/loss. Cost basis is now nullable:
-- NULL means "no real price was available", shown as N/A.

-- AlterTable
ALTER TABLE "watchlist_items" ALTER COLUMN "priceAtAdd" DROP NOT NULL;

-- A stored 0 (or negative) was never a real price, only a placeholder for "missing".
UPDATE "watchlist_items" SET "priceAtAdd" = NULL WHERE "priceAtAdd" <= 0;
