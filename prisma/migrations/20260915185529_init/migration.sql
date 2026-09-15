-- CreateTable
CREATE TABLE "searches" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trends" TEXT[],
    "filters" JSONB NOT NULL,
    "trendAnalysis" JSONB NOT NULL,

    CONSTRAINT "searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_results" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "trendMatched" TEXT[],
    "financialData" JSONB NOT NULL,
    "dataQuality" JSONB NOT NULL,
    "compositeScore" DOUBLE PRECISION,
    "convergenceScore" DOUBLE PRECISION,

    CONSTRAINT "search_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceAtAdd" DOUBLE PRECISION NOT NULL,
    "sourceSearchId" TEXT,
    "notes" TEXT,
    "tags" TEXT[],

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trend_portfolios" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trend_portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_items" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,

    CONSTRAINT "portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_scans" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "domains" TEXT[],
    "customPrompt" TEXT,
    "report" JSONB NOT NULL,
    "cachedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_loaded_theses" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searchId" TEXT,

    CONSTRAINT "research_loaded_theses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache_entries" (
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cache_entries_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "search_results_searchId_idx" ON "search_results"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_ticker_key" ON "watchlist_items"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_items_portfolioId_watchlistId_key" ON "portfolio_items"("portfolioId", "watchlistId");

-- CreateIndex
CREATE INDEX "cache_entries_expiresAt_idx" ON "cache_entries"("expiresAt");

-- AddForeignKey
ALTER TABLE "search_results" ADD CONSTRAINT "search_results_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "trend_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
