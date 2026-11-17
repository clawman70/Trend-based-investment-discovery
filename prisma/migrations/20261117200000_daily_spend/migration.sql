-- Phase E (bug B6): the daily AI spend estimate gets its own table with an atomic
-- increment. Replaces the read-add-write running total kept in cache_entries
-- (key "usage:spend:YYYY-MM-DD"), which lost updates under concurrent AI calls.
CREATE TABLE "daily_spend" (
    "day" TEXT NOT NULL,
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_spend_pkey" PRIMARY KEY ("day")
);
