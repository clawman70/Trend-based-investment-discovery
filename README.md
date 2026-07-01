# Trend-Based Investment Discovery Engine (v2.0 Rebuild)

A professional Bloomberg-style research terminal that takes a user's market trend thesis in natural language, discovers publicly traded company candidates using Gemini 3.5 Flash, validates tickers against live directories to drop hallucinations, and enriches them with historical fundamentals from the Financial Modeling Prep (FMP) API.

---

## Key Features

1. **Server-Side API Proxying**: Fixes v1 credentials exposure. All keys are kept server-side in `.env.local` and proxied behind Next.js Route Handlers.
2. **AI Discovery with Reasoning**: Queries `gemini-3.5-flash` utilizing the new `thinkingLevel: "medium"` parameter to identify direct and adjacent candidate companies in a structured JSON schema.
3. **Ticker Validation Pipeline**: Cross-references Gemini-returned symbols against a cached master directory of NYSE/NASDAQ active listings (`/api/v3/stock/list`), dropping hallucinations before financial enrichment.
4. **Resilient Local Development (DB Fallback)**: If no database URL is supplied in `.env.local`, the server logs a warning and automatically falls back to an in-memory caching engine, permitting testing without active PostgreSQL.
5. **Data Quality Integrity Flags**: Distinct badges (`Live Price`, `Growth Live`, `Partial Growth`, `Growth N/A`) represent the veracity and source of all metrics. Omitted fake analyst and price target columns.
6. **Bloomberg Terminal Aesthetic**: Sleek slate-dark palette, responsive glassmorphism input forms, Outfit sans-serif typeface, micro-animations, column sorting, and CSV results exporter.

---

## Directory Architecture

```text
├── Documents/
│   └── Trend-Discovery-2.0-Requirements.md  # Core Spec (Source of Truth)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── discover/route.ts            # Gemini scan & validate pipeline
│   │   │   ├── enrich/route.ts              # FMP quotes & growth stats proxy
│   │   │   └── validate-ticker/route.ts      # Active exchange directory match
│   │   ├── globals.css                      # Tailwind v4 terminal theme definitions
│   │   ├── layout.tsx                       # Core HTML layout & Font loads
│   │   └── page.tsx                         # Main Dashboard Component (React 19)
│   ├── components/
│   │   ├── Header.tsx                       # Neon terminal Header layout
│   │   ├── InputPanel.tsx                   # Filter triggers & prompt library
│   │   ├── ResultsTable.tsx                 # Sortable, CSV exportable, data-flagged grid
│   │   ├── ValidationAlerts.tsx             # Hallucinated ticker drops display
│   │   └── icons.tsx                        # Clean inline SVG symbols
│   ├── hooks/
│   │   └── useSortableData.ts               # Column sorting logic
│   └── lib/
│       ├── csvExporter.ts                   # CSV output generator
│       ├── dbHelper.ts                      # Postgres cache layer & Memory Fallback
│       ├── geminiService.ts                 # Google Gen AI client & prompts
│       ├── prisma.ts                        # Singleton Prisma Client
│       ├── tickerValidator.ts               # Active listing matcher
│       └── types.ts                         # Custom TS Interface bounds
├── prisma/
│   └── schema.prisma                        # Prisma Schema defining Core Tables
├── prisma.config.ts                         # Prisma v7 connection mapper
├── vitest.config.ts                         # Vitest runner settings
└── v1_backup/                               # Preserved original v1 code
```

---

## Environment Configuration

Configure your server variables in `.env.local`:

```env
GOOGLE_GENAI_API_KEY=YOUR_GEMINI_API_KEY
FMP_API_KEY=YOUR_FMP_API_KEY
POSTGRES_PRISMA_URL=                           # Pooled connection string (Vercel Postgres / Neon)
POSTGRES_URL_NON_POOLING=                      # Direct connection string (for migrations)
```

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Prisma Client
```bash
npx prisma generate
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the terminal UI.

---

## Running Verification Tests

The test suite runs unit & integration tests on validators, caches, and Next.js routes using Vitest:

```bash
npx vitest run
```
